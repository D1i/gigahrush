// Спец-локация «Ангар» во вкладке «3D»: своя сцена (src/locations/sceneHangar.ts) в движке просмотрщика
// (BlockoutViewer.setOverlay) и минималистичный HUD: «клик — войти», подсказка в зоне мини-босса, отладка. В
// «Прогулке» сцена открывается падением (пятно подтаявшего снега пробито), выход — ворота цеха. Сцена грузится лениво.
import { useEffect, useRef, useState } from 'react';
import { Color4 } from '@babylonjs/core/Maths/math.color';
import type { BlockoutViewer } from './viewer';
import type { HangarRoll, HangarSpec } from '../locations/hangar';
import type { HangarHud, HangarScene } from '../locations/sceneHangar';

export interface HangarRequest {
  kind: 'hangar';
  /** уникальный ключ входа (новый — новая сцена) */
  key: string;
  spec: HangarSpec;
  seedKey: string;
  roll?: HangarRoll;
  title: string;
  /** «Комната» — можно выйти кнопкой, стоя у кучи; «Прогулка» — падение, выход только воротами */
  mode: 'room' | 'walk';
  onExit(): void;
}

const SOUND_KEY = 'room-forge/hangar-sound';

export function HangarLayer(props: { viewer: BlockoutViewer | null; req: HangarRequest; onClose?(): void }) {
  const { viewer, req } = props;
  const [hud, setHud] = useState<HangarHud | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [debug, setDebug] = useState(false);
  const [sound, setSoundS] = useState(() => localStorage.getItem(SOUND_KEY) !== '0');
  const sceneRef = useRef<HangarScene | null>(null);
  const exitRef = useRef(req.onExit);
  exitRef.current = req.onExit;

  useEffect(() => {
    if (!viewer) return;
    let alive = true;
    let s: HangarScene | null = null;
    // пока сцена грузится — белая пелена (снег в лицо): провал начинается в берлоге
    const white = new Color4(0.9, 0.93, 1, 1), black = new Color4(0, 0, 0, 1);
    viewer.setOverlay({ render: () => viewer.engine.clear(req.mode === 'walk' ? white : black, true, true, true), attach() {}, detach() {} });
    (async () => {
      try {
        const mod = await import('../locations/sceneHangar');
        if (!alive) return;
        s = await mod.HangarScene.create(viewer.engine, viewer.engine.getRenderingCanvas()!, {
          spec: req.spec,
          seedKey: req.seedKey,
          roll: req.roll,
          fall: req.mode === 'walk',
          sound,
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
        viewer.setOverlay(s);
        if (import.meta.env.DEV) (window as unknown as { __rfHangar?: HangarScene }).__rfHangar = s;
        if (document.pointerLockElement === viewer.engine.getRenderingCanvas() || req.mode === 'walk') void s.begin();
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
      if (import.meta.env.DEV) delete (window as unknown as { __rfHangar?: HangarScene }).__rfHangar;
    };
  }, [viewer, req.key]);

  const setSound = (on: boolean) => {
    setSoundS(on);
    try {
      localStorage.setItem(SOUND_KEY, on ? '1' : '0');
    } catch {}
    sceneRef.current?.setSound(on);
  };

  const h = hud;
  const error = err ?? h?.error ?? null;
  return (
    <div className="v3-loc">
      <div className="float v3-loc-tools">
        <button className={'btn sm' + (sound ? ' on' : '')} onClick={() => setSound(!sound)} title="Звук локации (WebAudio)">
          звук: {sound ? 'вкл' : 'выкл'}
        </button>
        <label className="check" title="Фаза сцены и зона мини-босса">
          <input type="checkbox" checked={debug} onChange={(e) => setDebug(e.target.checked)} />
          отладка
        </label>
        {req.mode === 'room' && (
          <button className="btn sm" onClick={() => props.onClose?.()} title="Выйти из локации (только для просмотра комнаты)">
            выйти
          </button>
        )}
      </div>
      {debug && h && (
        <div className="float v3-loc-debug mono">
          <div>
            {req.title} · {h.phase === 'fall' ? 'падение' : h.phase === 'walk' ? 'цех' : 'выход'} · {h.boss ? 'зона мини-босса' : 'цех'}
          </div>
          <div>{h.sign}</div>
        </div>
      )}
      {(error || !h || h.loading) && (
        <div className="v3-loc-center">
          {error ? <div className="v3-err">{error}</div> : <div className="muted">Ангар…</div>}
          {error && req.mode === 'room' && (
            <button className="btn" onClick={() => props.onClose?.()}>
              Назад
            </button>
          )}
        </div>
      )}
      {h && !h.loading && !error && !h.started && (
        <div className="v3-loc-center prompt" onClick={() => void sceneRef.current?.begin()}>
          <div className="t">{req.title}</div>
          <div>Клик — войти</div>
          <div className="muted">WASD — идти · мышь — смотреть · Shift — бегом · Esc — отпустить мышь</div>
        </div>
      )}
      {h && h.started && !h.locked && h.phase !== 'exit' && (
        <div className="float hud v3-loc-hint" onClick={() => void sceneRef.current?.begin()}>
          <b>Клик</b> — захватить мышь
        </div>
      )}
      {h && h.started && h.locked && h.prompt && <div className="float hud v3-lift-prompt">{h.prompt}</div>}
    </div>
  );
}
