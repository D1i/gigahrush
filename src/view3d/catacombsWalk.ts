// «Прогулка» в катакомбах (биом «Катакомбы», docs/LOCATIONS.md §20): то, чего нет у
// обычных комнат. Часы прилива и дыхание — src/locations/catacombsFlood.ts, геометрия — ./catacombsNav.ts, вода —
// ./catacombsScene.ts, звук — ./catacombsAudio.ts.
//
//  • Катакомбы — комнаты с первым тегом «катакомбы» (или кластер биома 'catacombs' — host.biomeOf). Вне их слой спит:
//    ни тьмы, ни тумана, ни дыхания (вода в видимых комнатах катакомб рисуется и снаружи).
//  • Тьма: биом dark 1 гасит hemi / sun (src/view3d/biomeMood.ts), здесь — ещё и тёплый свет у игрока 'mood:lamp'; лёгкий
//    туман к цвету фона. Светит только фонарь игрока (F, стартовый набор хотбара).
//  • Наводнение: часы (FloodState) ведёт один — одиночка или хост коопа, — и только пока кто-то в катакомбах. Уровень —
//    floodLevel над полом сети (z = 0); в каждой нарисованной комнате катакомб — плоскость воды на RunInstance.z + уровень.
//  • Ход в воде медленнее: wadeMul(глубина у ног) — масштабом XZ-сдвига камеры после коллизий (onAfterCheckInputs, как
//    вода общаги; не posture.speedMul — его пишет бег).
//  • Дыхание: глаз ниже уровня — под водой (густая муть, глухой звук); stepLungs каждый кадр: воздух 12 с, потом тонет
//    (−10 HP/с). Захлебнулся — чёрный экран, «Захлебнулся», «Ещё раз» — reviveLungs (6 с неуязвимости) и на ближайшую
//    сухую площадку убежища (Room.stair.pads не ниже 2.1 м; нет — хаб катакомб или старт); в коопе — к живому напарнику
//    над водой. Утопление каждый считает сам.
//  • Перелаз: труба с тегом «перелаз» (p_cat_pipe_low / p_cat_pipe_mid) ближе 1 м, смотришь поперёк неё, стоя или
//    скрючившись — «E — перелезть»: дуга камеры над трубой (+0.35 м), коллизии на время выключены, за трубой — на 0.55 м
//    дальше грани (места нет — не лезть), потом стоя. Под средней трубой можно проползти (плита-укрытие 'table' ядра),
//    под высокой (p_cat_pipe_high) — пригнувшись: подсказка «C».
//  • Лазы (тег «лаз», 0.8 × 0.8): у входа стоя — «C — ползком»; в лазе — всегда на четвереньках (низкий потолок ядра
//    держит и сам; если нет — посадит этот слой), вылез — встать (если сажал слой). Под водой в лазе (глаз 0.5 м) —
//    захлебнуться быстрее всего: это и есть угроза.
//  • Бутылки (мусор с «бутыл» в имени): прошёл вплотную — звякнула (по разу, пока не отошёл).
//  • Кооп (docs/COOP.md): хост ~4 раза в секунду шлёт fx 'flood' — срез часов toWire; клиенты — fromWire + advanceRemote,
//    звуки входа в фазы — по floodOrd / phasesSince; хост сменился — новый продолжает с последнего среза. Погиб —
//    PlayerState.dead (страница складывает флаг с общагой и метро). Новых операций мира нет.
import type { Scene } from '@babylonjs/core/scene';
import type { UniversalCamera } from '@babylonjs/core/Cameras/universalCamera';
import type { Camera } from '@babylonjs/core/Cameras/camera';
import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import type { Light } from '@babylonjs/core/Lights/light';
import type { Observer } from '@babylonjs/core/Misc/observable';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import type { PropBox, RunExport, RunInstance } from '../blockout/types';
import { stairRiseOf } from '../blockout/stairs';
import {
  CATACOMBS, createFlood, createLungs, floodLevel, floodOrd, floodWarn, forceFlood, fromWire, advanceRemote, phasesSince, reviveLungs, stepFlood,
  stepLungs, toWire, untilRise, wadeMul, FLOOD_PHASES, type FloodPhase, type FloodState, type Lungs, type LungsEvent,
} from '../locations/catacombsFlood';
import type { FoldDriver } from './fold';
import type { PortalPiece, PortalRenderer } from './portal';
import { POSES, ROOM_CROUCH, ROOM_STAND, type Posture } from './posture';
import type { CoopSession } from '../coop/session';
import {
  CLIMB_NEAR, TAG_DUCT, TAG_HUB, climbDuration, climbEye, climbTarget, depthAt, freeFloor, freeSpot, isBottle, isCatacombs, isClimbPipe, isHighPipe, nearestDry, nearestRoom,
  obstacleOf, pipeApproach, pipeGeo, propKey, underNow, waterPlaneY, type DryPad, type Obstacle, type PipeGeo, type Rect,
} from './catacombsNav';
import { CAT_FOG, CatacombsWater, UNDER_FOG } from './catacombsScene';
import { CatacombsAudio } from './catacombsAudio';

/** Кооп: срез часов, мс; срез старше — при смене хоста не продолжать с него, мс. */
const SEND_MS = 250;
const REMOTE_KEEP_MS = 10000;
/** «C — ползком» у входа в лаз — ближе стольких метров к проёму. */
const DUCT_NEAR = 1.6;
/** «C — пригнуться» у высокой трубы — ближе, м. */
const HIGH_NEAR = 1.2;
/** Бутылка: звякнула — ближе (от края), м; снова — после того как отошёл дальше, м. */
const CLINK_R = 0.2;
const CLINK_REARM = 1.2;
/** После лаза встать — пробовать столько, с. */
const STAND_WAIT = 4;
/** Ноги на площадке убежища — не ниже refugeM на столько, м. */
const ON_PAD = 0.2;

/** Биом катакомб (id) — запасной признак комнаты (кластер), если у неё нет тега. */
export const CATACOMBS_BIOME = 'catacombs';

export interface CatacombsHud {
  /** игрок в катакомбах */
  on: boolean;
  /** «E — перелезть», «C — ползком» */
  prompt: string | null;
  /** воздух 0…1 (полоса — пока не полный), полный — null */
  air: number | null;
  /** здоровье 0…100 (целое), полное — null */
  hp: number | null;
  /** сколько раз било (ключ красной вспышки) */
  hit: number;
  /** голова под водой (муть по экрану) */
  under: boolean;
  /** уровень воды (чип) — пока идёт наводнение (предупреждение, подъём, пик, спад); иначе null */
  water: { m: number; dir: -1 | 0 | 1; phase: FloodPhase } | null;
  /** чёрный экран 0…1 */
  black: number;
  /** погиб: панель «Захлебнулся» */
  dead: boolean;
  /** подсказка внизу (правило биома) */
  hint: string | null;
  /** звук катакомб включён */
  sound: boolean;
}

export interface CatacombsHost {
  rx(): RunExport | null;
  driver(): FoldDriver | null;
  /** можно ли сейчас управлять (нет спец-сцены поверх, от первого лица) */
  live(): boolean;
  /** биом кластера комнаты (id) или null — запасной признак «в катакомбах» */
  biomeOf?(id: string): string | null;
  flash(text: string, color: string, ms?: number): void;
  onHud(h: CatacombsHud): void;
  /** E занята другой подсказкой (дверь, напарник, предмет под взглядом) */
  busy(): boolean;
  /** кооп: лобби (null — одиночная игра) */
  co: CoopSession | null;
  /** неуязвимость от предмета (лут — Inventory.fx.invuln): пока true, утопление не отнимает здоровье (воздух кончается) */
  invuln?: () => boolean;
}

interface Climb {
  t: number;
  dur: number;
  from: Vector3;
  to: Vector3;
  top: number;
  pitch0: number;
}

interface NearPipe {
  g: PipeGeo;
  /** куда встать за трубой (план); null — места нет */
  to: { x: number; y: number } | null;
  /** под ней можно проползти */
  under: boolean;
}

const smooth = (t: number) => {
  const x = Math.min(1, Math.max(0, t));
  return x * x * (3 - 2 * x);
};

/** Течение воды по фазе 0…1 (рябь, колыхание). */
function flowOf(phase: FloodPhase, warn: number): number {
  switch (phase) {
    case 'calm':
      return 0.05;
    case 'warn':
      return 0.1 + 0.15 * warn;
    case 'rise':
      return 1;
    case 'peak':
      return 0.8;
    case 'ebb':
      return 0.3 + 0.4 * warn;
  }
}

export class CatacombsWalk {
  /** игрок в катакомбах */
  on = false;
  /** захлебнулся (панель «Ещё раз») */
  dead = false;
  readonly audio = new CatacombsAudio();
  private water: CatacombsWater;
  /** часы прилива: свои (одиночка, хост) */
  private flood: FloodState | null = null;
  /** срез хоста (клиент коопа) */
  private remote: FloodState | null = null;
  private remoteAt = 0;
  /** порядковый номер последней фазы, о которой прозвучал звук (клиент) */
  private seen: number | null = null;
  private lungs: Lungs = createLungs();
  private under = false;
  /** множитель хода в воде этого кадра */
  private wade = 1;
  private depth = 0;
  private climb: Climb | null = null;
  private nearPipe: NearPipe | null = null;
  private prompt: string | null = null;
  /** в лаз посадил этот слой (вылез — встать) */
  private forced = false;
  private standLater = false;
  private standTry = 0;
  private hinted = { enter: false, warn: false, rise: false, ebb: false };
  private hint: { text: string; until: number } | null = null;
  private saved: { fog: number; fogStart: number; fogEnd: number; fogColor: Color3 } | null = null;
  private lampOff: Light | null = null;
  private obs: Observer<Scene> | null;
  private camObs: Observer<Camera> | null;
  private extrasOf: PortalRenderer | null = null;
  private staticBy = new Map<string, Mesh[]>();
  private idx: { rx: RunExport | null; by: Map<string, RunInstance>; cat: Map<string, boolean> } = { rx: null, by: new Map(), cat: new Map() };
  private cur: string | null = null;
  private lastRoom: string | null = null;
  private camPrev: Vector3 | null = null;
  private speedPrev: Vector3 | null = null;
  private speed = 0;
  private deadAt = 0;
  private hits = 0;
  private sentAt = 0;
  private hudKey = '';
  /** бутылки, которые уже звякнули (ключ → место, план) */
  private clinked = new Map<string, { x: number; y: number }>();
  /** QA: ускорение часов и дыхания */
  private qaScale = 1;
  private onKey = (e: KeyboardEvent) => this.key(e);
  private onGesture = () => {
    if (this.on) this.audio.start();
  };
  private onFx = (from: string, k: string, d: unknown) => this.fx(from, k, d);

  constructor(
    private readonly scene: Scene,
    private readonly cam: UniversalCamera,
    private readonly host: CatacombsHost,
    private readonly seed: string,
    /** поза от первого лица (BlockoutViewer.posture) */
    readonly posture: Posture,
  ) {
    this.water = new CatacombsWater(scene);
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

  /** Ведёт ли часы этот игрок (одиночная игра или хост коопа). */
  private get authority(): boolean {
    const co = this.co;
    return !co || co.isHost || !co.host;
  }

  /** Сид часов — мира (у всех игроков лобби один). */
  private floodSeed(): string {
    return `${this.host.rx()?.seed || this.seed}/catacombs`;
  }

  // ───────────────────────── экземпляры ─────────────────────────

  private index(rx: RunExport) {
    if (this.idx.rx !== rx) this.idx = { rx, by: new Map(rx.instances.map((i) => [i.id, i])), cat: new Map() };
    return this.idx;
  }

  private instOf(rx: RunExport, id: string | null): RunInstance | null {
    return id ? (this.index(rx).by.get(id) ?? null) : null;
  }

  /** Комната катакомб: первый тег или кластер биома (кэш по прогону). */
  private isCat(rx: RunExport, id: string | null): boolean {
    if (!id) return false;
    const ix = this.index(rx);
    let v = ix.cat.get(id);
    if (v === undefined) {
      const inst = ix.by.get(id);
      v = !!inst && (isCatacombs(inst.roomTags) || this.host.biomeOf?.(id) === CATACOMBS_BIOME);
      ix.cat.set(id, v);
    }
    return v;
  }

  /** Часы для картинки и звука: свои или присланные. */
  private clock(): FloodState | null {
    return this.authority ? this.flood : this.remote;
  }

  /** Уровень воды, м над полом сети (часов ещё нет — штиль). */
  private levelNow(): number {
    const s = this.clock();
    return s ? floodLevel(s) : CATACOMBS.calmM;
  }

  // ───────────────────────── кадр ─────────────────────────

  private frame() {
    const dtReal = Math.min(0.1, this.scene.getEngine().getDeltaTime() / 1000 || 1 / 60);
    const dt = dtReal * this.qaScale;
    const rx = this.host.rx();
    const d = this.host.driver();
    if (!rx || !d) return;
    const live = this.host.live();
    const portal = d.portal?.isActive ? d.portal : null;
    this.ensureExtras(portal);
    const room = live ? (portal?.current ?? d.current.center) : null;
    this.cur = room;
    if (room) this.lastRoom = room;
    const inst = this.instOf(rx, room);
    // комната на миг не определилась (мир пересобирается) — не входить и не выходить
    if (!live || room) {
      const inside = !!inst && this.isCat(rx, room);
      if (inside !== this.on) (inside ? this.enter() : this.leave());
    }
    // ── часы: свои (пока кто-то в катакомбах) или от хоста
    const anyone = this.anyone(rx);
    if (this.authority) {
      if (!this.flood && (anyone || this.on)) this.adopt();
      if (this.flood && anyone) for (const ph of stepFlood(this.flood, dt)) this.phaseCue(ph);
    } else if (this.remote) {
      if (anyone) advanceRemote(this.remote, dt);
      if (this.seen === null) this.seen = floodOrd(this.remote);
      for (const ph of phasesSince(this.seen, this.remote)) this.phaseCue(ph);
      this.seen = Math.max(this.seen, floodOrd(this.remote));
    }
    const fs = this.clock();
    const level = this.levelNow();
    const warn = fs ? floodWarn(fs) : 0;
    const phase: FloodPhase = fs?.phase ?? 'calm';
    // ── вода в нарисованных комнатах катакомб
    this.statics(rx, portal, level);
    this.water.update(dtReal, level, flowOf(phase, warn));
    // ── игрок
    const c = this.cam.position;
    const P = this.posture;
    const base = Number(inst?.z) || 0;
    const waterY = base + level;
    const feet = c.y - P.eye;
    const inside = this.on && live;
    this.depth = inside ? depthAt(waterY, feet) : 0;
    this.wade = inside && !this.climb ? wadeMul(this.depth) : 1;
    this.under = inside && !this.dead ? underNow(this.under, c.y, waterY) : false;
    if (!this.dead) for (const e of this.breathe(dt)) this.lungsEvent(e);
    if (this.on) {
      this.dark();
      this.fog(this.under);
    }
    const moved = this.speedPrev ? Math.hypot(c.x - this.speedPrev.x, c.z - this.speedPrev.z) : 0;
    this.speedPrev = c.clone();
    const sp = moved < 0.5 ? moved / dtReal : 0;
    this.speed += (sp - this.speed) * Math.min(1, dtReal * 6);
    this.prompt = null;
    this.nearPipe = null;
    if (inside && !this.dead) {
      if (this.climb) this.climbFrame(dtReal);
      else {
        this.duct(rx, inst, portal);
        this.prompts(rx, inst, portal, feet);
        this.bottles(rx, inst, portal, feet);
      }
    }
    this.standFrame(rx, dtReal, live);
    // ── подсказки (по разу): вход, предупреждение, подъём, спад
    if (inside && !this.dead) this.hints(phase, inst, feet);
    // ── звук
    this.audio.update({
      dt: dtReal,
      inside: this.on,
      warn,
      phase,
      level,
      depth: this.depth,
      under: this.under,
      moving: this.speed > 0.3,
      speed: this.speed,
      crawling: P.pose === 'crawl',
      breath: this.lungs.breath,
      hp: this.lungs.hp,
    });
    this.emitHud(phase, level);
    this.coopSend(anyone);
    this.camPrev = c.clone();
  }

  /** Кто-то в катакомбах: свой игрок или (кооп) напарник в мире в комнате катакомб. */
  private anyone(rx: RunExport): boolean {
    if (this.on) return true;
    const co = this.co;
    if (!co) return false;
    for (const pl of co.players.values()) {
      const s = pl.state;
      if (s && !s.loc && s.room && this.isCat(rx, s.room)) return true;
    }
    return false;
  }

  private enter() {
    this.on = true;
    const s = this.scene;
    this.saved = { fog: s.fogMode, fogStart: s.fogStart, fogEnd: s.fogEnd, fogColor: s.fogColor.clone() };
    this.fog(false);
    this.dark();
    if (!this.hinted.enter) {
      this.hinted.enter = true;
      this.hint = { text: 'Катакомбы. Темно — только фонарь (F)', until: performance.now() + 7000 };
    }
  }

  private leave() {
    this.on = false;
    this.under = false;
    this.nearPipe = null;
    this.prompt = null;
    if (this.climb) this.endClimb(false);
    // свет у игрока — обратно (другой тёмный биом: тот же или новый 'mood:lamp' настроения)
    const lamp = this.scene.getLightByName('mood:lamp') ?? this.lampOff;
    if (lamp && !lamp.isDisposed()) lamp.setEnabled(true);
    this.lampOff = null;
    const s = this.scene, sv = this.saved;
    if (sv) {
      s.fogMode = sv.fog;
      s.fogStart = sv.fogStart;
      s.fogEnd = sv.fogEnd;
      s.fogColor = sv.fogColor;
      this.saved = null;
    }
  }

  /** Тьма: тёплый свет у игрока ('mood:lamp' настроения биома) погашен — светит только фонарь. */
  private dark() {
    const lamp = this.scene.getLightByName('mood:lamp');
    if (lamp && lamp.isEnabled()) {
      lamp.setEnabled(false);
      this.lampOff = lamp;
    }
  }

  /** Туман: лёгкий к цвету фона или (под водой) густая муть; поменял кто-то другой (панель) — это его «как было». */
  private fog(under: boolean) {
    const s = this.scene, sv = this.saved;
    const is = (f: { start: number; end: number }) => s.fogMode === 3 && s.fogStart === f.start && s.fogEnd === f.end;
    if (!is(CAT_FOG) && !is(UNDER_FOG) && sv) {
      sv.fog = s.fogMode;
      sv.fogStart = s.fogStart;
      sv.fogEnd = s.fogEnd;
      sv.fogColor = s.fogColor.clone();
    }
    const want = under ? UNDER_FOG : CAT_FOG;
    if (is(want)) return;
    s.fogMode = 3; // LINEAR
    s.fogStart = want.start;
    s.fogEnd = want.end;
    const cc = s.clearColor;
    s.fogColor = under ? UNDER_FOG.color.clone() : new Color3(cc.r, cc.g, cc.b);
  }

  // ───────────────────────── часы ─────────────────────────

  /** Стал вести часы (одиночная игра, хост): с последнего среза прежнего хоста или с начала. */
  private adopt() {
    const r = this.remote;
    this.flood = r && performance.now() - this.remoteAt < REMOTE_KEEP_MS ? { ...r } : createFlood(this.floodSeed());
    this.remote = null;
    this.seen = floodOrd(this.flood);
  }

  /** Вход в фазу: звук (только в катакомбах). */
  private phaseCue(ph: FloodPhase) {
    if (this.on) this.audio.cue(ph);
  }

  /** Подсказки по разу: вход (в enter), предупреждение, первый подъём (не на площадке), спад. */
  private hints(phase: FloodPhase, inst: RunInstance | null, feet: number) {
    if ((phase === 'warn' || phase === 'rise') && !this.hinted.warn) {
      this.hinted.warn = true;
      this.host.flash('Гул в трубах… Вода идёт. Ищи, где выше — лестница на площадку', '#b9c8b0', 5200);
      return;
    }
    if (phase === 'rise' && !this.hinted.rise) {
      this.hinted.rise = true;
      const pad = feet - (Number(inst?.z) || 0) >= CATACOMBS.refugeM - ON_PAD;
      if (!pad) this.host.flash('Вода прибывает!', '#e0563f', 2200);
      return;
    }
    if (phase === 'ebb' && !this.hinted.ebb) {
      this.hinted.ebb = true;
      this.host.flash('Вода уходит', '#9fc3c8', 2000);
    }
  }

  // ───────────────────────── дыхание, смерть ─────────────────────────

  /** Шаг лёгких; неуязвимость от предмета (host.invuln) — урон утопления отменяется: здоровье, «давно не били» и
   *  смерть — как до шага, событий 'hurt' / 'dead' нет (воздух кончается как обычно). */
  private breathe(dt: number): LungsEvent[] {
    const L = this.lungs;
    if (!this.host.invuln?.()) return stepLungs(L, dt, this.under);
    const keep = { hp: L.hp, sinceHit: L.sinceHit };
    const ev = stepLungs(L, dt, this.under);
    if (L.hp < keep.hp || L.dead) {
      L.hp = keep.hp;
      L.sinceHit = keep.sinceHit;
      L.dead = false;
      L.cause = null;
    }
    return ev.filter((e) => e !== 'hurt' && e !== 'dead');
  }

  /** Лечение (лут): +hp здоровья, не выше полного; мёртвого не лечит. */
  heal(hp: number) {
    const L = this.lungs;
    if (this.dead || L.dead || !(hp > 0)) return;
    L.hp = Math.min(CATACOMBS.hp, L.hp + hp);
  }

  /** В воде: голова под водой или у ног по колено и глубже (≥ 0.45 м) — только в катакомбах. */
  get inWater(): boolean {
    return this.on && !this.dead && (this.under || this.depth >= 0.45);
  }

  private lungsEvent(e: LungsEvent) {
    if (e === 'dead') {
      this.die();
      return;
    }
    if (e === 'hurt') this.hits++;
    if (e === 'choke') this.host.flash('Нечем дышать — наверх!', '#e0563f', 1600);
    this.audio.cue(e);
  }

  private die() {
    if (this.dead) return;
    if (this.climb) this.endClimb(false);
    this.dead = true;
    this.deadAt = performance.now();
    this.posture.frozen = true;
    this.cam.checkCollisions = true;
    this.audio.cue('dead');
  }

  /** «Ещё раз»: воздух и здоровье — полные, неуязвимость; на ближайшую сухую площадку (кооп — к напарнику над водой). */
  retry() {
    if (!this.dead) return;
    this.dead = false;
    reviveLungs(this.lungs);
    this.under = false;
    this.posture.frozen = false;
    this.posture.roll = 0;
    this.cam.checkCollisions = true;
    this.forced = false;
    this.standLater = false;
    this.posture.set('stand');
    this.posture.finish();
    this.respawn();
    this.camPrev = this.speedPrev = null;
  }

  private respawn() {
    const d = this.host.driver();
    const rx = this.host.rx();
    if (!d || !rx) return;
    const level = this.levelNow();
    const co = this.co;
    if (co) {
      for (const pl of co.players.values()) {
        const s = pl.state;
        if (!s || s.dead || s.loc || !s.room || !s.fps) continue;
        const i = this.instOf(rx, s.room);
        if (!i) continue;
        // напарник сам под водой — не к нему
        if (this.isCat(rx, s.room) && s.p[1] < (Number(i.z) || 0) + level + 0.1) continue;
        d.goTo(s.room);
        this.cam.position.set(s.p[0], s.p[1] - (s.eye ?? 1.6) + this.posture.eye + 0.05, s.p[2]);
        this.cam.rotation.set(0.05, s.yaw, 0);
        this.cam.cameraDirection.setAll(0);
        return;
      }
    }
    const from = this.cur ?? this.lastRoom;
    const pad = from ? nearestDry(rx, from) : null;
    if (pad) {
      this.placeOnPad(pad);
      return;
    }
    const hub = from ? nearestRoom(rx.links, from, (id) => this.isCat(rx, id) && !!this.instOf(rx, id)?.roomTags.includes(TAG_HUB)) : null;
    if (hub) d.goTo(hub);
    else d.toStart();
  }

  /** На площадку: свободное место (колонны и стойки на ней — предметы куска, если он построен), иначе середина. */
  private placeOnPad(pad: DryPad) {
    const d = this.host.driver();
    const rx = this.host.rx();
    if (!d || !rx) return;
    const yaw = this.cam.rotation.y;
    d.goTo(pad.inst);
    const piece = d.portal?.cache.peek(pad.inst) ?? null;
    const obs: Obstacle[] = [];
    for (const p of piece?.model.props ?? []) {
      const o = obstacleOf(p, Number(this.instOf(rx, p.inst)?.z) || 0);
      if (o) obs.push(o);
    }
    const at = freeSpot(pad, obs) ?? { x: pad.x, y: pad.y };
    this.cam.position.set(at.x, pad.z + this.posture.eye + 0.05, -at.y);
    // лицом в зал (к середине пола комнаты), чуть вниз — видно воду внизу; куска нет — как смотрел
    let turn = yaw;
    if (piece?.floor.length) {
      let cx = 0, cy = 0, n = 0;
      for (const r of piece.floor) {
        const a = (r.x1 - r.x0) * (r.y1 - r.y0);
        cx += ((r.x0 + r.x1) / 2) * a;
        cy += ((r.y0 + r.y1) / 2) * a;
        n += a;
      }
      if (n > 0 && Math.hypot(cx / n - at.x, cy / n - at.y) > 0.5) turn = Math.atan2(cx / n - at.x, -(cy / n) + at.y);
    }
    this.cam.rotation.set(0.25, turn, 0);
    this.cam.cameraDirection.setAll(0);
  }

  // ───────────────────────── вода: шаг медленнее ─────────────────────────

  private slowStep() {
    const p = this.camPrev;
    if (!p || !this.on || this.dead || this.climb || !this.host.live()) return;
    const k = this.wade;
    if (k >= 0.999) return;
    const c = this.cam.position;
    const dx = c.x - p.x, dz = c.z - p.z;
    if (dx * dx + dz * dz > 0.25) return; // телепорт
    c.x = p.x + dx * k;
    c.z = p.z + dz * k;
  }

  // ───────────────────────── перелаз ─────────────────────────

  /** Куски комнаты и соседей по проёмам (построенные). */
  private piecesAround(portal: PortalRenderer | null, room: string | null) {
    const out: PortalPiece[] = [];
    if (!portal || !room) return out;
    const cur = portal.cache.peek(room);
    if (!cur) return out;
    out.push(cur);
    for (const q of cur.portals) {
      const n = portal.cache.peek(q.to);
      if (n && !out.includes(n)) out.push(n);
    }
    return out;
  }

  /** Предметы комнаты и соседей (каждый — один раз: у куска есть и предметы соседей у порога). */
  private propsAround(portal: PortalRenderer | null, room: string | null): PropBox[] {
    const seen = new Set<string>();
    const out: PropBox[] = [];
    for (const pc of this.piecesAround(portal, room)) {
      for (const p of pc.model.props) {
        const k = propKey(p);
        if (seen.has(k)) continue;
        seen.add(k);
        out.push(p);
      }
    }
    return out;
  }

  /** Подсказки E / C: труба-перелаз, высокая труба; место за трубой. */
  private prompts(rx: RunExport, inst: RunInstance | null, portal: PortalRenderer | null, feet: number) {
    if (!inst || !portal || !this.host.live()) return;
    const P = this.posture;
    const c = this.cam.position;
    const me = { x: c.x, y: -c.z };
    const yaw = this.cam.rotation.y;
    const f = { x: Math.sin(yaw), y: -Math.cos(yaw) };
    const props = this.propsAround(portal, this.cur);
    const zOf = (id: string) => Number(this.instOf(rx, id)?.z) || 0;
    let best: { g: PipeGeo; gap: number; a: NonNullable<ReturnType<typeof pipeApproach>>; under: boolean } | null = null;
    let high = false;
    for (const p of props) {
      const climbable = isClimbPipe(p);
      if (!climbable && !isHighPipe(p)) continue;
      const g = pipeGeo(p, zOf(p.inst));
      if (Math.abs(feet - g.base) > 0.45) continue;
      const a = pipeApproach(g, me, f, climbable ? CLIMB_NEAR : HIGH_NEAR);
      if (!a) continue;
      if (!climbable) {
        if (P.pose === 'stand') high = true;
        continue;
      }
      if (P.pose === 'crawl') continue;
      if (!best || a.gap < best.gap) best = { g, gap: a.gap, a, under: !!p.cover && (p.clear ?? 0) > 0.6 };
    }
    if (best) {
      const rects: Rect[] = [];
      for (const pc of this.piecesAround(portal, this.cur)) {
        if (Math.abs(zOf(pc.id) - best.g.base) < 0.3) rects.push(...pc.floor);
      }
      const obs: Obstacle[] = [];
      for (const p of props) {
        if (propKey(p) === best.g.key) continue;
        const o = obstacleOf(p, zOf(p.inst));
        if (o) obs.push(o);
      }
      for (const pc of this.piecesAround(portal, this.cur)) obs.push(...stairObstacles(this.instOf(rx, pc.id), rx.cellM));
      const to = climbTarget(best.g, best.a, rects, obs);
      this.nearPipe = { g: best.g, to, under: best.under };
      if (to) {
        this.prompt = best.under ? 'E — перелезть · C — проползти под трубой' : 'E — перелезть';
        return;
      }
    }
    if (high) this.prompt = 'C — пригнуться под трубу';
  }

  private key(e: KeyboardEvent) {
    if (e.code !== 'KeyE' || e.repeat || !this.on || this.dead || this.climb || !this.host.live() || this.host.busy()) return;
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT')) return;
    this.startClimb();
  }

  /** Перелезть через трубу под взглядом (есть место за ней). */
  private startClimb(): boolean {
    const n = this.nearPipe;
    if (!n || !n.to || this.climb || this.dead) return false;
    const c = this.cam.position;
    const from = c.clone();
    const g = n.g;
    // поза — стоя сразу (коллизии выключены, глаз ведёт дуга)
    this.posture.set('stand');
    this.posture.finish();
    c.copyFrom(from);
    this.posture.frozen = true;
    this.cam.checkCollisions = false;
    this.cam.cameraDirection.setAll(0);
    this.climb = {
      t: 0,
      dur: climbDuration(g.top - g.base),
      from,
      to: new Vector3(n.to.x, g.base + POSES.stand.eye + 0.02, -n.to.y),
      top: g.top,
      pitch0: this.cam.rotation.x,
    };
    this.forced = false;
    this.standLater = false;
    this.audio.cue('climb');
    return true;
  }

  private climbFrame(dt: number) {
    const cl = this.climb!;
    cl.t += dt;
    const k = Math.min(1, cl.t / cl.dur);
    const s = smooth(k);
    const c = this.cam.position;
    c.x = cl.from.x + (cl.to.x - cl.from.x) * s;
    c.z = cl.from.z + (cl.to.z - cl.from.z) * s;
    c.y = climbEye(k, cl.from.y, cl.to.y, cl.top);
    this.cam.cameraDirection.setAll(0);
    // взгляд кивает вниз, на трубу под руками
    this.cam.rotation.x = cl.pitch0 + 0.28 * Math.sin(Math.PI * k);
    if (k >= 1) this.endClimb(true);
  }

  /** Конец перелаза: на той стороне стоя (done) или прерван (смерть, ушёл из катакомб) — коллизии и управление назад. */
  private endClimb(done: boolean) {
    const cl = this.climb;
    if (!cl) return;
    this.climb = null;
    this.posture.frozen = this.dead;
    this.cam.checkCollisions = true;
    this.cam.rotation.x = cl.pitch0;
    if (done) {
      // C посреди перелаза — поза могла смениться: на той стороне — стоя
      if (this.posture.pose !== 'stand') {
        this.posture.set('stand');
        this.posture.finish();
      }
      this.cam.position.copyFrom(cl.to);
      this.cam.cameraDirection.setAll(0);
    }
    this.camPrev = this.speedPrev = null;
  }

  // ───────────────────────── лазы ─────────────────────────

  /** В лазе — на четвереньках (сажает слой, если поза не та); у входа стоя — «C — ползком». */
  private duct(rx: RunExport, inst: RunInstance | null, portal: PortalRenderer | null) {
    const P = this.posture;
    if (!inst) return;
    if (inst.roomTags.includes(TAG_DUCT)) {
      this.standLater = false;
      if (P.pose !== 'crawl') {
        P.set('crawl');
        this.forced = true;
      }
      // камеру поставили выше пола лаза (переход, «Ещё раз», загрузка — стоя, над сводом) — сразу на пол
      const base = Number(inst.z) || 0;
      const c = this.cam.position;
      if (c.y - P.eye > base + 0.3) {
        c.y = base + P.eye + 0.02;
        this.camPrev = this.speedPrev = null;
      }
      return;
    }
    if (this.forced && P.pose === 'crawl' && !this.standLater) {
      this.standLater = true;
      this.standTry = 0;
    }
    if (P.pose === 'crawl' || !portal || !this.cur) return;
    const piece = portal.cache.peek(this.cur);
    const c = this.cam.position;
    for (const q of piece?.portals ?? []) {
      if (!this.instOf(rx, q.to)?.roomTags.includes(TAG_DUCT)) continue;
      if (Math.hypot(q.center.x - c.x, q.center.z - c.z) < DUCT_NEAR) {
        this.prompt = 'C — ползком в лаз';
        return;
      }
    }
  }

  /** Вылез из лаза, куда сажал слой, — встать, когда над головой место (до STAND_WAIT с; мало — скрючившись). */
  private standFrame(rx: RunExport, dt: number, live: boolean) {
    const P = this.posture;
    if (!this.standLater) return;
    if (!live || this.dead) return;
    if (P.pose !== 'crawl') {
      this.standLater = false;
      this.forced = false;
      return;
    }
    if (this.instOf(rx, this.cur)?.roomTags.includes(TAG_DUCT)) return;
    this.standTry += dt;
    const room = P.headroom();
    if (room >= ROOM_STAND) {
      this.standLater = this.forced = false;
      P.set('stand');
    } else if (this.standTry > STAND_WAIT) {
      this.standLater = this.forced = false;
      if (room >= ROOM_CROUCH) P.set('crouch');
    }
  }

  // ───────────────────────── бутылки ─────────────────────────

  private bottles(rx: RunExport, inst: RunInstance | null, portal: PortalRenderer | null, feet: number) {
    if (!inst) return;
    const c = this.cam.position;
    const px = c.x, py = -c.z;
    for (const [k, at] of this.clinked) if (Math.hypot(at.x - px, at.y - py) > CLINK_REARM) this.clinked.delete(k);
    if (this.speed < 0.25) return;
    for (const p of this.propsAround(portal, this.cur)) {
      if (!isBottle(p)) continue;
      const base = p.z ?? (Number(this.instOf(rx, p.inst)?.z) || 0);
      if (Math.abs(feet - base) > 0.5) continue;
      const r = Math.max(p.w, p.d) / 2 + CLINK_R;
      if (Math.hypot(p.x - px, p.y - py) > r) continue;
      const k = propKey(p);
      if (this.clinked.has(k)) continue;
      this.clinked.set(k, { x: p.x, y: p.y });
      this.audio.cue('clink');
    }
  }

  // ───────────────────────── меши в портальном рендере ─────────────────────────

  private extrasFn = (room: string): readonly Mesh[] | undefined => this.staticBy.get(room);

  private ensureExtras(portal: PortalRenderer | null) {
    if (portal === this.extrasOf) return;
    this.extrasOf?.extraProviders.delete(this.extrasFn);
    this.extrasOf = portal;
    portal?.extraProviders.add(this.extrasFn);
  }

  /** Вода в комнатах катакомб, нарисованных в прошлом кадре (и текущей с соседями). */
  private statics(rx: RunExport, portal: PortalRenderer | null, level: number) {
    this.staticBy.clear();
    if (!portal) return;
    const rooms = new Set(portal.lastRooms);
    if (this.cur) {
      rooms.add(this.cur);
      for (const q of portal.cache.peek(this.cur)?.portals ?? []) rooms.add(q.to);
    }
    for (const id of rooms) {
      if (!this.isCat(rx, id)) continue;
      const inst = this.instOf(rx, id);
      const piece = portal.cache.peek(id);
      if (!inst || !piece || !piece.floor.length) continue;
      const base = Number(inst.z) || 0;
      const ceil = Number(inst.ceilM) > 0 ? Number(inst.ceilM) + stairRiseOf(inst) : null;
      this.staticBy.set(id, [this.water.mesh(id, piece.floor, waterPlaneY(base, level, ceil))]);
    }
  }

  // ───────────────────────── кооп ─────────────────────────

  private fx(from: string, k: string, d: unknown) {
    const co = this.co;
    if (!co || k !== 'flood' || co.isHost) return;
    if (co.host && from !== co.host) return;
    this.remote = fromWire(this.floodSeed(), d as never);
    this.remoteAt = performance.now();
    this.flood = null;
  }

  private coopSend(anyone: boolean) {
    const co = this.co;
    if (!co || co.status !== 'online' || !co.isHost || !this.flood || !anyone) return;
    const now = performance.now();
    if (now - this.sentAt < SEND_MS) return;
    this.sentAt = now;
    co.fx('flood', toWire(this.flood));
  }

  // ───────────────────────── HUD ─────────────────────────

  private emitHud(phase: FloodPhase, level: number) {
    const now = performance.now();
    if (this.hint && now > this.hint.until) this.hint = null;
    const black = this.dead ? Math.min(1, (now - this.deadAt) / 600) : 0;
    const L = this.lungs;
    const h: CatacombsHud = {
      on: this.on,
      prompt: this.on && !this.dead && !this.climb ? this.prompt : null,
      air: this.on && L.breath < 0.995 ? Math.round(L.breath * 20) / 20 : null,
      hp: L.hp < CATACOMBS.hp - 0.5 ? Math.round(L.hp) : null,
      hit: this.hits,
      under: this.on && this.under && !this.dead,
      water: this.on && phase !== 'calm' ? { m: Math.round(level * 10) / 10, dir: phase === 'rise' ? 1 : phase === 'ebb' ? -1 : 0, phase } : null,
      black: Math.round(black * 20) / 20,
      dead: this.dead && black >= 1,
      hint: this.on ? (this.hint?.text ?? null) : null,
      sound: this.audio.on,
    };
    const k = JSON.stringify(h);
    if (k === this.hudKey) return;
    this.hudKey = k;
    this.host.onHud(h);
  }

  /** Звук катакомб вкл/выкл (кнопка HUD). */
  setSound(on: boolean) {
    this.audio.setSound(on);
    if (on) this.audio.start();
    this.hudKey = '';
  }

  // ───────────────────────── QA ─────────────────────────

  /** Хуки для браузерных проверок (window.__rfCatacombs). */
  qa() {
    const self = this;
    const clockOrAdopt = () => {
      if (!self.authority) return null;
      if (!self.flood) self.adopt();
      return self.flood!;
    };
    const here = () => {
      const rx = self.host.rx();
      const d = self.host.driver();
      const portal = d?.portal?.isActive ? d.portal : null;
      return { rx, portal, inst: rx ? self.instOf(rx, self.cur) : null };
    };
    /** Трубы у игрока: геометрия (план) и подход. */
    const pipes = () => {
      const { rx, portal } = here();
      if (!rx || !portal) return [];
      return self.propsAround(portal, self.cur)
        .filter((p) => isClimbPipe(p) || isHighPipe(p))
        .map((p) => ({ room: p.inst, climb: isClimbPipe(p), clear: p.clear ?? 0, ...pipeGeo(p, Number(self.instOf(rx, p.inst)?.z) || 0) }));
    };
    return {
      state() {
        const s = self.clock();
        const c = self.cam.position;
        const { inst } = here();
        const lamp = self.scene.getLightByName('mood:lamp');
        const hemi = self.scene.getLightByName('hemi');
        const sc = self.scene;
        return {
          on: self.on, room: self.cur, tags: inst?.roomTags ?? null, authority: self.authority, dead: self.dead,
          phase: s?.phase ?? null, n: s?.n ?? null, t: s?.t ?? null, dur: s?.dur ?? null, level: self.levelNow(), warn: s ? floodWarn(s) : 0,
          untilRise: s ? untilRise(s) : null, eye: c.y, feet: c.y - self.posture.eye, base: Number(inst?.z) || 0, depth: self.depth, wade: self.wade,
          under: self.under, lungs: { ...self.lungs }, climbing: !!self.climb, pose: self.posture.pose, forced: self.forced,
          nearPipe: self.nearPipe ? { key: self.nearPipe.g.key, propId: self.nearPipe.g.propId, to: self.nearPipe.to } : null, prompt: self.prompt,
          fog: { mode: sc.fogMode, start: sc.fogStart, end: sc.fogEnd }, lamp: lamp ? lamp.isEnabled() : null, hemi: hemi?.intensity ?? null,
          waterMeshes: self.water.count, flow: self.water.flowNow, sound: self.audio.on, counters: { ...self.audio.counters }, hinted: { ...self.hinted },
        };
      },
      /** сразу в начало фазы (по умолчанию — предупреждение); клиент коопа — null */
      force(phase: FloodPhase = 'warn'): FloodPhase[] | null {
        const s = clockOrAdopt();
        if (!s || !FLOOD_PHASES.includes(phase)) return null;
        const ev = forceFlood(s, phase);
        for (const ph of ev) self.phaseCue(ph);
        return ev;
      },
      /** прокрутить часы на sec секунд (события фаз — как в игре) */
      skip(sec: number): FloodPhase[] | null {
        const s = clockOrAdopt();
        if (!s) return null;
        const ev = stepFlood(s, sec);
        for (const ph of ev) self.phaseCue(ph);
        return ev;
      },
      level(): number {
        return self.levelNow();
      },
      lungs(): Lungs {
        return { ...self.lungs };
      },
      setLungs(p: Partial<Lungs>) {
        Object.assign(self.lungs, p);
      },
      /** ускорение часов и дыхания (1 — как в игре, 0 — стоят) */
      speed(k = 1) {
        const v = Number(k);
        self.qaScale = Number.isFinite(v) ? Math.max(0, v) : 1;
      },
      /** нажать E у трубы: начался ли перелаз */
      climb(): boolean {
        return self.startClimb();
      },
      pipes,
      /**
       * Поставить игрока перед трубой (ближайшей или key) на gap м от грани, лицом к ней, стоя — с той стороны, откуда
       * за трубой есть место. Сторона (+1 / −1) или null.
       */
      facePipe(key?: string, gap = 0.5): { key: string; side: number } | null {
        const { rx, portal } = here();
        if (!rx || !portal) return null;
        const c = self.cam.position;
        const list = pipes().filter((g) => g.climb && (!key || g.key === key));
        list.sort((a, b) => Math.hypot(a.cx - c.x, a.cy + c.z) - Math.hypot(b.cx - c.x, b.cy + c.z));
        const g = list[0];
        if (!g) return null;
        const rects: Rect[] = [];
        for (const pc of self.piecesAround(portal, g.room)) rects.push(...pc.floor);
        for (const side of [1, -1] as const) {
          const a = { side, gap, along: 0, dot: 1 };
          if (!climbTarget(g, a, rects, [])) continue;
          const k = side * (g.half + gap);
          const x = g.cx + g.nx * k, y = g.cy + g.ny * k;
          self.posture.set('stand');
          self.posture.finish();
          c.set(x, g.base + self.posture.eye + 0.05, -y);
          self.cam.rotation.set(0.05, Math.atan2(-side * g.nx, side * g.ny), 0);
          self.cam.cameraDirection.setAll(0);
          self.camPrev = self.speedPrev = null;
          return { key: g.key, side };
        }
        return null;
      },
      /** лечение (как лут): +hp, не выше полного */
      heal(hp: number) {
        self.heal(hp);
      },
      /** в воде: голова под водой или по колено и глубже */
      inWater(): boolean {
        return self.inWater;
      },
      /** ближайшая сухая площадка от комнаты игрока */
      nearestDry(): DryPad | null {
        const { rx } = here();
        const from = self.cur ?? self.lastRoom;
        return rx && from ? nearestDry(rx, from) : null;
      },
      /** на пол своей комнаты (свободное место ближе к игроку, не на лестнице и не в предмете), стоя */
      toFloor(): { x: number; y: number } | null {
        const { rx, portal, inst } = here();
        const piece = portal && self.cur ? portal.cache.peek(self.cur) : null;
        if (!rx || !inst || !piece) return null;
        const base = Number(inst.z) || 0;
        const obs: Obstacle[] = [...stairObstacles(inst, rx.cellM)];
        for (const p of piece.model.props) {
          const o = obstacleOf(p, Number(self.instOf(rx, p.inst)?.z) || 0);
          if (o) obs.push(o);
        }
        const c = self.cam.position;
        const at = freeFloor(piece.floor, obs, base, { x: c.x, y: -c.z });
        if (!at) return null;
        self.posture.set('stand');
        self.posture.finish();
        c.set(at.x, base + self.posture.eye + 0.05, -at.y);
        self.cam.cameraDirection.setAll(0);
        self.camPrev = self.speedPrev = null;
        return at;
      },
      /** на сухую площадку (QA: переждать воду) */
      toDry(): DryPad | null {
        const { rx } = here();
        const from = self.cur ?? self.lastRoom;
        const pad = rx && from ? nearestDry(rx, from) : null;
        if (pad) {
          self.posture.set('stand');
          self.posture.finish();
          self.placeOnPad(pad);
          self.camPrev = self.speedPrev = null;
        }
        return pad;
      },
      /** лазы — проёмы текущей комнаты в комнаты «лаз» (Babylon: середина проёма) */
      ducts() {
        const { rx, portal } = here();
        if (!rx || !portal || !self.cur) return [];
        return (portal.cache.peek(self.cur)?.portals ?? [])
          .filter((q) => self.instOf(rx, q.to)?.roomTags.includes(TAG_DUCT))
          .map((q) => ({ to: q.to, x: q.center.x, y: q.center.y, z: q.center.z, ux: q.u.x, uz: q.u.z }));
      },
      retry() {
        self.retry();
      },
      /** утонуть сейчас (QA панели «Ещё раз») */
      kill() {
        if (self.dead) return;
        self.lungs.hp = 0;
        self.lungs.dead = true;
        self.lungs.cause = 'drown';
        self.die();
      },
    };
  }

  dispose() {
    if (this.on) this.leave();
    if (this.obs) this.scene.onBeforeRenderObservable.remove(this.obs);
    if (this.camObs) this.cam.onAfterCheckInputsObservable.remove(this.camObs);
    this.obs = this.camObs = null;
    if (this.climb) this.endClimb(false);
    if (this.dead) {
      this.posture.frozen = false;
      this.cam.checkCollisions = true;
    }
    this.extrasOf?.extraProviders.delete(this.extrasFn);
    this.extrasOf = null;
    window.removeEventListener('keydown', this.onKey);
    window.removeEventListener('keydown', this.onGesture);
    window.removeEventListener('pointerdown', this.onGesture);
    this.host.co?.onFx.delete(this.onFx);
    this.audio.dispose();
    this.water.dispose();
  }
}

/** Лестница экземпляра как помехи места за трубой: площадки (сплошные до пола) и марши (пандус). */
function stairObstacles(inst: RunInstance | null, cellM: number): Obstacle[] {
  const st = inst?.stair;
  if (!st) return [];
  const base = Number(inst!.z) || 0;
  const box = (q: { x0: number; y0: number; x1: number; y1: number }, top: number): Obstacle => ({
    cx: ((q.x0 + q.x1) / 2) * cellM,
    cy: ((q.y0 + q.y1) / 2) * cellM,
    ux: 1,
    uy: 0,
    vx: 0,
    vy: 1,
    hw: ((q.x1 - q.x0) / 2) * cellM,
    hd: ((q.y1 - q.y0) / 2) * cellM,
    z0: base,
    z1: base + top,
  });
  return [...(st.pads ?? []).map((p) => box(p, p.z)), ...(st.flights ?? []).map((f) => box(f, Math.max(f.z0, f.z1)))];
}
