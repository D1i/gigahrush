// «Прогулка» в общаге (биом «Общага», docs/GENERATOR-4D.md §22, docs/LOCATIONS.md «Общага: двери, темнота, рука,
// лампа»): то, чего нет у обычных комнат. Механика — src/locations/obshaga.ts (режиссёр: свет, двери, рука), навигация —
// ./obshagaNav.ts, картинка — ./obshagaScene.ts, звук — ./obshagaAudio.ts, кооп — ./obshagaSync.ts.
//
//  • Двери комнат (obshaga_room) закрываются сами: E у двери (с любой стороны, ближе 1.3 м) — распахнуть; режиссёр
//    закрывает её через время, только пока на неё никто не смотрит (полотно в кадре, на линии взгляда сквозь проёмы,
//    ближе 15 м) и в зоне хода никого нет. Полотно — коллайдер (src/blockout/babylon.ts, DoorStyle.selfClosing), поза —
//    FoldDriver.doorPose / poseDoor. Запертые (за дверью не выросла комната) не открываются — «Заперто»; их открывает
//    только рука (за ними — чёрный проём).
//  • Свет: моргание и отключение по режиссёру — светящиеся лампы гаснут, свет сцены (BiomeMood.light) — тусклый тёплый
//    при свете и почти чёрный в темноте. Только пока игрок в общаге.
//  • Керосиновая лампа — предмет хотбара (it_kerolamp, src/view3d/inventory.ts): E у лампы на споте — взять (место в
//    хотбаре есть — операция мира 'lamp': взятая не стоит больше ни у кого; лампа — в хотбар и в руку; места нет — «Руки
//    заняты»). Держит — лампа выбрана в хотбаре (host.lampHeld; модель у камеры и тусклый жёлтый свет рисует хотбар);
//    другая ячейка — лампа убрана. G — поставить на пол (предмет мира), E — подобрать. Держащего рука не хватает; поле
//    лампы (1 м) — у лампы в руках и у стоящей на полу (host.drops) — защищает всех рядом.
//  • Рука: в темноте из невидимой двери; ползёт кончиком по пути к своей цели — одному незащищённому игроку (проёмы комнат),
//    только пока её не видят (кадр + линия взгляда сквозь проёмы + свет: лампа ближе LANTERN_LIGHT_R или горящие
//    лампы); невидимая и близко — хватает и утаскивает за свою дверь: чёрный экран, «Тебя утащили за дверь», «Ещё раз» —
//    возрождение в ближайшем вестибюле с вахтой (кооп — рядом с живым напарником). Свет вернулся посреди волочения —
//    отпустила. Рука беззвучна; её дверь открывается без звука.
//  • Под кроватью (ползком, C — лёг под кровать сам: Posture.under === 'bed'; под столом не спасает) рука не хватает —
//    приползает и тычет пальцем: тычок — −OBSHAGA.pokeDmg здоровья (100), красная вспышка, тряска, вскрик; через
//    hpRegenDelayS без тычков заживает. Здоровье кончилось — смерть «Рука достала тебя под кроватью», «Ещё раз» — как
//    у утащенного (здоровье снова 100). Кооп: напарник под кроватью — у хоста по PlayerState.eye < SHELTER_EYE (глаз
//    над полом: лёжа 0.22, на четвереньках 0.5) И внутри рамки кровати (bedAt: рядом с кроватью лёжа — не укрыт);
//    тычок — событие среза, урон считает жертва у себя, смерть — PlayerState.dead. Кровать руке известна
//    (HandPlayer.cover / NavPlayer.cover — рамка из навигации): ползёт к свободному боку, кисть и пальцы — снаружи;
//    ближе не подойти — палец вытягивается до OBSHAGA.pokeMaxM.
//  • Цель руки — одна (HandView.target, aimHand механики): счёт «агро − путь». Хост у всех игроков одинаково меряет
//    горизонтальную скорость по смещениям (окно SPEED_WIN_S; скачок быстрее SPEED_MAX — телепорт, не шум) →
//    HandPlayer.speed (режиссёр копит память шума); фонарик — свой host.torch(), напарник — PlayerState.torch; путь до
//    каждого — pathLen по навигации (HandPlayer.dist); handGoal ведёт только к цели. Кровати не-целей — пол для руки.
//  • Предметы (host.fx — эффекты хотбара, сессия лута): invuln — тычки не отнимают здоровье, хватка не держит (рука
//    хватает и тащит пустой кулак за дверь, своего игрока не волочёт и смерти нет — slip до released / killed);
//    marked — HandPlayer.marked (+OBSHAGA.aggroMarkM), у напарника — PlayerState.mk (если есть); noise — HandPlayer.loud
//    (в единицах шума: 1 — бег; только свой: в PlayerState его нет); down (лежит) — шум шага 0; drunk — не здесь.
//    heal(hp) — еда: +hp, не выше OBSHAGA.hp. Увидел руку (фронт seesHand) — host.sawCreature('hand').
//  • Вода по пояс в затопленном подвале: плоскость воды, шаг 0.55.
//  • Кооп (docs/COOP.md §2.5): хост ведёт режиссёра за всех (видит ли руку каждый и на какие двери смотрит — присылают
//    клиенты, fx 'obshSee'; E у двери — fx 'obshDoor'), ~10 раз в секунду рассылает срез (fx 'obsh'); клиенты рисуют по
//    нему. Держит лампу / погиб — PlayerState.lamp / dead (src/coop/presence.ts).
//  • Высоты: всё из плана — с высотой экземпляра (RunInstance.z, лестницы). Рука не заходит в лестничные залы и не
//    пересекает швы бесконечного хода (карта руки — chartOf): игрок за лестницей — вне её досягаемости; если в карте
//    никого не осталось — рука уползает (поле «лампы» у самой кисти).
import type { Scene } from '@babylonjs/core/scene';
import type { UniversalCamera } from '@babylonjs/core/Cameras/universalCamera';
import type { Camera } from '@babylonjs/core/Cameras/camera';
import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import type { Observer } from '@babylonjs/core/Misc/observable';
import type { Plane } from '@babylonjs/core/Maths/math.plane';
import { Frustum } from '@babylonjs/core/Maths/math.frustum';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import type { Color3 } from '@babylonjs/core/Maths/math.color';
import {
  createHand, createObshagaDirector, forceObshagaBlackout, withdrawHand, inLanternLight, obshagaRule, obshagaView, openDoorById, stepDirector, stepDoors, OBSHAGA,
  doorOpenness, type BlackoutPhase, type HandView, type ObshagaEvent, type ObshagaState, type Pt, type SpawnCandidate,
  floorLanterns, isProtected, type FloorItem, type Rect,
} from '../locations/obshaga';
import { poseDoor, type DoorMeshes, type DoorPose } from '../blockout/babylon';
import { DOOR_STYLE_BY_ID, restAngle } from '../blockout/doors';
import type { DoorSlot, RunExport } from '../blockout/types';
import type { FoldDriver } from './fold';
import type { PortalDef, PortalRenderer } from './portal';
import type { Posture } from './posture';
import type { CoopSession } from '../coop/session';
import type { CoopPresence } from '../coop/presence';
import {
  bedAt, chartOf, doorPoints, handGoal, nearestHub, navOf, pathLen, remoteCover, roomAt, spawnCandidates, type LampSpot, type NavPlayer, type ObshDoor, type ObshNav,
} from './obshagaNav';
import { advanceRemote, fromWire, toWire, type ObshRemote } from './obshagaSync';
import { ArmColliders, makeHand, LANTERN_COLOR, ObshagaGlow, ObshagaWater, VoidPlanes, WARM_TINT, armSamples, sceneMul, type HandRender } from './obshagaScene';
import { ObshagaAudio } from './obshagaAudio';
import { PointLight } from '@babylonjs/core/Lights/pointLight';

/** Скорость ходьбы игрока, м/с (поза «стоя», UniversalCamera.speed 0.22). */
export const PLAYER_SPEED = 1.7;
/** E у двери / лампы — ближе, м. */
const NEAR_DOOR = 1.3;
const NEAR_LAMP = 1.3;
/** На дверь «смотрят», если она ближе, м. */
const SEE_DOOR_M = 15;
/** Руку видно не дальше, м. */
const SEE_HAND_M = 28;
/** Горящие лампы освещают руку при яркости не ниже. */
const LIT_SEE = 0.35;
/** Шаг в воде — столько от обычного. */
const WATER_SLOW = 0.55;
/** Кооп: рассылка среза и отчёты клиентов, мс; отчёт старше — не в счёт. */
const SEND_MS = 100;
const REPORT_TTL = 1200;
/** Рука потеряла игрока: путь до цели дальше LOST_M и не сокращается (≥ 1 м) LOST_S с — или цели в её карте нет (лестница,
 *  шов) LOST_S / 2 с — уходит (не видят — сразу, видят — уползает), следующая — рядом с игроками через 2–4 с. */
const LOST_M = 15;
/** Руку видели — «видят» ещё столько, мс (без дрожи взгляда между кадрами). */
const SEE_HOLD_MS = 300;
const LOST_S = 4;
/** После «Ещё раз» рука не ищет возрождённого столько секунд. */
const GRACE_S = 6;
/** Глаза волочимого над полом, м. */
const DRAG_EYE = 0.42;
/** Кооп: напарник под кроватью, если его PlayerState.eye (глаз над полом, posture.eye) ниже, м — середина между «лёжа»
 *  (0.22, только под низким укрытием — кроватью) и «на четвереньках» (0.5, под столом — не укрытие); и он в рамке
 *  кровати (с запасом SHELTER_PAD). */
const SHELTER_EYE = 0.35;
const SHELTER_PAD = 0.1;
/** Скорость игрока (шум шага, агро руки) — по смещению за окно не короче, с; быстрее SPEED_MAX м/с — телепорт (0). */
const SPEED_WIN_S = 0.3;
const SPEED_MAX = 8;

/** Игрок общаги у режиссёра: навигация + видит ли руку, укрытие и агро (HandPlayer). */
type WalkPlayer = NavPlayer & { sees: boolean; sheltered: boolean; speed: number; loud?: number; light: boolean; marked: boolean };

export interface ObshagaHud {
  /** игрок в общаге */
  on: boolean;
  /** «E — …» */
  prompt: string | null;
  /** держит лампу */
  lamp: boolean;
  /** темно (отключение) */
  dark: boolean;
  /** тащит рука: прогресс 0…1 */
  drag: number | null;
  /** чёрный экран 0…1 */
  black: number;
  /** погиб: панель «Ещё раз» */
  dead: boolean;
  /** от чего погиб: утащила за дверь / достала пальцем под кроватью; жив — null */
  cause: 'drag' | 'poke' | null;
  /** здоровье 0…100 (целое), полное — null (полоска в HUD только раненому) */
  hp: number | null;
  /** сколько тычков получил (ключ красной вспышки) */
  hit: number;
  /** подсказка (правило биома) */
  hint: string | null;
  /** звук общаги включён */
  sound: boolean;
  /** smile: погиб не от руки — заголовок панели смерти (kill); подсказка — в hint */
  title?: string | null;
}

export interface ObshagaHost {
  rx(): RunExport | null;
  driver(): FoldDriver | null;
  /** можно ли сейчас управлять (нет спец-сцены поверх, от первого лица) */
  live(): boolean;
  /** операция мира 'lamp' → взял ли лампу этот игрок */
  takeLamp(inst: string, spot: string): Promise<boolean>;
  /** керосиновая лампа в руке — выбрана в хотбаре (src/view3d/inventory.ts: Inventory.lampHeld; модель и свет в руке —
   *  тоже там, в любом биоме) */
  lampHeld(): boolean;
  /** в хотбаре есть место (взять лампу со спота) */
  handsFree(): boolean;
  /** лампа взята со спота — в хотбар и в руку (Inventory.receive) */
  giveLamp(): void;
  /** QA (giveLantern): лампа в руку через хотбар (on) / убрать из хотбара */
  qaLamp?(on: boolean): void;
  /** лежащие предметы мира (WalkSession.drops: массив новый на каждое изменение) — лампы на полу дают поле */
  drops(): readonly FloorItem[];
  /** свет сцены поверх темноты биома (BiomeMood.light) */
  light(mul: number, tint: Color3 | null): void;
  flash(text: string, color: string, ms?: number): void;
  onHud(h: ObshagaHud): void;
  /** E занята другой подсказкой (выход квартиры, откапывать напарника) */
  busy(): boolean;
  /** шаблон модели предмета (PropModels.get) */
  propModel(id: string): Mesh | null;
  /** кооп: лобби (null — одиночная игра) */
  co: CoopSession | null;
  presence(): CoopPresence | null;
  /** горит фонарик в руке (Inventory.torchOn) — агро руки; нет метода — не горит */
  torch?(): boolean;
  /** эффекты предметов хотбара (Inventory.fx); нет — нет эффектов */
  fx?: () => ObshagaFx | undefined;
  /** свой игрок увидел существо ('hand' — руку): по фронту, не каждый кадр */
  sawCreature?(kind: 'hand'): void;
}

/** Эффекты предметов для общаги (host.fx): см. шапку файла. */
export interface ObshagaFx {
  /** неуязвим: тычки и хватка без последствий */
  invuln: boolean;
  /** помечен: рука выбирает его (агро +aggroMarkM) */
  marked: boolean;
  drunk: boolean;
  /** лежит без сил: шум шага 0 */
  down: boolean;
  /** шум предметов (единицы шума: 1 — бег) — к агро */
  noise: number;
}

// smile: крючки других систем общаги — «Улыбка» (src/view3d/smileWalk.ts) и номера/ключи комнат
// (src/view3d/obshagaRoomsView.ts), tmp/smile-wip/CONTRACT.md §9.1. Каждый — список: системы добавляют свои функции.
export interface ObshagaHooks {
  /** дверь заперта: строка — подсказка («Заперто. Нужен ключ»), null — нет. Тогда E не открывает (звук doorBlocked +
   *  вспышка подсказки), хост отклоняет чужой obshDoor, рука не открывает её на своём пути */
  locked: ((doorId: string) => string | null)[];
  /** E у двери: true — нажатие съедено (например, отпереть ключом); зовётся ДО проверки locked */
  doorKey: ((doorId: string) => boolean)[];
  /** своя подсказка у двери вместо «E — открыть дверь» (null — обычная) */
  prompt: ((doorId: string) => string | null)[];
  /** множители света сцены и свечения ламп (ловушка гасит свет у жертвы) — перемножаются */
  light: (() => number)[];
  /** дверь открывается/закрывается беззвучно (её тихо приоткрыла «Улыбка») */
  silent: ((doorId: string) => boolean)[];
}

/** Вид режиссёра для картинки: свой (одиночная игра, хост) или присланный хостом. */
interface DirView {
  level: number;
  phase: BlackoutPhase;
  hand: HandView | null;
  handDoor: string | null;
  door(id: string): number;
  doorIds(): Iterable<string>;
}

/** Диагностика встреч (QA, window.__rfObshaga.diag()): по отключению — появилась ли рука, откуда и как далеко, дошла ли
 *  до игрока, почему уползла или не появилась. */
export interface ObshagaDiag {
  /** номер отключения режиссёра */
  n: number;
  /** комната игрока в момент отключения */
  room: string | null;
  spawns: { t: number; door: string; dist: number; facing: number | null }[];
  /** ждали дверь появления (spawnIn вышел), а руки нет — секунды по причинам */
  noSpawn: Record<string, number>;
  /** кончик ближе 2 м к игроку: секунды от появления этой руки */
  contacts: number[];
  /** ближе всего по пути, м (по руке) */
  closest: number[];
  grabs: number;
  /** хватка: секунды от появления этой руки (время режиссёра) */
  grabAt: number[];
  killed: number;
  withdraws: { t: number; why: string }[];
  /** длилась, с (null — ещё темно) */
  dur: number | null;
}

const easeDoor = (u: number): number => (u < 0.5 ? 2 * u * u : 1 - (-2 * u + 2) ** 2 / 2);

export class ObshagaWalk {
  /** игрок в общаге */
  on = false;
  /** держит лампу: она выбрана в хотбаре (хотбар помнится в localStorage рядом с миром) */
  get holding(): boolean {
    return this.host.lampHeld();
  }
  /** лампы на полу (лежащие KEROLAMP_ITEM) — по массиву drops (новый на каждое изменение) */
  private floorOf: { drops: readonly FloorItem[]; nav: ObshNav; pts: Pt[] } | null = null;
  /** погиб (панель «Ещё раз») */
  dead = false;
  readonly audio = new ObshagaAudio();
  /** режиссёр (одиночная игра и хост коопа) */
  dir: ObshagaState | null = null;
  /** срез от хоста (клиент коопа) */
  private remote: ObshRemote | null = null;
  private remoteAt = 0;
  private remoteFrom = '';
  private obs: Observer<Scene> | null;
  private camObs: Observer<Camera> | null;
  private camPrev: Vector3 | null = null;
  private glow: ObshagaGlow;
  private mateLight: PointLight;
  private water: ObshagaWater;
  private voids: VoidPlanes;
  /** рука: строится при входе в общагу (или когда рука появилась) — текстура кожи ~0.15 с */
  private hand: HandRender | null = null;
  private handOf: (() => HandRender) | null = null;
  private cols: ArmColliders;
  /** показанная открытость дверей и угол покоя полотна */
  private shown = new Map<string, number>();
  private rest = new Map<string, number>();
  /** взгляд своего игрока: видит ли руку, на какие двери смотрит */
  private seesHand = false;
  private seenHandAt = -1e9;
  private seenDoors = new Set<string>();
  private seenAt = 0;
  /** отчёты клиентов (хост) */
  private reports = new Map<string, { at: number; sees: boolean; doors: Set<string> }>();
  private wireQ = 0;
  private wireEv: [string, string][] = [];
  private sentAt = 0;
  private cands: SpawnCandidate[] = [];
  private candsAt = 0;
  /** рука потеряна: сколько секунд, ближе всего за это время, м; отозвать (её видят — уползает от «поля» у кисти) */
  private lostT = 0;
  /** передышка после возрождения (до, мс) */
  private graceUntil = 0;
  /** QA: без естественных отключений */
  private qaCalm = false;
  private lostMin = Infinity;
  private recall = false;
  private lastTarget: { target: string | null; dist: number } | null = null;
  private lastGoal: Pt | null = null;
  private nearDoor: ObshDoor | null = null;
  private nearLamp: LampSpot | null = null;
  private taking = false;
  /** волочение: дверь руки и время */
  private drag: { door: string | null; t: number; fov: number } | null = null;
  private deadAt = 0;
  /** здоровье (тычки из-под кровати), с последнего тычка (с — время кадров, как у режиссёра: на медленном кадре
   *  заживление не обгоняет тычки), сколько раз, от чего погиб */
  private hp: number = OBSHAGA.hp;
  private sinceHit = Infinity;
  private hits = 0;
  private cause: 'drag' | 'poke' = 'drag';
  private hudKey = '';
  private hint: { text: string; until: number } | null = null;
  private hinted = { enter: false, dark: false, poke: false };
  private prevPhase: BlackoutPhase = 'lit';
  private prevLevel = 1;
  private shake = 0;
  private extrasOf: PortalRenderer | null = null;
  private staticBy = new Map<string, Mesh[]>();
  private planes: Plane[] = [];
  private bfs: { room: string; prev: Map<string, string> } | null = null;
  private cur: string | null = null;
  private tubesRoom = '';
  private tubes = 0;
  private lastSpeed = 0;
  private lastHand: HandView | null = null;
  /** диагностика встреч (по отключениям) */
  private diagLog: ObshagaDiag[] = [];
  private diagT = 0;
  private diagHandT = 0;
  private diagContact = false;
  /** почему рука уходит (для диагностики): recall — в её карте никого, lost — игрок ушёл; иначе — лампа */
  private withdrawWhy: string | null = null;
  /** скорость игроков по смещениям (агро руки): последняя выборка плана, время (мс) и скорость, м/с */
  private track = new Map<string, { x: number; y: number; t: number; v: number }>();
  /** хватка не держит (неуязвим, host.fx): рука схватила своего игрока, но не тащит — до released / killed / ухода руки */
  private slip = false;
  private onKey = (e: KeyboardEvent) => this.key(e);
  private onGesture = () => {
    if (this.on) this.audio.start();
  };
  private onFx = (from: string, k: string, d: unknown) => this.fx(from, k, d);

  constructor(
    private readonly scene: Scene,
    private readonly cam: UniversalCamera,
    private readonly host: ObshagaHost,
    private readonly seed: string,
    /** поза от первого лица (BlockoutViewer.posture) */
    readonly posture: Posture,
    /** рука (настоящая модель); по умолчанию — заглушка */
    hand?: HandRender,
  ) {
    this.glow = new ObshagaGlow(scene);
    const ml = (this.mateLight = new PointLight('obsh:mateLantern', Vector3.Zero(), scene));
    ml.diffuse = LANTERN_COLOR.clone();
    ml.specular = LANTERN_COLOR.scale(0.2);
    ml.range = 6.5;
    ml.intensity = 0.95;
    ml.setEnabled(false);
    this.water = new ObshagaWater(scene);
    this.voids = new VoidPlanes(scene);
    this.hand = hand ?? null;
    this.handOf = () => makeHand(scene);
    this.cols = new ArmColliders(scene);
    this.obs = scene.onBeforeRenderObservable.add(() => this.frame());
    this.camObs = cam.onAfterCheckInputsObservable.add(() => this.slowStep());
    window.addEventListener('keydown', this.onKey);
    window.addEventListener('keydown', this.onGesture);
    window.addEventListener('pointerdown', this.onGesture);
    host.co?.onFx.add(this.onFx);
  }

  private get co(): CoopSession | null {
    return this.host.co;
  }

  private get myId(): string {
    return this.co?.me.id ?? 'me';
  }

  /** Ведёт ли режиссёра этот игрок (одиночная игра или хост коопа). */
  private get authority(): boolean {
    const co = this.co;
    return !co || co.isHost || !co.host;
  }

  // ───────────────────────── кадр ─────────────────────────

  private frame() {
    const dt = Math.min(0.1, this.scene.getEngine().getDeltaTime() / 1000 || 1 / 60);
    this.camPrev = this.cam.position.clone();
    const rx = this.host.rx();
    const d = this.host.driver();
    if (!rx || !d) return;
    const nav = navOf(rx);
    const live = this.host.live();
    const portal = d.portal?.isActive ? d.portal : null;
    this.ensureExtras(portal);
    const room = live ? (portal?.current ?? d.current.center) : null;
    this.cur = room;
    // комната на миг не определилась (мир пересобирается) — не входить и не выходить
    if (!live || room) {
      const inObsh = !!room && !!nav.rooms.get(room)?.obsh;
      if (inObsh !== this.on) (inObsh ? this.enter() : this.leave());
    }
    // ── режиссёр: свой или от хоста
    if (this.authority) {
      if (!this.dir) this.adopt();
      if (this.qaCalm && this.dir!.blackout.phase === 'lit') this.dir!.blackout.dur = Math.max(this.dir!.blackout.dur, 1e9);
      this.stepAuthority(dt, nav, portal);
      this.shutFrame(dt); // smile: closeDoor — дверь ловушки закрывается
    } else if (this.remote) advanceRemote(this.remote, dt);
    const v = this.view();
    // ── картинка: двери (везде), рука, вода, свет (только в общаге)
    this.doorsFrame(dt, v, nav, portal);
    const ctx = this.ctx(nav, portal);
    const hd = v.handDoor ? nav.doorById.get(v.handDoor) : null;
    if (!this.hand && (this.on || v.hand)) this.hand = this.handOf!();
    this.hand?.update(v.hand, dt, { ...ctx, doorway: hd ? { x: hd.x, y: hd.y, room: hd.cor } : null });
    this.lastHand = v.hand;
    const coll = new Set(portal?.colliding ?? []);
    // рука во весь проход — коллайдеры (у текущей комнаты и соседа у порога); схваченного не держат
    if (this.hand?.colliders) this.hand.colliders(!!portal && !this.drag, (r) => coll.has(r));
    this.cols.update(this.hand?.colliders ? null : v.hand, !!portal && !this.drag, { ...ctx, colliding: (r) => coll.has(r) });
    this.statics(nav, portal);
    this.water.update();
    this.mates(portal);
    if (this.on) {
      this.host.light(sceneMul(v.level), WARM_TINT);
      this.glow.set(v.level);
      // smile: свет гасят крючки (ловушка «Улыбки» у жертвы)
      const lm = this.lightMul();
      if (lm < 1) (this.host.light(sceneMul(v.level) * lm, WARM_TINT), this.glow.set(v.level * lm));
      this.phaseFx(v);
    } else this.glow.set(1);
    // ── взгляд (свой игрок): рука и двери
    const alive = this.on && live && !this.dead;
    if (alive && portal && room) this.gaze(v, nav, portal, room);
    else {
      this.seesHand = false;
      this.seenDoors.clear();
    }
    // ── жертва: волочение, смерть, отпустила; здоровье (тычки из-под кровати) заживает
    this.victimFrame(dt, v, nav, portal);
    this.hpFrame(dt);
    // ── ход (звук шагов; лампа в руке — у хотбара, src/view3d/inventory.ts)
    const c = this.cam.position;
    const moved = this.camPrevFrame ? Math.hypot(c.x - this.camPrevFrame.x, c.z - this.camPrevFrame.z) : 0;
    this.camPrevFrame = c.clone();
    const speed = moved < 0.5 ? moved / dt : 0;
    this.lastSpeed += (speed - this.lastSpeed) * Math.min(1, dt * 6);
    // ── подсказки и HUD
    this.prompts(nav, live && this.on && !this.dead && !this.drag, room);
    this.emitHud(v);
    // ── звук
    const flooded = !!room && !!nav.rooms.get(room)?.flooded;
    this.tubesOf(room, portal);
    this.audio.update(dt, {
      inBiome: this.on,
      light: v.level,
      tubes: this.tubes,
      moving: this.lastSpeed > 0.3,
      speed: this.lastSpeed,
      inWater: flooded,
      lantern: this.holding && !this.dead,
      listener: { x: c.x, y: c.y, z: c.z, yaw: this.cam.rotation.y },
      dead: this.dead,
    });
    // ── кооп: рассылка / отчёт
    this.coopSend(nav);
  }

  private camPrevFrame: Vector3 | null = null;

  private ctx(nav: ObshNav, portal: PortalRenderer | null) {
    return {
      zOf: (room: string | undefined) => (room ? (nav.rooms.get(room)?.z ?? 0) : 0),
      roomOf: (p: Pt) => roomAt(nav, p, (id) => portal?.cache.peek(id)?.floor ?? null),
      /** кровати комнаты (рамки плана, NavRoom.beds): не-цели рука переползает поверху (рендер кладёт кисть на матрас) */
      beds: (room: string | undefined): readonly Rect[] => (room ? (nav.rooms.get(room)?.beds ?? []) : []),
    };
  }

  private enter() {
    this.on = true;
    if (!this.hinted.enter) {
      this.hinted.enter = true;
      this.hint = { text: 'Общага. Найди керосиновую лампу — у вахтёра, в комнатах, на кухнях (E — взять).', until: performance.now() + 7000 };
    }
  }

  private leave() {
    this.on = false;
    this.host.light(1, null);
    this.glow.set(1);
    this.nearDoor = this.nearLamp = null;
  }

  /** Вид режиссёра для картинки. */
  private view(): DirView {
    if (this.authority && this.dir) {
      const dir = this.dir;
      const v = obshagaView(dir);
      return { level: v.light, phase: v.phase, hand: v.hand && v.hand.visible ? v.hand : null, handDoor: v.handDoor, door: (id) => doorOpenness(dir, id), doorIds: () => Object.keys(dir.doors) };
    }
    const r = this.remote;
    if (!r) return { level: 1, phase: 'lit', hand: null, handDoor: null, door: () => 0, doorIds: () => [] };
    return { level: advanceRemote(r, 0), phase: r.blackout.phase, hand: r.hand, handDoor: r.handDoor, door: (id) => r.doors[id] ?? 0, doorIds: () => Object.keys(r.doors) };
  }

  // ───────────────────────── режиссёр (одиночная игра, хост) ─────────────────────────

  /** Стал хостом (или одиночная игра): режиссёр — новый; свет и двери — с последнего среза прежнего хоста. */
  private adopt() {
    const dir = (this.dir = createObshagaDirector(`${this.seed}/obshaga`));
    const r = this.remote;
    if (r && performance.now() - this.remoteAt < 5000) {
      Object.assign(dir.blackout, { phase: r.blackout.phase, n: r.blackout.n, t: r.blackout.t, dur: r.blackout.dur });
      for (const [id, open] of Object.entries(r.doors)) {
        openDoorById(dir, id);
        const st = dir.doors[id];
        st.open = open;
        st.phase = open >= 1 ? 'open' : 'closing';
      }
      if (dir.blackout.phase === 'dark') dir.spawnIn = 3;
    }
    this.remote = null;
  }

  /** Игроки в общаге (свой и — у хоста — остальные), живые и в мире; под кроватью — sheltered и рамка кровати (cover);
   *  агро: скорость по смещениям (speedOf — у всех одинаково), фонарик, метка, шум предметов (свой). */
  private players(nav: ObshNav): WalkPlayer[] {
    const out: WalkPlayer[] = [];
    const room = this.cur;
    const now = performance.now();
    if (this.on && !this.dead && room && this.host.live() && now >= this.graceUntil) {
      const c = this.cam.position;
      const yaw = this.cam.rotation.y;
      const p = { x: c.x, y: -c.z, room };
      const it = this.host.fx?.();
      const v = this.speedOf(this.myId, p, now);
      out.push({
        id: this.myId, p, protected: this.holding, sees: this.seesHand, fx: Math.sin(yaw), fy: -Math.cos(yaw), ...this.shelter(this.myId, p, nav),
        speed: it?.down ? 0 : v, ...(it && it.noise > 0 ? { loud: it.noise } : {}), light: !!this.host.torch?.(), marked: !!it?.marked,
      });
    }
    const co = this.co;
    if (co) {
      for (const pl of co.players.values()) {
        const s = pl.state;
        if (!s || s.loc || s.dead || !s.room || !s.fps || !nav.rooms.get(s.room)?.obsh) continue;
        const rep = this.reports.get(pl.id);
        const fresh = !!rep && now - rep.at < REPORT_TTL;
        const p = { x: s.p[0], y: -s.p[2], room: s.room };
        out.push({
          id: pl.id, p, protected: !!s.lamp, sees: fresh && rep!.sees, fx: Math.sin(s.yaw), fy: -Math.cos(s.yaw), ...this.shelter(pl.id, p, nav),
          // метка напарника — PlayerState.mk (поле предметов; нет поля — нет метки)
          speed: this.speedOf(pl.id, p, now), light: !!s.torch, marked: !!(s as { mk?: unknown }).mk,
        });
      }
    }
    for (const [id, t] of this.track) if (now - t.t > 5000) this.track.delete(id);
    return out;
  }

  /** Горизонтальная скорость игрока id, м/с: смещение в плане за окно не короче SPEED_WIN_S (свой и напарники — одинаково);
   *  быстрее SPEED_MAX (телепорт, шов) — 0; выборки не было 2 с — заново с нуля. */
  private speedOf(id: string, p: Pt, now: number): number {
    const s = this.track.get(id);
    if (!s || now - s.t > 2000) {
      this.track.set(id, { x: p.x, y: p.y, t: now, v: 0 });
      return 0;
    }
    const dt = (now - s.t) / 1000;
    if (dt < SPEED_WIN_S) return s.v;
    const v = Math.hypot(p.x - s.x, p.y - s.y) / dt;
    s.v = v > SPEED_MAX ? 0 : v;
    s.x = p.x;
    s.y = p.y;
    s.t = now;
    return s.v;
  }

  private stepAuthority(dt: number, nav: ObshNav, portal: PortalRenderer | null) {
    const dir = this.dir!;
    const all = this.players(nav);
    // в общаге никого — режиссёр стоит (свет, двери, рука — как были)
    if (!all.length) return;
    // лампы: в руках (свой игрок и напарники) и стоящие на полу (предметы мира — у всех копий одни)
    const lanterns: Pt[] = [...all.filter((p) => p.protected).map((p) => ({ ...p.p })), ...this.floorLamps(nav)];
    let players = all;
    let lamps = lanterns;
    let chart: Map<string, number> | null = null;
    const h = dir.hand;
    if (h) {
      const root = (dir.handDoor ? nav.doorById.get(dir.handDoor)?.cor : null) ?? h.mouth.room ?? null;
      chart = root ? chartOf(nav, root) : null;
      if (chart) {
        players = all.filter((p) => p.p.room && chart!.has(p.p.room));
        lamps = lanterns.filter((l) => !l.room || chart!.has(l.room));
      }
      // отозвана, а её видят — уползает: поле «лампы» у самой кисти
      if (this.recall) lamps = [...lamps, { x: h.tip.x, y: h.tip.y }];
    } else {
      this.lostT = 0;
      this.lostMin = Infinity;
      this.recall = false;
    }
    // двери появления — в темноте без руки (раз в 0.25 с)
    const now = performance.now();
    let cands: SpawnCandidate[] = [];
    if (dir.blackout.phase === 'dark' && !h) {
      if (now - this.candsAt > 250) {
        this.candsAt = now;
        this.cands = spawnCandidates(nav, all, this.seenAll(), lanterns);
      }
      cands = this.cands;
    }
    const floor = (id: string) => portal?.cache.peek(id)?.floor ?? null;
    const goalPlayers = players;
    const goalLamps = lamps;
    this.lastGoal = null;
    this.lastTarget = null;
    // путь от кончика до каждого (счёт цели руки; null — не дойти)
    const tip = h ? { ...h.tip } : null;
    const ev = stepDirector(dir, dt, {
      players: players.map((p) => ({
        id: p.id, p: p.p, protected: p.protected, sees: p.sees, sheltered: p.sheltered, ...(p.cover ? { cover: p.cover } : {}),
        speed: p.speed, ...(p.loud ? { loud: p.loud } : {}), light: p.light, marked: p.marked,
        ...(tip && chart ? { dist: pathLen(nav, tip, p.p, chart, floor) } : {}),
      })),
      lanterns: lamps,
      playerSpeed: PLAYER_SPEED,
      spawnCandidates: cands,
      goal: (hv) => {
        if (!chart) return null;
        // только к цели руки (нет цели — к ближайшему, как раньше)
        const r = handGoal(nav, hv.tip, goalPlayers, goalLamps, chart, floor, hv.target ?? null);
        this.lastGoal = r.goal;
        this.lastTarget = r;
        return r.goal;
      },
    });
    // рука потеряла игрока (ушёл далеко, за лестницу, за шов) — уходит и вылезет снова рядом
    const hh = dir.hand;
    if (hh && (hh.phase === 'stalking' || hh.phase === 'emerging') && !this.recall) {
      const t = this.lastTarget as { target: string | null; dist: number } | null;
      const unreachable = !t || t.target === null;
      if (unreachable) this.lostT += dt * 2;
      else if (t.dist > LOST_M) {
        if (t.dist < this.lostMin - 1) {
          this.lostT = 0;
          this.lostMin = t.dist;
        } else {
          this.lostT += dt;
          this.lostMin = Math.min(this.lostMin, t.dist);
        }
      } else {
        this.lostT = 0;
        this.lostMin = Infinity;
      }
      if (this.lostT > LOST_S) {
        this.withdrawWhy = unreachable ? 'потеряла: игрок вне её досягаемости (лестница, шов)' : `потеряла: игрок дальше ${LOST_M} м`;
        if (!players.some((p) => p.sees)) ev.push(...withdrawHand(dir));
        else this.recall = true;
        this.lostT = 0;
        this.lostMin = Infinity;
      }
    }
    // рука на пути сквозь закрытую дверь комнаты — открывает её (беззвучно)
    const g = this.lastGoal as Pt | null;
    if (dir.hand && g && dir.hand.phase === 'stalking') {
      for (const dd of nav.doorsByRoom.get(g.room ?? '') ?? []) {
        if (!dd.room || Math.hypot(dd.x - g.x, dd.y - g.y) > 0.05) continue;
        if (this.lockedMsg(dd.id)) continue; // smile: запертую рука не открывает
        if (Math.hypot(dir.hand.tip.x - dd.x, dir.hand.tip.y - dd.y) < 1.6 && doorOpenness(dir, dd.id) < 0.98 && dir.doors[dd.id]?.phase !== 'opening') openDoorById(dir, dd.id);
      }
    }
    for (const e of ev) this.event(e);
    this.diagStep(dt, ev, nav, all, goalPlayers, lanterns);
    // двери: смотрят — свои и присланные; заняты — игроки в зоне хода и рука в проёме
    const blocked = new Set<string>();
    for (const id of Object.keys(dir.doors)) {
      const dd = nav.doorById.get(id);
      if (!dd) continue;
      if (all.some((p) => inDoorZone(dd, p.p))) blocked.add(id);
      else if (dir.hand && handThrough(dd, dir.hand.trail, dir.hand.tip)) blocked.add(id);
    }
    stepDoors(dir, dt, this.seenAll(), blocked);
  }

  /**
   * Под кроватью ли игрок id в точке p и под какой (рамка — из навигации, bedAt): свой — по позе (лёг под кровать:
   * середина камеры в коллайдере кровати; рамки может не найтись — укрыт без неё, рука тычет, откуда достаёт),
   * напарник — глаз ниже SHELTER_EYE и в рамке кровати (лёжа рядом с кроватью — не укрыт).
   */
  private shelter(id: string, p: Pt, nav: ObshNav): { sheltered: boolean; cover?: Rect } {
    if (id === this.myId) {
      if (this.posture.under !== 'bed') return { sheltered: false };
      const cover = bedAt(nav, p, SHELTER_PAD);
      return cover ? { sheltered: true, cover } : { sheltered: true };
    }
    const cover = remoteCover(nav, p, this.co?.players.get(id)?.state?.eye, SHELTER_EYE, SHELTER_PAD);
    return cover ? { sheltered: true, cover } : { sheltered: false };
  }

  /** Диагностика встреч: отключения, появления, касания, уходы, причины «руки нет». */
  private diagStep(dt: number, ev: ObshagaEvent[], nav: ObshNav, all: (NavPlayer & { sees: boolean })[], inChart: (NavPlayer & { sees: boolean })[], lanterns: Pt[]) {
    const dir = this.dir!;
    let cur = this.diagLog[this.diagLog.length - 1] ?? null;
    if (cur && cur.dur === null) this.diagT += dt;
    for (const e of ev) {
      if (e.type === 'blackout') {
        this.diagLog.push((cur = { n: e.n, room: all[0]?.p.room ?? null, spawns: [], noSpawn: {}, contacts: [], closest: [], grabs: 0, grabAt: [], killed: 0, withdraws: [], dur: null }));
        if (this.diagLog.length > 40) this.diagLog.shift();
        this.diagT = 0;
      }
      if (!cur) continue;
      if (e.type === 'spawn') {
        const c = this.cands.find((x) => x.id === e.door);
        cur.spawns.push({ t: +this.diagT.toFixed(2), door: e.door, dist: c ? +c.dist.toFixed(2) : -1, facing: c && typeof (c as { facing?: number }).facing === 'number' ? +(c as { facing?: number }).facing!.toFixed(2) : null });
        cur.closest.push(Infinity);
        this.diagHandT = 0;
        this.diagContact = false;
        this.withdrawWhy = null;
      }
      if (e.type === 'grab') {
        cur.grabs++;
        cur.grabAt.push(+this.diagHandT.toFixed(2));
      }
      if (e.type === 'killed') cur.killed++;
      if (e.type === 'withdrawn') {
        cur.withdraws.push({ t: +this.diagT.toFixed(2), why: this.withdrawWhy ?? 'лампа' });
        this.withdrawWhy = null;
      }
      if (e.type === 'lightsBack') cur.dur = +this.diagT.toFixed(2);
    }
    if (!cur || cur.dur !== null || dir.blackout.phase !== 'dark') return;
    const h = dir.hand;
    if (h) {
      this.diagHandT += dt;
      let best = Infinity;
      for (const p of inChart) best = Math.min(best, Math.hypot(p.p.x - h.tip.x, p.p.y - h.tip.y));
      const k = cur.closest.length - 1;
      if (k >= 0) cur.closest[k] = Math.min(cur.closest[k], +best.toFixed(2));
      if (!this.diagContact && best < 2) {
        this.diagContact = true;
        cur.contacts.push(+this.diagHandT.toFixed(2));
      }
      return;
    }
    if (dir.spawnIn === null || dir.spawnIn > 0) return;
    // ждём дверь появления, а её нет — почему
    let why: string;
    if (!all.length) why = 'в общаге никого';
    else if (!this.cands.length) {
      const rr = all.map((p) => nav.rooms.get(p.p.room ?? ''));
      why = rr.every((r) => r?.stair) ? 'игрок на лестнице' : rr.every((r) => r?.flooded) ? 'подвал: дверей нет' : 'дверей рядом нет';
    } else {
      const ok = this.cands.filter((c) => !c.seen && c.id !== dir.lastDoor);
      if (!ok.length) why = this.cands.every((c) => c.seen) ? 'все двери видны' : 'только прошлая дверь';
      else if (ok.every((c) => c.inField || lanterns.some((l) => Math.hypot(l.x - c.mouth.x, l.y - c.mouth.y) < OBSHAGA.spawnLanternM))) why = 'поле лампы';
      else why = 'дальше/ближе предела';
    }
    cur.noSpawn[why] = +((cur.noSpawn[why] ?? 0) + dt).toFixed(2);
  }

  /** Двери, на которые смотрит хоть кто-то (свой взгляд и свежие отчёты клиентов). */
  private seenAll(): Set<string> {
    const s = new Set(this.seenDoors);
    const now = performance.now();
    for (const r of this.reports.values()) if (now - r.at < REPORT_TTL) for (const id of r.doors) s.add(id);
    return s;
  }

  /** События режиссёра (свои — сразу; хосту — ещё и в срез для клиентов). */
  private event(e: ObshagaEvent) {
    if (e.type === 'grab' || e.type === 'released' || e.type === 'killed' || e.type === 'poke') {
      if (this.co) this.wireEv.push([e.type, e.victim]);
      if (e.victim === this.myId) this.victimEvent(e.type);
    }
  }

  // ───────────────────────── кооп ─────────────────────────

  private fx(from: string, k: string, d: unknown) {
    const co = this.co;
    if (!co) return;
    if (k === 'obsh') {
      if (co.isHost) return;
      const r = fromWire(d as never);
      if (!r) return;
      if (this.remote && from === this.remoteFrom && r.q < this.remote.q) return;
      this.remote = r;
      this.remoteFrom = from;
      this.remoteAt = performance.now();
      this.dir = null;
      for (const [type, victim] of r.events) if (victim === this.myId) this.victimEvent(type);
      return;
    }
    if (!co.isHost) return;
    if (k === 'obshSee') {
      const o = d as { h?: unknown; d?: unknown } | null;
      const doors = new Set<string>(Array.isArray(o?.d) ? (o!.d as unknown[]).filter((x): x is string => typeof x === 'string').slice(0, 64) : []);
      this.reports.set(from, { at: performance.now(), sees: !!o?.h, doors });
      return;
    }
    if (k === 'obshDoor') {
      const id = (d as { id?: unknown } | null)?.id;
      if (typeof id === 'string' && this.lockedMsg(id)) return; // smile: запертую хост не открывает
      if (typeof id === 'string' && this.dir && id.length < 80) openDoorById(this.dir, id);
    }
  }

  private coopSend(nav: ObshNav) {
    const co = this.co;
    if (!co || co.status !== 'online') return;
    const now = performance.now();
    if (now - this.sentAt < SEND_MS) return;
    this.sentAt = now;
    if (co.isHost && this.dir) {
      // рассылать, пока в общаге хоть кто-то (или есть что показать)
      const anyone = this.on || [...co.players.values()].some((p) => !!p.state?.room && !!nav.rooms.get(p.state.room)?.obsh);
      if (!anyone && !this.wireEv.length) return;
      co.fx('obsh', toWire(this.dir, ++this.wireQ, this.wireEv));
      this.wireEv = [];
    } else if (!co.isHost && this.on && !this.dead) {
      co.fx('obshSee', { h: this.seesHand ? 1 : 0, d: [...this.seenDoors].slice(0, 48) });
    }
  }

  // ───────────────────────── двери ─────────────────────────

  /** Поза полотна двери общаги при постройке куска (FoldDriver.doorPose): по показанной открытости. */
  doorPose(slot: DoorSlot): DoorPose | null {
    const st = DOOR_STYLE_BY_ID.get(slot.style);
    if (!st?.selfClosing || !slot.leaf) return null;
    const id = `${slot.inst}/${slot.connector}`;
    return { angle: this.restOf(id, slot) * easeDoor(this.shown.get(id) ?? 0), handle: 0 };
  }

  private restOf(id: string, slot: DoorSlot): number {
    let a = this.rest.get(id);
    if (a === undefined) {
      const st = DOOR_STYLE_BY_ID.get(slot.style);
      a = slot.angle > 1 ? slot.angle : st ? restAngle(st, slot.seed, slot.widthM, slot.hinge === 'left' ? slot.space[0] : slot.space[1]) : 90;
      this.rest.set(id, a);
    }
    return a;
  }

  private leaves(id: string, nav: ObshNav, portal: PortalRenderer | null): DoorMeshes | null {
    const dd = nav.doorById.get(id);
    return dd && portal ? (portal.cache.peek(dd.inst)?.bo.doorLeaves.get(id) ?? null) : null;
  }

  private doorsFrame(dt: number, v: DirView, nav: ObshNav, portal: PortalRenderer | null) {
    const ids = new Set<string>([...this.shown.keys(), ...v.doorIds()]);
    const smooth = !this.authority;
    for (const id of ids) {
      const target = v.door(id);
      const cur = this.shown.get(id) ?? 0;
      let next = smooth ? cur + (target - cur) * (1 - Math.exp(-dt * 10)) : target;
      if (Math.abs(next - target) < 0.003) next = target;
      if (next <= 0.001) next = 0;
      if (next === cur && next === 0) {
        this.shown.delete(id);
        continue;
      }
      const dd = nav.doorById.get(id);
      // звук: распахнулась / закрылась (дверь руки и двери, сквозь которые она лезет, — без звука)
      if (dd && this.on) {
        const silent = id === v.handDoor || (!!v.hand && handThrough(dd, v.hand.trail, v.hand.tip, 1.2)) || this.hooks.silent.some((f) => f(id)); // smile: silent
        const p = { x: dd.x, y: dd.z + 1.1, z: -dd.y };
        const near = Math.hypot(this.cam.position.x - p.x, this.cam.position.z - p.z) < 18;
        if (!silent && near && cur === 0 && next > 0) this.audio.doorOpen(p);
        if (!silent && near && cur > 0 && next === 0) this.audio.doorClose(p);
      }
      if (next === 0) this.shown.delete(id);
      else this.shown.set(id, next);
      const lv = this.leaves(id, nav, portal);
      if (!lv) continue;
      const ang = this.restOf(id, lv.slot) * easeDoor(next);
      poseDoor(lv, ang, next > cur && next < 0.35 ? 1 : 0);
      if (next > cur) pushFromLeaf(this.cam, lv, ang);
    }
  }

  // ───────────────────────── меши в портальном рендере ─────────────────────────

  private extrasFn = (room: string): readonly Mesh[] | undefined => {
    const a = this.staticBy.get(room);
    const h = this.hand?.meshes(room);
    if (!h || !h.length) return a;
    if (!a) return h;
    return [...a, ...h];
  };

  private ensureExtras(portal: PortalRenderer | null) {
    if (portal === this.extrasOf) return;
    this.extrasOf?.extraProviders.delete(this.extrasFn);
    this.extrasOf = portal;
    portal?.extraProviders.add(this.extrasFn);
  }

  /** Вода затопленных комнат (нарисованных в прошлом кадре) и чёрные проёмы распахнутых запертых дверей. */
  private statics(nav: ObshNav, portal: PortalRenderer | null) {
    this.staticBy.clear();
    if (!portal) return;
    const put = (room: string, m: Mesh) => {
      const l = this.staticBy.get(room);
      if (l) l.push(m);
      else this.staticBy.set(room, [m]);
    };
    const rooms = new Set(portal.lastRooms);
    if (this.cur) rooms.add(this.cur);
    for (const id of rooms) {
      const r = nav.rooms.get(id);
      if (!r?.flooded) continue;
      const piece = portal.cache.peek(id);
      const rects = piece?.floor ?? [{ x0: r.x0, y0: r.y0, x1: r.x1, y1: r.y1 }];
      put(id, this.water.mesh(id, rects, r.z));
    }
    for (const [id, open] of this.shown) {
      const dd = nav.doorById.get(id);
      if (!dd || dd.room) continue;
      if (open > 0.02) put(dd.cor, this.voids.get(dd));
    }
  }

  /** Лампа напарника — свет у ближайшего видимого аватара с лампой (один источник: предел материалов). */
  private mates(portal: PortalRenderer | null) {
    const co = this.co, pr = this.host.presence();
    let best: { p: Vector3; d: number } | null = null;
    if (co && pr && portal) {
      const me = this.cam.position;
      for (const a of pr.shown) {
        const s = co.players.get(a.id)?.state;
        if (!s?.lamp || s.dead || !a.room || (!portal.lastRooms.has(a.room) && a.room !== this.cur)) continue;
        const p = new Vector3(a.pos[0], a.pos[1] - 0.6, a.pos[2]);
        const d = Vector3.Distance(p, me);
        if (d < 18 && (!best || d < best.d)) best = { p, d };
      }
    }
    this.mateLight.setEnabled(!!best);
    if (best) {
      const t = performance.now() / 1000;
      this.mateLight.position.copyFrom(best.p);
      this.mateLight.intensity = 0.95 * (0.93 + 0.05 * Math.sin(t * 10.7) + 0.02 * Math.sin(t * 25));
    }
  }

  /** Звук и вспышки по фазе света (моргание, отключение, свет вернулся) — только в общаге. */
  private phaseFx(v: DirView) {
    if (v.phase !== this.prevPhase) {
      if (v.phase === 'dark') {
        this.audio.blackout();
        if (!this.hinted.dark) {
          this.hinted.dark = true;
          this.hint = { text: obshagaRule(), until: performance.now() + 9000 };
        }
      }
      if (this.prevPhase === 'dark' && v.phase !== 'dark') this.audio.lightsBack();
      this.prevPhase = v.phase;
    }
    if ((v.phase === 'flicker' || v.phase === 'return') && Math.abs(v.level - this.prevLevel) > 0.25) this.audio.flickerTick(v.level);
    this.prevLevel = v.level;
  }

  private tubesOf(room: string | null, portal: PortalRenderer | null) {
    if (!room || room === this.tubesRoom) return;
    const piece = portal?.cache.peek(room);
    if (!piece) return;
    this.tubesRoom = room;
    let t = 0, n = 0;
    for (const p of piece.model.props) {
      if (p.propId === 'p_obsh_tube') (t++, n++);
      else if (p.propId === 'p_obsh_plafond') n++;
    }
    this.tubes = n ? t / n : 0;
  }

  // ───────────────────────── взгляд ─────────────────────────

  private gaze(v: DirView, nav: ObshNav, portal: PortalRenderer, room: string) {
    this.planes = Frustum.GetPlanes(this.cam.getTransformationMatrix());
    if (this.bfs?.room !== room) this.bfs = { room, prev: bfsTree(nav, room, 6) };
    const lit = v.level >= LIT_SEE;
    const lamps = this.lanternsAll(nav);
    // рука: кисть и точки по телу (через ~1 м)
    let sees = false;
    const hv = v.hand;
    if (hv && hv.visible) {
      const zOf = (r: string | undefined) => (r ? (nav.rooms.get(r)?.z ?? 0) : 0);
      const floor = (id: string) => portal.cache.peek(id)?.floor ?? null;
      const pts = armSamples(hv.trail, 1.0);
      for (let i = pts.length - 1, n = 0; i >= 0 && n < 36 && !sees; i--, n++) {
        const p = pts[i];
        if (!lit && !inLanternLight(p, lamps)) continue;
        const r = roomAt(nav, p, floor) ?? p.room;
        if (!r) continue;
        if (this.visible(new Vector3(p.x, zOf(r) + 1.0, -p.y), r, portal)) sees = true;
      }
    }
    // взгляд держится чуть дольше кадра, где точка руки попала в кадр (качание лампы, шаг): рука не дёргается
    const nowS = performance.now();
    if (sees) this.seenHandAt = nowS;
    const was = this.seesHand;
    this.seesHand = sees || nowS - this.seenHandAt < SEE_HOLD_MS;
    // увидел руку — один раз на фронте (эффекты предметов: «пьяный» и т. п.)
    if (this.seesHand && !was) this.host.sawCreature?.('hand');
    // двери — 10 раз в секунду
    const now = performance.now();
    if (now - this.seenAt < 100) return;
    this.seenAt = now;
    const seen = new Set<string>();
    const c = this.cam.position;
    for (const r of this.bfs.prev.keys()) {
      for (const sp of nav.spawnsByRoom.get(r) ?? []) {
        if (seen.has(sp.id) || Math.hypot(sp.mouth.x - c.x, sp.mouth.y + c.z) > SEE_DOOR_M) continue;
        for (const q of sp.look) {
          const z = nav.rooms.get(q.room)?.z ?? 0;
          if (this.visible(new Vector3(q.x, z + q.h, -q.y), q.room, portal)) {
            seen.add(sp.id);
            break;
          }
        }
      }
    }
    this.seenDoors = seen;
  }

  /** Лампы в руках (свой игрок и напарники) и на полу — план. */
  private lanternsAll(nav: ObshNav): Pt[] {
    const out: Pt[] = [];
    if (this.holding && !this.dead && this.cur) out.push({ x: this.cam.position.x, y: -this.cam.position.z, room: this.cur });
    for (const pl of this.co?.players.values() ?? []) {
      const s = pl.state;
      if (s?.lamp && !s.dead && !s.loc && s.room && nav.rooms.has(s.room)) out.push({ x: s.p[0], y: -s.p[2], room: s.room });
    }
    for (const l of this.floorLamps(nav)) out.push(l);
    return out;
  }

  /** Лампы на полу (лежащие KEROLAMP_ITEM в комнатах плана) — план; пересчёт, только когда сменился массив предметов. */
  private floorLamps(nav: ObshNav): Pt[] {
    const drops = this.host.drops();
    const f = this.floorOf;
    if (f && f.drops === drops && f.nav === nav) return f.pts;
    const pts = floorLanterns(drops, (r) => nav.rooms.has(r));
    this.floorOf = { drops, nav, pts };
    return pts;
  }

  /** Видна ли точка P (Babylon) в комнате room: в кадре, ближе SEE_HAND_M и на линии взгляда сквозь цепочку проёмов. */
  private visible(P: Vector3, room: string, portal: PortalRenderer): boolean {
    for (const pl of this.planes) if (pl.dotCoordinate(P) < 0) return false;
    const eye = this.cam.globalPosition;
    if (Vector3.Distance(eye, P) > SEE_HAND_M) return false;
    const cur = this.cur;
    if (!cur || room === cur) return true;
    const prev = this.bfs?.prev;
    if (!prev || !prev.has(room)) return false;
    const path: string[] = [];
    for (let x: string | undefined = room; x && x !== cur; x = prev.get(x)) path.push(x);
    path.reverse();
    let a = cur;
    for (const b of path) {
      const q = portal.cache.peek(a)?.portals.find((p) => p.to === b && !p.shiftB);
      if (!q) return portal.lastRooms.has(room);
      if (!crossesPortal(q, eye, P)) return false;
      a = b;
    }
    return true;
  }

  // ───────────────────────── жертва ─────────────────────────

  private victimEvent(type: string) {
    if (type === 'grab') this.startDrag();
    else if (type === 'killed') {
      // неуязвимого рука утащила пустой кулак — смерти нет
      if (this.slip) this.slip = false;
      else this.die();
    } else if (type === 'released') {
      this.slip = false;
      this.release();
    } else if (type === 'poke') this.poked();
  }

  /** Тычок пальцем под кровать: здоровье −pokeDmg, красная вспышка (HUD hit), тряска (крен позы), вскрик; кончилось — смерть. */
  private poked() {
    // неуязвим (предмет) — тычок без последствий
    if (this.dead || this.drag || this.host.fx?.()?.invuln) return;
    this.hp = Math.max(0, this.hp - OBSHAGA.pokeDmg);
    this.sinceHit = 0;
    this.hits++;
    this.shake = Math.max(this.shake, 0.8);
    const c = this.cam.position;
    this.audio.poked({ x: c.x, y: c.y, z: c.z });
    if (!this.hinted.poke) {
      this.hinted.poke = true;
      this.hint = { text: 'Под кроватью рука не схватит — но достанет пальцем. Долго не пролежишь: вылезай, глядя на неё.', until: performance.now() + 6000 };
    }
    if (this.hp <= 0) this.die('poke');
  }

  /** Здоровье: через hpRegenDelayS без тычков заживает по hpRegenPerS в секунду. */
  private hpFrame(dt: number) {
    this.sinceHit += dt;
    if (this.dead || this.hp >= OBSHAGA.hp) return;
    if (this.sinceHit > OBSHAGA.hpRegenDelayS) this.hp = Math.min(OBSHAGA.hp, this.hp + OBSHAGA.hpRegenPerS * dt);
  }

  private startDrag() {
    if (this.drag || this.dead || this.slip) return;
    if (this.host.fx?.()?.invuln) {
      // неуязвим: хватка не держит — рука тащит за дверь пустой кулак, игрока не волочёт (до released / killed)
      this.slip = true;
      this.host.flash('Не удержала!', '#e8b04b', 1400);
      return;
    }
    const v = this.view();
    this.drag = { door: v.handDoor, t: 0, fov: this.cam.fov };
    this.posture.frozen = true;
    this.cam.checkCollisions = false;
    this.shake = 1.4;
    const c = this.cam.position;
    this.audio.grab({ x: c.x, y: c.y, z: c.z });
  }

  private victimFrame(dt: number, v: DirView, nav: ObshNav, portal: PortalRenderer | null) {
    this.shake = Math.max(0, this.shake - dt * 1.2);
    const hv = v.hand;
    const me = !!hv && hv.victim === this.myId && hv.phase === 'grabbing';
    if (!me) this.slip = false;
    if (me && !this.drag && !this.dead) this.startDrag();
    if (this.drag && !this.dead) {
      if (!me) {
        // руки больше нет, а смерти не было: свет вернулся (или потеряли срез) — отпустила; почти дотащила — смерть
        const last = this.lastHandDrag;
        if (!this.authority && last >= 0.85) this.die();
        else this.release(nav, portal);
      } else this.dragFrame(dt, hv!, nav);
    }
    this.lastHandDrag = me ? hv!.dragProgress : -1;
    // тряска поверх
    if (this.shake > 0 && !this.dead) {
      this.posture.roll = (Math.random() - 0.5) * 0.05 * this.shake;
    } else if (this.posture.roll !== 0 && !this.drag) this.posture.roll = 0;
  }

  private lastHandDrag = -1;

  private dragFrame(dt: number, hv: HandView, nav: ObshNav) {
    const d = this.drag!;
    d.t += dt;
    const tip = hv.tip;
    const z = nav.rooms.get(tip.room ?? '')?.z ?? nav.rooms.get(this.cur ?? '')?.z ?? 0;
    // от двери — направление последнего отрезка руки; схваченный — в кулаке (у кисти), чуть дальше от двери
    const tr = hv.trail;
    const prev = tr.length >= 2 ? tr[tr.length - 2] : tip;
    let vx = tip.x - prev.x, vy = tip.y - prev.y;
    const vl = Math.hypot(vx, vy);
    if (vl > 1e-6) (vx /= vl), (vy /= vl);
    const g = this.hand?.grip?.() ?? null;
    const gx = (g ? g.x : tip.x) + vx * 0.35, gy = (g ? -g.z : tip.y) + vy * 0.35;
    const c = this.cam.position;
    const k = 1 - Math.exp(-dt * 22);
    c.x += (gx - c.x) * k;
    c.z += (-gy - c.z) * k;
    c.y += (z + DRAG_EYE - c.y) * k;
    this.cam.cameraDirection.setAll(0);
    // смотреть прочь от двери — коридор уходит назад
    if (Math.hypot(vx, vy) > 1e-3) {
      const yaw = Math.atan2(vx, -vy);
      let dy = yaw - this.cam.rotation.y;
      dy = Math.atan2(Math.sin(dy), Math.cos(dy));
      this.cam.rotation.y += dy * Math.min(1, dt * 6);
    }
    this.cam.rotation.x += (0.18 - this.cam.rotation.x) * Math.min(1, dt * 5);
    this.cam.fov = d.fov * (1 + 0.12 * Math.min(1, d.t * 3));
    this.shake = Math.max(this.shake, 0.6);
    this.audio.drag(hv.dragProgress);
  }

  /** Отпустила (свет вернулся, поле лампы напарника): управление назад; в стене (за запертой дверью) — к проёму. */
  private release(nav?: ObshNav, portal?: PortalRenderer | null) {
    const d = this.drag;
    if (!d) return;
    this.drag = null;
    this.posture.frozen = false;
    this.posture.roll = 0;
    this.cam.checkCollisions = true;
    this.cam.fov = d.fov;
    const rx = this.host.rx();
    nav ??= rx ? navOf(rx) : undefined;
    portal ??= this.host.driver()?.portal ?? null;
    const c = this.cam.position;
    const room = this.cur;
    // волокли у самого пола — встать (иначе эллипсоид коллизий под полом)
    const z = (room ? nav?.rooms.get(room)?.z : 0) ?? 0;
    c.y = z + this.posture.eye + 0.05;
    const dd = d.door && nav ? nav.doorById.get(d.door) : null;
    if (dd) {
      const floor = room ? (portal?.cache.peek(room)?.floor ?? null) : null;
      const onFloor = !!floor && floor.some((r) => c.x > r.x0 && c.x < r.x1 && -c.z > r.y0 && -c.z < r.y1);
      if (!onFloor) {
        const { mouth } = doorPoints(dd);
        c.set(mouth.x, dd.z + this.posture.eye + 0.05, -mouth.y);
      }
    }
    this.host.flash('Отпустила!', '#e8b04b', 1400);
  }

  private die(cause: 'drag' | 'poke' = 'drag') {
    if (this.dead) return;
    const d = this.drag;
    this.drag = null;
    this.dead = true;
    this.cause = cause;
    this.deadAt = performance.now();
    this.posture.frozen = true;
    this.cam.checkCollisions = true;
    if (d) this.cam.fov = d.fov;
    this.audio.death();
  }

  /** Еда и т. п. (предметы хотбара, View3DPage): +hp здоровья, не выше OBSHAGA.hp; погибшему — нет. */
  heal(hp: number) {
    if (this.dead || !(hp > 0) || !Number.isFinite(hp)) return;
    this.hp = Math.min(OBSHAGA.hp, this.hp + hp);
  }

  /** «Ещё раз»: возрождение — в коопе рядом с живым напарником, иначе в ближайшем вестибюле с вахтой (или на старте). */
  retry() {
    if (!this.dead) return;
    this.dead = false;
    this.killText = null; // smile
    this.smileHold = false; // smile
    this.posture.frozen = false;
    this.posture.roll = 0;
    this.cam.checkCollisions = true;
    this.audio.reset();
    this.hp = OBSHAGA.hp;
    this.sinceHit = Infinity;
    // передышка после «Ещё раз»: рука не ищет возрождённого GRACE_S с
    this.graceUntil = performance.now() + GRACE_S * 1000;
    // погиб лёжа под кроватью (на четвереньках) — возрождается стоя, сразу (телепорт ставит камеру по eye позы)
    this.posture.set('stand');
    this.posture.finish();
    this.respawn();
  }

  private respawn() {
    const d = this.host.driver();
    const rx = this.host.rx();
    if (!d || !rx) return;
    const nav = navOf(rx);
    const co = this.co;
    if (co) {
      for (const pl of co.players.values()) {
        const s = pl.state;
        if (!s || s.dead || s.loc || !s.room || !s.fps || !nav.rooms.has(s.room)) continue;
        d.goTo(s.room);
        // глаза напарника — над его полом на s.eye (ползком / лёжа — ниже); свои — на своей высоте (стоя)
        this.cam.position.set(s.p[0], s.p[1] - (s.eye ?? 1.6) + this.posture.eye + 0.05, s.p[2]);
        this.cam.rotation.set(0.05, s.yaw, 0);
        this.cam.cameraDirection.setAll(0);
        return;
      }
    }
    const hub = this.cur ? nearestHub(nav, this.cur) : null;
    if (hub) d.goTo(hub);
    else d.toStart();
  }

  // ───────────────────────── подсказки и E ─────────────────────────

  private prompts(nav: ObshNav, can: boolean, room: string | null) {
    this.nearDoor = null;
    this.nearLamp = null;
    if (!can || !room) return;
    const c = this.cam.position;
    const px = c.x, py = -c.z;
    const rooms = [room, ...(nav.rooms.get(room)?.edges.map((e) => e.to) ?? [])];
    const feet = c.y - this.posture.eye;
    // лампа на споте — взять в хотбар (и с лампой в руках: место в хотбаре проверит take)
    {
      let bd = NEAR_LAMP;
      for (const l of nav.lamps) {
        if (!rooms.includes(l.inst) || Math.abs(feet - l.z) > 1.2) continue;
        const d = Math.hypot(px - l.x, py - l.y);
        if (d < bd) (bd = d), (this.nearLamp = l);
      }
    }
    let bd = NEAR_DOOR;
    const seen = new Set<string>();
    for (const r of rooms) {
      for (const dd of nav.doorsByRoom.get(r) ?? []) {
        if (seen.has(dd.id)) continue;
        seen.add(dd.id);
        if (Math.abs(feet - dd.z) > 1.4) continue;
        const d = Math.hypot(px - dd.x, py - dd.y);
        if (d < bd) (bd = d), (this.nearDoor = dd);
      }
    }
  }

  private promptText(): string | null {
    if (!this.on || this.dead || this.drag) return null;
    if (this.nearLamp) return 'E — взять керосиновую лампу';
    const d = this.nearDoor;
    if (d && d.room && (this.shown.get(d.id) ?? 0) < 0.85) { const sp = this.smilePrompt(d.id); if (sp) return sp; } // smile
    if (d && (this.shown.get(d.id) ?? 0) < 0.85) return 'E — открыть дверь';
    return null;
  }

  private key(e: KeyboardEvent) {
    if (e.code !== 'KeyE' || e.repeat || !this.on || this.dead || this.drag || !this.host.live() || this.host.busy()) return;
    if (this.smileHold) return; // smile: hold — ввод заморожен
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT')) return;
    const lamp = this.nearLamp;
    if (lamp) {
      void this.take(lamp);
      return;
    }
    const d = this.nearDoor;
    if (!d) return;
    const p = { x: d.x, y: d.z + 1.1, z: -d.y };
    if (!d.room) {
      // запертая: за ней комната не выросла
      this.audio.doorBlocked(p);
      this.host.flash('Заперто', '#c9b98a', 900);
      return;
    }
    if (this.smileDoorKey(d.id, p)) return; // smile: ключ (doorKey), замки (locked)
    this.openDoor(d.id);
  }

  /** Распахнуть дверь (одиночная игра, хост — сразу; клиент — просьба хосту). */
  openDoor(id: string) {
    if (this.authority) {
      if (!this.dir) this.adopt();
      openDoorById(this.dir!, id);
    } else this.co?.fx('obshDoor', { id });
  }

  /** E у лампы на споте: в хотбаре нет места — «Руки заняты» (операция не уходит); взял — лампа в хотбар и в руку. */
  private async take(l: LampSpot) {
    if (this.taking) return;
    if (!this.host.handsFree()) {
      this.host.flash('Руки заняты', '#e0563f', 1200);
      return;
    }
    this.taking = true;
    let ok = false;
    try {
      ok = await this.host.takeLamp(l.inst, l.spot);
    } finally {
      this.taking = false;
    }
    if (ok) {
      this.host.giveLamp();
      this.audio.pickupLantern();
      this.host.flash('Лампа в руке', '#e8b050', 1300);
    } else this.host.flash('Лампу уже взяли', '#c9b98a', 1200);
  }

  // ───────────────────────── вода: шаг медленнее ─────────────────────────

  private slowStep() {
    const p = this.camPrev;
    if (!p || !this.on || this.drag || this.dead || !this.host.live()) return;
    const rx = this.host.rx();
    const room = this.cur;
    if (!rx || !room || !navOf(rx).rooms.get(room)?.flooded) return;
    const c = this.cam.position;
    const dx = c.x - p.x, dz = c.z - p.z;
    if (dx * dx + dz * dz > 0.25) return; // телепорт
    c.x = p.x + dx * WATER_SLOW;
    c.z = p.z + dz * WATER_SLOW;
  }

  // ───────────────────────── HUD ─────────────────────────

  private emitHud(v: DirView) {
    const now = performance.now();
    if (this.hint && now > this.hint.until) this.hint = null;
    const black = this.dead ? Math.min(1, (now - this.deadAt) / 350) : 0;
    const h: ObshagaHud = {
      on: this.on,
      prompt: this.promptText(),
      lamp: this.holding && !this.dead,
      dark: this.on && v.phase === 'dark',
      drag: this.drag ? Math.round((this.lastHand?.dragProgress ?? 0) * 20) / 20 : null,
      black: Math.round(black * 20) / 20,
      dead: this.dead && black >= 1,
      cause: this.dead ? this.cause : null,
      hp: this.hp < OBSHAGA.hp - 0.5 ? Math.round(this.hp) : null,
      hit: this.hits,
      hint: this.on ? (this.hint?.text ?? null) : null,
      sound: this.audio.enabled,
    };
    // smile: смерть со своим текстом (kill) — заголовок и подсказка панели
    if (this.dead && this.killText) (h.title = this.killText.title), (h.hint = this.killText.hint);
    const k = JSON.stringify(h);
    if (k === this.hudKey) return;
    this.hudKey = k;
    this.host.onHud(h);
  }

  /** Звук общаги вкл/выкл (кнопка HUD). */
  setSound(on: boolean) {
    this.audio.setEnabled(on);
    if (on) this.audio.start();
    this.hudKey = '';
  }

  // ───────────────────────── QA ─────────────────────────

  /** Хуки для браузерных проверок (window.__rfObshaga). */
  qa() {
    const self = this;
    const dirOrAdopt = () => {
      if (!self.authority) return null;
      if (!self.dir) self.adopt();
      return self.dir!;
    };
    return {
      /** заморгать; skipFlicker — сразу темно */
      forceBlackout(skipFlicker = false): boolean {
        const dir = dirOrAdopt();
        if (!dir) return false;
        forceObshagaBlackout(dir);
        if (skipFlicker) dir.blackout.t = dir.blackout.dur;
        return true;
      },
      /** QA: без естественных отключений (только forceBlackout) — пока горит, следующее моргание не наступает */
      calm(on = true) {
        self.qaCalm = on;
      },
      /** QA: двери появления последнего расчёта (id, путь, видна ли, где относительно взгляда) */
      cands() {
        return self.cands.map((c) => ({ id: c.id, dist: c.dist, seen: c.seen, inField: c.inField, facing: c.facing ?? null }));
      },
      /** QA: сколько секунд (времени режиссёра) живёт текущая рука */
      handAge(): number {
        return self.dir?.hand ? self.diagHandT : 0;
      },
      /** QA: снять передышку после «Ещё раз» */
      noGrace() {
        self.graceUntil = 0;
      },
      /** свет вернуть сейчас */
      lightsBack(): boolean {
        const dir = dirOrAdopt();
        if (!dir) return false;
        if (dir.blackout.phase === 'flicker') dir.blackout.t = dir.blackout.dur;
        if (dir.blackout.phase === 'dark' || dir.blackout.phase === 'flicker') {
          dir.blackout.phase = 'dark';
          dir.blackout.t = dir.blackout.dur;
        }
        return true;
      },
      /** лампа в руке — через хотбар: on — в руку (есть в хотбаре — выбрать, нет — положить), off — убрать из хотбара */
      giveLantern(on = true) {
        self.host.qaLamp?.(on);
      },
      /** лампы на полу (план) — поле, как его видит общага */
      floorLamps(): Pt[] {
        const rx = self.host.rx();
        return rx ? self.floorLamps(navOf(rx)) : [];
      },
      /** защищён ли свой игрок сейчас: лампа в руке или поле любой лампы (в руках, на полу) */
      protectedNow(): boolean {
        const rx = self.host.rx();
        if (!rx || !self.cur) return false;
        const c = self.cam.position;
        return self.holding || isProtected({ x: c.x, y: -c.z, room: self.cur }, self.lanternsAll(navOf(rx)));
      },
      openDoor(id: string) {
        self.openDoor(id);
      },
      /** рука сейчас: из невидимой двери ближе всех к игроку (или из door) */
      spawnHandNear(door?: string): string | null {
        const dir = dirOrAdopt();
        const rx = self.host.rx();
        if (!dir || !rx) return null;
        if (dir.blackout.phase !== 'dark') {
          forceObshagaBlackout(dir);
          dir.blackout.t = dir.blackout.dur;
          stepDirector(dir, 0.001, { players: [], lanterns: [], playerSpeed: PLAYER_SPEED, spawnCandidates: [], goal: null });
        }
        const nav = navOf(rx);
        const cands = spawnCandidates(nav, self.players(nav), self.seenAll(), []);
        const c = door ? cands.find((x) => x.id === door) : cands.filter((x) => !x.seen && x.dist > 3).sort((a, b) => a.dist - b.dist)[0];
        if (!c) return null;
        dir.hand = createHand(`${dir.seed}/qa${dir.hands}`, c.door, c.mouth);
        dir.handDoor = c.id;
        dir.spawnIn = null;
        dir.hands++;
        openDoorById(dir, c.id);
        return c.id;
      },
      retry() {
        self.retry();
      },
      state() {
        const v = self.view();
        const rx = self.host.rx();
        return {
          on: self.on, holding: self.holding, dead: self.dead, dragging: !!self.drag, authority: self.authority,
          phase: v.phase, level: v.level, handDoor: v.handDoor,
          hand: v.hand && { phase: v.hand.phase, tip: v.hand.tip, length: v.hand.length, frozen: v.hand.frozen, blocked: v.hand.blocked, victim: v.hand.victim, drag: v.hand.dragProgress, trail: v.hand.trail.length, target: v.hand.target ?? null },
          doors: Object.fromEntries(self.shown), seesHand: self.seesHand, seenDoors: [...self.seenDoors], nearDoor: self.nearDoor?.id ?? null,
          nearLamp: self.nearLamp ? `${self.nearLamp.inst}/${self.nearLamp.spot}` : null, prompt: self.promptText(), room: self.cur,
          handColliders: self.hand?.colliderCount?.() ?? 0, grace: Math.max(0, self.graceUntil - performance.now()),
          hp: self.hp, hits: self.hits, sheltered: self.posture.under === 'bed', poke: v.hand?.poke ?? null, pokeTip: self.hand?.pokeTip?.() ?? null,
          cover: rx && self.cur && self.posture.under === 'bed' ? bedAt(navOf(rx), { x: self.cam.position.x, y: -self.cam.position.z, room: self.cur }, SHELTER_PAD) : null,
          lamps: rx ? navOf(rx).lamps : [], spawnIn: self.dir?.spawnIn ?? null, sound: self.audio.counters,
        };
      },
      nav() {
        const rx = self.host.rx();
        return rx ? navOf(rx) : null;
      },
      director() {
        return self.dir;
      },
      /** диагностика встреч по отключениям (сначала — давние) */
      diag(): ObshagaDiag[] {
        return JSON.parse(JSON.stringify(self.diagLog, (_k, v) => (v === Infinity ? null : v)));
      },
      diagReset() {
        self.diagLog = [];
      },
    };
  }

  // ───────────────────────── smile: фасад для «Улыбки» и комнат общаги ─────────────────────────
  // tmp/smile-wip/CONTRACT.md §9.1: src/view3d/smileWalk.ts (моб), src/view3d/obshagaRoomsView.ts (номера, ключи).

  /** Крючки: замки, ключи, подсказки у дверей, множители света. */
  readonly hooks: ObshagaHooks = { locked: [], doorKey: [], prompt: [], light: [], silent: [] };
  /** смерть со своим текстом (kill): заголовок и подсказка панели */
  private killText: { title: string; hint: string } | null = null;
  /** hold(): поза и ввод заморожены (жертву ест «Улыбка», ловушка) */
  private smileHold = false;
  /** closeDoor (хост): двери, что закрываются сейчас, — время, длительность, открытость в начале */
  private shut = new Map<string, { t: number; dur: number; from: number }>();
  /** кадр, на котором посчитан фрустум для seen() */
  private planesFrame = -1;

  /** Навигация общаги мира (нет мира — null). */
  nav(): ObshNav | null {
    const rx = this.host.rx();
    return rx ? navOf(rx) : null;
  }

  /** Портальный рендер (активный) или null. */
  portal(): PortalRenderer | null {
    const p = this.host.driver()?.portal;
    return p?.isActive ? p : null;
  }

  /** id своего игрока (кооп — co.me.id, соло — 'me'). */
  me(): string {
    return this.myId;
  }

  /** Свой игрок в общаге. */
  inside(): boolean {
    return this.on;
  }

  /** Экземпляр, где стоит свой игрок (кадр назад), или null. */
  room(): string | null {
    return this.cur;
  }

  /** Этот клиент ведёт режиссёра (хост коопа или соло). */
  isAuthority(): boolean {
    return this.authority;
  }

  /** Текущий уровень света режиссёра 0…1 (свой или из среза хоста). */
  lightLevel(): number {
    return this.view().level;
  }

  /** Видна ли своему игроку точка P (Babylon) в комнате room: в кадре, ближе 28 м и сквозь цепочку проёмов. */
  seen(P: Vector3, room: string): boolean {
    const portal = this.portal();
    const cur = this.cur;
    const rx = this.host.rx();
    if (!portal || !cur || !rx) return false;
    const f = this.scene.getFrameId();
    if (f !== this.planesFrame) {
      this.planesFrame = f;
      this.planes = Frustum.GetPlanes(this.cam.getTransformationMatrix());
    }
    if (this.bfs?.room !== cur) this.bfs = { room: cur, prev: bfsTree(navOf(rx), cur, 6) };
    return this.visible(P, room, portal);
  }

  /** Смерть со своим текстом (панель View3DPage: ObshagaHud.title / hint); «Ещё раз» — как у руки. */
  kill(title: string, hint: string) {
    if (this.dead) return;
    this.killText = { title, hint };
    this.smileHold = false;
    if (this.drag) this.release();
    this.die();
  }

  /** Заморозить позу и ввод (жертва): шаг 0, E не работает; отпустить — если не погиб и не волокут. */
  hold(on: boolean) {
    if (on === this.smileHold) return;
    this.smileHold = on;
    if (on) {
      this.posture.frozen = true;
      this.cam.cameraDirection.setAll(0);
    } else if (!this.dead && !this.drag) this.posture.frozen = false;
  }

  /** Хост: дверь id закрывается сейчас за durS (срез 'obsh' разносит открытость); клиент — ничего. */
  closeDoor(id: string, durS: number) {
    if (!this.authority) return;
    if (!this.dir) this.adopt();
    const d = this.dir!.doors[id];
    if (!d || !(d.open > 0)) return;
    this.shut.set(id, { t: 0, dur: Math.max(0, durS), from: d.open });
  }

  /** Хост: отменить closeDoor (жертва выскочила) — дальше дверь живёт по правилам режиссёра. */
  stopClose(id: string) {
    this.shut.delete(id);
  }

  /** Заперта ли дверь крючками: подсказка или null. */
  lockedMsg(id: string): string | null {
    for (const f of this.hooks.locked) {
      const s = f(id);
      if (s) return s;
    }
    return null;
  }

  private lightMul(): number {
    let m = 1;
    for (const f of this.hooks.light) {
      const k = f();
      if (Number.isFinite(k)) m *= Math.min(1, Math.max(0, k));
    }
    return m;
  }

  private smilePrompt(id: string): string | null {
    for (const f of this.hooks.prompt) {
      const s = f(id);
      if (s) return s;
    }
    return null;
  }

  /** E у двери: ключ съел нажатие — true; заперта — звук и вспышка подсказки, true; иначе false. */
  private smileDoorKey(id: string, p: { x: number; y: number; z: number }): boolean {
    for (const f of this.hooks.doorKey) if (f(id)) return true;
    const lk = this.lockedMsg(id);
    if (!lk) return false;
    this.audio.doorBlocked(p);
    this.host.flash(lk, '#c9b98a', 1100);
    return true;
  }

  /** Ход closeDoor поверх режиссёра: открытость — по своим часам (взгляды и проём не держат), закрылась — запись долой. */
  private shutFrame(dt: number) {
    const dir = this.dir;
    if (!dir) return this.shut.clear();
    for (const [id, s] of this.shut) {
      const d = dir.doors[id];
      if (!d) {
        this.shut.delete(id);
        continue;
      }
      s.t += dt;
      const u = s.dur > 0 ? Math.min(1, s.t / s.dur) : 1;
      d.open = s.from * (1 - u);
      d.held = 0;
      if (u >= 1) {
        delete dir.doors[id];
        this.shut.delete(id);
      } else d.phase = 'paused';
    }
  }
  // ───────────────────────── /smile ─────────────────────────

  dispose() {
    if (this.on) this.leave();
    if (this.obs) this.scene.onBeforeRenderObservable.remove(this.obs);
    if (this.camObs) this.cam.onAfterCheckInputsObservable.remove(this.camObs);
    this.obs = this.camObs = null;
    if (this.drag) this.release();
    this.posture.frozen = false;
    this.extrasOf?.extraProviders.delete(this.extrasFn);
    this.extrasOf = null;
    window.removeEventListener('keydown', this.onKey);
    window.removeEventListener('keydown', this.onGesture);
    window.removeEventListener('pointerdown', this.onGesture);
    this.host.co?.onFx.delete(this.onFx);
    this.audio.dispose();
    this.glow.dispose();
    this.mateLight.dispose();
    this.water.dispose();
    this.voids.dispose();
    this.hand?.dispose();
    this.cols.dispose();
  }
}

// ───────────────────────── помощники ─────────────────────────

/** Дерево BFS по комнатам от root (все комнаты, без швов), до maxHops дверей: комната → откуда пришли. */
function bfsTree(nav: ObshNav, root: string, maxHops: number): Map<string, string> {
  const prev = new Map<string, string>([[root, '']]);
  const hops = new Map<string, number>([[root, 0]]);
  const q = [root];
  for (let k = 0; k < q.length; k++) {
    const id = q[k];
    const h = hops.get(id)!;
    if (h >= maxHops) continue;
    for (const e of nav.rooms.get(id)?.edges ?? []) {
      if (prev.has(e.to)) continue;
      prev.set(e.to, id);
      hops.set(e.to, h + 1);
      q.push(e.to);
    }
  }
  return prev;
}

/** Отрезок глаз → P проходит сквозь прямоугольник проёма q (P — за его плоскостью, в комнате q.to). */
function crossesPortal(q: PortalDef, eye: Vector3, P: Vector3): boolean {
  const s0 = (eye.x - q.p0.x) * q.u.x + (eye.y - q.p0.y) * q.u.y + (eye.z - q.p0.z) * q.u.z;
  const s1 = (P.x - q.p0.x) * q.u.x + (P.y - q.p0.y) * q.u.y + (P.z - q.p0.z) * q.u.z;
  // глаз уже в проёме (за плоскостью) — сквозь него и смотрим
  if (s0 >= -1e-3) return true;
  let X: Vector3;
  if (s1 <= 0) X = P;
  else X = eye.add(P.subtract(eye).scale(s0 / (s0 - s1)));
  const across = q.axis === 'x' ? -X.z : X.x;
  const E = 0.05;
  return across >= q.lo - E && across <= q.hi + E && X.y >= q.z - E && X.y <= q.z + q.h + E;
}

/** Точка в зоне хода полотна (или в проёме) двери d — дверь не закрывается. */
export function inDoorZone(d: ObshDoor, p: { x: number; y: number }): boolean {
  // сторона полотна: у связанной — комната (против нормали в коридор), у запертой — коридор
  const lx = d.room ? -d.nx : d.nx, ly = d.room ? -d.ny : d.ny;
  const dx = p.x - d.x, dy = p.y - d.y;
  const n = dx * lx + dy * ly;
  const t = Math.abs(dx * ly - dy * lx);
  if (n < -0.45) return false;
  return t < d.widthM / 2 + 0.35 && n < d.widthM + 0.4;
}

/** Рука проходит сквозь проём двери (точка следа или кисть ближе r к середине проёма). */
export function handThrough(d: ObshDoor, trail: readonly Pt[], tip: Pt, r = 0.7): boolean {
  if (Math.hypot(tip.x - d.x, tip.y - d.y) < r) return true;
  for (let i = 0; i < trail.length; i += 2) if (Math.hypot(trail[i].x - d.x, trail[i].y - d.y) < r) return true;
  return false;
}

/** Игрок в зоне распахивающегося полотна — мягко отходит (полотно не проходит сквозь камеру). */
function pushFromLeaf(cam: UniversalCamera, d: DoorMeshes, angleDeg: number) {
  const PLAYER_R = 0.36;
  const th = (angleDeg * Math.PI) / 180;
  for (const lf of d.leaves) {
    const P = lf.mesh.position;
    const s = lf.geo.sign;
    const e = new Vector3(s * Math.cos(lf.yaw), 0, -s * Math.sin(lf.yaw));
    const o = new Vector3(-Math.sin(lf.yaw), 0, -Math.cos(lf.yaw));
    const dx = cam.position.x - P.x, dz = cam.position.z - P.z;
    const t = dx * e.x + dz * e.z;
    const n = dx * o.x + dz * o.z;
    const W = lf.geo.width;
    const r = Math.hypot(t, n);
    if (r >= W + PLAYER_R || n < -0.05 || t < -PLAYER_R) continue;
    const delta = Math.asin(Math.min(1, PLAYER_R / Math.max(r, PLAYER_R)));
    const lead = th + delta + 0.2;
    if (Math.atan2(n, t) > lead) continue;
    const n1 = lead < Math.PI / 2 - 0.01 && t > 0 ? t * Math.tan(lead) : Infinity;
    const n2 = Math.sqrt(Math.max(0, (W + PLAYER_R) ** 2 - t * t));
    const need = Math.min(n1, n2);
    if (n >= need) continue;
    cam.cameraDirection.addInPlace(o.scale(Math.min(0.05, need - n)));
  }
}

