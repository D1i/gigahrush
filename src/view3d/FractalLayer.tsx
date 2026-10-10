// Спец-локация «Фрактальная станция» во вкладке «3D»: своя сцена (src/locations/sceneFractal.ts) в движке просмотрщика
// (BlockoutViewer.setOverlay) и HUD: «клик — войти», подсказки («Упрись в стену — она станет полом», «Сорвёшься —
// упадёшь в повтор»), кольцо упора в стену, «эскалатор!» при срыве, «E — перелезть через балюстраду», звук, отладка.
// В «Прогулке» сцена открывается спуском по бездонному эскалатору метро (src/view3d/fractalAbyss.ts), выход — открытая
// ниша выходной копии (onExit → descend → вестибюль). Смерти и «Ещё раз» нет. Сцена грузится лениво; пока строится
// ячейка — чёрная заглушка. QA-хук window.__rfFractal — в DEV и в режиме «Комната».
import { useEffect, useRef, useState } from 'react';
import { Color4 } from '@babylonjs/core/Maths/math.color';
import type { BlockoutViewer } from './viewer';
import type { CoopSession } from '../coop/session';
import type { FractalHud, FractalQa, FractalScene } from '../locations/sceneFractal';
import './fractal.css';

export interface FractalRequest {
  kind: 'fractal';
  /** уникальный ключ входа (новый — новая сцена) */
  key: string;
  /** locKey(s, id бездны) — одинаков у всех игроков мира */
  seedKey: string;
  title: string;
  /** «Комната» — выход кнопкой; «Прогулка» — выход открытой нишей выходной копии */
  mode: 'room' | 'walk';
  /** кооп (null — один) */
  co: CoopSession | null;
  /** цвет куртки своего аватара (PlayerInfo.slot) */
  slot?: number;
  onExit(): void;
}

const SOUND_KEY = 'room-forge/fractal-sound';
const UP_NAME = ['+X', '−X', '+Y', '−Y', '+Z', '−Z'];
const GROUND = { floor: 'пол', ramp: 'эскалатор', air: 'в воздухе' } as const;

/** Кольцо упора в стену: доля 0…1. */
function PushRing(props: { k: number }) {
  const r = 22, c = 2 * Math.PI * r;
  return (
    <svg className="v3-fr-ring" width="64" height="64" viewBox="0 0 64 64">
      <circle cx="32" cy="32" r={r} className="bg" />
      <circle cx="32" cy="32" r={r} className="fg" strokeDasharray={`${c * props.k} ${c}`} transform="rotate(-90 32 32)" />
    </svg>
  );
}

export function FractalLayer(props: { viewer: BlockoutViewer | null; req: FractalRequest; onClose?(): void; story?: boolean }) {
  const { viewer, req } = props;
  const story = !!props.story;
  const [hud, setHud] = useState<FractalHud | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [debug, setDebug] = useState(false);
  const [sound, setSoundS] = useState(() => localStorage.getItem(SOUND_KEY) !== '0');
  const sceneRef = useRef<FractalScene | null>(null);
  const exitRef = useRef(req.onExit);
  exitRef.current = req.onExit;
  // звук переключили, пока сцена строится (sceneRef ещё пуст), — после create применить актуальное значение
  const soundRef = useRef(sound);
  soundRef.current = sound;

  useEffect(() => {
    if (!viewer) return;
    let alive = true;
    let s: FractalScene | null = null;
    // пока строится ячейка — тьма (спуск во тьму и есть)
    const black = new Color4(0, 0, 0, 1);
    viewer.setOverlay({ render: () => viewer.engine.clear(black, true, true, true), attach() {}, detach() {} });
    const qaHook = import.meta.env.DEV || req.mode === 'room';
    (async () => {
      try {
        const mod = await import('../locations/sceneFractal');
        if (!alive) return;
        const sound0 = soundRef.current;
        s = await mod.FractalScene.create(viewer.engine, viewer.engine.getRenderingCanvas()!, {
          seedKey: req.seedKey,
          sound: sound0,
          co: req.co,
          slot: req.slot,
          onHud: (h) => alive && setHud(h),
          onExit: () => {
            if (alive) exitRef.current();
          },
        });
        if (!alive) {
          s.dispose();
          return;
        }
        sceneRef.current = s;
        if (soundRef.current !== sound0) s.setSound(soundRef.current);
        viewer.setOverlay(s);
        if (qaHook) (window as unknown as { __rfFractal?: FractalQa; __rfFractalScene?: FractalScene }).__rfFractal = s.qa();
        if (import.meta.env.DEV) (window as unknown as { __rfFractalScene?: FractalScene }).__rfFractalScene = s;
        // спустились с захваченной мышью — сразу внутри
        if (document.pointerLockElement === viewer.engine.getRenderingCanvas() || req.mode === 'walk') s.begin();
      } catch (e) {
        console.error(e);
        if (alive) setErr(String((e as Error)?.message ?? e));
      }
    })();
    return () => {
      alive = false;
      viewer.setOverlay(null);
      if (s) s.dispose();
      sceneRef.current = null;
      const w = window as unknown as { __rfFractal?: FractalQa; __rfFractalScene?: FractalScene };
      delete w.__rfFractal;
      delete w.__rfFractalScene;
    };
  }, [viewer, req.key]);

  const setSound = (on: boolean) => {
    soundRef.current = on;
    setSoundS(on);
    try {
      localStorage.setItem(SOUND_KEY, on ? '1' : '0');
    } catch {}
    sceneRef.current?.setSound(on);
  };

  const h = hud;
  const error = err ?? h?.error ?? null;
  const live = !!h && h.ready && !error;
  return (
    <div className="v3-loc v3-fr">
      <div className="float v3-loc-tools">
        <button className={'btn sm' + (sound ? ' on' : '')} onClick={() => setSound(!sound)} title="Звук локации (WebAudio)">
          звук: {sound ? 'вкл' : 'выкл'}
        </button>
        {!story && (
          <label className="check" title="Гравитация, ячейка, fps, видимые копии себя">
            <input type="checkbox" checked={debug} onChange={(e) => setDebug(e.target.checked)} />
            отладка
          </label>
        )}
        {req.mode === 'room' && (
          <button className="btn sm" onClick={() => props.onClose?.()} title="Выйти из локации (только для просмотра комнаты)">
            выйти
          </button>
        )}
      </div>
      {debug && !story && h && (
        <div className="float v3-loc-debug mono">
          <div>
            {req.title} · up <b>{UP_NAME[h.up]}</b> · ячейка {h.cell.join(', ')}
          </div>
          <div>
            {GROUND[h.ground]}
            {h.ride ? ` · ${h.ride.kind} ${h.ride.dir > 0 ? 'вверх' : h.ride.dir < 0 ? 'вниз' : 'стоит'}` : ''}
            {h.alarm ? ` · срыв: ${h.alarm}` : ''}
          </div>
          <div>
            fps {h.fps} · копий себя {h.selfSeen} · напарников {h.mates} · до выхода {h.exitNear ?? '—'} м
          </div>
        </div>
      )}
      {(error || !h || !h.ready) && (
        <div className="v3-loc-center">
          {error ? <div className="v3-err">{error}</div> : <div className="muted">{req.title}…</div>}
          {error && (
            <button className="btn" onClick={() => (req.mode === 'room' ? props.onClose?.() : exitRef.current())}>
              Назад
            </button>
          )}
        </div>
      )}
      {live && !h.started && (
        <div className="v3-loc-center prompt" onClick={() => sceneRef.current?.begin()}>
          <div className="t">{req.title}</div>
          <div>Клик — войти</div>
          <div className="muted">WASD — идти · мышь — смотреть · Shift — бегом · упрись в стену — она станет полом · Esc — отпустить мышь</div>
        </div>
      )}
      {live && h.started && !h.locked && (
        <div className="float hud v3-loc-hint" onClick={() => sceneRef.current?.begin()}>
          <b>Клик</b> — захватить мышь
        </div>
      )}
      {live && h.started && h.pushing > 0.02 && <PushRing k={h.pushing} />}
      {live && h.started && h.alarm && <div className={'v3-fr-alarm ' + h.alarm}>эскалатор!</div>}
      {live && h.started && h.locked && h.hint && <div className="float hud v3-lift-prompt v3-fr-hint">{h.hint}</div>}
    </div>
  );
}
