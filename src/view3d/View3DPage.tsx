// Вкладка «3D»: болванка прогона в Babylon. Слева — источник и параметры болванки, в центре — холст
// (облёт / от первого лица), справа — статистика, самопроверка модели, комната и экспорт.
// Страница грузится лениво (React.lazy в App.tsx) — Babylon не попадает в основной код приложения.
// Складчатый (4D) прогон целиком не строится (комнаты слоёв W накладываются в 3D) — сценой управляет
// FoldDriver (./fold.ts): видимое множество от первого лица, башня слоёв / слой / множество в облёте.
import { useEffect, useMemo, useRef, useState } from 'react';
import { useProject } from '../model/store';
import { notify, useUI } from '../model/ui';
import { generateNow } from '../preview/runActions';
import { downloadText, fmtKB, safeName } from '../preview/util';
import { Btn, Check, NumField, Section, Select } from '../ui/kit';
import { buildBlockoutModel, validateBlockout } from '../blockout/core';
import { hasPvs, isFoldRun, layersOf, localRadiusOf } from '../blockout/subrun';
import { DEFAULT_BLOCKOUT, type BlockoutModel, type BlockoutOptions, type DeadEndMode, type RoomInfo3D, type RunExport, type RunFinish } from '../blockout/types';
import { BlockoutViewer, type CamMode } from './viewer';
import { FoldDriver, layerColor, type FoldOrbitView, type FoldRender, type FoldResume, type FoldState } from './fold';
import { downloadBlob, parseRunJSON, propTexturesOf, runExportOf, singleRoomRun, startInst } from './sources';
import { readWalk, writeWalk, WalkSession, type WalkOptions, type WalkStatus } from './walk';
import { StairwellLayer, type LocationRequest } from './StairwellLayer';
import { LiftLayer, type LiftRequest } from './LiftLayer';
import { LairDecor } from './lairDecor';
import { lairSign } from '../locations/lair';
import type { LiftSide } from '../model/types';
import { locationSeedKey } from '../locations/stairwell';
import { seedKey as worldSeedKey } from '../gen4d/stream';
import { viewHorizonM } from '../gen4d/pvs';
import './view3d.css';

type Source = 'run' | 'room' | 'file' | 'walk';

/** Спец-локация на экране: лестница или лифт (у каждой свой слой и сцена). */
type LocReq = (LocationRequest & { kind: 'stairwell' }) | LiftRequest;
const SIDE_RU: Record<LiftSide, string> = { straight: 'прямо', right: 'направо' };

/** Самопроверка моделей частей складчатого прогона — один раз на модель (модели кэшируются драйвером). */
const validCache = new WeakMap<BlockoutModel, string[] | string>();
function validateOnce(m: BlockoutModel): string[] | string {
  let r = validCache.get(m);
  if (r === undefined) {
    try {
      r = validateBlockout(m);
    } catch (e: any) {
      r = String(e?.message ?? e);
    }
    validCache.set(m, r);
  }
  return r;
}
const sgn = (w: number) => (w > 0 ? `+${w}` : `${w}`);
/** этаж для HUD: «0», «−2» (типографский минус) */
const fmtFloor = (f: number) => (f < 0 ? `−${-f}` : `${f}`);

const OPTS_KEY = 'room-forge/blockout-opts';
const readOpts = (): BlockoutOptions => {
  try {
    return { ...DEFAULT_BLOCKOUT, ...JSON.parse(localStorage.getItem(OPTS_KEY) || '{}') };
  } catch {
    return { ...DEFAULT_BLOCKOUT };
  }
};

// настройки вида (не модели): отделка на стенах и полах; туман на дальности обзора — необязательная
// атмосфера (по умолчанию выкл.: затемнения вдали нет, если место не тёмное по смыслу)
const VIEW_KEY = 'room-forge/blockout-view';
type ViewSettings = { finishes: boolean; fog: boolean };
const readView = (): ViewSettings => {
  try {
    const o = JSON.parse(localStorage.getItem(VIEW_KEY) || '{}');
    return { finishes: o.finishes !== false, fog: o.fog === true };
  } catch {
    return { finishes: true, fog: false };
  }
};

// выбор источника и загруженный файл переживают уход со вкладки
const memo: {
  source: Source;
  file: { name: string; data: RunExport; stamp: number } | null;
  deadRoom: DeadEndMode;
  foldView: FoldOrbitView;
  detector: boolean;
  render: FoldRender;
} = {
  // прогулка переживает перезагрузку страницы (продолжение с того же места)
  source: readWalk().on ? 'walk' : 'run',
  file: null,
  deadRoom: 'open',
  foldView: { kind: 'tower' },
  detector: false,
  render: 'portal',
};

const DEAD: { value: DeadEndMode; label: string }[] = [
  { value: 'panel', label: 'Стена + дверь-заглушка' },
  { value: 'wall', label: 'Глухая стена' },
  { value: 'open', label: 'Открытый проём' },
];

/** Понятный текст ошибки ядра: заглушка TODO → «ещё не готово». */
function coreError(e: unknown): { title: string; text: string } {
  const msg = String((e as any)?.message ?? e);
  if (msg.includes('TODO(blockout-core)'))
    return { title: 'Ядро болванок ещё не готово', text: `src/blockout/core.ts пока не реализован — 3D появится, когда он будет готов.\n${msg}` };
  return { title: 'Не удалось построить болванку', text: msg };
}

export default function View3DPage() {
  const p = useProject();
  const ui = useUI();
  const [source, setSourceS] = useState<Source>(memo.source);
  const [file, setFileS] = useState(memo.file);
  const [fileErr, setFileErr] = useState<string | null>(null);
  const [roomSel, setRoomSel] = useState<string>(ui.roomId ?? p.rooms[0]?.id ?? '');
  const [opts, setOptsS] = useState<BlockoutOptions>(readOpts);
  const [view, setViewS] = useState(readView);
  const setView = (patch: Partial<ViewSettings>) => {
    const next = { ...view, ...patch };
    setViewS(next);
    try {
      localStorage.setItem(VIEW_KEY, JSON.stringify(next));
    } catch {}
  };
  const setFinishes = (v: boolean) => setView({ finishes: v });
  const [deadRoom, setDeadRoomS] = useState<DeadEndMode>(memo.deadRoom);
  const [mode, setModeS] = useState<CamMode>('orbit');
  const [pick, setPick] = useState<string | null>(null);
  const [here, setHere] = useState<string | null>(null);
  const [locked, setLocked] = useState(false);
  const [glErr, setGlErr] = useState<string | null>(null);
  const [sceneInfo, setSceneInfo] = useState<{ ms: number; meshes: number } | null>(null);
  const [sceneErr, setSceneErr] = useState<string | null>(null);
  const [glbBusy, setGlbBusy] = useState(false);
  /** спец-локация (src/locations/): своя сцена поверх болванки, пока задана */
  const [loc, setLoc] = useState<LocReq | null>(null);
  const roomAttempts = useRef(new Map<string, number>());

  const setSource = (s: Source) => {
    setLoc(null);
    memo.source = s;
    setSourceS(s);
    writeWalk({ ...readWalk(), on: s === 'walk' });
  };

  // ── прогулка: бесконечный мир (src/gen4d/stream.ts) ──
  const [walkOpts, setWalkOptsS] = useState<WalkOptions>(() => readWalk());
  const [walkSeedDraft, setWalkSeedDraft] = useState(walkOpts.seed);
  /** что запущено: сид + номер перезапуска (сброс сохранения → тот же сид заново) */
  const [walkRun, setWalkRun] = useState({ seed: walkOpts.seed, n: 0 });
  const [walkRx, setWalkRx] = useState<RunExport | null>(null);
  const [walkStatus, setWalkStatus] = useState<WalkStatus | null>(null);
  const walkRef = useRef<WalkSession | null>(null);
  const setWalkOpt = <K extends keyof WalkOptions>(k: K, v: WalkOptions[K]) => {
    const next = { ...walkOpts, [k]: v };
    setWalkOptsS(next);
    writeWalk({ ...next, on: source === 'walk' });
  };
  const startWalk = (seed: string, reset = false) => {
    const s = seed.trim() || 'гигахрущ';
    if (reset) WalkSession.reset(s);
    const next = { ...walkOpts, seed: s };
    setWalkOptsS(next);
    setWalkSeedDraft(s);
    writeWalk({ ...next, on: true });
    setWalkRun((r) => ({ seed: s, n: r.n + 1 }));
  };
  const setOpt = <K extends keyof BlockoutOptions>(k: K, v: BlockoutOptions[K]) => {
    if (k === 'deadEnds' && source === 'room') {
      memo.deadRoom = v as DeadEndMode;
      setDeadRoomS(v as DeadEndMode);
      return;
    }
    const next = { ...opts, [k]: v };
    setOptsS(next);
    try {
      localStorage.setItem(OPTS_KEY, JSON.stringify(next));
    } catch {}
  };
  const resetOpts = () => {
    setOptsS({ ...DEFAULT_BLOCKOUT });
    memo.deadRoom = 'open';
    setDeadRoomS('open');
    try {
      localStorage.removeItem(OPTS_KEY);
    } catch {}
  };

  // ── источник → RunExport ──
  const rx = useMemo((): { data: RunExport | null; error: string | null; key: string } => {
    try {
      if (source === 'run') {
        if (!ui.run) return { data: null, error: null, key: 'run:none' };
        return { data: runExportOf(p, ui.run), error: null, key: `run:${ui.run.seed}:${ui.run.ms}:${ui.run.instances.length}` };
      }
      if (source === 'room') {
        const run = roomSel ? singleRoomRun(p, roomSel) : null;
        if (!run) return { data: null, error: 'Комната не выбрана', key: 'room:none' };
        return { data: runExportOf(p, run), error: null, key: 'room:' + roomSel };
      }
      if (source === 'walk') return { data: walkRx, error: null, key: `walk:${walkRun.seed}:${walkRun.n}` };
      if (!file) return { data: null, error: null, key: 'file:none' };
      return { data: file.data, error: null, key: `file:${file.name}:${file.stamp}` };
    } catch (e: any) {
      return { data: null, error: 'Экспорт прогона не удался: ' + String(e?.message ?? e), key: 'err' };
    }
  }, [source, ui.run, roomSel, file, p, walkRx, walkRun]);

  const effOpts = useMemo(() => (source === 'room' ? { ...opts, deadEnds: deadRoom } : opts), [opts, source, deadRoom]);
  // складчатый (4D) прогон: целиком не строится — частями через FoldDriver
  const fold = useMemo(() => isFoldRun(rx.data), [rx.data]);

  // ── RunExport → BlockoutModel (ядро) + самопроверка ──
  type Built =
    | { model: BlockoutModel; ms: number; valid: string[] | null; validErr: string | null; error?: undefined }
    | { model?: undefined; error: { title: string; text: string } };
  const built = useMemo((): Built | null => {
    if (!rx.data || fold) return null;
    const t0 = performance.now();
    let model: BlockoutModel;
    try {
      model = buildBlockoutModel(rx.data, effOpts);
    } catch (e) {
      console.error(e);
      return { error: coreError(e) };
    }
    const ms = performance.now() - t0;
    let valid: string[] | null = null;
    let validErr: string | null = null;
    try {
      valid = validateBlockout(model);
    } catch (e: any) {
      validErr = String(e?.message ?? e);
    }
    return { model, ms, valid, validErr };
  }, [rx.data, effOpts, fold]);
  const model = built?.model ?? null;
  const propTextures = useMemo(() => propTexturesOf(p, rx.data), [rx.data, p.props]);

  // ── Babylon: движок живёт, пока открыта вкладка ──
  const stageRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const labelRef = useRef<HTMLDivElement>(null);
  const perfRef = useRef<HTMLDivElement>(null);
  const viewer = useRef<BlockoutViewer | null>(null);
  const driver = useRef<FoldDriver | null>(null);
  const [fs, setFs] = useState<FoldState | null>(null);
  const [foldView, setFoldViewS] = useState<FoldOrbitView>(memo.foldView);
  const [detector, setDetectorS] = useState(memo.detector);
  const [foldRender, setFoldRenderS] = useState<FoldRender>(memo.render);
  const [flash, setFlash] = useState<{ seq: number; text: string; color: string } | null>(null);
  /** клик по комнате в облёте; в виде «видимое множество» — пересобрать вокруг неё */
  const onPickRef = useRef<(inst: string | null) => void>(() => {});
  onPickRef.current = (inst) => {
    setPick(inst);
    if (inst && driver.current && foldView.kind === 'vis' && inst !== foldView.inst) setFoldView({ kind: 'vis', inst }, false);
  };
  useEffect(() => {
    let v: BlockoutViewer | null = null;
    try {
      v = new BlockoutViewer(canvasRef.current!, stageRef.current!, {
        onPick: (inst) => onPickRef.current(inst),
        onRoom: setHere,
        onPointerLock: setLocked,
        onStats: (fps, dc) => {
          // портальный рендер: сколько комнат и проёмов в кадре
          if (v?.hasOverlay) {
            // спец-локация: своя сцена, статистики болванки нет
            if (perfRef.current) perfRef.current.textContent = `${fps.toFixed(0)} fps · спец-локация`;
            return;
          }
          const ps = driver.current?.portalStats;
          const extra = ps ? ` · комнат ${ps.rooms} (${ps.unique}) · проёмов ${ps.portals} · глубина ${ps.levels}` : '';
          if (perfRef.current) perfRef.current.textContent = `${fps.toFixed(0)} fps · ${dc} draw calls${extra}`;
        },
      });
      viewer.current = v;
      // для QA-скриптов в режиме разработки: доступ к сцене из page.evaluate
      if (import.meta.env.DEV) (window as unknown as { __rfViewer?: BlockoutViewer }).__rfViewer = v;
      if (import.meta.env.DEV) (window as any).__rf3d = v; // для QA-скриптов
    } catch (e: any) {
      console.error(e);
      setGlErr(String(e?.message ?? e));
    }
    return () => {
      v?.dispose();
      viewer.current = null;
      if (import.meta.env.DEV) delete (window as any).__rf3d;
    };
  }, []);

  // перестройка сцены при смене модели; камеру вписываем заново только при смене источника
  const fitKey = useRef('');
  useEffect(() => {
    const v = viewer.current;
    if (!v || fold) return; // складчатый прогон строит FoldDriver (эффект ниже)
    setPick(null);
    try {
      const t0 = performance.now();
      const refit = !!model && fitKey.current !== rx.key;
      v.setModel(model, { propTextures, finishes: view.finishes, spawnInst: startInst(rx.data), refit });
      if (model) fitKey.current = rx.key;
      setSceneInfo(model ? { ms: performance.now() - t0, meshes: v.scene.meshes.length } : null);
      setSceneErr(null);
    } catch (e: any) {
      console.error(e);
      v.setModel(null);
      setSceneInfo(null);
      setSceneErr(String(e?.message ?? e));
    }
  }, [model, propTextures, view.finishes, fold]);

  // ── складчатый прогон: драйвер частей; при смене настроек того же прогона — с той же комнаты ──
  const foldResume = useRef<{ key: string; snap: FoldResume } | null>(null);
  useEffect(() => {
    const v = viewer.current;
    if (source === 'walk') return; // прогулкой управляет свой эффект (мир растёт — драйвер не пересоздаётся)
    if (!v || !fold || !rx.data) {
      setFs(null);
      return;
    }
    setPick(null);
    const same = foldResume.current?.key === rx.key;
    let d: FoldDriver | null = null;
    try {
      d = new FoldDriver(
        v,
        rx.data,
        effOpts,
        { propTextures, finishes: view.finishes },
        {
          onState: (s) => {
            setFs(s);
            setSceneInfo({ ms: s.msScene, meshes: v.scene.meshes.length });
          },
        },
        { ...(same ? foldResume.current!.snap : {}), orbitView: memo.foldView, detector: memo.detector, render: memo.render },
      );
      driver.current = d;
      if (import.meta.env.DEV) (window as any).__rf3dFold = d; // для QA-скриптов
      d.apply(!same);
      setSceneErr(null);
    } catch (e: any) {
      console.error(e);
      v.setParts([]);
      setSceneInfo(null);
      setSceneErr(String(e?.message ?? e));
    }
    return () => {
      if (d) {
        foldResume.current = { key: rx.key, snap: d.snapshot };
        d.dispose();
      }
      driver.current = null;
      if (import.meta.env.DEV) delete (window as any).__rf3dFold;
    };
  }, [fold, rx.data, rx.key, effOpts, propTextures, view.finishes, source]);

  // ── прогулка: мир + драйвер; мир растёт — драйвер получает новый прогон (setRun); позиция игрока и мир
  // сохраняются в localStorage — после перезагрузки страницы прогулка продолжается с того же места ──
  useEffect(() => {
    const v = viewer.current;
    if (!v || source !== 'walk') {
      setWalkRx(null);
      setWalkStatus(null);
      return;
    }
    setPick(null);
    let session: WalkSession | null = null;
    let d: FoldDriver | null = null;
    let timer = 0;
    let alive = true;
    // ── спец-локации мира: порог в комнату с Room.location → своя сцена; выход назад — к той же двери,
    // выход вниз — world.descend → комната этажом(ами) ниже; выход лифта — world.ascend → комната этажом(ами)
    // выше, у её метки прихода; оттуда к лифту — шагнуть к этой стене ──
    const attempts = new Map<string, number>();
    const neighbor = (id: string): string | null => {
      const l = session?.rx.links.find((x) => x.kind !== 'descent' && x.kind !== 'lift' && (x.a.inst === id || x.b.inst === id));
      return l ? (l.a.inst === id ? l.b.inst : l.a.inst) : null;
    };
    const locKey = (s: WalkSession, id: string) => locationSeedKey(worldSeedKey(s.world.settings.seed, s.world.settings.mods), s.world.addressOf(id) ?? id);
    /** после выхода из лифта — не войти обратно, пока игрок ещё стоит у стены, через которую пришёл */
    let liftCool = 0;
    const lair = new LairDecor(v.scene);
    const enterLoc = (id: string) => {
      const s = session;
      if (!s || !d || v.hasOverlay) return;
      // спецификация и розыгрыш — из мира (тот же розыгрыш берёт descend / ascend)
      const L = s.world.locationOf(id);
      if (L?.kind === 'lift') {
        const cross = d.current.cross;
        enterLift(id, 0, undefined, cross && cross.to === id ? cross.from : null);
        return;
      }
      if (L?.kind === 'lair') {
        // связи-переходы — только в прогоне мира (в JSON болванки их нет)
        const link = s.world.run().links.find((l) => l.kind === 'lift' && l.b.inst === id);
        const de = link ? d.deadEndAt(id, link.b.connector) : null;
        if (de) lair.show(id, de.center, de.u, de.depth, lairSign(L.spec), L.spec.darkness);
        return;
      }
      if (!L || L.kind !== 'stairwell') return;
      const inst = s.rx.instances.find((i) => i.id === id);
      const cross = d.current.cross;
      const from = cross && cross.to === id ? cross.from : null;
      const n = attempts.get(id) ?? 0;
      attempts.set(id, n + 1);
      setLoc({
        kind: 'stairwell',
        key: `${id}:${Date.now()}`,
        spec: L.spec,
        seedKey: locKey(s, id),
        roll: L.roll,
        attempt: n,
        title: inst?.roomName || 'Подъезд',
        mode: 'walk',
        onExit: (kind) => exitLoc(kind, id, from),
      });
    };
    /** Лифт: с этажа 0 (вошли с площадки) или с этажа floor у коридора side (вернулись из комнаты за выходом). */
    const enterLift = (id: string, floor = 0, side?: LiftSide, from: string | null = null) => {
      const s = session;
      if (!s || !d || v.hasOverlay) return;
      const L = s.world.locationOf(id);
      if (L?.kind !== 'lift') return;
      const inst = s.rx.instances.find((i) => i.id === id);
      const n = attempts.get(id) ?? 0;
      attempts.set(id, n + 1);
      lair.hide();
      setLoc({
        kind: 'lift',
        key: `${id}:${Date.now()}`,
        spec: L.spec,
        seedKey: locKey(s, id),
        roll: L.roll,
        attempt: n,
        floor,
        side,
        title: inst?.roomName || 'Лифт',
        mode: 'walk',
        onExit: (kind, f, isLair) => exitLift(kind, f, isLair, id, from),
      });
    };
    const exitLift = (kind: 'entry' | LiftSide, floor: number, isLair: boolean, id: string, from: string | null) => {
      const s = session;
      const dd = d;
      setLoc(null);
      if (!s || !dd || !alive) return;
      const back = () => dd.placeAtDoor(from ?? neighbor(id) ?? id, id);
      if (kind === 'entry') {
        back();
        return;
      }
      let exitId: string | null = null;
      try {
        exitId = s.world.ascend(id, floor, kind);
      } catch (e) {
        console.error(e);
      }
      if (!exitId) {
        notify('Лифт никуда не вывел: мир не смог поставить комнату выше (см. консоль)', 'error');
        back();
        return;
      }
      const target = exitId;
      const go = (k: number) => {
        if (!alive) return;
        if (!s.rx.instances.some((i) => i.id === target)) {
          if (k < 50) setTimeout(() => go(k + 1), 20);
          return;
        }
        const link = s.world.run().links.find((l) => l.kind === 'lift' && l.a.inst === id && l.b.inst === target);
        dd.goTo(target);
        if (link) dd.placeAtDeadEnd(target, link.b.connector);
        liftCool = performance.now() + 1500;
        const fl = s.world.run().instances.find((i) => i.id === target)?.floor ?? 0;
        const text = `этаж ${fmtFloor(fl)} · ${SIDE_RU[kind]}${isLair ? ' · логово' : ''}`;
        setFlash({ seq: Date.now(), text, color: isLair ? '#e0563f' : '#e8b04b' });
        setTimeout(() => setFlash((f) => (f?.text === text ? null : f)), 1900);
        // логово — темнота и табличка, как при шаге в комнату
        if (s.world.locationOf(target)?.kind === 'lair') enterLoc(target);
      };
      go(0);
    };
    // возврат в лифт: игрок в комнате за выходом лифта шагнул к стене, через которую пришёл
    const liftTimer = window.setInterval(() => {
      const s = session, dd = d;
      if (!s || !dd || v.hasOverlay || v.mode !== 'fps' || performance.now() < liftCool) return;
      const room = dd.portal?.current ?? dd.current.center;
      if (!room) return;
      if (s.world.locationOf(room)?.kind === 'lift') return;
      const c = v.fps.position;
      for (const l of s.world.run().links) {
        if (l.kind !== 'lift' || l.b.inst !== room) continue;
        const de = dd.deadEndAt(room, l.b.connector);
        if (!de || Math.abs(c.y - 1.65 - de.center.y) > 1.5) continue;
        if (Math.hypot(c.x - de.center.x, c.z - de.center.z) < 0.7) {
          enterLift(l.a.inst, l.floors ?? 1, l.side ?? 'straight');
          return;
        }
      }
    }, 100);
    const exitLoc = (kind: 'back' | 'descend', id: string, from: string | null) => {
      const s = session;
      const dd = d;
      setLoc(null);
      if (!s || !dd || !alive) return;
      const back = () => dd.placeAtDoor(from ?? neighbor(id) ?? id, id);
      if (kind === 'back') {
        back();
        return;
      }
      let exitId: string | null = null;
      try {
        exitId = s.world.descend(id);
      } catch (e) {
        console.error(e);
      }
      if (!exitId) {
        notify('Лестница никуда не вывела: мир не смог поставить комнату ниже (см. консоль)', 'error');
        back();
        return;
      }
      // мир вырос (onChange → refresh в микрозадаче) — дождаться комнаты в прогоне драйвера и перейти в неё
      const target = exitId;
      const go = (k: number) => {
        if (!alive) return;
        if (!s.rx.instances.some((i) => i.id === target)) {
          if (k < 50) setTimeout(() => go(k + 1), 20);
          return;
        }
        dd.goTo(target);
        const fl = s.world.run().instances.find((i) => i.id === target)?.floor ?? 0;
        const text = `этаж ${fmtFloor(fl)}`;
        setFlash({ seq: Date.now(), text, color: '#e8b04b' });
        setTimeout(() => setFlash((f) => (f?.text === text ? null : f)), 1700);
      };
      go(0);
    };
    const savePlayer = () => {
      if (!session || !d || v.mode !== 'fps') return;
      const room = d.portal?.current ?? d.current.center;
      if (!room) return;
      const c = v.fps;
      session.savePlayer({ room, pos: [c.position.x, c.position.y, c.position.z], rot: [c.rotation.x, c.rotation.y, c.rotation.z], at: Date.now() });
    };
    try {
      session = walkRef.current = new WalkSession(p, { ...walkOpts, seed: walkRun.seed });
      const s = session;
      const player = s.loadPlayer();
      setWalkRx(s.rx);
      setWalkStatus(s.status());
      v.setMode('fps');
      setModeS('fps');
      d = new FoldDriver(
        v,
        s.rx,
        effOpts,
        { propTextures: propTexturesOf(p, s.rx), finishes: view.finishes },
        {
          onState: (st) => {
            setFs(st);
            setSceneInfo({ ms: st.msScene, meshes: v.scene.meshes.length });
          },
          onEnter: (id) => {
            s.enter(id);
            // ушли из логова — свет обратно
            if (s.world.locationOf(id)?.kind !== 'lair') lair.hide();
            enterLoc(id);
          },
        },
        { center: player?.room ?? null, fpsReady: !!player, orbitView: { kind: 'tower' }, detector: memo.detector, render: 'portal' },
        true,
      );
      const dd = d;
      driver.current = d;
      if (import.meta.env.DEV) {
        (window as any).__rf3dFold = d; // для QA-скриптов
        (window as any).__rfWalk = s;
      }
      s.onUpdate = (nrx, changed) => {
        dd.setRun(nrx, changed);
        setWalkRx(nrx);
        setWalkStatus(s.status());
      };
      d.apply(true);
      if (player) {
        v.fps.position.set(...player.pos);
        v.fps.rotation.set(...player.rot);
        v.fps.cameraDirection.setAll(0);
      }
      timer = window.setInterval(() => {
        savePlayer();
        setWalkStatus(s.status());
      }, 1000);
      setSceneErr(null);
    } catch (e: any) {
      console.error(e);
      v.setParts([]);
      setSceneErr(String(e?.message ?? e));
    }
    const onUnload = () => {
      savePlayer();
      session?.saveNow();
    };
    window.addEventListener('beforeunload', onUnload);
    return () => {
      alive = false;
      setLoc(null);
      window.removeEventListener('beforeunload', onUnload);
      clearInterval(timer);
      clearInterval(liftTimer);
      lair.hide();
      savePlayer();
      d?.dispose();
      session?.dispose();
      walkRef.current = null;
      driver.current = null;
      if (import.meta.env.DEV) {
        delete (window as any).__rf3dFold;
        delete (window as any).__rfWalk;
      }
    };
  }, [source, walkRun, effOpts, view.finishes]);

  // вспышка «W 2 → 3» при переходе через порог со сдвигом
  const crossSeq = fs?.cross?.seq ?? 0;
  useEffect(() => {
    const c = fs?.cross;
    if (!c || c.fromW === c.toW) return;
    setFlash({ seq: c.seq, text: `W ${sgn(c.fromW)} → ${sgn(c.toW)}`, color: layerColor(c.toW) });
    const t = setTimeout(() => setFlash((f) => (f?.seq === c.seq ? null : f)), 1700);
    return () => clearTimeout(t);
  }, [crossSeq]);

  const setFoldView = (fv: FoldOrbitView, refit = true) => {
    memo.foldView = fv;
    setFoldViewS(fv);
    driver.current?.setOrbitView(fv, refit);
  };
  const setFoldRender = (r: FoldRender) => {
    memo.render = r;
    setFoldRenderS(r);
    driver.current?.setRender(r);
  };
  const setDetector = (on: boolean) => {
    memo.detector = on;
    setDetectorS(on);
    driver.current?.setDetector(on);
  };

  // туман на дальности обзора прогона (от первого лица) — необязательная атмосфера, по умолчанию выкл.:
  // портальный рендер открывает проёмы, пока они видны (горизонт viewHorizonM), «Прогулка» раскрывает мир на
  // ту же дальность — затемнять даль не нужно. Обязателен только для «Набора (PVS)»: набор отсекает всё
  // дальше sightM, за его краем — проёмы в темноту, и туман, непрозрачный ровно на пределе, прячет этот край
  const sightM = Number(rx.data?.settings?.sightM ?? 0) || 0;
  const horizonM = viewHorizonM(sightM);
  const fogForced = isFoldRun(rx.data) && fs?.render === 'pvs' && hasPvs(rx.data) && sightM > 0;
  const fog = view.fog;
  const setFog = (on: boolean) => setView({ fog: on });
  useEffect(() => {
    viewer.current?.setFog(fog || fogForced ? sightM : 0);
  }, [fog, fogForced, sightM, mode, model, fs?.models]);

  useEffect(() => {
    viewer.current?.setLabel(labelRef.current, mode === 'orbit' ? pick : null);
  }, [pick, mode, model, fs?.models]);

  const setMode = (m: CamMode) => {
    viewer.current?.setMode(m);
    setModeS(m);
    if (m === 'fps') setPick(null);
    else setHere(null);
    driver.current?.apply(false);
  };

  // ── данные для панелей ──
  /** модели на сцене: одна для обычного прогона, части — для складчатого */
  const shownModels = useMemo<BlockoutModel[]>(() => (fold ? (fs?.models ?? []) : model ? [model] : []), [fold, fs?.models, model]);
  const sum = (f: (m: BlockoutModel) => number) => shownModels.reduce((s, m) => s + f(m), 0);
  const allFinishes = useMemo(() => shownModels.flatMap((m) => m.finishes ?? []), [shownModels]);
  const tierOf = (id: string | null) => (id ? rx.data?.tiers?.find((t) => t.id === id) : undefined);
  const finOf = (id: string | null | undefined) => (id ? allFinishes.find((f) => f.id === id) : undefined);
  /** «стены: Дамаск · пол: Линолеум» — для подписи комнаты */
  const finText = (r: RoomInfo3D) => {
    if (!view.finishes) return '';
    const w = finOf(r.finish?.wall);
    const f = finOf(r.finish?.floor);
    return [w && `стены: ${w.name}`, f && `пол: ${f.name}`].filter(Boolean).join(' · ');
  };

  // отделки, встретившиеся в сцене: сколько граней облицовано, сколько под панелью (dado), сколько полов
  const finStats = useMemo(() => {
    if (!shownModels.length || !view.finishes) return [];
    const by = new Map<string, { fin: RunFinish; faces: number; dado: number; floors: number }>();
    for (const model of shownModels) {
      const get = (id: string) => {
        const fin = model.finishes?.find((f) => f.id === id);
        if (!fin) return null;
        let e = by.get(id);
        if (!e) by.set(id, (e = { fin, faces: 0, dado: 0, floors: 0 }));
        return e;
      };
      for (const f of model.faces ?? []) {
        if (!f.finish) continue;
        const e = get(f.finish);
        if (!e) continue;
        e.faces++;
        if (e.fin.dado && f.z0 < e.fin.dado.heightM) {
          const d = get(e.fin.dado.finishId);
          if (d) d.dado++;
        }
      }
      for (const s of model.floors) {
        const e = s.inst && s.finish ? get(s.finish) : null;
        if (e) e.floors++;
      }
    }
    return [...by.values()].sort((a, b) => b.faces + b.dado + b.floors - (a.faces + a.dado + a.floors));
  }, [shownModels, view.finishes]);
  const roomOf = (inst: string | null) => {
    if (!inst) return undefined;
    for (const m of shownModels) {
      const r = m.rooms.find((x) => x.inst === inst);
      if (r) return r;
    }
    return undefined;
  };
  // от первого лица в складчатом прогоне комната — центр видимого множества (её ведёт драйвер по порогам)
  const shown = roomOf(mode === 'orbit' ? pick : fold ? (fs?.center ?? null) : here);
  const wOfInst = (inst: string | null | undefined) => (inst ? (rx.data?.instances.find((i) => i.id === inst)?.w ?? 0) : 0);
  const floorOf = (inst: string | null | undefined) => (inst ? (rx.data?.instances.find((i) => i.id === inst)?.floor ?? 0) : 0);
  const seed = rx.data?.seed ?? 'run';
  const layers = useMemo(() => (fold && rx.data ? layersOf(rx.data) : []), [fold, rx.data]);
  // потенциально видимые наборы (генератор с бесшовной видимостью)
  const pvs = fold && hasPvs(rx.data);
  const pvsAvg = useMemo(() => {
    const list = pvs && rx.data?.pvs ? Object.values(rx.data.pvs) : [];
    return list.length ? +(list.reduce((s, l) => s + l.length, 0) / list.length).toFixed(1) : 0;
  }, [pvs, rx.data]);
  const visTitle = pvs
    ? 'Видимый набор (PVS) выбранной комнаты: всё, что видно из её пола и проёмов. Клик по комнате — набор вокруг неё'
    : 'Видимое множество выбранной комнаты: она и всё за её дверями. Клик по комнате — множество вокруг неё';
  // новый прогон без запомненного слоя — выбрать слой 0 (или ближайший имеющийся)
  useEffect(() => {
    if (foldView.kind !== 'layer' || !layers.length || layers.includes(foldView.w)) return;
    const w = layers.includes(0) ? 0 : layers[0];
    memo.foldView = { kind: 'layer', w };
    setFoldViewS(memo.foldView);
  }, [layers]);
  // самопроверка частей складчатого прогона (каждая модель — один раз)
  const foldValid = useMemo(() => {
    if (!fold || !fs) return null;
    const list: string[] = [];
    let err: string | null = null;
    for (const m of fs.models) {
      const r = validateOnce(m);
      if (typeof r === 'string') err = r;
      else list.push(...r);
    }
    return { list, err, issues: fs.models.flatMap((m) => m.issues) };
  }, [fold, fs?.models]);
  const foldStats = (rx.data?.fold ?? null) as { minW: number; maxW: number; layers: number; overlaps: number; shifted: number } | null;

  /** Закрыть сцену спец-локации кнопкой («выйти», «Назад»): и отпустить мышь, если сцена её захватила. */
  const closeLoc = () => {
    setLoc(null);
    if (document.pointerLockElement) document.exitPointerLock();
  };

  // ── «Комната» со спец-локацией: войти в её сцену без мира ──
  const selRoom = p.rooms.find((r) => r.id === roomSel) ?? null;
  const enterRoomLoc = () => {
    const room = selRoom;
    const spec = room?.location;
    if (!room || !spec || spec.kind === 'lair') return;
    const n = roomAttempts.current.get(room.id) ?? 0;
    roomAttempts.current.set(room.id, n + 1);
    if (spec.kind === 'lift') {
      setLoc({
        kind: 'lift',
        key: `room:${room.id}:${Date.now()}`,
        spec,
        seedKey: locationSeedKey('room-' + room.id, 'i0'),
        attempt: n,
        title: room.name,
        mode: 'room',
        onExit: (kind, floor, isLair) => {
          setLoc(null);
          if (document.pointerLockElement) document.exitPointerLock();
          notify(
            kind === 'entry'
              ? 'Вышли из лифта назад, на площадку'
              : `Выход ${SIDE_RU[kind]} на этаже ${floor > 0 ? '+' : '−'}${Math.abs(floor)}${isLair ? ' — логово босса' : ''}: в «Прогулке» это комната ${floor > 0 ? 'выше' : 'ниже'}`,
            'ok',
          );
        },
      });
      return;
    }
    setLoc({
      kind: 'stairwell',
      key: `room:${room.id}:${Date.now()}`,
      spec,
      // как у прогона фиксированного размера: сид прогона одной комнаты (singleRoomRun) + id экземпляра
      seedKey: locationSeedKey('room-' + room.id, 'i0'),
      attempt: n,
      title: room.name,
      mode: 'room',
      onExit: (kind, floors) => {
        setLoc(null);
        if (document.pointerLockElement) document.exitPointerLock();
        if (kind === 'descend') notify(`Лестница разомкнулась и вывела вниз на ${floors} эт. — в «Прогулке» это комната этажом ниже`, 'ok');
      },
    });
  };

  const onFile = (f: File | undefined) => {
    if (!f) return;
    f.text().then(
      (t) => {
        try {
          const data = parseRunJSON(t);
          memo.file = { name: f.name, data, stamp: Date.now() };
          setFileS(memo.file);
          setFileErr(null);
        } catch (e: any) {
          setFileErr(String(e?.message ?? e));
        }
      },
      (e) => setFileErr(String(e?.message ?? e)),
    );
  };

  // складчатый прогон: выгружаются части, что сейчас на сцене (одна модель или массив слоёв)
  const dlModel = () =>
    shownModels.length && downloadText(`blockout-${safeName(seed)}.json`, JSON.stringify(shownModels.length === 1 ? shownModels[0] : shownModels, null, 2));
  const dlRun = () => rx.data && downloadText(`run-${safeName(seed)}.json`, JSON.stringify(rx.data, null, 2));
  const dlGLB = async () => {
    const v = viewer.current;
    if (!v || !shownModels.length) return;
    setGlbBusy(true);
    try {
      const blob = await v.exportGLB('blockout');
      downloadBlob(`blockout-${safeName(seed)}.glb`, blob);
      notify(`GLB сохранён (${fmtKB(blob.size)})`, 'ok');
    } catch (e: any) {
      console.error(e);
      notify('Экспорт GLB не удался: ' + String(e?.message ?? e), 'error');
    } finally {
      setGlbBusy(false);
    }
  };

  // сообщение поверх холста
  let msg: { kind: 'info' | 'err'; title: string; text?: string; action?: React.ReactNode } | null = null;
  if (glErr) msg = { kind: 'err', title: 'WebGL недоступен', text: glErr };
  else if (rx.error) msg = { kind: 'err', title: 'Нет данных', text: rx.error };
  else if (!rx.data && source === 'run')
    msg = { kind: 'info', title: 'Прогона ещё нет', text: 'Сгенерируйте раскладку — болванка построится по ней.', action: <Btn variant="primary" onClick={() => generateNow()}>Сгенерировать</Btn> };
  else if (!rx.data && source === 'file') msg = { kind: 'info', title: 'Файл не выбран', text: 'Загрузите JSON прогона (кнопка слева) — тот, что скачивается в «Генераторе».' };
  else if (built?.error) msg = { kind: 'err', ...built.error };
  else if (sceneErr) msg = { kind: 'err', title: 'Ошибка сцены Babylon', text: sceneErr };

  const area = sum((m) => m.rooms.reduce((s, r) => s + r.floorAreaM2, 0));
  const span = (() => {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const m of shownModels) {
      x0 = Math.min(x0, m.bounds.x0);
      y0 = Math.min(y0, m.bounds.y0);
      x1 = Math.max(x1, m.bounds.x1);
      y1 = Math.max(y1, m.bounds.y1);
    }
    return x0 === Infinity ? null : { w: x1 - x0, d: y1 - y0 };
  })();
  const shownW = fold && shown ? wOfInst(shown.inst) : null;

  return (
    <div className="cols3">
      <aside className="side">
        <Section title="Источник">
          <div className="v3-seg four">
            <Btn sm on={source === 'run'} onClick={() => setSource('run')} title="Последний прогон генератора">
              Прогон
            </Btn>
            <Btn sm on={source === 'room'} onClick={() => setSource('room')} title="Одна комната из редактора">
              Комната
            </Btn>
            <Btn sm on={source === 'walk'} onClick={() => setSource('walk')} title="Прогулка: бесконечный складчатый мир от первого лица — комнаты генерируются за дверями по мере ходьбы, мир сохраняется">
              Прогулка
            </Btn>
            <Btn sm on={source === 'file'} onClick={() => setSource('file')} title="JSON прогона с диска">
              Файл
            </Btn>
          </div>
          {source === 'run' && (
            <div className="v3-src">
              {ui.run ? (
                <>
                  <div>
                    Сид <span className="mono">{ui.run.seed}</span> · комнат {ui.run.instances.length} · зазор {ui.run.settings.gap} кл
                    {fold && <> · складчатый (4D), слоёв {layers.length}</>}
                  </div>
                  <Btn sm onClick={() => generateNow()} title="Перегенерировать по текущим настройкам «Генератора»">
                    Сгенерировать заново
                  </Btn>
                </>
              ) : (
                <>
                  <div className="hint">Прогона ещё нет.</div>
                  <Btn variant="primary" onClick={() => generateNow()}>
                    Сгенерировать
                  </Btn>
                </>
              )}
            </div>
          )}
          {source === 'room' && (
            <div className="v3-src">
              <Select value={roomSel} options={p.rooms.map((r) => ({ value: r.id, label: r.name + (r.location ? ' · спец-локация' : '') }))} onChange={setRoomSel} />
              <div className="hint">Один экземпляр, rot 0, без розыгрыша спотов. Тупики по умолчанию открыты.</div>
              {(selRoom?.location?.kind === 'stairwell' || selRoom?.location?.kind === 'lift') && (
                <>
                  <Btn variant="primary" onClick={enterRoomLoc} disabled={!!loc || !!glErr} title="Сцена спец-локации сама по себе, без мира: вход у двери, выход назад — через неё же">
                    Войти в локацию
                  </Btn>
                  <div className="hint">
                    {selRoom.location.kind === 'stairwell'
                      ? 'Спец-локация «Бесконечная лестница». В «Прогулке» вход — через дверь комнаты, выход вниз ведёт на этаж ниже.'
                      : 'Спец-локация «Ржавый лифт». В «Прогулке» вход — через дверь шахты, выходы прямо и направо ведут на этажи выше и ниже, к лифту — назад к той же стене.'}
                  </div>
                </>
              )}
              {selRoom?.location?.kind === 'lair' && (
                <div className="hint">Логово босса (заглушка): в «Прогулке» сюда выводит один из выходов лифта — тёмная комната с табличкой.</div>
              )}
            </div>
          )}
          {source === 'walk' && (
            <div className="v3-src v3-walk">
              <div className="v3-walk-seed">
                <input
                  className="input"
                  value={walkSeedDraft}
                  onChange={(e) => setWalkSeedDraft(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && startWalk(walkSeedDraft)}
                  title="Сид мира: тот же сид — тот же мир (и его сохранение)"
                />
                <Btn sm onClick={() => startWalk(walkSeedDraft)} disabled={walkSeedDraft.trim() === walkRun.seed} title="Открыть мир этого сида (сохранённый — с того же места)">
                  Открыть
                </Btn>
              </div>
              <div className="grid2">
                <NumField label="Тупики" value={walkOpts.deadEndChance * 100} min={0} max={100} step={5} digits={0} suffix="%" title="Вероятность, что нераскрытая дверь окажется заколоченной" onChange={(v) => setWalkOpt('deadEndChance', Math.min(1, Math.max(0, v / 100)))} />
                <NumField label="Ветвистость" value={walkOpts.branching} min={0} max={10} step={0.25} title="Множитель веса развилок: 1 — как в пуле, больше — ветвистее" onChange={(v) => setWalkOpt('branching', Math.max(0, v))} />
                <NumField label="Вперёд дверей" value={walkOpts.aheadDoors} min={0} max={16} step={1} digits={0} title="На сколько дверей вперёд мир раскрыт заранее" onChange={(v) => setWalkOpt('aheadDoors', Math.round(v))} />
              </div>
              <div className="v3-seg">
                <Btn sm onClick={() => startWalk('мир-' + Math.random().toString(36).slice(2, 7))} title="Новый мир со случайным сидом и настройками выше">
                  Новый мир
                </Btn>
                <Btn sm onClick={() => startWalk(walkRun.seed, true)} title="Стереть сохранение этого сида и начать его заново (с настройками выше)">
                  Сбросить сохранение
                </Btn>
              </div>
              {walkStatus && (
                <div className="v3-kv">
                  <span>комнат</span>
                  <span>{walkStatus.rooms} · слоёв {walkStatus.layers}</span>
                  <span>тупиков</span>
                  <span>{walkStatus.dead} · не раскрыто дверей {walkStatus.pending}</span>
                  <span>сохранение</span>
                  <span className={walkStatus.error ? 'v3-err' : 'muted'}>
                    {walkStatus.error ?? (walkStatus.saved ? `${new Date(walkStatus.saved.at).toLocaleTimeString()}${walkStatus.saved.bytes ? ` · ${fmtKB(walkStatus.saved.bytes)}` : ''}` : 'ещё нет')}
                  </span>
                </div>
              )}
              {walkStatus?.stale && <div className="v3-err">Сохранение не подошло к проекту (комнаты изменились) — мир начат заново.</div>}
              <div className="hint">
                Настройки выше — для нового мира и после сброса; у сохранённого мира свои. Предел обзора и зазор — из «Генератора». Мир и позиция сохраняются сами.
              </div>
            </div>
          )}
          {source === 'file' && (
            <div className="v3-src">
              <label className="btn v3-file">
                <input type="file" accept=".json,application/json" onChange={(e) => (onFile(e.target.files?.[0]), (e.target.value = ''))} />
                Загрузить JSON прогона…
              </label>
              {file && (
                <div>
                  <span className="mono">{file.name}</span> · комнат {file.data.instances.length}
                  {fold && <> · складчатый (4D), слоёв {layers.length}</>}
                </div>
              )}
              {fileErr && <div className="v3-err">{fileErr}</div>}
            </div>
          )}
        </Section>

        <Section title="Болванка" actions={<Btn sm variant="ghost" onClick={resetOpts} title="Вернуть значения по умолчанию">сброс</Btn>}>
          <div className="grid2">
            <NumField label="Высота стен" value={opts.wallHeightM} min={1.8} max={6} step={0.05} suffix="м" onChange={(v) => setOpt('wallHeightM', v)} />
            <NumField label="Высота дверей" value={opts.doorHeightM} min={1.5} max={opts.wallHeightM} step={0.05} suffix="м" onChange={(v) => setOpt('doorHeightM', v)} />
            <NumField label="Обвязка" value={opts.outerWallCells} min={0} max={20} step={1} digits={0} suffix="кл" title="Толщина наружных стен вокруг пола, клеток" onChange={(v) => setOpt('outerWallCells', Math.round(v))} />
            <NumField label="Перегородка" value={opts.partitionM} min={0.02} max={0.3} step={0.01} suffix="м" title="Толщина перегородки при зазоре 0" onChange={(v) => setOpt('partitionM', v)} />
            <NumField label="Плиты" value={opts.slabM} min={0} max={0.5} step={0.05} suffix="м" title="Толщина плит пола и потолка; 0 — плоскости" onChange={(v) => setOpt('slabM', v)} />
          </div>
          <Select label="Тупики" value={source === 'room' ? deadRoom : opts.deadEnds} options={DEAD} onChange={(v) => setOpt('deadEnds', v)} />
          <Check label="потолки" value={opts.ceilings} onChange={(v) => setOpt('ceilings', v)} />
          <Check label="мебель (декор)" value={opts.props} onChange={(v) => setOpt('props', v)} />
          <Check label="мебель со спотов" value={opts.spotProps} onChange={(v) => setOpt('spotProps', v)} title="Ставить и то, что выпало на спотах" />
          <Check label="заполнять пустоты" value={opts.fillVoids} onChange={(v) => setOpt('fillVoids', v)} title="Замкнутые пустоты (дыры в полу, щели между стенами) — сплошной массой" />
          <Check
            label="отделка (обои, кафель, полы)"
            value={view.finishes}
            onChange={setFinishes}
            title="Облицовка стен и полы по разыгранной отделке комнат; выкл — стены и полы с сеткой блокаута"
          />
        </Section>

        {fold && rx.data && (
          <Section title="Складчатый прогон (4D)">
            <div className="v3-kv">
              <span>слоёв W</span>
              <span>
                {layers.length} ({sgn(layers[0] ?? 0)} … {sgn(layers[layers.length - 1] ?? 0)})
              </span>
              {foldStats && (
                <>
                  <span>пороги со сдвигом</span>
                  <span>
                    {foldStats.shifted} из {rx.data.links.length}
                  </span>
                  <span>в одном месте 3D</span>
                  <span>{foldStats.overlaps} пар комнат</span>
                </>
              )}
              <span>видимость</span>
              {pvs ? (
                <span title="Потенциально видимые наборы из генератора: всё, что видно из пола и проёмов комнаты по прямой сквозь проёмы; комнаты набора не пересекаются">
                  видимый набор (PVS), {pvsAvg} комн. в среднем
                </span>
              ) : (
                <span title="В прогоне нет PVS (генератор без бесшовной видимости) — рендер по соседям за дверями; на порогах двери на краю набора появляются и исчезают">
                  ≤ {fs?.depth ?? 1} двер{(fs?.depth ?? 1) === 1 ? 'ь' : 'и'} (localRadius {localRadiusOf(rx.data)}), без PVS
                </span>
              )}
            </div>
            <div className="cap">Облёт</div>
            <div className="v3-seg">
              <Btn sm on={foldView.kind === 'tower'} onClick={() => setFoldView({ kind: 'tower' })} title="Каждый слой W — свой план, слои друг над другом; пороги со сдвигом — вертикальные линии">
                Башня
              </Btn>
              <Btn sm on={foldView.kind === 'layer'} onClick={() => setFoldView({ kind: 'layer', w: foldView.kind === 'layer' ? foldView.w : (layers.includes(0) ? 0 : (layers[0] ?? 0)) })} title="Один слой W — обычный план без пересечений">
                Слой
              </Btn>
              <Btn sm on={foldView.kind === 'vis'} onClick={() => setFoldView({ kind: 'vis', inst: pick ?? fs?.center ?? null })} title={visTitle}>
                Видимое
              </Btn>
            </div>
            {foldView.kind === 'layer' && (
              <Select
                label="Слой"
                value={String(foldView.w)}
                options={layers.map((w) => ({ value: String(w), label: `W = ${sgn(w)} · комнат ${rx.data!.instances.filter((i) => (i.w ?? 0) === w).length}` }))}
                onChange={(v) => setFoldView({ kind: 'layer', w: Number(v) }, false)}
              />
            )}
            <div className="cap">От первого лица</div>
            <div className="v3-seg">
              <Btn
                sm
                on={foldRender === 'portal'}
                onClick={() => setFoldRender('portal')}
                title="Портальный рендер: каждая комната рисуется только сквозь свой проём (стенсил), рекурсивно — комнаты могут пересекаться в 3D даже в поле зрения, переходы бесшовны"
              >
                Порталы
              </Btn>
              <Btn
                sm
                on={foldRender === 'pvs'}
                onClick={() => setFoldRender('pvs')}
                title="Прежний рендер: видимый набор (PVS) или соседи одной болванкой; бесшовен, только если в наборе нет пересечений"
              >
                Набор (PVS)
              </Btn>
            </div>
            <Check
              label="Детектор 4D (отладка)"
              value={detector}
              onChange={setDetector}
              title="От первого лица: контуры комнат других слоёв, стоящих в 3D там же, где текущая (видны сквозь стены). Заготовка будущих детекторов"
            />
            <div className="hint">
              Весь прогон одной болванкой не строится: комнаты разных слоёв занимают одно место.{' '}
              {foldRender === 'portal'
                ? `От первого лица — портальный рендер: текущая комната рисуется обычно, остальные — только сквозь проёмы, рекурсивно, пока проём виден в кадре (без тумана; горизонт ${+horizonM.toFixed(1)} м — дальше комната за проёмом рисуется без своих проёмов). Комнаты других слоёв в том же месте не видны — включите детектор, чтобы увидеть их контуры. Шаг через середину проёма — комната за ним становится текущей, бесшовно.`
                : pvs
                  ? 'От первого лица строится видимый набор (PVS) текущей комнаты — всё, что из неё видно в пределах обзора; проёмы за его краем открыты в темноту, их прячет туман. Шаг на пол соседа — его набор подменяет текущий целиком, бесшовно.'
                  : 'От первого лица строится видимое множество текущей комнаты (соседи за дверями); шаг на пол соседа — пересборка вокруг него. Синие двери ведут за границу множества (в прогоне нет PVS — на порогах они заметны).'}{' '}
              Янтарные двери (в башне) — в другой слой.
            </div>
          </Section>
        )}

        <Section title="Атмосфера">
          {fogForced ? (
            <>
              <label
                className="check v3-forced"
                title="Набор (PVS) рисует одной болванкой только то, что видно из комнаты в пределах обзора; проёмы за его краем открыты в темноту. Туман, непрозрачный ровно на пределе, прячет этот край — без него на порогах было бы видно, как комнаты появляются и исчезают. Порталам туман не нужен"
              >
                <input type="checkbox" checked disabled />
                туман на дальности обзора ({+sightM.toFixed(1)} м) — нужен режиму «Набор (PVS)»
              </label>
              <div className="hint">Набор отсекает всё дальше предела обзора, туман прячет этот край. В режиме «Порталы» тумана нет.</div>
            </>
          ) : (
            <Check
              label={sightM > 0 ? `туман на дальности обзора (${+sightM.toFixed(1)} м)` : 'туман на дальности обзора (предел не задан)'}
              value={fog}
              onChange={setFog}
              title="Необязательная атмосфера (по умолчанию выкл.): от первого лица взгляд вязнет к пределу обзора генератора, будто пространство не пускает взгляд. Рендеру туман не нужен — без него даль не затемняется"
            />
          )}
        </Section>

        <Section title="Управление" collapsible defaultOpen={false}>
          <div className="hint">
            <b>Облёт:</b> ЛКМ — вращать, ПКМ / Ctrl+ЛКМ — сдвиг, колесо — масштаб, клик по полу — подпись комнаты.
            <br />
            <b>От первого лица:</b> клик — захват мыши, WASD / стрелки — ходьба, Esc — отпустить мышь. Коллизии и гравитация, глаза на 1.6 м.
          </div>
        </Section>
      </aside>

      <div className="stage v3-stage" ref={stageRef}>
        <canvas ref={canvasRef} tabIndex={0} />
        {loc &&
          (loc.kind === 'lift' ? (
            <LiftLayer viewer={viewer.current} req={loc} onClose={closeLoc} />
          ) : (
            <StairwellLayer viewer={viewer.current} req={loc} onClose={closeLoc} />
          ))}
        <div className="float toolbar v3-tools" style={loc ? { display: 'none' } : undefined}>
          <Btn sm on={mode === 'orbit'} onClick={() => setMode('orbit')} title="Облёт: вид сверху под углом, потолки скрыты">
            Облёт
          </Btn>
          <Btn sm on={mode === 'fps'} onClick={() => setMode('fps')} title="От первого лица: WASD + мышь, потолки видны">
            От первого лица
          </Btn>
          <span className="sep" />
          {mode === 'orbit' ? (
            <Btn sm variant="ghost" onClick={() => viewer.current?.fit()} title="Вписать всю карту">
              Вписать
            </Btn>
          ) : (
            <Btn sm variant="ghost" onClick={() => (driver.current ? driver.current.toStart() : viewer.current?.spawn())} title="Вернуться на старт">
              На старт
            </Btn>
          )}
          {fold && mode === 'orbit' && (
            <>
              <span className="sep" />
              <Btn sm on={foldView.kind === 'tower'} onClick={() => setFoldView({ kind: 'tower' })} title="Башня слоёв W">
                Башня
              </Btn>
              <Btn sm on={foldView.kind === 'layer'} onClick={() => setFoldView({ kind: 'layer', w: foldView.kind === 'layer' ? foldView.w : (layers.includes(0) ? 0 : (layers[0] ?? 0)) })} title="Один слой W">
                Слой
              </Btn>
              {foldView.kind === 'layer' && (
                <select className="select v3-wsel" value={foldView.w} onChange={(e) => setFoldView({ kind: 'layer', w: Number(e.target.value) }, false)} title="Слой W">
                  {layers.map((w) => (
                    <option key={w} value={w}>
                      W = {sgn(w)}
                    </option>
                  ))}
                </select>
              )}
              <Btn sm on={foldView.kind === 'vis'} onClick={() => setFoldView({ kind: 'vis', inst: pick ?? fs?.center ?? null })} title={visTitle}>
                Видимое
              </Btn>
            </>
          )}
          {fold && mode === 'fps' && (
            <>
              <span className="sep" />
              <label className="check v3-det" title="Контуры комнат других слоёв в том же месте 3D (сквозь стены)">
                <input type="checkbox" checked={detector} onChange={(e) => setDetector(e.target.checked)} />
                Детектор 4D (отладка)
              </label>
            </>
          )}
        </div>
        {mode === 'fps' && shown && !loc && (
          <div className={'float v3-here' + (fold ? ' fold' : '')}>
            {shown.name} <span className="muted">· {tierOf(shown.tier)?.name ?? 'базовая'}</span>
            {shownW !== null && (
              <span className="v3-w" style={{ color: layerColor(shownW) }} title="Слой W текущей комнаты">
                W {sgn(shownW)}
              </span>
            )}
            {finText(shown) && <div className="muted">{finText(shown)}</div>}
            {fold && detector && fs && (
              <div className="v3-ghosts">
                {fs.ghosts.length ? (
                  <>
                    <span className="muted">детектор: здесь же в других слоях — {fs.ghosts.length}</span>
                    {fs.ghosts.slice(0, 6).map((g) => (
                      <span key={g.inst} style={{ color: layerColor(g.w) }}>
                        W {sgn(g.w)} · {g.name}
                      </span>
                    ))}
                    {fs.ghosts.length > 6 && <span className="muted">…и ещё {fs.ghosts.length - 6}</span>}
                  </>
                ) : (
                  <span className="muted">детектор: в этом месте других слоёв нет</span>
                )}
              </div>
            )}
          </div>
        )}
        {source === 'walk' && mode === 'fps' && walkStatus && !loc && (
          <div className="float hud v3-walkhud">
            <span>комнат {walkStatus.rooms}</span>
            {shown && (
              <>
                <span title="Этаж: 0 — этаж старта; ниже — после спуска по спец-локации">этаж {fmtFloor(floorOf(shown.inst))}</span>
                <span style={{ color: layerColor(wOfInst(shown.inst)) }}>W {sgn(wOfInst(shown.inst))}</span>
                <span>глубина {rx.data?.instances.find((i) => i.id === shown.inst)?.depth ?? 0}</span>
              </>
            )}
            <span>тупиков {walkStatus.dead}</span>
            <span className={walkStatus.error ? 'v3-err' : 'muted'} title={walkStatus.error ?? 'автосохранение мира в localStorage'}>
              {walkStatus.error ? '⚠ не сохранено' : walkStatus.saved ? `✓ сохранено ${new Date(walkStatus.saved.at).toLocaleTimeString()}` : '…'}
            </span>
          </div>
        )}
        {flash && mode === 'fps' && !loc && (
          <div key={flash.seq} className="v3-flash" style={{ color: flash.color }}>
            {flash.text}
          </div>
        )}
        <div className="v3-label" ref={labelRef} style={{ display: 'none' }}>
          {shown && mode === 'orbit' && (
            <div>
              <span className="t">{shown.name}</span>
              <span className="s">
                {tierOf(shown.tier)?.name ?? 'базовая'} · {shown.floorAreaM2.toFixed(1)} м² · {shown.inst}
              </span>
              {finText(shown) && <span className="s">{finText(shown)}</span>}
            </div>
          )}
        </div>
        <div className="float hud v3-hud" style={loc ? { display: 'none' } : undefined}>
          {fs?.label && <span>{fs.label}</span>}
          {mode === 'orbit' ? (
            <span>ЛКМ — вращать · ПКМ — сдвиг · колесо — масштаб · клик по полу — комната</span>
          ) : locked ? (
            <span>
              <b>WASD</b> — ходьба · мышь — обзор · <b>Esc</b> — отпустить мышь
            </span>
          ) : (
            <span>
              <b>Клик</b> по сцене — захватить мышь · WASD — ходьба
            </span>
          )}
        </div>
        <div className="float hud v3-perf" ref={perfRef} />
        {msg && (
          <div className={'v3-msg' + (msg.kind === 'info' ? ' info' : '')}>
            <div>
              <h3>{msg.title}</h3>
              {msg.text && <pre>{msg.text}</pre>}
              {msg.action}
            </div>
          </div>
        )}
      </div>

      <aside className="side right">
        <Section title={fold && shownModels.length > 1 ? `Модель · ${shownModels.length} частей` : 'Модель'}>
          {shownModels.length ? (
            <>
              <div className="v3-stats">
                <Stat k="объёмов" v={sum((m) => m.stats.solids)} />
                <Stat k="проёмов" v={sum((m) => m.stats.openings)} />
                <Stat k="тупиков" v={sum((m) => m.stats.deadEnds)} />
                <Stat k="комнат" v={sum((m) => m.rooms.length)} />
                <Stat k="мебели" v={sum((m) => m.props.length)} />
                <Stat k="пол, м²" v={Math.round(area)} />
              </div>
              <div className="v3-times">
                <span title={fold ? 'ядро болванки последней сборки; 0 — из кэша' : undefined}>
                  модель {fold ? (fs ? fs.msModel.toFixed(0) : '—') : built?.model ? built.ms.toFixed(0) : '—'} мс
                </span>
                <span>сцена {sceneInfo ? sceneInfo.ms.toFixed(0) : '—'} мс</span>
                <span>мешей {sceneInfo?.meshes ?? '—'}</span>
                {span && (
                  <span>
                    {+span.w.toFixed(1)} × {+span.d.toFixed(1)} м
                  </span>
                )}
              </div>
            </>
          ) : (
            <div className="hint">Модели нет.</div>
          )}
        </Section>

        {shownModels.length > 0 && (
          <Section title={`Отделка${finStats.length ? ' · ' + finStats.length : ''}`} collapsible>
            {!view.finishes ? (
              <div className="hint">Выключена — стены и полы с сеткой блокаута.</div>
            ) : finStats.length === 0 ? (
              <div className="hint">В модели нет отделки: у комнат не разыграны обои/полы, или JSON прогона без finishes.</div>
            ) : (
              <div className="v3-fins">
                {finStats.map(({ fin, faces, dado, floors }) => (
                  <div key={fin.id} className="v3-fin" title={`${fin.id} · повтор ${+fin.tileW.toFixed(3)} × ${+fin.tileH.toFixed(3)} м${fin.tex ? '' : ' · без текстуры'}`}>
                    <Swatch fin={fin} big />
                    <div className="v3-fin-t">
                      <span>{fin.name}</span>
                      <span className="muted mono">
                        {[faces && `граней ${faces}`, dado && `панель: граней ${dado}`, floors && `полов ${floors}`].filter(Boolean).join(' · ')}
                        {fin.dado ? ` · панель до ${fin.dado.heightM} м` : ''}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Section>
        )}

        {built?.model && (
          <Section title="Проверка">
            {built.validErr ? (
              <div className="v3-err">validateBlockout: {built.validErr}</div>
            ) : built.valid && built.valid.length === 0 ? (
              <div className="v3-ok">✓ Чисто: объёмы не пересекаются, пол закрыт стенами, проёмы сквозные.</div>
            ) : (
              <ul className="v3-list bad">
                {built.valid!.slice(0, 60).map((s, i) => (
                  <li key={i}>{s}</li>
                ))}
                {built.valid!.length > 60 && <li className="muted">…и ещё {built.valid!.length - 60}</li>}
              </ul>
            )}
            {built.model.issues.length > 0 && (
              <>
                <div className="cap">Замечания ядра · {built.model.issues.length}</div>
                <ul className="v3-list warn">
                  {built.model.issues.slice(0, 60).map((s, i) => (
                    <li key={i}>{s}</li>
                  ))}
                </ul>
              </>
            )}
          </Section>
        )}

        {foldValid && fs && fs.models.length > 0 && (
          <Section title="Проверка">
            <div className="hint">Части на сцене ({fs.label}) — каждая отдельно.</div>
            {foldValid.err ? (
              <div className="v3-err">validateBlockout: {foldValid.err}</div>
            ) : foldValid.list.length === 0 ? (
              <div className="v3-ok">✓ Чисто: в каждой части объёмы не пересекаются, пол закрыт стенами, проёмы сквозные.</div>
            ) : (
              <ul className="v3-list bad">
                {foldValid.list.slice(0, 60).map((s, i) => (
                  <li key={i}>{s}</li>
                ))}
                {foldValid.list.length > 60 && <li className="muted">…и ещё {foldValid.list.length - 60}</li>}
              </ul>
            )}
            {foldValid.issues.length > 0 && (
              <>
                <div className="cap">Замечания ядра · {foldValid.issues.length}</div>
                <ul className="v3-list warn">
                  {foldValid.issues.slice(0, 60).map((s, i) => (
                    <li key={i}>{s}</li>
                  ))}
                </ul>
              </>
            )}
          </Section>
        )}

        {shown && (
          <Section title={mode === 'orbit' ? 'Выбранная комната' : 'Комната под ногами'}>
            <div className="v3-kv">
              <span>имя</span>
              <span>{shown.name}</span>
              {fold && (
                <>
                  <span>слой</span>
                  <span style={{ color: layerColor(wOfInst(shown.inst)) }}>W {sgn(wOfInst(shown.inst))}</span>
                </>
              )}
              <span>тир</span>
              <span>
                {shown.tier ? (
                  <span className="chip" style={{ borderColor: tierOf(shown.tier)?.color, color: tierOf(shown.tier)?.color }}>
                    {tierOf(shown.tier)?.name ?? shown.tier}
                  </span>
                ) : (
                  'базовая'
                )}
              </span>
              <span>экземпляр</span>
              <span className="mono">
                {shown.inst} · {shown.roomId}
              </span>
              <span>пол</span>
              <span>{shown.floorAreaM2.toFixed(1)} м²</span>
              {view.finishes && finOf(shown.finish?.wall) && (
                <>
                  <span>стены</span>
                  <span className="v3-fin-n">
                    <Swatch fin={finOf(shown.finish?.wall)!} /> {finOf(shown.finish?.wall)!.name}
                  </span>
                </>
              )}
              {view.finishes && finOf(shown.finish?.floor) && (
                <>
                  <span>покрытие</span>
                  <span className="v3-fin-n">
                    <Swatch fin={finOf(shown.finish?.floor)!} /> {finOf(shown.finish?.floor)!.name}
                  </span>
                </>
              )}
              {shown.tags.length > 0 && (
                <>
                  <span>теги</span>
                  <span>{shown.tags.join(', ')}</span>
                </>
              )}
            </div>
          </Section>
        )}

        <Section title="Экспорт">
          <div className="v3-dl">
            <Btn onClick={dlModel} disabled={!shownModels.length} title={fold ? 'Части на сцене: модель видимого множества или массив моделей слоёв' : 'BlockoutModel: объёмы, полы, потолки, проёмы — план в метрах'}>
              ⤓ Скачать blockout.json
            </Btn>
            <Btn onClick={dlGLB} disabled={!shownModels.length || glbBusy || !!glErr} title="Геометрия сцены в glTF binary; metadata мешей → extras">
              ⤓ {glbBusy ? 'Экспорт GLB…' : 'Скачать .glb'}
            </Btn>
            <Btn onClick={dlRun} disabled={!rx.data} title="Исходный JSON прогона (вход ядра)">
              ⤓ Скачать run.json
            </Btn>
          </div>
          <div className="hint">Подключение к своему Babylon-проекту — docs/BLOCKOUT-BABYLON.md, пример — examples/babylon-demo/.</div>
        </Section>
      </aside>
    </div>
  );
}

/** Образец отделки: текстура или цвет. */
function Swatch(props: { fin: RunFinish; big?: boolean }) {
  const { fin } = props;
  return (
    <span
      className={'v3-sw' + (props.big ? ' big' : '')}
      style={{ backgroundColor: /^#[0-9a-f]{6}$/i.test(fin.color) ? fin.color : '#888', backgroundImage: fin.tex ? `url(${fin.tex})` : undefined }}
    />
  );
}

function Stat(props: { k: string; v: number | string }) {
  return (
    <div className="stat">
      <span className="v">{props.v}</span>
      <span className="k">{props.k}</span>
    </div>
  );
}
