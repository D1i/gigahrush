// Финал игры «Болото на крыше» во вкладке «3D»: своя сцена (src/locations/sceneSwampEnd.ts) в движке просмотрщика
// (BlockoutViewer.setOverlay) и HUD: «клик — войти», подсказка у шестерни и люка, титры «КОНЕЦ» с кнопками. В
// «Прогулке» сцена открывается шагом в комнату «Лестница на крышу»; назад — люк (к той же двери завода). Сцена
// грузится лениво.
import { useEffect, useRef, useState } from 'react';
import { Color4 } from '@babylonjs/core/Maths/math.color';
import type { BlockoutViewer } from './viewer';
import type { SwampRoll, SwampSpec } from '../locations/swampEnd';
import type { SwampHud, SwampScene } from '../locations/sceneSwampEnd';

export interface SwampRequest {
  kind: 'swamp';
  /** уникальный ключ входа (новый — новая сцена) */
  key: string;
  spec: SwampSpec;
  seedKey: string;
  roll?: SwampRoll;
  title: string;
  /** «Комната» — можно выйти кнопкой; «Прогулка» — назад только люком */
  mode: 'room' | 'walk';
  /** 'back' — вернулся на завод (люк или кнопка после титров); 'new' — новая игра (сброс мира) */
  onExit(kind: 'back' | 'new'): void;
}

export function SwampLayer(props: { viewer: BlockoutViewer | null; req: SwampRequest; onClose?(): void }) {
  const { viewer, req } = props;
  const [hud, setHud] = useState<SwampHud | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [debug, setDebug] = useState(false);
  /** «Ещё раз» — пересоздать сцену */
  const [run, setRun] = useState(0);
  const sceneRef = useRef<SwampScene | null>(null);
  const exitRef = useRef(req.onExit);
  exitRef.current = req.onExit;

  useEffect(() => {
    if (!viewer) return;
    let alive = true;
    let s: SwampScene | null = null;
    const black = new Color4(0, 0, 0, 1);
    viewer.setOverlay({ render: () => viewer.engine.clear(black, true, true, true), attach() {}, detach() {} });
    setHud(null);
    (async () => {
      try {
        const mod = await import('../locations/sceneSwampEnd');
        if (!alive) return;
        s = await mod.SwampScene.create(viewer.engine, viewer.engine.getRenderingCanvas()!, {
          spec: req.spec,
          seedKey: req.seedKey,
          roll: req.roll,
          onHud: (h) => alive && setHud(h),
          onExit: (kind) => {
            if (alive) exitRef.current(kind);
          },
        });
        if (!alive) {
          s.dispose();
          return;
        }
        sceneRef.current = s;
        viewer.setOverlay(s);
        if (import.meta.env.DEV) (window as unknown as { __rfSwamp?: SwampScene }).__rfSwamp = s;
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
      if (import.meta.env.DEV) delete (window as unknown as { __rfSwamp?: SwampScene }).__rfSwamp;
    };
  }, [viewer, req.key, run]);

  const h = hud;
  const error = err ?? h?.error ?? null;
  const ended = !!h && h.phase === 'end' && h.title > 0;
  const done = !!h && h.end === 'done';
  // титры дошли — мышь отпустить, чтобы нажать кнопку (оглядеться — клик по сцене снова захватит)
  useEffect(() => {
    if (done && document.pointerLockElement) document.exitPointerLock();
  }, [done]);
  const release = () => {
    if (document.pointerLockElement) document.exitPointerLock();
  };
  return (
    <div className="v3-loc">
      <div className="float v3-loc-tools">
        <label className="check" title="Фаза сцены">
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
            {req.title} · {h.phase === 'walk' ? 'крыша' : h.phase === 'end' ? `финал · ${h.end}` : 'выход'}
          </div>
          <div>{h.titles.lines[1]}</div>
        </div>
      )}
      {(error || !h || h.loading) && (
        <div className="v3-loc-center">
          {error ? <div className="v3-err">{error}</div> : <div className="muted">Крыша…</div>}
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
          <div>Клик — подняться на крышу</div>
          <div className="muted">WASD — идти (грязь по колено) · мышь — смотреть · Shift — быстрее · Esc — отпустить мышь</div>
        </div>
      )}
      {h && h.started && !h.locked && h.phase === 'walk' && (
        <div className="float hud v3-loc-hint" onClick={() => void sceneRef.current?.begin()}>
          <b>Клик</b> — захватить мышь
        </div>
      )}
      {h && h.started && h.phase === 'walk' && h.prompt && <div className="float hud v3-lift-prompt">{h.prompt}</div>}
      {ended && (
        <div className="v3-end" style={{ opacity: h!.title }}>
          <h1>{h!.titles.title}</h1>
          {h!.titles.lines.map((l) => (
            <p key={l}>{l}</p>
          ))}
          {done && (
            <div className="v3-end-btns">
              <button className="btn" onClick={() => { release(); exitRef.current('new'); }} title="Сбросить мир этого сида и начать с начала">
                Новая игра
              </button>
              <button className="btn" onClick={() => setRun((k) => k + 1)} title="Ещё раз подняться на крышу">
                Ещё раз
              </button>
              <button className="btn" onClick={() => { release(); exitRef.current('back'); }} title="Вернуться к лестнице на заводе">
                На завод
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
