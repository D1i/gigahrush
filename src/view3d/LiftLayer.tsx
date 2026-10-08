// Спец-локация «Ржавый лифт» во вкладке «3D»: своя сцена (src/locations/sceneLift.ts) в движке просмотрщика
// (BlockoutViewer.setOverlay) и минималистичный HUD поверх холста: приглашение «клик — войти», подсказка у
// кнопок поста, экран смерти с «Ещё раз», звук, отладка. Правило игроку не раскрывается — только после первой
// смерти подсказка. Сцена и загрузчик glTF грузятся лениво (import()) при первом входе.
import { useEffect, useRef, useState } from 'react';
import { Color4 } from '@babylonjs/core/Maths/math.color';
import type { BlockoutViewer } from './viewer';
import type { LiftSide, LiftSpec } from '../model/types';
import { liftFloorLabel, type LiftRoll } from '../locations/lift';
import type { LiftExitKind, LiftHud, LiftMechanics, LiftScene } from '../locations/sceneLift';

export interface LiftRequest {
  kind: 'lift';
  /** уникальный ключ входа (новый — новая сцена) */
  key: string;
  spec: LiftSpec;
  seedKey: string;
  /** розыгрыш экземпляра (из мира: StreamWorld.locationOf); нет — по seedKey */
  roll?: LiftRoll;
  attempt: number;
  /** возврат в лифт с этажа выше (из комнаты за выходом): этаж и сторона коридора */
  floor?: number;
  side?: LiftSide;
  title: string;
  /** «Комната» — можно выйти кнопкой; «Прогулка» — только ногами через дверь */
  mode: 'room' | 'walk';
  onExit(kind: LiftExitKind, floor: number, lair: boolean): void;
}

const PHASE: Record<string, string> = { idle: 'стоит', moving: 'едет', jammed: 'доска, качает', thrown: 'выброшен', snapped: 'трос оборвался' };
const SIDE: Record<string, string> = { straight: 'прямо', right: 'направо' };
const SOUND_KEY = 'room-forge/lift-sound';

export function LiftLayer(props: { viewer: BlockoutViewer | null; req: LiftRequest; onClose?(): void }) {
  const { viewer, req } = props;
  const [hud, setHud] = useState<LiftHud | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [debug, setDebug] = useState(false);
  const [sound, setSoundS] = useState(() => localStorage.getItem(SOUND_KEY) !== '0');
  const sceneRef = useRef<LiftScene | null>(null);
  const exitRef = useRef(req.onExit);
  exitRef.current = req.onExit;

  useEffect(() => {
    if (!viewer) return;
    let alive = true;
    let s: LiftScene | null = null;
    // пока сцена грузится — темнота (болванка не рисуется и не слушает ввод)
    const black = new Color4(0, 0, 0, 1);
    viewer.setOverlay({ render: () => viewer.engine.clear(black, true, true, true), attach() {}, detach() {} });
    (async () => {
      try {
        const mod = await import('../locations/sceneLift');
        if (!alive) return;
        // QA (режим разработки): своя механика или подправленная спецификация (например, доска всегда)
        const w = window as unknown as { __rfLiftMech?: LiftMechanics; __rfLiftSpec?: Partial<LiftSpec> };
        const spec = import.meta.env.DEV && w.__rfLiftSpec ? { ...req.spec, ...w.__rfLiftSpec } : req.spec;
        s = await mod.LiftScene.create(viewer.engine, viewer.engine.getRenderingCanvas()!, {
          spec,
          seedKey: req.seedKey,
          roll: req.roll,
          attempt: req.attempt,
          floor: req.floor,
          side: req.side,
          sound,
          mech: import.meta.env.DEV ? w.__rfLiftMech : undefined,
          onHud: (h) => alive && setHud(h),
          onExit: (k, f, lair) => {
            if (alive) exitRef.current(k, f, lair);
          },
        });
        if (!alive) {
          s.dispose();
          return;
        }
        sceneRef.current = s;
        viewer.setOverlay(s);
        if (import.meta.env.DEV) (window as unknown as { __rfLift?: LiftScene }).__rfLift = s;
        // вошли с захваченной мышью (шагнули через порог в «Прогулке») — сразу в игру
        if (document.pointerLockElement === viewer.engine.getRenderingCanvas()) void s.begin();
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
      if (import.meta.env.DEV) delete (window as unknown as { __rfLift?: LiftScene }).__rfLift;
    };
  }, [viewer, req.key]);

  const setSound = (on: boolean) => {
    setSoundS(on);
    try {
      localStorage.setItem(SOUND_KEY, on ? '1' : '0');
    } catch {}
    sceneRef.current?.setSound(on);
    if (on) void sceneRef.current?.audio.start();
  };

  const h = hud;
  const error = err ?? h?.error ?? null;
  return (
    <div className="v3-loc">
      <div className="float v3-loc-tools">
        <button className={'btn sm' + (sound ? ' on' : '')} onClick={() => setSound(!sound)} title="Звук локации (WebAudio)">
          звук: {sound ? 'вкл' : 'выкл'}
        </button>
        <label className="check" title="Фаза механики, этаж, крен и амплитуда раскачки, логово">
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
            {req.title} · {h.variant === 'cage' ? 'клетка' : 'каретка'} · попытка {h.attempt + 1} · смертей {h.deaths}
          </div>
          <div>
            фаза <b>{PHASE[h.phase] ?? h.phase}</b> · этаж {liftFloorLabel(h.floor)}
            {h.target !== null ? ` → ${liftFloorLabel(h.target)}` : ''} (шахта {liftFloorLabel(-h.down)}…{liftFloorLabel(h.floors)}) · y{' '}
            {h.y.toFixed(2)} м
          </div>
          <div>
            логово: {h.lair ? `этаж ${liftFloorLabel(h.lair.floor)}, ${SIDE[h.lair.side]}` : 'нет'} ·{' '}
            {h.inCage ? 'в кабине' : `в коридоре этажа ${liftFloorLabel(h.level)}`}
          </div>
          {h.axis && (
            <>
              <div>
                качает по {h.axis === 'x' ? 'ширине' : 'длине'} · крен {h.phi.toFixed(2)} · доска {h.stuck ? 'держит' : 'выпала'}
                {h.variant === 'cage' ? ` · трос ${Math.round(h.wear * 100)}%` : ''}
              </div>
              <div className="v3-loc-meter" title="Амплитуда раскачки (1 — предел)">
                <span style={{ width: `${Math.round(Math.min(1, h.amp) * 100)}%` }} />
              </div>
            </>
          )}
        </div>
      )}
      {(error || !h || h.loading) && (
        <div className="v3-loc-center">
          {error ? <div className="v3-err">{error}</div> : <div className="muted">Шахта…</div>}
          {error && req.mode === 'room' && (
            <button className="btn" onClick={() => props.onClose?.()}>
              Назад
            </button>
          )}
        </div>
      )}
      {h && !h.loading && !error && !h.started && !h.dead && (
        <div className="v3-loc-center prompt" onClick={() => void sceneRef.current?.begin()}>
          <div className="t">{req.title}</div>
          <div>Клик — войти</div>
          <div className="muted">WASD — идти · мышь — смотреть · Shift — бегом · E / Q — кнопки поста · Esc — отпустить мышь</div>
        </div>
      )}
      {h && h.started && !h.locked && !h.dead && (
        <div className="float hud v3-loc-hint" onClick={() => void sceneRef.current?.begin()}>
          <b>Клик</b> — захватить мышь
        </div>
      )}
      {h && h.started && h.locked && !h.dead && h.prompt && <div className="float hud v3-lift-prompt">{h.prompt}</div>}
      {h?.dead && (
        <div className="v3-loc-dead">
          <div>
            <h2>{h.dead.reason === 'snap' ? 'Трос оборвался' : 'Вас выбросило в шахту'}</h2>
            {h.deaths >= 1 && (
              <p className="hint">
                {h.dead.reason === 'snap' ? 'Доска держит клетку, а лебёдка тянет — подбеги к доске и спихни её' : 'Кренит — перебегай на поднявшуюся сторону'}
              </p>
            )}
            <button className="btn primary" onClick={() => sceneRef.current?.retry()}>
              Ещё раз
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
