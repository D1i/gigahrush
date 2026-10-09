// Спец-локация «Бесконечная лестница» во вкладке «3D»: своя сцена (src/locations/sceneStairwell.ts)
// в движке просмотрщика (BlockoutViewer.setOverlay) и минималистичный HUD поверх холста: приглашение
// «клик — войти», экран смерти с «Ещё раз», звук, отладка. Правило игроку не раскрывается — только
// после первой смерти подсказка. Сцена и загрузчик glTF грузятся лениво (import()) при первом входе.
// Сюжет (story, «Запустить без отладки»): отладки нет; Хвататель утащил — не «Ещё раз», а темнота и «очнулся» в общаге
// (req.onFall через STORY_FALL_S или кнопкой «Очнуться»).
import { useEffect, useRef, useState } from 'react';
import { Color4 } from '@babylonjs/core/Maths/math.color';
import type { BlockoutViewer } from './viewer';
import type { StairwellSpec } from '../model/types';
import type { StairwellRoll } from '../locations/stairwell';
import type { StairExit, StairHud, StairMechanics, StairwellScene } from '../locations/sceneStairwell';

export interface LocationRequest {
  /** уникальный ключ входа (новый — новая сцена) */
  key: string;
  spec: StairwellSpec;
  seedKey: string;
  /** розыгрыш экземпляра (из мира: StreamWorld.locationOf); нет — по seedKey */
  roll?: StairwellRoll;
  attempt: number;
  /** подпись (имя комнаты) */
  title: string;
  /** «Комната» — можно выйти кнопкой; «Прогулка» — только ногами через дверь */
  mode: 'room' | 'walk';
  onExit(kind: StairExit, floorsDown: number): void;
  /** сюжет: Хвататель утащил — срыв в общагу (вместо «Ещё раз»); нет — обычная смерть */
  onFall?(): void;
}

/** Сюжет: после смерти — темнота столько мс, потом срыв в общагу (или раньше — «Очнуться»). */
export const STORY_FALL_MS = 2500;

const PHASE: Record<string, string> = { calm: 'тихо', threat: 'угроза', grabbed: 'схвачен', open: 'разомкнута' };
const SOUND_KEY = 'room-forge/stair-sound';

export function StairwellLayer(props: { viewer: BlockoutViewer | null; req: LocationRequest; onClose?(): void; story?: boolean }) {
  const { viewer, req } = props;
  const story = !!props.story;
  const [hud, setHud] = useState<StairHud | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [debug, setDebug] = useState(false);
  const [sound, setSoundS] = useState(() => localStorage.getItem(SOUND_KEY) !== '0');
  const sceneRef = useRef<StairwellScene | null>(null);
  const exitRef = useRef(req.onExit);
  exitRef.current = req.onExit;
  const fallRef = useRef(req.onFall);
  fallRef.current = req.onFall;
  /** сюжет: срыв уже ушёл (таймер или кнопка) */
  const fellRef = useRef(false);

  useEffect(() => {
    if (!viewer) return;
    let alive = true;
    let s: StairwellScene | null = null;
    // пока сцена грузится — темнота (болванка не рисуется и не слушает ввод)
    const black = new Color4(0, 0, 0, 1);
    const blank = { render: () => viewer.engine.clear(black, true, true, true), attach() {}, detach() {} };
    viewer.setOverlay(blank);
    (async () => {
      try {
        const mod = await import('../locations/sceneStairwell');
        if (!alive) return;
        // QA (режим разработки): своя механика или ускоренная спецификация
        const w = window as unknown as { __rfStairMech?: StairMechanics; __rfStairSpec?: Partial<StairwellSpec> };
        const spec = import.meta.env.DEV && w.__rfStairSpec ? { ...req.spec, ...w.__rfStairSpec } : req.spec;
        s = await mod.StairwellScene.create(viewer.engine, viewer.engine.getRenderingCanvas()!, {
          spec,
          seedKey: req.seedKey,
          roll: req.roll,
          attempt: req.attempt,
          sound,
          mech: import.meta.env.DEV ? w.__rfStairMech : undefined,
          onHud: (h) => alive && setHud(h),
          onExit: (k, n) => {
            if (alive) exitRef.current(k, n);
          },
        });
        if (!alive) {
          s.dispose();
          return;
        }
        sceneRef.current = s;
        viewer.setOverlay(s);
        if (import.meta.env.DEV) (window as unknown as { __rfStair?: StairwellScene }).__rfStair = s;
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
      if (import.meta.env.DEV) delete (window as unknown as { __rfStair?: StairwellScene }).__rfStair;
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
  // сюжет: утащили — темнота, через STORY_FALL_MS — в общагу
  const fall = story && !!req.onFall;
  const fallNow = () => {
    if (fellRef.current) return;
    fellRef.current = true;
    fallRef.current?.();
  };
  const dead = !!h?.dead;
  useEffect(() => {
    if (!fall || !dead) return;
    const t = setTimeout(fallNow, STORY_FALL_MS);
    return () => clearTimeout(t);
  }, [fall, dead]);
  return (
    <div className="v3-loc">
      <div className="float v3-loc-tools">
        <button className={'btn sm' + (sound ? ' on' : '')} onClick={() => setSound(!sound)} title="Звук локации (WebAudio)">
          звук: {sound ? 'вкл' : 'выкл'}
        </button>
        {!story && (
          <label className="check" title="Фаза механики, пережито/нужно, близость Хвателя, этаж петли">
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
            {req.title} · попытка {h.attempt + 1} · смертей {h.deaths}
          </div>
          <div>
            фаза <b>{PHASE[h.phase] ?? h.phase}</b> · пережито {h.survived}/{h.needed} · выход на {h.floorsDown} эт. ниже
          </div>
          <div>
            этаж петли {h.floor} · y {h.y.toFixed(2)} м{h.bottom !== null ? ` · низ ${h.bottom}` : ''} · вход {h.backOpen ? 'открыт' : 'закрыт'}
          </div>
          <div className="v3-loc-meter" title="Близость Хвателя">
            <span style={{ width: `${Math.round(h.meter * 100)}%` }} />
          </div>
        </div>
      )}
      {(error || !h || h.loading) && (
        <div className="v3-loc-center">
          {error ? <div className="v3-err">{error}</div> : <div className="muted">Подъезд…</div>}
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
          <div className="muted">WASD — идти · мышь — смотреть · Shift — быстрее · Esc — отпустить мышь</div>
        </div>
      )}
      {h && h.started && !h.locked && !h.dead && (
        <div className="float hud v3-loc-hint" onClick={() => void sceneRef.current?.begin()}>
          <b>Клик</b> — захватить мышь
        </div>
      )}
      {h?.dead && fall && (
        <div className="v3-loc-dead v3-story-fall">
          <div>
            <h2>Хвататель утащил вас вглубь подъезда</h2>
            <p className="hint">…темнота, сырой бетон, где-то капает вода</p>
            <button className="btn" onClick={fallNow}>
              Очнуться
            </button>
          </div>
        </div>
      )}
      {h?.dead && !fall && (
        <div className="v3-loc-dead">
          <div>
            <h2>Хвататель утащил вас вглубь подъезда</h2>
            {h.deaths >= 1 && <p className="hint">Услышав звук снизу — поднимитесь на этаж</p>}
            <button className="btn primary" onClick={() => sceneRef.current?.retry()}>
              Ещё раз
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
