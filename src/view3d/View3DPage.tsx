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
import { readWalk, walkBiome, writeWalk, WalkSession, type WalkOptions, type WalkStatus } from './walk';
import { plainBiomes, startBiomeOf } from '../gen4d/biomes';
import { StairwellLayer, type LocationRequest } from './StairwellLayer';
import { LiftLayer, type LiftRequest } from './LiftLayer';
import { SwampLayer, type SwampRequest } from './SwampLayer';
import { HangarLayer, type HangarRequest } from './HangarLayer';
import { FractalLayer, type FractalRequest } from './FractalLayer'; // fractal
import { AbyssWalk } from './fractalAbyss'; // fractal
import { isAbyss } from '../locations/fractalEntry'; // fractal
import { SnowWalk, type SnowHud } from './snowWalk';
import { ObshagaWalk, type ObshagaHud } from './obshagaWalk';
import { SmileWalk } from './smileWalk'; // smile
import { ObshagaRoomsView } from './obshagaRoomsView'; // smile
import { MetroWalk, type MetroHud } from './metroWalk';
import { CellarWalk, walkCellarHost } from './cellarWalk';
import { CatacombsWalk, type CatacombsHud } from './catacombsWalk';
import { StoryWalk, type StoryHud } from './storyWalk';
import { storyStep } from '../game/story';
import { SNOWDOOR_CONN } from '../locations/snowDoor';
import { Inventory, LootFeed, type InventoryHud } from './inventory';
import { HotbarHud } from './HotbarHud';
import { BagHud } from './BagHud';
import { lootOf } from '../gen4d/streamLoot';
import { NOTE_FLAT } from './posture';
import { collapseSite } from '../locations/snowCollapse';
import { KEROLAMP_ITEM } from '../locations/obshaga';
import { LairDecor } from './lairDecor';
import { BiomeMood } from './biomeMood';
import { lairSign } from '../locations/lair';
import type { LiftSide } from '../model/types';
import { locationSeedKey, parseLocation } from '../locations/stairwell';
import { seedKey as worldSeedKey, type ClusterInfo, type WetInfo } from '../gen4d/stream';
import { WET_TAGS } from '../gen4d/wet';
import { viewHorizonM } from '../gen4d/pvs';
import { coopResume, useCoop } from '../coop/store';
import { CoopHud, CoopModal, CoopSection, COOP_STATUS, coopActive } from '../coop/CoopPanel';
import { CoopPresence } from '../coop/presence';
import type { CoopOpEvent, CoopSession } from '../coop/session';
import './view3d.css';

type Source = 'run' | 'room' | 'file' | 'walk';

/** Спец-локация на экране: лестница, лифт или ангар (у каждой свой слой и сцена). */
type LocReq = (LocationRequest & { kind: 'stairwell' }) | LiftRequest | HangarRequest | SwampRequest | FractalRequest;
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
    return { ...DEFAULT_BLOCKOUT, doors: true, ...JSON.parse(localStorage.getItem(OPTS_KEY) || '{}') };
  } catch {
    return { ...DEFAULT_BLOCKOUT, doors: true };
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

/**
 * «Запустить без отладки» (src/play/PlayPage.tsx): только игра — «Прогулка» по миру walk (в лобби — мир лобби) на весь
 * экран, без отладочных панелей; мышь отпущена (Esc) — пауза. Отладочные настройки прогулки (readWalk) не трогает.
 */
export interface PlayMode {
  /** мир одиночной игры (сюжет — WalkOptions.story); новый объект с другим сидом — мир пересоздаётся */
  walk: WalkOptions;
  /** «Главное меню» (пауза, после «КОНЕЦ»): страница сама решает, выходить ли из лобби */
  onMenu: () => void;
  /** «Новая игра» после «КОНЕЦ» (одиночная): новый мир (новый сид) → новый walk */
  onNewGame: () => void;
}

export default function View3DPage(props: { play?: PlayMode } = {}) {
  const play = props.play ?? null;
  const p = useProject();
  const ui = useUI();
  // игра без отладки — всегда «Прогулка» (memo.source и отладочные настройки не меняются)
  const [source, setSourceS] = useState<Source>(play ? 'walk' : memo.source);
  const [file, setFileS] = useState(memo.file);
  const [fileErr, setFileErr] = useState<string | null>(null);
  const [roomSel, setRoomSel] = useState<string>(ui.roomId ?? p.rooms[0]?.id ?? '');
  // игра без отладки — болванка и вид по умолчанию (отладочные настройки вкладки «3D» не действуют)
  const [opts, setOptsS] = useState<BlockoutOptions>(() => (play ? { ...DEFAULT_BLOCKOUT, doors: true } : readOpts()));
  const [view, setViewS] = useState<ViewSettings>(() => (play ? { finishes: true, fog: false } : readView()));
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
  /** модели предметов догрузились (меняется раз) — пересобрать болванку с ними */
  const [propsVer, setPropsVer] = useState(0);
  const [sceneErr, setSceneErr] = useState<string | null>(null);
  const [glbBusy, setGlbBusy] = useState(false);
  /** спец-локация (src/locations/): своя сцена поверх болванки, пока задана */
  const [loc, setLoc] = useState<LocReq | null>(null);
  const roomAttempts = useRef(new Map<string, number>());
  // ── кооп (src/coop/, docs/COOP.md): лобби страницы; в лобби «Прогулка» — его копия мира ──
  const coop = useCoop();
  const coopOn = coopActive(coop);
  /** копия мира лобби (null — не в лобби или ещё грузится) */
  const coopWalk = coopOn ? coop.walk : null;
  const [coopModal, setCoopModal] = useState(false);
  /** рядом другой игрок — идём медленнее (HUD) */
  const [coopSlow, setCoopSlow] = useState(false);
  /** рядом засыпанный обвалом напарник — «E — откапывать» (его имя) */
  const [coopDig, setCoopDig] = useState<string | null>(null);
  const locRef = useRef<LocReq | null>(null);
  locRef.current = loc;

  const setSource = (s: Source) => {
    setLoc(null);
    if (play) return; // игра без отладки — только «Прогулка»
    memo.source = s;
    setSourceS(s);
    writeWalk({ ...readWalk(), on: s === 'walk' });
  };
  // вошли в лобби — сразу в его мир; вкладка была в лобби до перезагрузки — войти снова
  useEffect(() => {
    if (coopOn && source !== 'walk') setSource('walk');
  }, [coopOn]);
  useEffect(() => {
    coopResume(() => p);
  }, []);

  // ── прогулка: бесконечный мир (src/gen4d/stream.ts) ──
  const [walkOpts, setWalkOptsS] = useState<WalkOptions>(() => play?.walk ?? readWalk());
  const [walkSeedDraft, setWalkSeedDraft] = useState(walkOpts.seed);
  /** что запущено: сид + номер перезапуска (сброс сохранения → тот же сид заново) */
  const [walkRun, setWalkRun] = useState({ seed: walkOpts.seed, n: 0 });
  const [walkRx, setWalkRx] = useState<RunExport | null>(null);
  const [walkStatus, setWalkStatus] = useState<WalkStatus | null>(null);
  /** режим квартир: закрытый выход рядом с игроком (подсказка «E — открыть») и квартира под ногами */
  const [doorAt, setDoorAt] = useState<{ inst: string; connector: string } | null>(null);
  const [walkHere, setWalkHere] = useState<ClusterInfo | null>(null);
  /** влажность куска сети цехов под ногами (завод) */
  const [walkWet, setWalkWet] = useState<WetInfo | null>(null);
  /** снежные ходы: засыпан / треск / подсказка у подтаявшего снега (src/view3d/snowWalk.ts) */
  const [snowHud, setSnowHud] = useState<SnowHud | null>(null);
  /** общага: подсказка у двери / лампы, волочение, смерть, звук (src/view3d/obshagaWalk.ts) */
  const [obshHud, setObshHud] = useState<ObshagaHud | null>(null);
  const obshRef = useRef<ObshagaWalk | null>(null);
  // метро: эскалаторы (src/view3d/metroWalk.ts)
  const [metroHud, setMetroHud] = useState<MetroHud | null>(null);
  const metroRef = useRef<MetroWalk | null>(null);
  // fractal: вуаль бездонного эскалатора (src/view3d/fractalAbyss.ts) — opacity пишется напрямую, без рендера React
  const frVeilRef = useRef<HTMLDivElement | null>(null);
  // катакомбы: наводнение, дыхание, перелаз (src/view3d/catacombsWalk.ts)
  const [catHud, setCatHud] = useState<CatacombsHud | null>(null);
  const catRef = useRef<CatacombsWalk | null>(null);
  /** сюжет: люк в погреб, дверь в снег — подсказка, затемнение, белая пелена (src/view3d/storyWalk.ts) */
  const [storyHud, setStoryHud] = useState<StoryHud | null>(null);
  /** мир прогулки — сюжетный (WalkSession.story): срыв на лестнице / в лифте — в общагу, без отладки в сценах */
  const [walkStory, setWalkStory] = useState(false);
  const walkRef = useRef<WalkSession | null>(null);
  /** руки: хотбар, фонарик, предметы на полу (src/view3d/inventory.ts) */
  const [invHud, setInvHud] = useState<InventoryHud | null>(null);
  const invRef = useRef<Inventory | null>(null);
  const setWalkOpt = <K extends keyof WalkOptions>(k: K, v: WalkOptions[K]) => {
    const next = { ...walkOpts, [k]: v };
    setWalkOptsS(next);
    writeWalk({ ...next, on: source === 'walk' });
  };
  const startWalk = (seed: string, reset = false) => {
    const s = seed.trim() || 'гигахрущ';
    if (reset) WalkSession.reset(s, (p.world?.biomes ?? []).map((b) => b.id));
    const next = { ...walkOpts, seed: s };
    setWalkOptsS(next);
    setWalkSeedDraft(s);
    writeWalk({ ...next, on: true });
    setWalkRun((r) => ({ seed: s, n: r.n + 1 }));
  };
  /** «Новая игра» после финала: стереть миры сида во всех биомах и начать с биома старта проекта. */
  const newGame = () => {
    if (coopOn) {
      notify('В лобби мир общий — «Новая игра» после выхода из лобби', 'info');
      return;
    }
    if (play) {
      // игра без отладки: новый мир (новый сид) даёт страница — новый play.walk (эффект ниже). Стирать мир этого же сида
      // здесь нельзя: уходящая сессия при dispose сохранит его снова
      play.onNewGame();
      return;
    }
    const s = walkRun.seed;
    WalkSession.reset(s, (p.world?.biomes ?? []).map((b) => b.id));
    const next = { ...walkOpts, seed: s, biome: null };
    setWalkOptsS(next);
    writeWalk({ ...next, on: true });
    setWalkRun((r) => ({ seed: s, n: r.n + 1 }));
  };
  const newGameRef = useRef(newGame);
  newGameRef.current = newGame;
  // ── игра без отладки (play): новый мир от страницы, пауза ──
  const playWalk = play?.walk ?? null;
  useEffect(() => {
    if (!playWalk || playWalk === walkOpts) return;
    setWalkOptsS(playWalk);
    setWalkRun((r) => ({ seed: playWalk.seed, n: r.n + 1 }));
  }, [playWalk]);
  /** меню паузы открыто кнопкой «Меню» / Esc поверх спец-локации (без неё пауза — пока мышь отпущена) */
  const [pauseOpen, setPauseOpen] = useState(false);
  /** игрок уже входил в игру (захватывал мышь): первая «пауза» — экран входа */
  const [played, setPlayed] = useState(false);
  useEffect(() => {
    if (!locked) return;
    setPlayed(true);
    setPauseOpen(false);
  }, [locked]);
  useEffect(() => {
    if (!play) return;
    // Esc, которым браузер отпускает мышь, странице не приходит — этот только при отпущенной мыши
    const k = (e: KeyboardEvent) => {
      if (e.code === 'Escape' && !document.pointerLockElement && locRef.current) setPauseOpen((o) => !o);
    };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [!!play]);
  /** «Продолжить»: захватить мышь снова (сцена спец-локации захватывает её сама — кликом по ней) */
  const playResume = () => {
    setPauseOpen(false);
    const v = viewer.current;
    if (!v || v.hasOverlay) return;
    v.engine.getRenderingCanvas()?.focus();
    v.engine.enterPointerlock();
  };
  const playMenu = () => {
    setPauseOpen(false);
    if (document.pointerLockElement) document.exitPointerLock();
    play?.onMenu();
  };
  /** Режим квартир: биом, в котором начинается мир прогулки (у каждого — свой мир сида и своё сохранение). */
  const walkStartBiome = walkBiome(p, walkOpts) ?? (p.world ? startBiomeOf(p.world)?.id ?? null : null);
  const switchBiome = (id: string) => {
    const next = { ...walkOpts, biome: id };
    setWalkOptsS(next);
    writeWalk({ ...next, on: true });
    setWalkRun((r) => ({ seed: r.seed, n: r.n + 1 }));
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
    setOptsS({ ...DEFAULT_BLOCKOUT, doors: true });
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

  // «Комната» — свои тупики; «Прогулка» в режиме квартир — глухие двери стенами (закрытые выходы — двери-панели)
  const effOpts = useMemo(
    () => (source === 'room' ? { ...opts, deadEnds: deadRoom } : source === 'walk' && (coopWalk ? coopWalk.opts.clusters : walkOpts.clusters) ? { ...opts, deadEnds: 'wall' as const } : opts),
    [opts, source, deadRoom, walkOpts.clusters, coopWalk],
  );
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
  /** вспышка-надпись; big — название шага сюжета при входе в новый биом (крупнее и дольше) */
  const [flash, setFlash] = useState<{ seq: number; text: string; color: string; big?: boolean } | null>(null);
  /** поза от первого лица (C) */
  const [pose, setPose] = useState<'stand' | 'crouch' | 'crawl'>('stand');
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
        // C — на четвереньки / встать (src/view3d/posture.ts): поза — в подсказке, «здесь не встать» — вспышкой
        onPosture: (pose, note) => {
          setPose(pose);
          const text = note ?? (pose === 'crawl' ? 'на четвереньках' : pose === 'crouch' ? 'скрючившись' : 'стоя');
          const seq = Date.now();
          setFlash({ seq, text, color: note && note !== NOTE_FLAT ? '#e0563f' : '#cfd8e6' });
          setTimeout(() => setFlash((f) => (f?.seq === seq ? null : f)), 1200);
        },
        onPropsReady: () => setPropsVer((x) => x + 1),
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

  // бег (Shift, src/view3d/sprint.ts) — только в «Прогулке»; шкала выносливости — прямо в DOM после кадра, без setState
  const staminaRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const v = viewer.current;
    if (!v) return;
    v.sprint.enabled = source === 'walk';
    let shown = '';
    let shownEl: HTMLDivElement | null = null;
    const o = v.scene.onAfterRenderObservable.add(() => {
      const el = staminaRef.current;
      if (!el) return;
      if (el !== shownEl) (shownEl = el), (shown = ''); // шкалу смонтировали заново — переписать всё
      const s = v.sprint.state;
      const w = Math.round(s.v * 200) / 200;
      const key = `${w}|${s.v < 0.999 || s.sprinting ? 1 : 0}|${s.exhausted ? 1 : 0}`;
      if (key === shown) return;
      shown = key;
      el.classList.toggle('on', s.v < 0.999 || s.sprinting);
      el.classList.toggle('tired', s.exhausted);
      (el.firstElementChild as HTMLElement | null)?.style.setProperty('transform', `scaleX(${w})`);
    });
    return () => {
      v.scene.onAfterRenderObservable.remove(o);
    };
  }, [source]);

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
  }, [model, propTextures, view.finishes, fold, propsVer]);

  // модели предметов догрузились — у складчатого прогона и прогулки куски пересобираются с ними
  useEffect(() => {
    if (propsVer) driver.current?.refreshProps();
  }, [propsVer]);

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
    // кооп: мир лобби ещё грузится — сцены нет (сообщение поверх холста)
    if (coopOn && !coopWalk) {
      setWalkRx(null);
      setWalkStatus(null);
      return;
    }
    /** лобби, чья копия мира — эта прогулка (null — одиночная) */
    const co: CoopSession | null = coopWalk ? coop : null;
    let presence: CoopPresence | null = null;
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
    // темнота биома (Biome.dark): свет сцены — по квартире под ногами
    const mood = new BiomeMood(v.scene);
    // снежные ходы: поза (ползком / скрючившись), туман, обвалы, подтаявший снег → ангар (src/view3d/snowWalk.ts)
    let roomIdx: { rx: unknown; by: Map<string, RunExport['instances'][number]> } = { rx: null, by: new Map() };
    const snow = new SnowWalk(v.scene, v.fps, {
      room: () => {
        const s = session, dd = d;
        if (!s || !dd) return null;
        const id = dd.portal?.current ?? dd.current.center;
        if (!id) return null;
        if (roomIdx.rx !== s.rx) roomIdx = { rx: s.rx, by: new Map(s.rx.instances.map((i) => [i.id, i])) };
        const inst = roomIdx.by.get(id);
        return inst ? { id, inst } : null;
      },
      pickSite: (id, x, y) => (session ? collapseSite(session.rx, id, x, y) : null),
      collapse: (site) => {
        void session?.request({ k: 'collapse', inst: site.inst, conn: site.connector });
      },
      // раскопка завала: прогресс — из мира; работа — операция мира (кооп: нажатия всех игроков складываются)
      digProgress: (inst, conn) => session?.world.collapseProgress(inst, conn) ?? null,
      dig: (inst, conn, amount) => {
        void session?.request({ k: 'dig', inst, conn, amount });
      },
      thawOf: (id) => {
        const L = session?.world.locationOf(id);
        return L?.kind === 'hangar' ? L.roll : null;
      },
      onBreak: (id) => enterHangar(id),
      onHud: setSnowHud,
      live: () => !v.hasOverlay && v.mode === 'fps',
      collapseMul: () => invRef.current?.fx.collapseMul ?? 1, // лут: горит зиппа — обвалы вдвое чаще
    }, walkRun.seed, v.posture);
    if (import.meta.env.DEV) (window as any).__rfSnow = snow; // для QA-скриптов
    // погреб: боком в щелях, темнота и пыль в луче фонаря, осыпи и обвалы; HUD — свой (src/view3d/cellarWalk.ts)
    const cellar = new CellarWalk(v, walkCellarHost(v, {
      session: () => session,
      driver: () => d,
      torch: () => !!invRef.current?.torchOn,
      busy: () => !!door || !!presence?.nearBuried || !!invRef.current?.aimed || transit.busy,
      collapseMul: () => invRef.current?.fx.collapseMul ?? 1, // лут: горит зиппа — обвалы вдвое чаще
    }), walkRun.seed);
    if (import.meta.env.DEV) (window as any).__rfCellar = cellar; // для QA-скриптов
    // общага: двери, что закрываются сами, отключения света, рука, керосиновая лампа, вода в подвале (src/view3d/obshagaWalk.ts)
    const obsh = new ObshagaWalk(v.scene, v.fps, {
      rx: () => session?.rx ?? null,
      driver: () => d,
      live: () => !v.hasOverlay && v.mode === 'fps',
      // лампа взята — операция мира (кооп: кто первый — того и лампа)
      takeLamp: async (inst, spot) => !!(await session?.request({ k: 'lamp', inst, spot })),
      // лампа — предмет хотбара (src/view3d/inventory.ts): в руке — выбрана; взятая со спота — в хотбар и в руку
      lampHeld: () => !!invRef.current?.lampHeld,
      handsFree: () => (invRef.current?.free ?? 0) > 0,
      giveLamp: () => void invRef.current?.receive({ item: KEROLAMP_ITEM }),
      qaLamp: (on) => void invRef.current?.qaHold(KEROLAMP_ITEM, on),
      // лампы на полу (предметы мира) — поле лампы
      drops: () => session?.drops() ?? [],
      light: (mul, tint) => mood.light(mul, tint),
      flash: (text, color, ms = 1300) => {
        const seq = Date.now();
        setFlash({ seq, text, color });
        setTimeout(() => setFlash((f) => (f?.seq === seq ? null : f)), ms);
      },
      onHud: setObshHud,
      busy: () => !!door || !!presence?.nearBuried || transit.busy,
      propModel: (id) => v.props.get(id),
      co,
      presence: () => presence,
      // лут (src/view3d/inventory.ts): эффекты предметов, горящий фонарик, пьяный ругается на руку
      fx: () => invRef.current?.fx,
      torch: () => !!invRef.current?.torchOn,
      sawCreature: (k) => invRef.current?.sawCreature(k),
    }, walkRun.seed, v.posture);
    obshRef.current = obsh;
    if (import.meta.env.DEV) (window as any).__rfObshaga = obsh.qa(); // для QA-скриптов
    // smile: «Улыбка» (моб общаги, src/view3d/smileWalk.ts) и номера/замки/ключи комнат (src/view3d/obshagaRoomsView.ts) —
    // через фасад obsh (hooks, kill, hold, closeDoor); после общаги: её кадр раньше (крен позы, свет)
    const smile = new SmileWalk(v.scene, v.fps, obsh, {
      co,
      presence: () => presence,
      held: () => invRef.current?.held?.item ?? null,
      seed: walkRun.seed,
      rx: () => session?.rx ?? null,
      live: () => !v.hasOverlay && v.mode === 'fps',
    });
    if (import.meta.env.DEV) (window as any).__rfSmile = smile.qa(); // для QA-скриптов
    const dormView = new ObshagaRoomsView(v.scene, obsh, {
      session: () => session,
      inv: () => invRef.current,
      co,
      flash: (text, color, ms = 1300) => {
        const seq = Date.now();
        setFlash({ seq, text, color });
        setTimeout(() => setFlash((f) => (f?.seq === seq ? null : f)), ms);
      },
      live: () => !v.hasOverlay && v.mode === 'fps',
    });
    // метро: эскалаторы везут и изредка срываются, холодный свет и туман метро (src/view3d/metroWalk.ts) — после общаги:
    // она каждый кадр обнуляет крен позы, тряска метро пишется позже
    const metro = new MetroWalk(v.scene, v.fps, {
      rx: () => session?.rx ?? null,
      driver: () => d,
      live: () => !v.hasOverlay && v.mode === 'fps',
      // обрыв дорожки — операция мира (кооп: у всех; повтор — null)
      breakEsc: async (inst, lane) => !!(await session?.request({ k: 'esc', inst, lane })),
      light: (mul, tint) => mood.light(mul, tint),
      flash: (text, color, ms = 1300) => {
        const seq = Date.now();
        setFlash({ seq, text, color });
        setTimeout(() => setFlash((f) => (f?.seq === seq ? null : f)), ms);
      },
      onHud: setMetroHud,
      busy: () => !!door || !!presence?.nearBuried || transit.busy,
      co,
    }, walkRun.seed, v.posture);
    metroRef.current = metro;
    if (import.meta.env.DEV) (window as any).__rfMetro = metro.qa(); // для QA-скриптов
    // fractal: бездонный эскалатор метро — спуск во тьму (вуаль) → слой «Фрактальной станции»; выход — открытая ниша
    // выходной копии → world.descend → вестибюль метро этажом ниже (tmp/metro-wip/FRACTAL.md §6). Каждый входит сам.
    const enterFractal = (id: string) => {
      const s = session;
      if (!s || !d || v.hasOverlay) return;
      const n = attempts.get(id) ?? 0;
      attempts.set(id, n + 1);
      if (frVeilRef.current) frVeilRef.current.style.opacity = '0';
      lair.hide();
      setLoc({
        kind: 'fractal',
        key: `${id}:${n}`,
        seedKey: locKey(s, id),
        title: 'Фрактальная станция',
        mode: 'walk',
        co,
        slot: co?.players.get(co.me.id)?.slot,
        onExit: () => exitLoc('descend', id, null),
      });
    };
    const abyss = new AbyssWalk({
      viewer: v,
      driver: () => d,
      live: () => !v.hasOverlay && v.mode === 'fps' && !v.paused,
      onVeil: (x) => {
        if (frVeilRef.current) frVeilRef.current.style.opacity = String(x);
      },
      onEnter: (id) => enterFractal(id),
    });
    if (import.meta.env.DEV) {
      (window as any).__rfAbyss = abyss.qa(); // для QA-скриптов
      // QA: войти во «Фрактальную станцию» из комнаты id (по умолчанию — под ногами; выход descend — только из бездны)
      (window as any).__rfFractalEnter = (id?: string) => {
        const room = id ?? d?.portal?.current ?? d?.current.center ?? null;
        if (room) enterFractal(room);
      };
    }
    // катакомбы: темнота (только фонарь), наводнение по часам (кооп — часы хоста), дыхание под водой, перелаз через трубы,
    // лазы ползком (src/view3d/catacombsWalk.ts) — после общаги и метро, до сюжета
    const cat = new CatacombsWalk(v.scene, v.fps, {
      rx: () => session?.rx ?? null,
      driver: () => d,
      live: () => !v.hasOverlay && v.mode === 'fps',
      biomeOf: (id) => session?.world.clusterAt(id)?.biome?.id ?? null,
      flash: (text, color, ms = 1300) => {
        const seq = Date.now();
        setFlash({ seq, text, color });
        setTimeout(() => setFlash((f) => (f?.seq === seq ? null : f)), ms);
      },
      onHud: setCatHud,
      busy: () => !!door || !!presence?.nearBuried || transit.busy || !!invRef.current?.aimed,
      co,
      // лут: неуязвимость от предмета (Inventory.fx.invuln) — утопление не отнимает здоровье
      invuln: () => !!(invRef.current as { fx?: { invuln?: boolean } } | null)?.fx?.invuln,
    }, walkRun.seed, v.posture);
    catRef.current = cat;
    if (import.meta.env.DEV) (window as any).__rfCatacombs = cat.qa(); // для QA-скриптов
    // сюжет: люк в погреб, дверь в снег (src/view3d/storyWalk.ts) — после снега и общаги: её кадр перекрывает их позу
    const instOf = (id: string) => {
      const s = session;
      if (!s) return null;
      if (roomIdx.rx !== s.rx) roomIdx = { rx: s.rx, by: new Map(s.rx.instances.map((i) => [i.id, i])) };
      return roomIdx.by.get(id) ?? null;
    };
    const transit = new StoryWalk(v.scene, v.fps, {
      room: () => {
        const dd = d;
        const id = dd ? (dd.portal?.current ?? dd.current.center) : null;
        const inst = id ? instOf(id) : null;
        return id && inst ? { id, inst } : null;
      },
      inst: instOf,
      cellM: () => session?.rx.cellM ?? 0.1,
      props: () => session?.rx.props ?? [],
      kindOf: (id) => {
        const L = session?.world.locationOf(id);
        return L?.kind === 'hatch' ? { kind: 'hatch' } : L?.kind === 'snowdoor' ? { kind: 'snowdoor', digs: L.roll.digs } : null;
      },
      doorSlot: (inst, conn) => d?.doorAt(inst, conn) ?? null,
      openDoor: (slot) => !!d?.doors?.open(slot, { ready: () => true }),
      portal: () => d?.portal ?? null,
      descend: (id) => storyDescend(id),
      busy: () => !!door || !!presence?.nearBuried || !!invRef.current?.aimed,
      live: () => !v.hasOverlay && v.mode === 'fps',
      paused: () => v.paused,
      onHud: setStoryHud,
    }, v.posture);
    if (import.meta.env.DEV) (window as any).__rfStory = transit.qa(); // для QA-скриптов
    /** Подтаявший снег пробит — сцена ангара (падение); ворота цеха — world.descend (этажи ниже: завод или другой биом). */
    const enterHangar = (id: string) => {
      const s = session;
      if (!s || !d || v.hasOverlay) return;
      const L = s.world.locationOf(id);
      if (L?.kind !== 'hangar') return;
      setLoc({
        kind: 'hangar',
        key: `${id}:${Date.now()}`,
        spec: L.spec,
        seedKey: locKey(s, id),
        roll: L.roll,
        title: 'Ангар',
        mode: 'walk',
        onExit: () => exitLoc('descend', id, null),
      });
    };
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
      if (L?.kind === 'swamp') {
        // финал: крыша с шестернёй; люк — назад к двери, «Новая игра» — мир сида с начала
        const inst = s.rx.instances.find((i) => i.id === id);
        const cross = d.current.cross;
        const from = cross && cross.to === id ? cross.from : null;
        lair.hide();
        setLoc({
          kind: 'swamp',
          key: `${id}:${Date.now()}`,
          spec: L.spec,
          seedKey: locKey(s, id),
          roll: L.roll,
          title: inst?.roomName || 'Под перевёрнутым болотом',
          mode: 'walk',
          onExit: (kind) => {
            if (kind === 'new') {
              setLoc(null);
              newGameRef.current();
              return;
            }
            exitLoc('back', id, from);
          },
        });
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
        // сюжет: Хвататель утащил — очнулся в общаге
        onFall: s.story ? () => void exitFall(id, from) : undefined,
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
        // сюжет: выбросило в шахту / оборвался трос — очнулся в общаге
        onFall: s.story ? () => void exitFall(id, from) : undefined,
      });
    };
    const exitLift = async (kind: 'entry' | LiftSide, floor: number, isLair: boolean, id: string, from: string | null) => {
      const s = session;
      const dd = d;
      setLoc(null);
      if (!s || !dd || !alive) return;
      const back = () => dd.placeAtDoor(from ?? neighbor(id) ?? id, id);
      if (kind === 'entry') {
        back();
        return;
      }
      // операция мира (кооп: через сервер лобби — у всех за этим выходом одна и та же комната)
      const exitId = await s.request({ k: 'ascend', id, floor, side: kind });
      if (!alive) return;
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
        // игровые часы: на паузе кулдаун не тает (иначе после неё — снова в лифт)
        liftCool = v.gameNow() + 1500;
        const fl = s.world.run().instances.find((i) => i.id === target)?.floor ?? 0;
        const text = `этаж ${fmtFloor(fl)} · ${SIDE_RU[kind]}${isLair ? ' · логово' : ''}`;
        // сюжет: лифт вывел в другой биом — вспышка его названия (liftTimer), а не этажа
        if (!storyBiomeChange(s, id, target)) {
          setFlash({ seq: Date.now(), text, color: isLair ? '#e0563f' : '#e8b04b' });
          setTimeout(() => setFlash((f) => (f?.text === text ? null : f)), 1900);
        }
        // логово — темнота и табличка, как при шаге в комнату
        if (s.world.locationOf(target)?.kind === 'lair') enterLoc(target);
      };
      go(0);
    };
    // ── сюжет (src/game/story.ts): срыв в общагу, люк и дверь в снег; при входе в новый биом — его название ──
    let storyBiome: string | null = null;
    /** биом комнаты под ногами (liftTimer) */
    let hereBiome: string | null = null;
    const biomeOf =(s: WalkSession, id: string) => s.world.clusterAt(id)?.biome?.id ?? null;
    /** сюжет и переход из from в to сменил биом (вспышка — название шага сюжета в liftTimer, а не этаж) */
    const storyBiomeChange = (s: WalkSession, from: string, to: string) => s.story && biomeOf(s, from) !== biomeOf(s, to);
    const bigFlash = (text: string) => {
      const seq = Date.now();
      setFlash({ seq, text, color: '#efe3c8', big: true });
      setTimeout(() => setFlash((f) => (f?.seq === seq ? null : f)), 3400);
    };
    /** Переход привёл в комнату target (операция мира вернулась): дождаться её в прогоне драйвера и перейти в неё. */
    const arriveAt = (s: WalkSession, dd: FoldDriver, target: string): Promise<boolean> =>
      new Promise((res) => {
        const go = (k: number) => {
          if (!alive) return res(false);
          if (!s.rx.instances.some((i) => i.id === target)) {
            if (k < 50) setTimeout(() => go(k + 1), 20);
            else res(false);
            return;
          }
          dd.goTo(target);
          // посадка на паузе (срыв: экран смерти отпустил мышь) — прогреть кадры: за меню паузы — новое место
          if (v.paused) v.warmUp(800);
          res(true);
        };
        go(0);
      });
    /** Сюжет: люк в погреб, дверь в снег — операция мира descend (кооп — через лобби) → комната-выход следующего биома;
     *  посадка — как после спуска лестницы. false — не вышло (сценарий проявится на месте). */
    const storyDescend = async (id: string): Promise<boolean> => {
      const s = session, dd = d;
      if (!s || !dd || !alive) return false;
      const exitId = await s.request({ k: 'descend', id });
      if (!alive) return false;
      if (!exitId) {
        notify('Переход никуда не вывел: мир не смог поставить комнату (см. консоль)', 'error');
        return false;
      }
      return arriveAt(s, dd, exitId);
    };
    /** Сюжет: срыв — Хвататель утащил с лестницы, из лифта выбросило: операция мира fall → комната прихода в общаге. */
    const exitFall = async (id: string, from: string | null) => {
      const s = session, dd = d;
      setLoc(null);
      if (!s || !dd || !alive) return;
      const exitId = await s.request({ k: 'fall', id });
      if (!alive) return;
      if (!exitId) {
        notify('Срыв никуда не вывел: мир не смог поставить комнату общаги (см. консоль)', 'error');
        dd.placeAtDoor(from ?? neighbor(id) ?? id, id);
        return;
      }
      void arriveAt(s, dd, exitId);
    };
    // режим квартир: закрытый выход квартиры рядом (ближе 1.3 м к его двери-панели) — подсказка «E — открыть»
    let door: { inst: string; connector: string } | null = null;
    let hereRoom: string | null = null;
    const nearDoor = (s: WalkSession, dd: FoldDriver, room: string) => {
      let best: { inst: string; connector: string } | null = null;
      let bd = 1.3;
      const c = v.fps.position;
      // идёт сценарий сюжета — E его; дверь в снег — не выход квартиры (её открывает сценарий, ./storyWalk.ts)
      for (const k of transit.active ? [] : (s.rx.instances.find((i) => i.id === room)?.connectors ?? [])) {
        if (!k.exit || k.id === SNOWDOOR_CONN) continue;
        const de = dd.deadEndAt(room, k.id);
        if (!de || Math.abs(c.y - v.posture.eye - 0.05 - de.center.y) > 1.5) continue;
        const dist = Math.hypot(c.x - de.center.x, c.z - de.center.z);
        if (dist < bd) {
          bd = dist;
          best = { inst: room, connector: k.id };
        }
      }
      if (best?.inst !== door?.inst || best?.connector !== door?.connector) {
        door = best;
        setDoorAt(best);
      }
    };
    const onDoorKey = (e: KeyboardEvent) => {
      const s = session;
      if (e.code !== 'KeyE' || !s || !door || v.hasOverlay || v.mode !== 'fps' || v.paused || presence?.nearBuried || transit.active) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT')) return;
      const { inst, connector } = door;
      door = null;
      setDoorAt(null);
      // анимация (портальный рендер): ручка → мир растёт за закрытым полотном → распах, когда комната за дверью готова
      // (docs/DOORS.md §4); без неё (набор PVS, нет модели двери) — сразу
      const dd = d;
      const slot = dd?.doorAt(inst, connector) ?? null;
      let target: string | null = null;
      const anim = slot && dd?.doors ? dd.doors.open(slot, { ready: () => !!target && s.world.doorState(inst, connector) === 'linked' && dd.roomReady(target) }) : null;
      const go = () => {
        if (!alive || session !== s) return;
        // операция мира (кооп: через сервер лобби — дверь открывается у всех; комната за ней — когда операция вернулась)
        void s.request({ k: 'door', inst, conn: connector }).then((id) => {
          if (!alive || session !== s) return;
          target = id;
          if (!target) {
            anim?.fail();
            notify('Дверь не открылась: за ней ничего не встало', 'error');
          }
        });
      };
      // мир растёт после первого кадра анимации (ручка уже пошла) — пауза генерации прячется в отпирании
      if (anim) requestAnimationFrame(() => setTimeout(go, 0));
      else go();
    };
    window.addEventListener('keydown', onDoorKey);
    // возврат в лифт: игрок в комнате за выходом лифта шагнул к стене, через которую пришёл
    const liftTimer = window.setInterval(() => {
      const s = session, dd = d;
      if (!s || !dd || v.hasOverlay || v.mode !== 'fps') return;
      const room = dd.portal?.current ?? dd.current.center;
      if (!room) return;
      if (s.world.transitionState()) {
        nearDoor(s, dd, room);
        if (room !== hereRoom) {
          hereRoom = room;
          const here = s.world.clusterAt(room);
          setWalkHere(here);
          setWalkWet(s.world.wetAt(room));
          mood.set(here?.biome?.dark ?? 0);
          hereBiome = here?.biome?.id ?? null;
        }
        // сюжет: вошёл в другой биом (переход, срыв, дверь общаги на улицу; и в начале игры) — название шага сюжета;
        // на паузе (экран входа, очнулся после срыва) — после неё, когда игрок его увидит
        if (!v.paused && hereBiome && hereBiome !== storyBiome) {
          const st = s.story ? storyStep(hereBiome) : null;
          if (st) bigFlash(st.title);
          storyBiome = hereBiome;
        }
      }
      // пауза игры: в лифт не входить; кулдаун — по игровым часам
      if (v.paused || v.gameNow() < liftCool) return;
      if (s.world.locationOf(room)?.kind === 'lift') return;
      const c = v.fps.position;
      for (const l of s.world.run().links) {
        if (l.kind !== 'lift' || l.b.inst !== room) continue;
        const de = dd.deadEndAt(room, l.b.connector);
        if (!de || Math.abs(c.y - v.posture.eye - 0.05 - de.center.y) > 1.5) continue;
        if (Math.hypot(c.x - de.center.x, c.z - de.center.z) < 0.7) {
          enterLift(l.a.inst, l.floors ?? 1, l.side ?? 'straight');
          return;
        }
      }
    }, 100);
    /** Игра без отладки: ушёл из спец-локации ногами (лестница, ворота ангара, дверь болота) — её сцена отпускает мышь
     *  (dispose / выход), а на прогулке без мыши — пауза. Захватить снова, как только отпустила (без жеста можно: отпустила
     *  страница, а не игрок). Лифт мышь не отпускает — не звать. */
    const relock = () => {
      const c = v.engine.getRenderingCanvas();
      if (!play || !c || document.pointerLockElement !== c) return;
      const on = () => {
        if (document.pointerLockElement) return;
        document.removeEventListener('pointerlockchange', on);
        if (alive && !v.hasOverlay) v.engine.enterPointerlock();
      };
      document.addEventListener('pointerlockchange', on);
      window.setTimeout(() => document.removeEventListener('pointerlockchange', on), 1500);
    };
    const exitLoc = async (kind: 'back' | 'descend', id: string, from: string | null) => {
      const s = session;
      const dd = d;
      relock();
      setLoc(null);
      if (!s || !dd || !alive) return;
      const back = () => dd.placeAtDoor(from ?? neighbor(id) ?? id, id);
      if (kind === 'back') {
        back();
        return;
      }
      // операция мира (кооп: через сервер лобби — у всех внизу одна и та же комната)
      const exitId = await s.request({ k: 'descend', id });
      if (!alive) return;
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
        // сюжет: спуск привёл в другой биом (лестница → подвал, ворота ангара → завод) — вспышка названия (liftTimer)
        if (storyBiomeChange(s, id, target)) return;
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
      session = walkRef.current = coopWalk ?? new WalkSession(p, { ...walkOpts, seed: walkRun.seed });
      const s = session;
      // кооп: своё место в этом лобби (после перезагрузки) или рядом с другим игроком
      const player = co ? co.spawnPoint() : s.loadPlayer();
      setWalkRx(s.rx);
      setWalkStatus(s.status());
      setWalkStory(s.story);
      v.setMode('fps');
      setModeS('fps');
      d = new FoldDriver(
        v,
        s.rx,
        effOpts,
        { propTextures: propTexturesOf(co?.project ?? p, s.rx), finishes: view.finishes },
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
        { center: player?.room ?? null, fpsReady: !!player, orbitView: { kind: 'tower' }, detector: !play && memo.detector, render: 'portal' },
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
      // двери комнат общаги закрываются сами: поза полотна при постройке куска — от общаги
      d.doorPose = (slot) => obsh.doorPose(slot);
      d.apply(true);
      if (player) {
        v.fps.position.set(...player.pos);
        v.fps.rotation.set(...player.rot);
        v.fps.cameraDirection.setAll(0);
      }
      // игра без отладки: до входа — пауза (мышь не захвачена); мир встаёт и виден за экраном входа — прогрев кадров
      v.warmUp(1200);
      if (co) {
        // другие игроки: аватары, своё положение для них, «рядом — медленнее»
        presence = new CoopPresence(v, co, () => d, () => locRef.current?.kind ?? null, () => snow.collapse.phase === 'buried' || cellar.buried, { lamp: () => obsh.holding && !obsh.dead, dead: () => obsh.dead || metro.dead || cat.dead, torch: () => !!invRef.current?.torchOn, mk: () => !!invRef.current?.fx.marked });
        co.onAct.add(onAct);
        co.beforeOp.add(beforeOp);
        co.afterOp.add(afterOp);
        if (import.meta.env.DEV) (window as any).__rfCoop = { co, presence }; // для QA-скриптов
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
    // кооп: дверь открыл другой игрок — у нас та же анимация (если кусок её комнаты построен), мир растёт его операцией
    const remote = new Map<number, { anim: { fail(): void }; to: (id: string) => void }>();
    function beforeOp(e: CoopOpEvent) {
      const dd = d;
      if (e.mine || e.op.k !== 'door' || !dd?.doors || !dd.portal?.cache.peek(e.op.inst)) return;
      const slot = dd.doorAt(e.op.inst, e.op.conn);
      if (!slot || slot.role !== 'exit') return;
      let target: string | null = null;
      const anim = dd.doors.open(slot, { ready: () => !!target && dd.roomReady(target) });
      if (anim) remote.set(e.seq, { anim, to: (id) => (target = id) });
    }
    function afterOp(e: CoopOpEvent, res: string | null) {
      const r = remote.get(e.seq);
      if (!r) return;
      remote.delete(e.seq);
      if (res) r.to(res);
      else r.anim.fail();
    }
    // кооп: засыпанного обвалом напарника рядом откапывают (E) — ему уходит действие dig, у него — SnowWalk.mateDig
    const onDigKey = (e: KeyboardEvent) => {
      const mate = presence?.nearBuried;
      if (e.code !== 'KeyE' || e.repeat || !co || !mate || v.hasOverlay || v.mode !== 'fps') return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT')) return;
      co.act(mate.id, 'dig');
    };
    function onAct(from: string, a: string) {
      if (a !== 'dig' || (snow.collapse.phase !== 'buried' && !cellar.buried)) return;
      if (snow.collapse.phase === 'buried') snow.mateDig();
      else cellar.mateDig(); // погреб: засыпало землёй
      const who = co?.players.get(from)?.name ?? 'напарник';
      const text = `${who} откапывает`;
      setFlash({ seq: Date.now(), text, color: '#9fd3ff' });
      setTimeout(() => setFlash((f) => (f?.text === text ? null : f)), 900);
    }
    if (co) window.addEventListener('keydown', onDigKey);
    const coopTimer = co
      ? window.setInterval(() => {
          setCoopSlow(!!presence?.slowed);
          setCoopDig(presence?.nearBuried?.name ?? null);
        }, 150)
      : 0;
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
      window.removeEventListener('keydown', onDoorKey);
      setDoorAt(null);
      setWalkHere(null);
      setWalkWet(null);
      lair.hide();
      mood.dispose();
      snow.dispose();
      setSnowHud(null);
      if (import.meta.env.DEV) delete (window as any).__rfSnow;
      cellar.dispose();
      if (import.meta.env.DEV) delete (window as any).__rfCellar;
      smile.dispose(); // smile
      dormView.dispose(); // smile
      if (import.meta.env.DEV) delete (window as any).__rfSmile; // smile
      obsh.dispose();
      obshRef.current = null;
      setObshHud(null);
      if (import.meta.env.DEV) delete (window as any).__rfObshaga;
      metro.dispose();
      metroRef.current = null;
      setMetroHud(null);
      if (import.meta.env.DEV) delete (window as any).__rfMetro;
      abyss.dispose(); // fractal
      if (import.meta.env.DEV) delete (window as any).__rfAbyss;
      if (import.meta.env.DEV) delete (window as any).__rfFractalEnter;
      cat.dispose();
      catRef.current = null;
      setCatHud(null);
      if (import.meta.env.DEV) delete (window as any).__rfCatacombs;
      transit.dispose();
      setStoryHud(null);
      setWalkStory(false);
      if (import.meta.env.DEV) delete (window as any).__rfStory;
      savePlayer();
      clearInterval(coopTimer);
      setCoopSlow(false);
      setCoopDig(null);
      window.removeEventListener('keydown', onDigKey);
      presence?.dispose();
      if (co) {
        co.beforeOp.delete(beforeOp);
        co.afterOp.delete(afterOp);
        co.onAct.delete(onAct);
        if (import.meta.env.DEV) delete (window as any).__rfCoop;
      }
      d?.dispose();
      // кооп: копия мира принадлежит лобби (операции применяются и без страницы) — только отцепиться
      if (co) {
        if (session) session.onUpdate = null;
      } else session?.dispose();
      walkRef.current = null;
      driver.current = null;
      if (import.meta.env.DEV) {
        delete (window as any).__rf3dFold;
        delete (window as any).__rfWalk;
      }
    };
  }, [source, walkRun, effOpts, view.finishes, coopOn, coopWalk]);

  // руки «Прогулки» (src/view3d/inventory.ts): хотбар, фонарик, выбросить / подобрать — после эффекта прогулки (его сессия
  // и драйвер уже стоят), пересоздаются вместе с ним; мир меняется только операциями сессии (кооп — через лобби)
  useEffect(() => {
    const v = viewer.current, s = walkRef.current, dd = driver.current;
    if (!v || source !== 'walk' || !s || !dd) return;
    let pvs: { rx: RunExport; c: string; set: Set<string> } | null = null;
    // лут: точки лута комнат набора вокруг игрока (src/gen4d/streamLoot.ts), кооп — напарник для дурака
    const co = coopWalk ? coop : null;
    const feed = new LootFeed();
    let lootSet: { rx: RunExport; c: string; set: Set<string> } | null = null;
    const inv = new Inventory(v, {
      key: s.key,
      playerId: coopWalk ? (coop?.me.id ?? null) : null,
      portal: () => dd.portal ?? null,
      room: () => dd.portal?.current ?? dd.current.center ?? null,
      // набор (PVS): предмет виден, пока его комната в наборе
      roomShown: (inst) => {
        const c = dd.current.center;
        if (!c) return true;
        if (pvs?.rx !== dd.run || pvs.c !== c) pvs = { rx: dd.run, c, set: dd.setOf(c) };
        return pvs.set.has(inst);
      },
      drops: () => s.drops(),
      // не подобранные точки лута комнат набора (массив новый — только на изменение: пересинк по lootRev)
      loot: () => {
        const c = dd.portal?.current ?? dd.current.center;
        if (!c) return [];
        const rx = s.rx;
        if (lootSet?.rx !== rx || lootSet.c !== c) lootSet = { rx, c, set: dd.setOf(c) };
        return feed.get(rx, lootSet.set, s.world.lootRev(), (inst) => lootOf(s.world, inst, rx), (id) => s.world.lootTaken(id));
      },
      request: (op) => s.request(op),
      saveWorld: () => s.saveNow(),
      // лут: спичка гаснет в воде; еда и дурак лечат — слой биома со здоровьем (общага, катакомбы)
      inWater: () => !!catRef.current?.inWater,
      heal: (hp) => {
        obshRef.current?.heal(hp);
        catRef.current?.heal(hp);
      },
      // дурак: живой напарник в той же комнате ближе r (по ногам — тот же пол)
      partner: (r) => {
        const room = dd.portal?.current ?? dd.current.center;
        if (!co || !room) return null;
        const c = v.fps.position, feet = c.y - v.posture.eye;
        let best: { id: string; name: string; d: number } | null = null;
        for (const p of co.players.values()) {
          const st = p.state;
          if (p.id === co.me.id || !st || st.loc || st.dead || !st.fps || st.room !== room) continue;
          const dist = Math.hypot(st.p[0] - c.x, st.p[2] - c.z);
          if (dist < r && Math.abs(st.p[1] - (st.eye ?? 1.6) - feet) < 1 && (!best || dist < best.d)) best = { id: p.id, name: p.name, d: dist };
        }
        return best;
      },
      durak: (to) => co?.act(to, 'durak'),
      // общага, метро: погиб — лампы в руке не видно
      handsDown: () => !!obshRef.current?.dead || !!metroRef.current?.dead || !!catRef.current?.dead,
      flash: (text, color = '#cfd8e6') => {
        const seq = Date.now();
        setFlash({ seq, text, color });
        setTimeout(() => setFlash((f) => (f?.seq === seq ? null : f)), 1200);
      },
      onHud: setInvHud,
    });
    invRef.current = inv;
    if (import.meta.env.DEV) (window as any).__rfInv = inv.qa(); // для QA-скриптов
    // напарник позвал в дурака (кооп-действие 'durak')
    const onDurak = (from: string, a: string) => {
      if (a === 'durak') inv.durakFrom(co?.players.get(from)?.name ?? 'напарником');
    };
    co?.onAct.add(onDurak);
    return () => {
      co?.onAct.delete(onDurak);
      inv.dispose();
      invRef.current = null;
      setInvHud(null);
      if (import.meta.env.DEV) delete (window as any).__rfInv;
    };
  }, [source, walkRun, effOpts, view.finishes, coopOn, coopWalk]);

  // общага: утащили — отпустить мышь (кнопка «Ещё раз»)
  useEffect(() => {
    if (obshHud?.dead && document.pointerLockElement) document.exitPointerLock();
  }, [obshHud?.dead]);
  // метро: эскалатор сорвался — отпустить мышь (кнопка «Ещё раз»)
  useEffect(() => {
    if (metroHud?.dead && document.pointerLockElement) document.exitPointerLock();
  }, [metroHud?.dead]);
  // fractal: на время «Фрактальной станции» звук метро молчит — кадр прогулки стоит, MetroAudio застыл бы на последнем
  // (гул ламп, «поршень», лента бездны); выход (любой: ниша, «выйти», закрытие) — звук возвращается
  const frOpen = loc?.kind === 'fractal';
  useEffect(() => {
    if (!frOpen) return;
    const m = metroRef.current;
    m?.muteSound(true);
    return () => m?.muteSound(false);
  }, [frOpen]);
  // катакомбы: захлебнулся — отпустить мышь (кнопка «Ещё раз»)
  useEffect(() => {
    if (catHud?.dead && document.pointerLockElement) document.exitPointerLock();
  }, [catHud?.dead]);

  // ── игра без отладки, одиночная: на паузе игровое время стоит (BlockoutViewer.setPaused — кадры не идут, звук на паузе):
  // мышь отпущена (Esc, экран входа, «Меню» поверх спец-локации), окно без фокуса. В лобби мир общий — идёт дальше; на
  // экранах смерти (общага, метро, катакомбы: «Ещё раз») — тоже идёт, как прежде ──
  const [focused, setFocused] = useState(() => typeof document === 'undefined' || document.hasFocus());
  useEffect(() => {
    if (!play) return;
    const on = () => setFocused(true);
    const off = () => setFocused(false);
    window.addEventListener('focus', on);
    window.addEventListener('blur', off);
    return () => {
      window.removeEventListener('focus', on);
      window.removeEventListener('blur', off);
    };
  }, [!!play]);
  const gamePaused =
    !!play && !coopOn && source === 'walk' && (pauseOpen || !locked || !focused) && !obshHud?.dead && !metroHud?.dead && !catHud?.dead;
  useEffect(() => {
    viewer.current?.setPaused(gamePaused);
    if (import.meta.env.DEV) (window as any).__rfPaused = gamePaused; // для QA-скриптов
  }, [gamePaused]);

  // вспышка «W 2 → 3» при переходе через порог со сдвигом
  const crossSeq = fs?.cross?.seq ?? 0;
  useEffect(() => {
    const c = fs?.cross;
    // игра без отладки: складки 4D игроку не показываются
    if (!c || c.fromW === c.toW || play) return;
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

  // ── «Прогон» / «Файл»: шагнул в комнату со спец-локацией (лестница, лифт) — её сцена. Мира за переходом здесь нет
  // (переходы в другие биомы — в «Прогулке»): любой выход — обратно к двери, через которую вошёл ──
  const runLocSkip = useRef<string | null>(null);
  const runRoom = source === 'run' || source === 'file' ? (fold ? fs?.center ?? null : here) : null;
  /** Поставить игрока в соседнюю комнату у проёма в комнату id, лицом от проёма. */
  const exitToDoor = (id: string) => {
    const v = viewer.current;
    const data = rx.data;
    if (!v || !data) return;
    const l = data.links.find((x) => (!x.kind || x.kind === 'door') && !x.sealed && (x.a.inst === id || x.b.inst === id));
    const nb = l ? (l.a.inst === id ? l.b.inst : l.a.inst) : null;
    if (!nb) return;
    if (fold) {
      driver.current?.placeAtDoor(nb, id);
      return;
    }
    const op = model?.openings.find((o) => (o.a.inst === id && o.b.inst === nb) || (o.b.inst === id && o.a.inst === nb));
    const ri = model?.rooms.find((r) => r.inst === id);
    if (!op || !ri) return;
    const cx = (op.rect.x0 + op.rect.x1) / 2, cy = (op.rect.y0 + op.rect.y1) / 2;
    // направление в соседнюю комнату: по оси прохода проёма, от спец-комнаты
    const dx = op.axis === 'x' ? Math.sign(cx - ri.anchor[0]) || 1 : 0;
    const dy = op.axis === 'y' ? Math.sign(cy - ri.anchor[1]) || 1 : 0;
    // план (x вправо, y вниз) → Babylon (x, −y)
    v.fps.position.set(cx + dx * 0.9, v.fps.position.y, -(cy + dy * 0.9));
    v.fps.rotation.set(0.05, Math.atan2(dx, -dy), 0);
    v.fps.cameraDirection.setAll(0);
  };
  useEffect(() => {
    const data = rx.data;
    if (!runRoom || mode !== 'fps' || loc || !data) return;
    if (runLocSkip.current === runRoom) return;
    runLocSkip.current = null;
    const inst = data.instances.find((i) => i.id === runRoom);
    const spec = parseLocation(inst?.location);
    // логово — без сцены; ангар — сцена открывается только пробитым снегом («Прогулка»); люк и дверь в снег (сюжет) —
    // без своей сцены, сценарий — в «Прогулке» (./storyWalk.ts)
    if (!inst || !spec || spec.kind === 'lair' || spec.kind === 'hangar' || spec.kind === 'hatch' || spec.kind === 'snowdoor') return;
    const n = roomAttempts.current.get(inst.id) ?? 0;
    roomAttempts.current.set(inst.id, n + 1);
    const base = { key: `run:${inst.id}:${Date.now()}`, seedKey: locationSeedKey(data.seed, inst.id), attempt: n, title: inst.roomName, mode: 'walk' as const };
    const back = (text: string | null) => {
      setLoc(null);
      runLocSkip.current = inst.id;
      exitToDoor(inst.id);
      if (text) notify(text, 'ok');
    };
    const far = 'в «Прогулке» отсюда — квартира другого биома или богатая квартира';
    if (spec.kind === 'lift') {
      setLoc({ kind: 'lift', ...base, spec, onExit: (kind, floor) => back(kind === 'entry' ? null : `Выход ${SIDE_RU[kind]} на этаже ${floor > 0 ? '+' : '−'}${Math.abs(floor)}: ${far}`) });
    } else if (spec.kind === 'swamp') {
      setLoc({ kind: 'swamp', ...base, spec, onExit: () => back(null) });
    } else {
      setLoc({ kind: 'stairwell', ...base, spec, onExit: (kind, floors) => back(kind === 'descend' ? `Лестница вывела вниз на ${floors} эт.: ${far}` : null) });
    }
  }, [runRoom, mode, loc, rx.data]);

  // ── «Комната» со спец-локацией: войти в её сцену без мира ──
  const selRoom = p.rooms.find((r) => r.id === roomSel) ?? null;
  const enterRoomLoc = () => {
    const room = selRoom;
    // fractal: бездонный эскалатор — без спец-локации: слой «Фрактальной станции» сразу, выход — назад (к двери)
    if (room && isAbyss(room.tags)) {
      setLoc({
        kind: 'fractal',
        key: `room:${room.id}:${Date.now()}`,
        seedKey: locationSeedKey('room-' + room.id, 'i0'),
        title: 'Фрактальная станция',
        mode: 'room',
        co: null,
        onExit: () => {
          setLoc(null);
          if (document.pointerLockElement) document.exitPointerLock();
          notify('Вышли из «Фрактальной станции»: в «Прогулке» это вестибюль метро этажом ниже', 'ok');
        },
      });
      return;
    }
    const spec = room?.location;
    if (!room || !spec || spec.kind === 'lair') return;
    if (spec.kind === 'hatch' || spec.kind === 'snowdoor') {
      notify(spec.kind === 'hatch' ? 'Люк в погреб — переход сюжета: открывается в «Прогулке» (E у люка)' : 'Дверь в снег — переход сюжета: открывается в «Прогулке» (E у двери)', 'info');
      return;
    }
    const n = roomAttempts.current.get(room.id) ?? 0;
    roomAttempts.current.set(room.id, n + 1);
    if (spec.kind === 'swamp') {
      setLoc({
        kind: 'swamp',
        key: `room:${room.id}:${Date.now()}`,
        spec,
        seedKey: locationSeedKey('room-' + room.id, 'i0'),
        title: room.name,
        mode: 'room',
        onExit: (kind) => {
          setLoc(null);
          if (document.pointerLockElement) document.exitPointerLock();
          if (kind === 'new') notify('«Новая игра» в «Прогулке» стирает мир сида и начинает с биома старта', 'ok');
        },
      });
      return;
    }
    if (spec.kind === 'hangar') {
      setLoc({
        kind: 'hangar',
        key: `room:${room.id}:${Date.now()}`,
        spec,
        seedKey: locationSeedKey('room-' + room.id, 'i0'),
        title: 'Ангар',
        mode: 'room',
        onExit: () => {
          setLoc(null);
          if (document.pointerLockElement) document.exitPointerLock();
          notify('Вышли за ворота ангара: в «Прогулке» это комната этажами ниже — хаб завода (если он есть) или другой биом', 'ok');
        },
      });
      return;
    }
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
  else if (source === 'walk' && coopOn && !coopWalk) msg = { kind: 'info', title: `Лобби: ${COOP_STATUS[coop.status]}`, text: `Мир лобби загружается с сервера ${coop.url}…` };
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
    <div className={play ? 'v3-play' : 'cols3'}>
      {/* игра без отладки (play): ни панелей, ни отладочного HUD — только холст и игровой HUD */}
      {!play && (
      <aside className="side">
        <CoopSection co={coop} onOpen={() => setCoopModal(true)} />
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
              {(selRoom?.location?.kind === 'stairwell' || selRoom?.location?.kind === 'lift' || selRoom?.location?.kind === 'hangar' || selRoom?.location?.kind === 'swamp') && (
                <>
                  <Btn variant="primary" onClick={enterRoomLoc} disabled={!!loc || !!glErr} title="Сцена спец-локации сама по себе, без мира: вход у двери, выход назад — через неё же">
                    Войти в локацию
                  </Btn>
                  <div className="hint">
                    {selRoom.location.kind === 'stairwell'
                      ? 'Спец-локация «Бесконечная лестница». В «Прогулке» вход — через дверь комнаты, выход вниз ведёт на этаж ниже.'
                      : selRoom.location.kind === 'swamp'
                      ? 'Финал игры «Болото на крыше». В «Прогулке» сюда выводит мокрый ход завода; встань на зуб шестерни — он поднимет тебя в перевёрнутое болото над головой: конец игры. Назад — дверь.'
                      : selRoom.location.kind === 'hangar'
                      ? 'Спец-локация «Ангар». В «Прогулке» — подтаявшая берлога снежных ходов: пробил пятно в полу — падение сквозь крышу в ангар; ворота цеха ведут дальше (этажами ниже). Здесь — стоя у кучи, без падения.'
                      : 'Спец-локация «Ржавый лифт». В «Прогулке» вход — через дверь шахты, выходы прямо и направо ведут на этажи выше и ниже, к лифту — назад к той же стене.'}
                  </div>
                </>
              )}
              {selRoom?.location?.kind === 'lair' && (
                <div className="hint">Логово босса (заглушка): в «Прогулке» сюда выводит один из выходов лифта — тёмная комната с табличкой.</div>
              )}
              {/* fractal: бездонный эскалатор — комната без спец-локации, вход в слой станции */}
              {isAbyss(selRoom?.tags) && (
                <>
                  <Btn variant="primary" onClick={enterRoomLoc} disabled={!!loc || !!glErr} title="Сцена «Фрактальной станции» сама по себе, без мира: выход — кнопкой или нишей">
                    Войти в локацию
                  </Btn>
                  <div className="hint">
                    Спец-локация «Фрактальная станция». В «Прогулке» — бездонный эскалатор за дверью служебного хода метро: ниже середины спуска — тьма и станция-тессеракт, где все поверхности — полы; выход — светлая ниша «Выход в город» наверху эскалатора выхода, ведёт в вестибюль метро этажом ниже.
                  </div>
                </>
              )}
            </div>
          )}
          {source === 'walk' && (
            <div className="v3-src v3-walk">
              {coopOn && (
                <div className="hint">
                  Мир лобби{coop.meta ? <> — сид <span className="mono">«{coop.meta.seed}»</span></> : null}: общий для всех игроков, хранится на сервере. Сид, биом и сброс ниже — для
                  одиночной прогулки (после выхода из лобби).
                </div>
              )}
              <div className="v3-walk-seed">
                <input
                  className="input"
                  value={walkSeedDraft}
                  onChange={(e) => setWalkSeedDraft(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && startWalk(walkSeedDraft)}
                  title="Сид мира: тот же сид — тот же мир (и его сохранение)"
                />
                <Btn sm onClick={() => startWalk(walkSeedDraft)} disabled={coopOn || walkSeedDraft.trim() === walkRun.seed} title="Открыть мир этого сида (сохранённый — с того же места)">
                  Открыть
                </Btn>
              </div>
              <label className="check" title="Мир растёт квартирами с закрытыми дверями-выходами, биомами и переходами (настройки — «Генератор» → «Бесконечный мир»). Выключено — прежний рост с тупиками по шансу">
                <input type="checkbox" checked={walkOpts.clusters} onChange={(e) => setWalkOpt('clusters', e.target.checked)} />
                Квартиры, биомы и переходы
              </label>
              {walkOpts.clusters && p.world && walkStartBiome && (
                <div className="v3-walk-biome" title="Мир начинается в этом биоме: переключение сразу открывает его мир этого сида (у каждого биома — свой, сохраняется отдельно — вернётесь туда же). Дальше биомы меняются переходами, как обычно">
                  <Select
                    label="Биом"
                    value={walkStartBiome}
                    options={plainBiomes(p.world).map((b) => ({ value: b.id, label: b.name + (b.layout === 'tunnels' ? ' · ходы' : '') }))}
                    onChange={switchBiome}
                  />
                </div>
              )}
              {!walkOpts.clusters && (
                <div className="grid2">
                  <NumField label="Тупики" value={walkOpts.deadEndChance * 100} min={0} max={100} step={5} digits={0} suffix="%" title="Вероятность, что нераскрытая дверь окажется заколоченной" onChange={(v) => setWalkOpt('deadEndChance', Math.min(1, Math.max(0, v / 100)))} />
                  <NumField label="Ветвистость" value={walkOpts.branching} min={0} max={10} step={0.25} title="Множитель веса развилок: 1 — как в пуле, больше — ветвистее" onChange={(v) => setWalkOpt('branching', Math.max(0, v))} />
                  <NumField label="Вперёд дверей" value={walkOpts.aheadDoors} min={0} max={16} step={1} digits={0} title="На сколько дверей вперёд мир раскрыт заранее" onChange={(v) => setWalkOpt('aheadDoors', Math.round(v))} />
                </div>
              )}
              <div className="v3-seg">
                <Btn sm onClick={() => startWalk('мир-' + Math.random().toString(36).slice(2, 7))} disabled={coopOn} title="Новый мир со случайным сидом и настройками выше">
                  Новый мир
                </Btn>
                <Btn sm onClick={() => startWalk(walkRun.seed, true)} disabled={coopOn} title="Стереть сохранение этого сида и начать его заново (с настройками выше)">
                  Сбросить сохранение
                </Btn>
              </div>
              {walkStatus && (
                <div className="v3-kv">
                  <span>комнат</span>
                  <span>{walkStatus.rooms} · слоёв {walkStatus.layers}</span>
                  {walkStatus.stats.transition ? (
                    <>
                      <span>квартир</span>
                      <span>
                        {walkStatus.stats.clusters} · закрытых выходов {walkStatus.stats.exitsOpen}
                      </span>
                      {walkStatus.stats.hubs > 0 && (
                        <>
                          <span>подвал</span>
                          <span title="хабов в подвалах мира · замкнутых колец из хаба в хаб · бесконечных прямых участков (шов)">
                            хабов {walkStatus.stats.hubs} · колец {walkStatus.stats.rings} · бесконечных {walkStatus.stats.wraps}
                          </span>
                        </>
                      )}
                      <span>переход</span>
                      <span>
                        {walkStatus.stats.transition.pending
                          ? 'выпал — за следующей открытой дверью'
                          : `пройдено ${walkStatus.stats.transition.count} комн. · шанс ${Math.round(walkStatus.stats.transition.chance * 100)}%`}
                      </span>
                    </>
                  ) : (
                    <>
                      <span>тупиков</span>
                      <span>{walkStatus.dead} · не раскрыто дверей {walkStatus.pending}</span>
                    </>
                  )}
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
          <Check label="двери (модели)" value={opts.doors !== false} onChange={(v) => setOpt('doors', v)} title="Двери из каталога (docs/DOORS.md): закрытые выходы, заколоченные тупики, распахнутые полотна и наличники у проходов" />
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
            <b>От первого лица:</b> клик — захват мыши, WASD / стрелки — ходьба, C — на четвереньки / встать, Esc — отпустить мышь. Коллизии и гравитация, глаза на 1.6 м (на четвереньках — 0.5 м).
            <br />
            <b>Прогулка:</b> Shift + W — бег (стоя). Выносливость — шкала внизу: тает на бегу (~7 с), выдохся — бега нет, пока не отдышишься; на месте отдых быстрее.
            <br />
            <b>Руки (прогулка):</b> хотбар внизу — 1–5 / колесо — предмет в руке, F — фонарь вкл/выкл, G — выбросить перед собой, E — подобрать с пола (подсвеченный). Хотбар сохраняется с миром, брошенное лежит, где бросили.
          </div>
        </Section>
      </aside>
      )}

      <div className="stage v3-stage" ref={stageRef}>
        <canvas ref={canvasRef} tabIndex={0} />
        {/* fractal: вуаль бездонного эскалатора (src/view3d/fractalAbyss.ts) — opacity пишет AbyssWalk */}
        <div ref={frVeilRef} className="v3-fr-veil" style={{ position: 'absolute', inset: 0, background: '#000', opacity: 0, pointerEvents: 'none' }} />
        {loc &&
          (loc.kind === 'lift' ? (
            <LiftLayer viewer={viewer.current} req={loc} onClose={closeLoc} story={source === 'walk' && (walkStory || !!play)} />
          ) : loc.kind === 'hangar' ? (
            <HangarLayer viewer={viewer.current} req={loc} onClose={closeLoc} story={source === 'walk' && (walkStory || !!play)} />
          ) : loc.kind === 'swamp' ? (
            <SwampLayer viewer={viewer.current} req={loc} onClose={closeLoc} play={play ? { onMenu: playMenu } : undefined} />
          ) : loc.kind === 'fractal' ? ( // fractal
            <FractalLayer viewer={viewer.current} req={loc} onClose={closeLoc} story={source === 'walk' && (walkStory || !!play)} />
          ) : (
            <StairwellLayer viewer={viewer.current} req={loc} onClose={closeLoc} story={source === 'walk' && (walkStory || !!play)} />
          ))}
        {!play && (
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
        )}
        {mode === 'fps' && shown && !loc && !play && (
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
            {/* игра без отладки: из статистики — только биом (место), влажность завода, общага, связь и ошибка сохранения */}
            {!play && <span>комнат {walkStatus.rooms}</span>}
            {shown && !play && (
              <>
                <span title="Этаж: 0 — этаж старта; ниже — после спуска по спец-локации">этаж {fmtFloor(floorOf(shown.inst))}</span>
                <span style={{ color: layerColor(wOfInst(shown.inst)) }}>W {sgn(wOfInst(shown.inst))}</span>
                <span>глубина {rx.data?.instances.find((i) => i.id === shown.inst)?.depth ?? 0}</span>
              </>
            )}
            {walkHere?.biome ? (
              <span style={{ color: walkHere.biome.color }} title={walkHere.gate ? 'площадка-переход: любая её дверь — в другой биом' : walkHere.rich ? 'богатая квартира: элитность выше' : 'биом квартиры'}>
                {walkHere.biome.name}
                {walkHere.rich && !play ? ' ★' : ''}
                {walkHere.gate && !play ? ' · переход' : ''}
              </span>
            ) : (
              !play && <span>тупиков {walkStatus.dead}</span>
            )}
            {walkWet && (
              <span title="Влажность куска цеха: иди туда, где влажнее — там болото (финал). Ступени: сухо, сыро, течь, топь">
                {WET_TAGS[walkWet.level]}{play ? '' : ` ${Math.round(walkWet.w * 100)}%`}{walkWet.dir > 0 ? ' ↑' : ' ↓'}
              </span>
            )}
            {obshHud?.on && (
              <>
                {obshHud.lamp && <span style={{ color: '#e8b050' }} title="Керосиновая лампа в руке: рука не подойдёт ближе 3 м ни к тебе, ни к тем, кто рядом">лампа</span>}
                {obshHud.dark && <span className="v3-err" title="Свет отключили: из дверей лезет рука — смотри на неё">темно</span>}
                {obshHud.hp != null && (
                  <span className="v3-obsh-hp" title="Здоровье: под кроватью рука не схватит, но бьёт пальцем. Без тычков 4 с — заживает">
                    <i style={{ width: `${obshHud.hp}%` }} />
                  </span>
                )}
                <button className="btn sm v3-obsh-sound" onClick={() => obshRef.current?.setSound(!obshHud.sound)} title="Звук общаги (WebAudio). Esc — отпустить мышь, чтобы нажать">
                  звук: {obshHud.sound ? 'вкл' : 'выкл'}
                </button>
              </>
            )}
            {metroHud?.on && (
              <>
                {metroHud.alarm && metroHud.alarm !== 'broken' && <span className="v3-err" title="Эскалатор срывается: перелезь через балюстраду (E) или успей доехать до низа">эскалатор!</span>}
                <button className="btn sm v3-obsh-sound" onClick={() => metroRef.current?.setSound(!metroHud.sound)} title="Звук метро (WebAudio). Esc — отпустить мышь, чтобы нажать">
                  звук: {metroHud.sound ? 'вкл' : 'выкл'}
                </button>
              </>
            )}
            {catHud?.on && (
              <>
                {catHud.water && (
                  <span className={catHud.water.phase === 'warn' ? '' : 'v3-err'} title="Уровень воды над полом ходов. Пик — 2 м: переждать на площадке убежища (лестница наверх)">
                    вода {catHud.water.m.toFixed(1)} м{catHud.water.dir > 0 ? ' ↑' : catHud.water.dir < 0 ? ' ↓' : ''}
                  </span>
                )}
                {catHud.air != null && (
                  <span className="v3-obsh-hp v3-cat-air" title="Воздух: под водой хватит на 12 с, потом тонешь. Над водой — восстанавливается">
                    <i style={{ width: `${Math.round(catHud.air * 100)}%` }} />
                  </span>
                )}
                {catHud.hp != null && (
                  <span className="v3-obsh-hp" title="Здоровье: без воздуха −10 в секунду. Над водой через 4 с заживает">
                    <i style={{ width: `${catHud.hp}%` }} />
                  </span>
                )}
                <button className="btn sm v3-obsh-sound" onClick={() => catRef.current?.setSound(!catHud.sound)} title="Звук катакомб (WebAudio). Esc — отпустить мышь, чтобы нажать">
                  звук: {catHud.sound ? 'вкл' : 'выкл'}
                </button>
              </>
            )}
            {coopOn ? (
              (!play || coop.status !== 'online') && (
                <span className={coop.status === 'online' ? 'muted' : 'v3-err'} title="мир лобби хранится на сервере">
                  онлайн · {COOP_STATUS[coop.status]}
                </span>
              )
            ) : (
              (!play || walkStatus.error) && (
                <span className={walkStatus.error ? 'v3-err' : 'muted'} title={walkStatus.error ?? 'автосохранение мира в localStorage'}>
                  {walkStatus.error ? '⚠ не сохранено' : walkStatus.saved ? `✓ сохранено ${new Date(walkStatus.saved.at).toLocaleTimeString()}` : '…'}
                </span>
              )
            )}
          </div>
        )}
        {source === 'walk' && mode === 'fps' && doorAt && !coopDig && !loc && !invHud?.prompt && <div className="float hud v3-lift-prompt">E — открыть дверь</div>}
        {source === 'walk' && mode === 'fps' && coopDig && !loc && !invHud?.prompt && <div className="float hud v3-lift-prompt">E — откапывать: {coopDig}</div>}
        {source === 'walk' && mode === 'fps' && coopOn && coopWalk && !loc && <CoopHud co={coop} slow={coopSlow} />}
        {source === 'walk' && mode === 'fps' && !loc && snowHud?.buried != null && <div className="v3-snow-buried" style={{ opacity: 0.94 - 0.55 * snowHud.buried }} />}
        {source === 'walk' && mode === 'fps' && !loc && snowHud?.crack != null && <div className="v3-snow-crack" style={{ opacity: 0.25 + 0.5 * snowHud.crack }} />}
        {source === 'walk' && mode === 'fps' && !loc && snowHud?.prompt && !invHud?.prompt && <div className="float hud v3-lift-prompt">{snowHud.prompt}</div>}
        {source === 'walk' && mode === 'fps' && !loc && obshHud?.prompt && !doorAt && !coopDig && !invHud?.prompt && !storyHud?.prompt && !storyHud?.active && <div className="float hud v3-lift-prompt">{obshHud.prompt}</div>}
        {/* метро (src/view3d/metroWalk.ts): срыв эскалатора — «E — перелезть», затемнение при падении */}
        {source === 'walk' && mode === 'fps' && !loc && metroHud?.prompt && !doorAt && !coopDig && !storyHud?.prompt && <div className="float hud v3-lift-prompt">{metroHud.prompt}</div>}
        {source === 'walk' && mode === 'fps' && !loc && metroHud?.hint && !metroHud.dead && !obshHud?.hint && <div className="float hud v3-obsh-hint">{metroHud.hint}</div>}
        {source === 'walk' && mode === 'fps' && !loc && !!metroHud?.black && <div className="v3-obsh-black" style={{ opacity: metroHud.black }} />}
        {/* катакомбы (src/view3d/catacombsWalk.ts): «E — перелезть», «C — ползком», муть под водой, захлебнулся — затемнение */}
        {source === 'walk' && mode === 'fps' && !loc && catHud?.under && <div className="v3-cat-under" />}
        {source === 'walk' && mode === 'fps' && !loc && catHud?.prompt && !doorAt && !coopDig && !invHud?.prompt && !storyHud?.prompt && <div className="float hud v3-lift-prompt">{catHud.prompt}</div>}
        {source === 'walk' && mode === 'fps' && !loc && catHud?.hint && !catHud.dead && !obshHud?.hint && !metroHud?.hint && <div className="float hud v3-obsh-hint">{catHud.hint}</div>}
        {source === 'walk' && mode === 'fps' && !loc && catHud?.hp != null && !catHud.dead && <div key={catHud.hit} className="v3-obsh-hurt" />}
        {source === 'walk' && mode === 'fps' && !loc && !!catHud?.black && <div className="v3-obsh-black" style={{ opacity: catHud.black }} />}
        {/* сюжет (src/view3d/storyWalk.ts): люк — затемнение; дверь в снег — треск, белая пелена, «E — выкапываться» */}
        {source === 'walk' && mode === 'fps' && !loc && storyHud?.crack != null && <div className="v3-snow-crack" style={{ opacity: 0.25 + 0.5 * storyHud.crack }} />}
        {source === 'walk' && mode === 'fps' && !loc && storyHud?.white != null && <div className="v3-snow-buried" style={{ opacity: storyHud.white }} />}
        {source === 'walk' && mode === 'fps' && !loc && storyHud?.black != null && <div className="v3-story-black" style={{ opacity: storyHud.black }} />}
        {source === 'walk' && mode === 'fps' && !loc && storyHud?.prompt && (storyHud.white != null || (!doorAt && !coopDig && !invHud?.prompt)) && <div className="float hud v3-lift-prompt v3-story-prompt">{storyHud.prompt}</div>}
        {source === 'walk' && mode === 'fps' && !loc && obshHud?.hint && !obshHud.dead && <div className="float hud v3-obsh-hint">{obshHud.hint}</div>}
        {source === 'walk' && mode === 'fps' && !loc && obshHud?.drag != null && <div className="v3-obsh-drag" style={{ opacity: 0.5 + 0.5 * obshHud.drag }} />}
        {source === 'walk' && mode === 'fps' && !loc && !!obshHud?.black && <div className="v3-obsh-black" style={{ opacity: obshHud.black }} />}
        {source === 'walk' && mode === 'fps' && !loc && obshHud?.hp != null && !obshHud.dead && <div key={obshHud.hit} className="v3-obsh-hurt" />}
        {source === 'walk' && mode === 'fps' && !loc && obshHud?.dead && (
          <div className="v3-loc-dead v3-obsh-dead">
            <div>
              {obshHud.title ? (
                // smile: смерть не от руки — свой текст (ObshagaWalk.kill)
                <>
                  <h2>{obshHud.title}</h2>
                  {obshHud.hint && <p className="hint">{obshHud.hint}</p>}
                </>
              ) : obshHud.cause === 'poke' ? (
                <>
                  <h2>Рука достала тебя под кроватью</h2>
                  <p className="hint">Под кроватью она не схватит, но бьёт пальцем — долго не пролежишь. Вылезай, глядя на неё: под взглядом она замирает.</p>
                </>
              ) : (
                <>
                  <h2>Тебя утащили за дверь</h2>
                  <p className="hint">Рука ползёт, только пока её не видно. Смотри на неё — замрёт; керосиновая лампа держит её на 3 м.</p>
                </>
              )}
              <button className="btn primary" onClick={() => obshRef.current?.retry()}>
                Ещё раз
              </button>
            </div>
          </div>
        )}
        {source === 'walk' && mode === 'fps' && !loc && metroHud?.dead && !obshHud?.dead && (
          <div className="v3-loc-dead v3-obsh-dead">
            <div>
              <h2>Эскалатор сорвался</h2>
              <p className="hint">Лента дёрнулась и встала — потом побежала вниз и оборвалась в приямок. Перелезай через балюстраду на соседнюю дорожку (E) или успей доехать до низа.</p>
              <button className="btn primary" onClick={() => metroRef.current?.retry()}>
                Ещё раз
              </button>
            </div>
          </div>
        )}
        {source === 'walk' && mode === 'fps' && !loc && catHud?.dead && !obshHud?.dead && !metroHud?.dead && (
          <div className="v3-loc-dead v3-obsh-dead">
            <div>
              <h2>Захлебнулся</h2>
              <p className="hint">Вода приходит по часам: сначала гул в трубах, потом поднимается до 2 м. Переждать можно только наверху — на площадке убежища (лестница). Под водой воздуха — на 12 секунд.</p>
              <button className="btn primary" onClick={() => catRef.current?.retry()}>
                Ещё раз
              </button>
            </div>
          </div>
        )}
        {source === 'walk' && mode === 'fps' && !loc && (
          <div className="v3-stamina" ref={staminaRef}>
            <div className="v3-stamina-fill" />
          </div>
        )}
        {/* руки: хотбар внизу по центру; «E — подобрать» — в том же месте, что прочие «E — …» (и вместо них: E — его) */}
        {source === 'walk' && mode === 'fps' && !loc && invHud && <HotbarHud hud={invHud} />}
        {source === 'walk' && mode === 'fps' && !loc && invHud?.bagOpen && invRef.current && <BagHud hud={invHud} act={invRef.current} />}
        {source === 'walk' && mode === 'fps' && !loc && invHud?.prompt && <div className="float hud v3-lift-prompt">{invHud.prompt}</div>}
        {flash && mode === 'fps' && !loc && (
          <div key={flash.seq} className={'v3-flash' + (flash.big ? ' v3-flash-story' : '')} style={{ color: flash.color }}>
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
        {/* игра без отладки: клавиши — в меню паузы */}
        <div className="float hud v3-hud" style={loc || play ? { display: 'none' } : undefined}>
          {fs?.label && <span>{fs.label}</span>}
          {mode === 'orbit' ? (
            <span>ЛКМ — вращать · ПКМ — сдвиг · колесо — масштаб · клик по полу — комната</span>
          ) : locked ? (
            <>
              <span>
                <b>WASD</b> — ходьба{source === 'walk' && <> · <b>Shift</b> — бег</>} · мышь — обзор · <b>C</b> — {pose === 'crawl' ? 'встать' : 'на четвереньки'} · <b>Esc</b> — отпустить мышь
              </span>
              {source === 'walk' && (
                <span>
                  <b>1–5</b> / колесо — предмет · <b>F</b> — свет · <b>R</b> — перезарядить · <b>ЛКМ</b> — использовать · <b>Tab</b> — сумка · <b>G</b> — выбросить · <b>E</b> — подобрать
                </span>
              )}
            </>
          ) : (
            <span>
              <b>Клик</b> по сцене — захватить мышь · WASD — ходьба · C — на четвереньки
            </span>
          )}
        </div>
        {!play && <div className="float hud v3-perf" ref={perfRef} />}
        {msg && (
          <div className={'v3-msg' + (msg.kind === 'info' ? ' info' : '')}>
            <div>
              <h3>{msg.title}</h3>
              {msg.text && <pre>{msg.text}</pre>}
              {msg.action}
              {play && (
                <button className="btn" onClick={playMenu}>
                  {coopOn ? 'Выйти из лобби в меню' : 'Главное меню'}
                </button>
              )}
            </div>
          </div>
        )}
        {/* игра без отладки: пауза — мышь отпущена (Esc); поверх спец-локации — кнопкой «Меню» или Esc */}
        {play && loc && !locked && !pauseOpen && (
          <button className="v3-play-menu" onClick={() => setPauseOpen(true)} title="Пауза, главное меню (Esc)">
            Меню
          </button>
        )}
        {play && !msg && (pauseOpen || (!locked && !loc && mode === 'fps' && !obshHud?.dead && !metroHud?.dead && !catHud?.dead && !invHud?.bagOpen)) && (
          <PlayPause
            where={walkHere?.biome?.name ?? null}
            first={!played}
            co={coopOn ? coop : null}
            onResume={playResume}
            onMenu={playMenu}
          />
        )}
      </div>

      {!play && (
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
      )}
      {coopModal && !play && (
        <CoopModal
          co={coop}
          walk={{ ...walkOpts, seed: walkRun.seed }}
          project={p}
          biomeName={p.world?.biomes.find((b) => b.id === walkStartBiome)?.name ?? null}
          onClose={() => setCoopModal(false)}
        />
      )}
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

/** Клавиши игры — в меню паузы (игра без отладки). */
const PLAY_KEYS: [string, string][] = [
  ['WASD', 'идти'],
  ['мышь', 'смотреть'],
  ['Shift', 'бежать'],
  ['C', 'на четвереньки / встать'],
  ['E', 'открыть, взять'],
  ['F', 'свет: фонарь, спичка, зиппа'],
  ['R', 'перезарядить, заправить'],
  ['ЛКМ', 'съесть, использовать'],
  ['Tab', 'сумка'],
  ['1–5 · колесо', 'что в руке'],
  ['G', 'выбросить'],
  ['Esc', 'пауза'],
];

/**
 * Пауза игры без отладки (src/play/): мышь отпущена — меню поверх; в одиночной игре мир стоит (gamePaused), в лобби идёт
 * дальше. Первый раз — экран входа. В лобби — его код (друзьям) и выход из лобби вместо «Главного меню».
 */
function PlayPause(props: { where: string | null; first: boolean; co: CoopSession | null; onResume: () => void; onMenu: () => void }) {
  const { co } = props;
  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      notify('Код лобби скопирован', 'ok');
    } catch {
      notify('Не удалось скопировать — выделите код вручную', 'warn');
    }
  };
  return (
    <div className="v3-pause">
      <div className="v3-pause-card">
        {props.where && <div className="v3-pause-where">{props.where}</div>}
        <h2>{props.first ? 'Гигахрущ' : 'Пауза'}</h2>
        <div className="v3-pause-btns">
          <button className="v3-pause-btn go" onClick={props.onResume} autoFocus>
            {props.first ? 'Войти' : 'Продолжить'}
          </button>
          <button className="v3-pause-btn" onClick={props.onMenu} title={co ? 'Выйти из лобби: мир лобби останется у остальных' : 'Игра сохранена — «Продолжить» в меню вернёт сюда'}>
            {co ? 'Выйти из лобби в меню' : 'Главное меню'}
          </button>
        </div>
        {co && (
          <div className="v3-pause-lobby">
            <span>лобби · игроков {co.players.size + 1}</span>
            <input className="mono" readOnly value={co.lobby} onFocus={(e) => e.currentTarget.select()} />
            <button className="v3-pause-btn sm" onClick={() => void copy(co.lobby)}>
              копировать код
            </button>
          </div>
        )}
        <dl className="v3-pause-keys">
          {PLAY_KEYS.map(([k, v]) => (
            <div key={k}>
              <dt>{k}</dt>
              <dd>{v}</dd>
            </div>
          ))}
        </dl>
      </div>
    </div>
  );
}
