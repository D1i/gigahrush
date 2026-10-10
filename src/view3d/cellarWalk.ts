// «Прогулка» в земляном погребе (биом «Погреб», комнаты с первой меткой 'погреб'): узко, осыпается земля, пыль, нет
// света. То, чего нет у обычных комнат (правило и числа — src/locations/cellarSqueeze.ts, docs/LOCATIONS.md):
//
//  • Тело — эллипс по взгляду (Posture.body: плечи 0.46, грудь 0.26 м): ход 0.6 м — идёшь как обычно; в щель 0.4 м
//    грудью вперёд не пролезть (коллизии), а лицом к стене A/D — пролезаешь боком. Тело ставится и у двери в погреб
//    из соседней комнаты (круглое 0.6 в проём 0.6 не проходит), снимается — к круглому плавно (подъём «вширь» позы).
//  • Поворот в тесноте (cam.onAfterCheckInputsObservable — после ввода и коллизий, до кадра): лучи от середины тела
//    вдоль ±X / ±Z на двух высотах (середина эллипсоида и плечи) в коллайдеры рядом (probeFree); поворот, при котором
//    тело не влезает, — до последнего влезающего (clampYaw; инерция поворота сброшена — без дрожи), середина тела
//    сдвигается к середине хода на сколько он стал «в» стене (fitAt). В щели — ~±50° от «лицом к стене».
//  • Боком (Posture.side — ширина поперёк хода < 0.5 м): скорость ×0.36, бега нет, фонарь ниже (свет остаётся), руки
//    плашмя на стене перед лицом перехватывают её по приставному шагу (./cellarHands.ts), голова чуть ходит вбок и
//    вниз и кренится на шаг (только на время кадра — как бег, ./sprint.ts), плечо скребёт по стене — из-под него
//    сыплется земля, шорох; дыхание тяжелее. Давишь W в щель грудью вперёд — «Не пролезть — повернись боком».
//  • Темнота: туман бурый, вдаль 0.6…4.5 м (пыль); свет у игрока ('mood:lamp' биома) почти погашен (0.06, 1.5 м,
//    у глаз) — без фонаря почти черно. Пыль в луче фонаря — мелкие пылинки только внутри конуса 0.3…3 м впереди,
//    пока фонарь горит.
//  • Осыпи (косметика): каждые 6…20 с (в щели — чаще) со свода или со стены впереди сыплется струйка земли, иногда
//    падает комок; шипение и дробь со стороны осыпи, лёгкая дрожь.
//  • Обвалы (src/locations/snowCollapse.ts, числа CELLAR_COLLAPSE): метры по узким ходам → место (host.pickSite) →
//    треск крепей, скрип, сыплется земля 2 с → обвал: проём завален навсегда (host.collapse → WorldOp 'collapse'),
//    густая пыль (туман 0.3…1.5 м, оседает ~8 с), куча земли у завала (оболочка погреба кладёт её сама —
//    src/view3d/cellarMesh.ts; без оболочки — p_cel_heap или своя из примитивов), игрок ближе 1.1 м —
//    засыпан: почти чёрный экран, глухо, E — откапываться (digSelf), напарник — mateDig (кооп: действие 'dig').
//    Завал можно разгрести: у кучи E (host.dig → WorldOp 'dig'; в коопе нажатия всех складываются), куча меньше.
//  • Звук — ./cellarAudio.ts (localStorage 'room-forge/cellar-sound' = '0' — выключить); заводится жестом.
// Мир — только операциями (кооп): host.collapse / host.dig. HUD — свой DOM (./cellarHud.ts) в элементе сцены.
import type { Scene } from '@babylonjs/core/scene';
import type { UniversalCamera } from '@babylonjs/core/Cameras/universalCamera';
import type { Camera } from '@babylonjs/core/Cameras/camera';
import type { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh';
import type { Observer } from '@babylonjs/core/Misc/observable';
import type { Particle } from '@babylonjs/core/Particles/particle';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { PointLight } from '@babylonjs/core/Lights/pointLight';
import { Ray } from '@babylonjs/core/Culling/ray';
import { Color3, Color4 } from '@babylonjs/core/Maths/math.color';
import { Matrix, Vector3 } from '@babylonjs/core/Maths/math.vector';
import { ParticleSystem } from '@babylonjs/core/Particles/particleSystem';
import '@babylonjs/core/Particles/particleSystemComponent';
import type { RunInstance } from '../blockout/types';
import { makeRng, type Rng } from '../model/rng';
import { collapseSite, createCollapse, digCollapse, postponeCollapse, startCollapse, stepCollapse, type CollapseEvent, type CollapseSite, type CollapseState } from '../locations/snowCollapse';
import {
  BODY, CELLAR_COLLAPSE, HINT_SLIT, HINT_TURN, NARROW_M, cellarCollapseRoom, clampYaw, clearance, crossWidth, crumbDelay, dustFog,
  dustLevel, facingAxis, fitAt, isCellarTags, isSlitTags, newShuffle, slitAhead, squeezing, stepOk, stepShuffle, widthOf, wrapAngle,
  type Free, type Span,
} from '../locations/cellarSqueeze';
import { puffTexture } from '../locations/liftTextures';
import { CellarAudio, CELLAR_SOUND_KEY } from './cellarAudio';
import { WallHands, type WallProbe } from './cellarHands';
import { cellarField, cellarRay, cellarShellSpec, type CellarField } from './cellarMesh';
import { CellarHudView, HUD_OFF, hudKey, type CellarHud } from './cellarHud';
import type { Posture } from './posture';
import type { FoldDriver } from './fold';
import type { WalkSession } from './walk';

const CELL = 0.1;
/** туман погреба: бурая темнота, пыль висит — вдаль почти ничего */
export const CELLAR_FOG = { start: 0.6, end: 4.5, color: new Color3(0.016, 0.012, 0.008) };
/** свет у игрока в погребе: почти погашен (без фонаря почти черно) */
export const CELLAR_LAMP = { intensity: 0.06, range: 1.5, color: new Color3(1, 0.72, 0.45) };
/** отсвет фонаря на стену вплотную (боком в щели): яркость и дальность точечного света у груди */
export const NEAR_FILL = { intensity: 0.55, range: 0.9 };
/** лучи «свободно вокруг» — не дальше, м */
const PROBE_M = 1.2;
/** смещения начала лучей поперёк (доля полуразмера тела) */
const OFFS = [-0.92, -0.5, 0, 0.5, 0.92];
/** тело и у двери в погреб из соседней комнаты — ближе стольких м к проёму */
const DOOR_NEAR = 1.2;
/** раскопка завала: ближе стольких м к проёму с завалом */
const PLUG_NEAR = 1.2;
/** подсказка держится, с */
const HINT_S = 3;
/** давит W и стоит — дольше стольких с: «не пролезть» */
const PUSH_S = 0.2;
/** поворот упирался дольше стольких с (за последние ~0.6 с): «тесно» */
const TURN_S = 0.3;

const FWD_KEYS = new Set(['KeyW', 'ArrowUp']);
const typing = (e: Event) => {
  const t = e.target as HTMLElement | null;
  return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
};
const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/** Комната погреба (первая метка 'погреб'). */
export const isCellarRoom = (inst: { roomTags: string[] }): boolean => isCellarTags(inst.roomTags);

/** Что нужно от просмотрщика (BlockoutViewer). */
export interface CellarViewer {
  scene: Scene;
  fps: UniversalCamera;
  posture: Posture;
  /** элемент сцены — HUD погреба поверх холста (нет — без HUD: тесты, превью) */
  host?: HTMLElement | null;
}

export interface CellarWalkHost {
  /** комната под ногами (экземпляр экспорта) */
  room(): { id: string; inst: RunInstance } | null;
  /** экземпляр по id (сосед за дверью — погреб ли) */
  inst?(id: string): RunInstance | null;
  /** место обвала у игрока (план, метры) или null — нельзя (запрёт игрока) */
  pickSite(roomId: string, x: number, y: number): CollapseSite | null;
  /** обвал: мир заваливает проём навсегда (WorldOp 'collapse') */
  collapse(site: CollapseSite): void;
  /** доля раскопки завала у метки (0…1; null — завала нет) */
  digProgress(inst: string, conn: string): number | null;
  /** разгрести завал: работа amount (доля; WorldOp 'dig' — в коопе нажатия всех складываются) */
  dig(inst: string, conn: string, amount: number): void;
  /** модель предмета (куча земли p_cel_heap); нет — своя */
  propModel?(id: string): Mesh | null;
  /** фонарь горит в руке (пыль в луче) */
  torch(): boolean;
  /** множитель метров к обвалу (зажигалка в руке — обвалы чаще: 2); нет — 1 */
  collapseMul?(): number;
  /** у игрока своя подсказка E (подобрать, дверь, откопать напарника) — свою не показывать */
  busy?(): boolean;
  /** можно ли сейчас управлять (нет спец-сцены поверх, режим от первого лица) */
  live(): boolean;
  onHud?(h: CellarHud): void;
}

/** Хозяин для «Прогулки» (View3DPage): комната — по порталу / центру набора, мир — операциями сессии. */
export function walkCellarHost(
  v: { props?: { get(id: string): Mesh | null } | null; hasOverlay: boolean; mode: string },
  get: { session(): WalkSession | null; driver(): FoldDriver | null; torch(): boolean; busy?(): boolean; collapseMul?(): number },
): CellarWalkHost {
  let idx: { rx: unknown; by: Map<string, RunInstance> } = { rx: null, by: new Map() };
  const inst = (id: string): RunInstance | null => {
    const s = get.session();
    if (!s) return null;
    if (idx.rx !== s.rx) idx = { rx: s.rx, by: new Map(s.rx.instances.map((i) => [i.id, i])) };
    return idx.by.get(id) ?? null;
  };
  return {
    room: () => {
      const dd = get.driver();
      const id = dd ? (dd.portal?.current ?? dd.current.center) : null;
      const i = id ? inst(id) : null;
      return id && i ? { id, inst: i } : null;
    },
    inst,
    pickSite: (id, x, y) => {
      const s = get.session();
      return s ? collapseSite(s.rx, id, x, y, cellarCollapseRoom) : null;
    },
    collapse: (site) => void get.session()?.request({ k: 'collapse', inst: site.inst, conn: site.connector }),
    digProgress: (i, c) => get.session()?.world.collapseProgress(i, c) ?? null,
    dig: (i, c, amount) => void get.session()?.request({ k: 'dig', inst: i, conn: c, amount }),
    propModel: (id) => v.props?.get(id) ?? null,
    torch: get.torch,
    collapseMul: get.collapseMul,
    busy: get.busy,
    live: () => !v.hasOverlay && v.mode === 'fps',
  };
}

const RAY = new Ray(Vector3.Zero(), new Vector3(1, 0, 0), 1);
const PO = new Vector3(), PD = new Vector3();

/** Коллайдеры рядом с (x, z) в пределах range по горизонтали и [y0, y1] по высоте. */
function collidersNear(scene: Scene, x: number, z: number, range: number, y0: number, y1: number): AbstractMesh[] {
  const out: AbstractMesh[] = [];
  for (const m of scene.meshes) {
    if (!m.checkCollisions || !m.isEnabled()) continue;
    const b = m.getBoundingInfo().boundingBox, mn = b.minimumWorld, mx = b.maximumWorld;
    if (mx.y < y0 || mn.y > y1) continue;
    if (mx.x < x - range || mn.x > x + range || mx.z < z - range || mn.z > z + range) continue;
    out.push(m);
  }
  return out;
}

/** Луч входит в коробку [mn, mx] (мир) раньше far: расстояние входа (0 — начало внутри) или Infinity — мимо. */
function boxEntry(mn: Vector3, mx: Vector3, ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, far: number): number {
  const span = { t0: 0, t1: far };
  if (!slab(span, ox, dx, mn.x, mx.x) || !slab(span, oy, dy, mn.y, mx.y) || !slab(span, oz, dz, mn.z, mx.z)) return Infinity;
  return span.t0;
}

/** Слой коробки по одной оси: сужает [t0, t1]; false — луч мимо. */
function slab(s: { t0: number; t1: number }, o: number, d: number, lo: number, hi: number): boolean {
  if (Math.abs(d) < 1e-9) return o >= lo && o <= hi;
  const a = (lo - o) / d, b = (hi - o) / d;
  s.t0 = Math.max(s.t0, Math.min(a, b));
  s.t1 = Math.min(s.t1, Math.max(a, b));
  return s.t0 <= s.t1;
}

/** Луч из (ox, oy, oz) по (dx, dy, dz) до len в меши near: расстояние до ближайшего попадания или len. Меш, в чью рамку
 *  (мир) луч не входит раньше ближайшего попадания, не проверяется (точная проверка Babylon обращает матрицу меша —
 *  дорого: лучей «свободно вокруг» за кадр — десятки). */
function cast(near: readonly AbstractMesh[], ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, len: number): number {
  RAY.origin.set(ox, oy, oz);
  RAY.direction.set(dx, dy, dz);
  RAY.length = len;
  let best = len;
  for (const m of near) {
    const b = m.getBoundingInfo().boundingBox;
    if (boxEntry(b.minimumWorld, b.maximumWorld, ox, oy, oz, dx, dy, dz, best) >= best) continue;
    const h = RAY.intersectsMesh(m as Mesh, false);
    if (h.hit && h.distance < best) best = h.distance;
  }
  return best;
}

/**
 * Свободно вокруг тела (план Babylon x, z): лучи вдоль ±X на смещениях по Z (доли ez) и вдоль ±Z на смещениях по X
 * (доли ex) на высотах ys (берётся меньшее); начала лучей — внутри нынешнего тела (там стен нет). Нет стены ближе
 * range — range.
 */
export function probeFree(scene: Scene, x: number, z: number, ys: readonly number[], ex: number, ez: number, range = PROBE_M): Free {
  const near = collidersNear(scene, x, z, range + 0.05, Math.min(...ys), Math.max(...ys));
  const free: Free = { x: [], z: [] };
  for (const k of OFFS) {
    const oz = k * ez, ox = k * ex;
    let xp = range, xn = range, zp = range, zn = range;
    for (const y of ys) {
      xp = Math.min(xp, cast(near, x, y, z + oz, 1, 0, 0, range));
      xn = Math.min(xn, cast(near, x, y, z + oz, -1, 0, 0, range));
      zp = Math.min(zp, cast(near, x + ox, y, z, 0, 0, 1, range));
      zn = Math.min(zn, cast(near, x + ox, y, z, 0, 0, -1, range));
    }
    free.x.push({ off: oz, pos: xp, neg: xn });
    free.z.push({ off: ox, pos: zp, neg: zn });
  }
  return free;
}

/** Свободно у середины тела вдоль оси в сторону sign (луч без смещения). */
const spanAt = (spans: readonly Span[], sign: 1 | -1): number => {
  const s = spans.find((q) => Math.abs(q.off) < 1e-6);
  return s ? (sign > 0 ? s.pos : s.neg) : Infinity;
};

interface Heap {
  node: TransformNode;
  inst: string;
  conn: string;
  /** ширина проёма, м */
  w: number;
}

interface Clod {
  mesh: Mesh;
  v: Vector3;
  floor: number;
  ttl: number;
}

export class CellarWalk {
  /** игрок в погребе (от первого лица) */
  on = false;
  private saved: { fog: number; fogStart: number; fogEnd: number; fogColor: Color3 } | null = null;
  /** туман, который поставили сами (поменял кто-то другой — его новое «как было») */
  private fogSet: { start: number; end: number } | null = null;
  private lampSaved: { lamp: PointLight; intensity: number; range: number; diffuse: Color3 } | null = null;
  private lampObs: Observer<Camera> | null = null;
  private obs: Observer<Scene>[] = [];
  private inObs: Observer<Camera> | null = null;
  private col: CollapseState;
  private readonly spec = CELLAR_COLLAPSE;
  /** свободно вокруг — последний замер (где и при каком повороте) */
  private free: Free | null = null;
  private freeAt = { x: NaN, z: NaN, yaw: NaN };
  private prevYaw: number | null = null;
  /** запас тела на принятом месте (clearance), м; ход в этом кадре упёрся (тело не влезло бы) */
  private clear = 0;
  private stepHit = false;
  /** сдвиг середины тела при повороте (не ход) — кадр вычитает его из хода */
  private shifted = { x: 0, z: 0 };
  private inAt: { x: number; z: number } | null = null;
  /** поворот упёрся в этом кадре; сколько упирался (затухает) */
  private turnHit = false;
  private turnT = 0;
  private side = false;
  private readonly shuffle = newShuffle();
  /** боком идёт (0…1, сглажено) — качание головы */
  private gait = 0;
  private last: Vector3 | null = null;
  private hands: WallHands | null = null;
  /** стена перед лицом (руки): до неё по нормали и угол от взгляда */
  private wall: { dist: number; delta: number } | null = null;
  /** оболочка куска под ногами (руки ложатся на её бугры): меш, поле полости, обратная мировая матрица; нет — когда
   *  проверить снова */
  private shell: { id: string; mesh: AbstractMesh; F: CellarField; floorY: number; inv: Matrix; flag: number } | null = null;
  private shellMiss = { id: '', until: 0 };
  /** цена кадра (мс, сглажено; QA): весь кадр погреба, руки */
  private perf = { frame: 0, hands: 0, input: 0 };
  private fwd = new Set<string>();
  private pushT = 0;
  private hint: { text: string; until: number } | null = null;
  private t = 0;
  private shake = 0;
  private crumbIn: number;
  private readonly rng: Rng;
  /** с обвала, с (пыль) */
  private dustT = Infinity;
  private crumbs: ParticleSystem | null = null;
  private puff: ParticleSystem | null = null;
  private trickle: ParticleSystem | null = null;
  private scrape: ParticleSystem | null = null;
  private motes: ParticleSystem | null = null;
  /** отсвет фонаря вплотную (боком) и его сила 0…1 */
  private near: PointLight | null = null;
  private nearK = 0;
  private clods: Clod[] = [];
  private clodMat: StandardMaterial | null = null;
  private heapMat: StandardMaterial | null = null;
  private heaps = new Map<string, Heap>();
  private heapCheck = 0;
  private nearPlug: { inst: string; conn: string; x: number; y: number } | null = null;
  /** вид на время кадра (качание головы боком) — снять после кадра */
  private applied: { x: number; y: number; z: number; rz: number } | null = null;
  /** крен этого кадра (шаг боком, тряска) — на время кадра */
  private rollNow = 0;
  /** засыпан — Posture.frozen поставили сами */
  private froze = false;
  private hudKey = '';
  private readonly hud: CellarHudView;
  private hudState: CellarHud = HUD_OFF;
  /** звук погреба; запускается по жесту (клавиша, клик) */
  readonly audio = new CellarAudio(typeof localStorage === 'undefined' || localStorage.getItem(CELLAR_SOUND_KEY) !== '0');
  private disposed = false;
  private readonly scene: Scene;
  private readonly cam: UniversalCamera;
  readonly posture: Posture;

  constructor(
    v: CellarViewer,
    private readonly host: CellarWalkHost,
    seed: string,
  ) {
    this.scene = v.scene;
    this.cam = v.fps;
    this.posture = v.posture;
    this.col = createCollapse(this.spec, `${seed}/cellar`);
    this.rng = makeRng(`${seed}/cellar-crumbs`);
    this.crumbIn = crumbDelay(this.rng.next(), false);
    this.hud = new CellarHudView(v.host);
    const s = this.scene;
    this.obs.push(s.onBeforeRenderObservable.add(() => this.frame()));
    this.obs.push(s.onBeforeRenderTargetsRenderObservable.add(() => this.view()));
    this.obs.push(s.onAfterRenderObservable.add(() => this.unview()));
    this.inObs = this.cam.onAfterCheckInputsObservable.add(() => this.afterInput());
    if (typeof window !== 'undefined') {
      window.addEventListener('keydown', this.onDown);
      window.addEventListener('keyup', this.onUp);
      window.addEventListener('blur', this.onBlur);
      window.addEventListener('pointerdown', this.onGesture);
    }
  }

  /** Состояние обвалов (сохранение / QA). */
  get collapse(): CollapseState {
    return this.col;
  }

  /** Засыпан обвалом (кооп: PlayerState.buried — напарник может откопать). */
  get buried(): boolean {
    return this.col.phase === 'buried';
  }

  /** Протискивается боком. */
  get squeezing(): boolean {
    return this.side;
  }

  /** HUD сейчас (QA). */
  get hudNow(): CellarHud {
    return this.hudState;
  }

  // ───────────────────────── ввод ─────────────────────────

  private onDown = (e: KeyboardEvent) => {
    if (typing(e)) return;
    if (FWD_KEYS.has(e.code)) this.fwd.add(e.code);
    if (this.on) void this.audio.start();
    if (e.code === 'KeyE' && !e.repeat) this.key();
  };

  private onUp = (e: KeyboardEvent) => {
    this.fwd.delete(e.code);
  };

  private onBlur = () => this.fwd.clear();

  private onGesture = () => {
    if (this.on) void this.audio.start();
  };

  /** E: засыпан — откапываться; у кучи завала — разгребать. */
  private key() {
    if (!this.on || !this.host.live()) return;
    if (this.col.phase === 'buried') {
      for (const ev of digCollapse(this.spec, this.col, 'self')) if (ev.type === 'freed') this.freed(ev.site);
      this.audio.dig();
      this.shake = Math.max(this.shake, 0.35);
      return;
    }
    const pl = this.nearPlug;
    if (!pl || this.host.busy?.()) return;
    this.host.dig(pl.inst, pl.conn, 1 / this.spec.clear);
    this.audio.dig();
    this.shake = Math.max(this.shake, 0.25);
    // земля из-под рук
    this.dustBurst(new Vector3(pl.x, this.posture.feet + 0.3, -pl.y), 18, 0.25);
  }

  /** Напарник откапывает (кооператив; одиночная игра — для QA). */
  mateDig() {
    for (const ev of digCollapse(this.spec, this.col, 'mate')) if (ev.type === 'freed') this.freed(ev.site);
  }

  // ───────────────────────── поворот в тесноте ─────────────────────────

  /** Высоты лучей «свободно вокруг»: середина эллипсоида коллизий и плечи (половина его полувысоты выше). */
  private heights(): number[] {
    const c = this.cam, ey = c.ellipsoid.y;
    const mid = c.position.y - ey + c.ellipsoidOffset.y;
    return [mid, mid + 0.5 * ey];
  }

  private measure() {
    const c = this.cam.position, e = this.cam.ellipsoid;
    this.free = probeFree(this.scene, c.x, c.z, this.heights(), e.x, e.z);
    this.freeAt = { x: c.x, z: c.z, yaw: this.cam.rotation.y };
  }

  /**
   * После ввода и коллизий этого кадра (до кадра):
   *  • ход — тело на новом месте должно влезать (clearance): коллизии Babylon пропускают эллипсоид углом в проём, если
   *    он шире проёма на несколько см (плечи 0.46 — в щель 0.4 грудью вперёд проходили), — такой ход назад (по оси,
   *    из-за которой не влезает; не вышло — весь);
   *  • поворот, при котором тело не влезает, — до последнего влезающего; середина тела — от стен, на сколько поворот
   *    вдвинул её в них.
   */
  private afterInput() {
    const t0 = performance.now();
    this.afterInputRun();
    this.perf.input += (performance.now() - t0 - this.perf.input) * 0.05;
  }

  private afterInputRun() {
    const P = this.posture, body = P.body;
    const c = this.cam.position;
    this.turnHit = false;
    if (!body || !this.host.live()) {
      this.prevYaw = null;
      this.inAt = null;
      return;
    }
    const jumped = !this.inAt || Math.hypot(c.x - this.inAt.x, c.z - this.inAt.z) > 0.5;
    this.measure();
    const want = this.cam.rotation.y;
    if (this.prevYaw === null || jumped) {
      this.prevYaw = want;
      this.inAt = { x: c.x, z: c.z };
      this.clear = clearance(body, want, this.free!);
      return;
    }
    // ход: эллипсоид этого кадра — по прошлому повороту
    const prev = this.inAt!;
    this.stepHit = false;
    if (c.x !== prev.x || c.z !== prev.z) {
      const y0 = this.prevYaw;
      if (!stepOk(clearance(body, y0, this.free!), this.clear)) {
        this.stepHit = true;
        const nx = c.x, nz = c.z;
        let ok = false;
        // по одной оси (скольжение вдоль стены), дальше — назад целиком
        const tries: [number, number][] = Math.abs(nx - prev.x) >= Math.abs(nz - prev.z) ? [[prev.x, nz], [nx, prev.z]] : [[nx, prev.z], [prev.x, nz]];
        for (const [x, z] of tries) {
          if (x === prev.x && z === prev.z) continue;
          c.x = x;
          c.z = z;
          this.measure();
          if (stepOk(clearance(body, y0, this.free!), this.clear)) {
            ok = true;
            break;
          }
        }
        if (!ok) {
          c.x = prev.x;
          c.z = prev.z;
          this.measure();
        }
        this.cam.movement?.resetPanVelocity?.();
      }
    }
    const free = this.free!;
    let y = want;
    if (Math.abs(wrapAngle(want - this.prevYaw)) > 1e-7) {
      y = clampYaw(body, this.prevYaw, want, free);
      if (Math.abs(y - want) > 1e-7) {
        this.cam.rotation.y = y;
        this.cam.cameraRotation.y = 0;
        this.cam.movement?.resetRotationVelocity?.();
        this.turnHit = true;
      }
      // поворот вдвинул тело в стену — к середине хода (только на сколько вдвинул: стоя у стены не дрожит)
      const f = fitAt(body, y, free, 0.003);
      if (f.ok && (f.dx || f.dz)) {
        c.x += f.dx;
        c.z += f.dz;
        // это не ход (кадр не должен счесть его шагом поперёк щели)
        this.shifted.x += f.dx;
        this.shifted.z += f.dz;
      }
    }
    this.prevYaw = y;
    this.inAt = { x: c.x, z: c.z };
    // запас на принятом месте; сдвинули от стен — не меньше зазора сдвига
    const cl = clearance(body, y, free);
    this.clear = c.x !== this.freeAt.x || c.z !== this.freeAt.z ? Math.max(cl, 0.003) : cl;
  }

  // ───────────────────────── кадр ─────────────────────────

  private frame() {
    if (this.disposed) return;
    const t0 = performance.now();
    this.frameRun();
    this.perf.frame += (performance.now() - t0 - this.perf.frame) * 0.05;
  }

  private frameRun() {
    const dt = Math.min(0.1, this.scene.getEngine().getDeltaTime() / 1000 || 1 / 60);
    this.t += dt;
    // комната на миг не определилась (мир пересобирается) — состояние не трогать
    const live = this.host.live();
    const r = live ? this.host.room() : null;
    if (live && !r) return;
    const cellar = !!r && isCellarRoom(r.inst);
    if (cellar !== this.on) (cellar ? this.enter() : this.leave());
    // тело-эллипс: в погребе и у двери в него (круглое 0.6 в проём 0.6 не проходит)
    const P = this.posture;
    const want = !!r && (cellar || this.nearCellarDoor(r.inst));
    if (want && !P.body) P.body = { a: BODY.a, b: BODY.b };
    else if (!want && P.body) P.body = null;
    this.audio.setInCellar(cellar);
    this.clodsStep(dt);
    if (!cellar || !r) {
      if (this.side) this.side = P.side = false;
      this.hands?.update(false, this.shuffle.phase, this.shuffle.dir, null, dt);
      this.nearFill(dt, false);
      this.motesOn(false);
      this.emit(HUD_OFF);
      return;
    }
    const c = this.cam.position;
    // свободно вокруг: замер этого кадра (после ввода) или заново
    if (!this.free || Math.abs(this.freeAt.x - c.x) > 1e-6 || Math.abs(this.freeAt.z - c.z) > 1e-6 || this.freeAt.yaw !== this.cam.rotation.y) this.measure();
    const free = this.free!;
    // ход за кадр
    const p = new Vector3(c.x, 0, c.z);
    let mx = 0, mz = 0;
    if (this.last) {
      mx = p.x - this.last.x - this.shifted.x;
      mz = p.z - this.last.z - this.shifted.z;
      if (Math.hypot(mx, mz) > 0.5) mx = mz = 0; // перенос, не ход
    }
    this.shifted.x = this.shifted.z = 0;
    this.last = p;
    const moved = Math.hypot(mx, mz);
    const buried = this.col.phase === 'buried';
    // засыпан — не двигаться (пишем только смену: сюжет и другие тоже держат позу)
    if (buried !== this.froze) P.frozen = this.froze = buried;
    // ── боком: ширина поперёк хода
    const was = this.side;
    this.side = squeezing(crossWidth(free, mx, mz), this.side);
    P.side = this.side;
    const yaw = this.cam.rotation.y;
    const rx = Math.cos(yaw), rz = -Math.sin(yaw); // вправо
    const fx = Math.sin(yaw), fz = Math.cos(yaw); // вперёд
    let step = false;
    if (this.side) step = stepShuffle(this.shuffle, mx * rx + mz * rz).step;
    this.gait += ((this.side && moved > 0.0004 ? 1 : 0) - this.gait) * Math.min(1, dt * (moved > 0.0004 ? 8 : 3));
    // стена перед лицом: узкая ось хода, сторона — куда смотришь
    this.wall = null;
    if (this.side) {
      const wz = widthOf(free.z), wx = widthOf(free.x);
      const axZ = wz <= wx;
      const comp = axZ ? fz : fx;
      const sign: 1 | -1 = comp >= 0 ? 1 : -1;
      const dist = spanAt(axZ ? free.z : free.x, sign);
      const wallYaw = axZ ? (sign > 0 ? 0 : Math.PI) : sign > 0 ? Math.PI / 2 : -Math.PI / 2;
      this.wall = { dist, delta: wrapAngle(wallYaw - yaw) };
      // плечо скребёт по стене — сыплется земля из-под него
      if (step && !buried) this.scrapeFx(c, axZ, sign, dist);
    }
    if (this.side && !was) this.hint = null;
    // ── подсказки: давит W в щель грудью вперёд; поворот упирается
    const now = this.t;
    if (this.fwd.size && !buried && moved < 0.003) this.pushT += dt;
    else this.pushT = 0;
    if (this.pushT > PUSH_S && this.slitAheadNow(fx, fz)) this.hint = { text: HINT_SLIT, until: now + HINT_S };
    // упирался поворот: копится (не больше 2·TURN_S — отпустил мышь, подсказка уходит за ~0.6 с)
    this.turnT = Math.min(2 * TURN_S, Math.max(0, this.turnT + (this.turnHit ? dt : -dt)));
    if (this.turnT > TURN_S && !(this.hint?.text === HINT_SLIT && this.hint.until > now)) this.hint = { text: HINT_TURN, until: now + 1.6 };
    if (this.hint && this.hint.until < now) this.hint = null;
    // ── обвалы: метры по узким ходам (залы и ниши — нет)
    const narrow = Math.min(widthOf(free.x), widthOf(free.z)) < NARROW_M;
    const px = c.x, py = -c.z;
    const walkedM = narrow && !buried && moved < 0.5 ? moved : 0;
    const mul = this.host.collapseMul?.() ?? 1;
    for (const e of stepCollapse(this.spec, this.col, dt, walkedM * (Number.isFinite(mul) && mul > 0 ? mul : 1), { x: px, y: py })) this.onEvent(e, r.id);
    // ── осыпи (косметика)
    this.crumbIn -= dt;
    if (this.crumbIn <= 0) {
      const slit = this.side || isSlitTags(r.inst.roomTags);
      this.crumbIn = crumbDelay(this.rng.next(), slit);
      if (!buried) this.crumble(fx, fz, rx, rz);
    }
    // ── туман: пыль после обвала сжимает его, оседает
    this.dustT += dt;
    const dust = dustLevel(this.dustT);
    this.fog(dust);
    this.dimLamp();
    // ── крен: шаг боком, тряска — только на время кадра (view): Posture.roll каждый кадр обнуляет общага
    this.shake = Math.max(0, this.shake - dt * 1.5);
    const shuffleRoll = this.side ? 0.012 * Math.sin(this.shuffle.phase) * this.gait : 0;
    this.rollNow = shuffleRoll + (this.shake > 0 ? (Math.random() - 0.5) * 0.03 * this.shake : 0);
    // ── куча у завала, раскопка
    this.heapsStep(dt, r.id, r.inst);
    this.nearPlug = null;
    let prompt: string | null = null;
    let bd = PLUG_NEAR;
    for (const k of r.inst.connectors) {
      if (!k.collapsed || k.len < 1) continue;
      const x = ((k.line[0] + k.line[2]) / 2) * CELL, y = ((k.line[1] + k.line[3]) / 2) * CELL;
      const d = Math.hypot(px - x, py - y);
      if (d < bd) {
        bd = d;
        this.nearPlug = { inst: r.id, conn: k.id, x, y };
      }
    }
    if (this.nearPlug) {
      const pr = this.host.digProgress(this.nearPlug.inst, this.nearPlug.conn) ?? 0;
      prompt = `Завал. E — разгребать (${Math.round(pr * this.spec.clear)}/${this.spec.clear})`;
    }
    const buriedK = buried ? this.col.dig : null;
    if (buriedK !== null) prompt = `Засыпало землёй! E — откапываться (${Math.round(buriedK * this.spec.digSelf)}/${this.spec.digSelf})`;
    const crack = this.col.phase === 'warn' ? Math.min(1, this.col.t / this.spec.warnS) : null;
    this.emit({ on: true, buried: buriedK, crack, dust, prompt, hint: this.hint?.text ?? null, side: this.side });
    // ── звук
    let crackPan = 0;
    const site = this.col.site;
    if (site) crackPan = this.panTo(site.x, -site.y);
    this.audio.update(dt, { moved: moved < 0.5 ? moved : 0, side: this.side, step, buried, crack, crackPan });
    // ── руки на стене, пыль в луче
    const torch = this.host.torch();
    if (this.side && !this.hands) this.hands = new WallHands(this.scene, this.cam);
    if (this.hands) {
      const th = performance.now();
      this.hands.update(this.side && !buried, this.shuffle.phase, this.shuffle.dir, this.wall, dt, torch ? 1 : 0, this.side ? this.shellOf(r.id) && this.probe : null);
      this.perf.hands += (performance.now() - th - this.perf.hands) * 0.05;
    }
    this.nearFill(dt, this.side && torch && !buried);
    this.motesOn(torch && !buried);
  }

  /** Оболочка куска id (меш `cellar:${id}:earth` портального рендера) — лучи рук в её бугры; нет — null (ищется
   *  снова не чаще раза в секунду). */
  private shellOf(id: string) {
    const s = this.shell;
    if (s && s.id === id && !s.mesh.isDisposed()) return s;
    this.shell = null;
    if (this.shellMiss.id === id && this.t < this.shellMiss.until) return null;
    const mesh = this.scene.getMeshByName(`cellar:${id}:earth`);
    const spec = mesh ? cellarShellSpec(mesh) : null;
    if (!mesh || !spec) {
      this.shellMiss = { id, until: this.t + 1 };
      return null;
    }
    return (this.shell = { id, mesh, F: cellarField(spec), floorY: spec.floorY, inv: new Matrix(), flag: -1 });
  }

  /** Луч рук в землю оболочки (мир Babylon): в местные координаты меша → план (x = X, y = −Z, z = Y − пол). */
  private readonly probe: WallProbe = (o, d, max) => {
    const s = this.shell;
    if (!s) return null;
    const wm = s.mesh.getWorldMatrix();
    if (s.flag !== wm.updateFlag) {
      wm.invertToRef(s.inv);
      s.flag = wm.updateFlag;
    }
    Vector3.TransformCoordinatesToRef(o, s.inv, PO);
    Vector3.TransformNormalToRef(d, s.inv, PD);
    return cellarRay(s.F, PO.x, -PO.z, PO.y - s.floorY, PD.x, -PD.z, PD.y, max);
  };

  /** Боком лицом к стене фонарь светит почти в упор (его источник — у глаза, вплотную к стене, стена вне конуса): отсвет
   *  на стену и перчатки — тёплый точечный свет у груди, плавно появляется и гаснет. */
  private nearFill(dt: number, on: boolean) {
    if (!on && !this.near) return;
    if (!this.near) {
      const l = (this.near = new PointLight('cellar:near', Vector3.Zero(), this.scene));
      l.diffuse = new Color3(1, 0.86, 0.68);
      l.specular = Color3.Black();
      l.range = NEAR_FILL.range;
      l.intensity = 0;
    }
    const l = this.near;
    this.nearK += ((on ? 1 : 0) - this.nearK) * Math.min(1, dt * 6);
    l.intensity = NEAR_FILL.intensity * this.nearK;
    const c = this.cam.position, f = this.cam.getDirection(Vector3.Forward());
    l.position.set(c.x + f.x * 0.03, c.y - 0.16, c.z + f.z * 0.03);
  }

  /** Сторона звука (−1 слева … 1 справа) к точке Babylon (x, z). */
  private panTo(x: number, z: number): number {
    const c = this.cam.position;
    const dx = x - c.x, dz = z - c.z, l = Math.hypot(dx, dz) || 1, yaw = this.cam.rotation.y;
    return (dx / l) * Math.cos(yaw) - (dz / l) * Math.sin(yaw);
  }

  /** Щель впереди, куда грудью вперёд не пролезть: смотришь вдоль оси, впереди свободно — ширина там уже плеч. */
  private slitAheadNow(fx: number, fz: number): boolean {
    const ax = facingAxis(fx, fz);
    if (!ax || !this.free) return false;
    const ahead = spanAt(ax.axis === 'x' ? this.free.x : this.free.z, ax.sign);
    const probe = 0.3;
    if (ahead < probe + 0.05) return false;
    const c = this.cam.position;
    const ys = this.heights();
    const ox = c.x + (ax.axis === 'x' ? ax.sign * probe : 0), oz = c.z + (ax.axis === 'z' ? ax.sign * probe : 0);
    const near = collidersNear(this.scene, ox, oz, PROBE_M, Math.min(...ys), Math.max(...ys));
    let w = Infinity;
    for (const y of ys) {
      const a = ax.axis === 'x' ? cast(near, ox, y, oz, 0, 0, 1, PROBE_M) + cast(near, ox, y, oz, 0, 0, -1, PROBE_M) : cast(near, ox, y, oz, 1, 0, 0, PROBE_M) + cast(near, ox, y, oz, -1, 0, 0, PROBE_M);
      w = Math.min(w, a);
    }
    return slitAhead(w, this.posture.body ?? BODY);
  }

  /** У двери в погреб: проём комнаты, связанный с комнатой погреба, ближе DOOR_NEAR. */
  private nearCellarDoor(inst: RunInstance): boolean {
    if (!this.host.inst) return false;
    const c = this.cam.position, px = c.x, py = -c.z;
    for (const k of inst.connectors) {
      if (!k.linkedTo) continue;
      const x = ((k.line[0] + k.line[2]) / 2) * CELL, y = ((k.line[1] + k.line[3]) / 2) * CELL;
      if (Math.hypot(px - x, py - y) > DOOR_NEAR) continue;
      const o = this.host.inst(k.linkedTo.inst);
      if (o && isCellarRoom(o)) return true;
    }
    return false;
  }

  // ───────────────────────── темнота ─────────────────────────

  private enter() {
    this.on = true;
    const s = this.scene;
    this.saved = { fog: s.fogMode, fogStart: s.fogStart, fogEnd: s.fogEnd, fogColor: s.fogColor.clone() };
    this.fogSet = null;
    this.last = null;
    this.side = false;
    this.fog(0);
    this.dimLamp();
    // свет у игрока — у глаз (настроение биома вешает его выше головы)
    if (!this.lampObs) {
      this.lampObs = s.onBeforeCameraRenderObservable.add(() => {
        if (!this.on) return;
        const lamp = s.getLightByName('mood:lamp') as PointLight | null;
        if (!lamp) return;
        const p = this.cam.position, f = this.cam.getDirection(Vector3.Forward());
        lamp.position.set(p.x + f.x * 0.1, p.y - 0.08, p.z + f.z * 0.1);
      });
    }
  }

  /** Туман погреба (с пылью k); поменял его кто-то другой (страница: «туман» в панели) — это его новое «как было». */
  private fog(k: number) {
    const s = this.scene, sv = this.saved, mine = this.fogSet;
    const want = dustFog(CELLAR_FOG, k);
    if (mine && s.fogMode === 3 && s.fogStart === mine.start && s.fogEnd === mine.end) {
      if (mine.start === want.start && mine.end === want.end) return;
    } else if (sv && mine) {
      sv.fog = s.fogMode;
      sv.fogStart = s.fogStart;
      sv.fogEnd = s.fogEnd;
      sv.fogColor = s.fogColor.clone();
    }
    s.fogMode = 3; // LINEAR
    s.fogStart = want.start;
    s.fogEnd = want.end;
    if (!s.fogColor.equals(CELLAR_FOG.color)) s.fogColor = CELLAR_FOG.color.clone();
    this.fogSet = { start: s.fogStart, end: s.fogEnd };
  }

  /** Свет у игрока ('mood:lamp' биома) — почти погашен; пересоздан (смена темноты) — снова. */
  private dimLamp() {
    const lamp = this.scene.getLightByName('mood:lamp') as PointLight | null;
    if (!lamp) return;
    if (this.lampSaved?.lamp !== lamp) this.lampSaved = { lamp, intensity: lamp.intensity, range: lamp.range, diffuse: lamp.diffuse.clone() };
    if (lamp.intensity !== CELLAR_LAMP.intensity) lamp.intensity = CELLAR_LAMP.intensity;
    if (lamp.range !== CELLAR_LAMP.range) lamp.range = CELLAR_LAMP.range;
    if (!lamp.diffuse.equals(CELLAR_LAMP.color)) lamp.diffuse = CELLAR_LAMP.color.clone();
  }

  private leave() {
    this.on = false;
    const s = this.scene, sv = this.saved;
    const P = this.posture;
    if (this.froze) P.frozen = this.froze = false;
    this.rollNow = 0;
    P.side = this.side = false;
    this.hint = null;
    this.crumbs?.stop();
    if (this.lampObs) s.onBeforeCameraRenderObservable.remove(this.lampObs);
    this.lampObs = null;
    const ls = this.lampSaved;
    if (ls && !ls.lamp.isDisposed()) {
      ls.lamp.intensity = ls.intensity;
      ls.lamp.range = ls.range;
      ls.lamp.diffuse = ls.diffuse;
    }
    this.lampSaved = null;
    if (sv) {
      s.fogMode = sv.fog;
      s.fogStart = sv.fogStart;
      s.fogEnd = sv.fogEnd;
      s.fogColor = sv.fogColor;
    }
    this.saved = null;
    this.fogSet = null;
  }

  // ───────────────────────── вид: качание головы боком ─────────────────────────

  /** Перед матрицами кадра (как бег, ./sprint.ts): боком голова чуть ходит вбок и вниз на каждый приставной шаг и
   *  кренится, грудь — с дыханием; тряска осыпи / обвала — крен. Физика и поза этого не видят (снимается после кадра). */
  private view() {
    this.unview();
    if (!this.on || !this.host.live() || this.scene.activeCamera !== this.cam) return;
    let x = 0, y = 0, z = 0;
    if (this.side) {
      const ph = this.shuffle.phase, g = this.gait, yaw = this.cam.rotation.y;
      const lat = 0.011 * Math.sin(ph) * g;
      y = -0.009 * Math.abs(Math.sin(ph)) * g + 0.003 * Math.sin(this.t * 2.6);
      x = lat * Math.cos(yaw);
      z = -lat * Math.sin(yaw);
    }
    const rz = this.rollNow;
    if (!x && !y && !z && !rz) return;
    const c = this.cam.position;
    c.x += x;
    c.y += y;
    c.z += z;
    this.cam.rotation.z += rz;
    this.applied = { x, y, z, rz };
  }

  private unview() {
    const a = this.applied;
    if (!a) return;
    this.applied = null;
    const c = this.cam.position;
    c.x -= a.x;
    c.y -= a.y;
    c.z -= a.z;
    this.cam.rotation.z -= a.rz;
  }

  // ───────────────────────── обвал ─────────────────────────

  private onEvent(e: CollapseEvent, roomId: string) {
    if (e.type === 'due') {
      const c = this.cam.position;
      const site = this.host.pickSite(roomId, c.x, -c.z);
      if (site) {
        startCollapse(this.spec, this.col, site);
        this.crackFx(site, true);
      } else postponeCollapse(this.spec, this.col);
      return;
    }
    if (e.type === 'crumbs') {
      if (this.crumbs) this.crumbs.emitRate = 40 + 260 * e.k;
      this.shake = Math.max(this.shake, 0.3 + 0.7 * e.k);
      return;
    }
    if (e.type === 'fall') {
      this.crackFx(e.site, false);
      this.fallFx(e.site);
      this.audio.fall(this.panTo(e.site.x, -e.site.y), e.buried);
      this.host.collapse(e.site);
      this.shake = 1.5;
      this.dustT = 0;
      return;
    }
    if (e.type === 'freed') this.freed(e.site);
  }

  /** Откопался: на своей стороне завала — отступ от места обвала вглубь своего куска. */
  private freed(site: CollapseSite) {
    const c = this.cam.position;
    const dx = c.x - site.x, dz = c.z + site.y;
    const l = Math.hypot(dx, dz) || 1;
    const need = this.spec.buryM + 0.25;
    if (l < need) {
      c.x = site.x + (dx / l) * need;
      c.z = -site.y + (dz / l) * need;
    }
    this.shake = 0.5;
    this.prevYaw = null;
  }

  /** Текстура частиц (клуб пыли); без DOM (тесты на NullEngine) — без текстуры. */
  private puffTex() {
    return typeof document === 'undefined' ? null : puffTexture(this.scene);
  }

  /** Сыплются частицы земли (unlit: цвет — тусклый бурый, на свету фонаря — тёмные крошки). */
  private grains(name: string, cap: number): ParticleSystem {
    const p = new ParticleSystem(name, cap, this.scene);
    p.particleTexture = this.puffTex();
    p.minSize = 0.008;
    p.maxSize = 0.03;
    p.minLifeTime = 0.5;
    p.maxLifeTime = 1;
    p.gravity = new Vector3(0, -7, 0);
    p.direction1 = new Vector3(-0.08, -0.1, -0.08);
    p.direction2 = new Vector3(0.08, -0.4, 0.08);
    p.minEmitPower = 0.3;
    p.maxEmitPower = 0.8;
    p.color1 = new Color4(0.26, 0.19, 0.12, 1);
    p.color2 = new Color4(0.19, 0.14, 0.09, 1);
    p.colorDead = new Color4(0.15, 0.11, 0.07, 0);
    p.blendMode = ParticleSystem.BLENDMODE_STANDARD;
    p.emitRate = 0;
    return p;
  }

  /** Треск: со свода над местом обвала сыплется земля. */
  private crackFx(site: CollapseSite, on: boolean) {
    if (!on) {
      this.crumbs?.stop();
      return;
    }
    const p = (this.crumbs ??= this.grains('cellar:crumbs', 500));
    p.minEmitBox = new Vector3(-0.3, 0, -0.3);
    p.maxEmitBox = new Vector3(0.3, 0, 0.3);
    p.emitter = new Vector3(site.x, this.posture.feet + 1.8, -site.y);
    p.emitRate = 40;
    p.targetStopDuration = 0;
    p.start();
  }

  /** Клуб пыли (обвал, разгребание): бурые клубы. */
  private dustBurst(at: Vector3, n: number, power: number) {
    if (!this.puff) {
      const p = (this.puff = new ParticleSystem('cellar:puff', 400, this.scene));
      p.particleTexture = this.puffTex();
      p.minSize = 0.3;
      p.maxSize = 0.9;
      p.minLifeTime = 1.5;
      p.maxLifeTime = 3.5;
      p.minEmitPower = 0.2;
      p.maxEmitPower = 1;
      p.gravity = new Vector3(0, -0.05, 0);
      p.direction1 = new Vector3(-1, 0.1, -1);
      p.direction2 = new Vector3(1, 0.5, 1);
      p.minAngularSpeed = -0.5;
      p.maxAngularSpeed = 0.5;
      p.color1 = new Color4(0.3, 0.24, 0.17, 0.5);
      p.color2 = new Color4(0.22, 0.17, 0.12, 0.35);
      p.colorDead = new Color4(0.15, 0.12, 0.09, 0);
      p.minEmitBox = new Vector3(-0.3, -0.2, -0.3);
      p.maxEmitBox = new Vector3(0.3, 0.6, 0.3);
      p.blendMode = ParticleSystem.BLENDMODE_STANDARD;
      p.manualEmitCount = 0;
    }
    this.puff.minEmitPower = 0.2 * power;
    this.puff.maxEmitPower = power;
    this.puff.emitter = at;
    this.puff.manualEmitCount = n;
    this.puff.start();
  }

  /** Обвал: клубы пыли, падают комья; игрок у места — пыль и вокруг него. */
  private fallFx(site: CollapseSite) {
    const y = this.posture.feet;
    this.dustBurst(new Vector3(site.x, y + 0.5, -site.y), 260, 1.2);
    for (let i = 0; i < 9; i++) {
      const a = Math.random() * Math.PI * 2, r = Math.random() * 0.35;
      this.dropClod(new Vector3(site.x + Math.cos(a) * r, y + 1.6 + Math.random() * 0.2, -site.y + Math.sin(a) * r), 0.035 + Math.random() * 0.05, y);
    }
  }

  /** Плечо скребёт по стене (шаг боком): крошки земли из-под него. */
  private scrapeFx(c: Vector3, axZ: boolean, sign: 1 | -1, dist: number) {
    const p = (this.scrape ??= this.grains('cellar:scrape', 120));
    p.minEmitBox = new Vector3(-0.03, -0.05, -0.03);
    p.maxEmitBox = new Vector3(0.03, 0.05, 0.03);
    const yaw = this.cam.rotation.y, dir = this.shuffle.dir;
    // у ведущего плеча, на стене перед лицом
    const sx = Math.cos(yaw) * dir * 0.2, sz = -Math.sin(yaw) * dir * 0.2;
    const d = Math.max(0.05, dist - 0.02);
    p.emitter = new Vector3(c.x + (axZ ? sx : sign * d), this.posture.feet + 1.32, c.z + (axZ ? sign * d : sz));
    p.manualEmitCount = 10 + Math.floor(Math.random() * 10);
    p.start();
  }

  /** Осыпь: струйка земли со свода (или со стены) впереди, иногда — комок; шипение, лёгкая дрожь. */
  private crumble(fx: number, fz: number, rx: number, rz: number) {
    const c = this.cam.position, feet = this.posture.feet;
    const near = collidersNear(this.scene, c.x, c.z, 2.2, feet, feet + 3);
    const fwd = cast(near, c.x, c.y - 0.2, c.z, fx, 0, fz, 2.2);
    const r = Math.max(0.25, Math.min(fwd - 0.15, 0.5 + this.rng.next() * 1.1));
    const lat = (this.rng.next() - 0.5) * 0.3;
    const x = c.x + fx * r + rx * lat, z = c.z + fz * r + rz * lat;
    const up = cast(near, x, feet + 1, z, 0, 1, 0, 2);
    const top = feet + 1 + up;
    const p = (this.trickle ??= this.grains('cellar:trickle', 300));
    p.minEmitBox = new Vector3(-0.05, 0, -0.05);
    p.maxEmitBox = new Vector3(0.05, 0, 0.05);
    p.emitter = new Vector3(x, Math.min(top, feet + 2.4) - 0.02, z);
    p.emitRate = 70 + this.rng.next() * 60;
    p.targetStopDuration = 0.7 + this.rng.next() * 0.9;
    p.start();
    const pan = this.panTo(x, z);
    this.audio.trickle(pan, 0.6 + 0.4 * this.rng.next());
    if (this.rng.next() < 0.3) this.dropClod(new Vector3(x, top - 0.05, z), 0.025 + this.rng.next() * 0.03, feet, true);
    this.shake = Math.max(this.shake, 0.12);
  }

  /** Комок земли падает на пол (y пола floor) и лежит несколько секунд. */
  private dropClod(at: Vector3, size: number, floor: number, sound = false) {
    if (!this.clodMat) {
      const m = (this.clodMat = new StandardMaterial('cellar:clod', this.scene));
      m.diffuseColor = new Color3(0.25, 0.18, 0.11);
      m.specularColor = Color3.Black();
    }
    const mesh = MeshBuilder.CreateSphere('cellar:clod', { diameter: 1, segments: 5 }, this.scene);
    mesh.scaling.set(size * (0.8 + Math.random() * 0.5), size * (0.6 + Math.random() * 0.3), size * (0.8 + Math.random() * 0.5));
    mesh.rotation.set(Math.random() * 3, Math.random() * 3, Math.random() * 3);
    mesh.position.copyFrom(at);
    mesh.material = this.clodMat;
    mesh.isPickable = false;
    this.clods.push({ mesh, v: new Vector3((Math.random() - 0.5) * 0.3, 0, (Math.random() - 0.5) * 0.3), floor: floor + size * 0.3, ttl: sound ? 8 : 12 });
    if (sound) (mesh.metadata as unknown) = { sound: true };
  }

  private clodsStep(dt: number) {
    for (const f of this.clods) {
      f.ttl -= dt;
      if (f.mesh.position.y <= f.floor) continue;
      f.v.y -= 9.8 * dt;
      f.mesh.position.addInPlace(f.v.scale(dt));
      if (f.mesh.position.y <= f.floor) {
        f.mesh.position.y = f.floor;
        if ((f.mesh.metadata as { sound?: boolean } | null)?.sound) this.audio.clod(this.panTo(f.mesh.position.x, f.mesh.position.z));
      }
    }
    if (this.clods.some((f) => f.ttl <= 0) || this.clods.length > 60) {
      this.clods = this.clods.filter((f, i) => {
        const keep = f.ttl > 0 && i >= this.clods.length - 60;
        if (!keep) f.mesh.dispose();
        return keep;
      });
    }
  }

  // ───────────────────────── куча земли у завала ─────────────────────────

  /** Кучи у заваленных проёмов комнаты игрока (по ширине проёма); меньше с раскопкой; раскопан — убрать. Кусок с
   *  оболочкой погреба (портальный рендер, src/view3d/cellarMesh.ts) кладёт кучу сам — тогда своей нет (запасная — для
   *  болванки без оболочки). */
  private heapsStep(dt: number, id: string, inst: RunInstance) {
    this.heapCheck -= dt;
    if (this.heapCheck > 0) return;
    this.heapCheck = 0.25;
    const feet = this.posture.feet;
    const shell = (rid: string) => !!this.scene.getMeshByName(`cellar:${rid}:earth`);
    for (const k of shell(id) ? [] : inst.connectors) {
      if (!k.collapsed || k.len < 1) continue;
      const key = `${id}/${k.id}`;
      if (this.heaps.has(key)) continue;
      const [x1, y1, x2, y2] = k.line;
      const cx = ((x1 + x2) / 2) * CELL, cy = ((y1 + y2) / 2) * CELL;
      // внутрь комнаты: к середине её охвата, поперёк проёма
      const b = inst.bbox, mx = ((b.x0 + b.x1) / 2) * CELL, my = ((b.y0 + b.y1) / 2) * CELL;
      const horiz = Math.abs(y1 - y2) < 1e-6;
      const ux = horiz ? 0 : Math.sign(mx - cx) || 1, uy = horiz ? Math.sign(my - cy) || 1 : 0;
      const w = k.len * CELL;
      const node = this.heapMesh(key, w);
      node.position.set(cx + ux * 0.18, feet - 0.02, -(cy + uy * 0.18));
      // местная z узла — внутрь комнаты (план y вниз → Babylon −z), x — вдоль проёма
      node.rotation.y = Math.atan2(ux, -uy);
      this.heaps.set(key, { node, inst: id, conn: k.id, w });
    }
    for (const [key, h] of this.heaps) {
      const pr = this.host.digProgress(h.inst, h.conn);
      if (pr === null || shell(h.inst)) {
        h.node.dispose(false, false);
        this.heaps.delete(key);
        continue;
      }
      const s = 1 - 0.7 * clamp01(pr);
      h.node.scaling.set(1, s, 0.5 + 0.5 * s);
    }
    // далеко позади — убрать (вернётся — построится снова)
    if (this.heaps.size > 16) {
      for (const [key, h] of this.heaps) {
        if (h.inst === id) continue;
        h.node.dispose(false, false);
        this.heaps.delete(key);
        if (this.heaps.size <= 12) break;
      }
    }
  }

  /** Куча земли шириной w (вдоль x узла, вглубь — z): модель p_cel_heap, вписанная в размер, или своя из примитивов. */
  private heapMesh(key: string, w: number): TransformNode {
    const node = new TransformNode(`cellar:heap:${key}`, this.scene);
    const tpl = this.host.propModel?.('p_cel_heap') ?? null;
    if (tpl) {
      const m = tpl.clone(`cellar:heapModel:${key}`, node, false);
      if (m) {
        m.setEnabled(true);
        m.isVisible = true;
        m.isPickable = false;
        m.checkCollisions = false;
        const bb = tpl.getBoundingInfo().boundingBox;
        const ext = bb.extendSize, mid = bb.center;
        const sx = (w * 1.1) / Math.max(0.05, 2 * ext.x), sy = 0.5 / Math.max(0.05, 2 * ext.y), sz = 0.45 / Math.max(0.05, 2 * ext.z);
        const s = Math.min(sx, sy * 1.6, sz * 1.6);
        m.scaling.set(sx, Math.min(sy, s), Math.min(sz, s * 1.2));
        m.position.set(-mid.x * m.scaling.x, -(mid.y - ext.y) * m.scaling.y, -mid.z * m.scaling.z);
        m.rotation.set(0, 0, 0);
        return node;
      }
    }
    if (!this.heapMat) {
      const m = (this.heapMat = new StandardMaterial('cellar:heap', this.scene));
      m.diffuseColor = new Color3(0.24, 0.17, 0.11);
      m.specularColor = Color3.Black();
    }
    const mound = MeshBuilder.CreateSphere(`cellar:mound:${key}`, { diameter: 1, segments: 12 }, this.scene);
    mound.scaling.set(w * 1.15, 0.9, 0.7);
    mound.position.y = 0;
    mound.material = this.heapMat;
    mound.parent = node;
    mound.isPickable = false;
    for (let i = 0; i < 5; i++) {
      const c = MeshBuilder.CreateSphere(`cellar:moundClod:${key}`, { diameter: 1, segments: 5 }, this.scene);
      const s = 0.06 + Math.random() * 0.07;
      c.scaling.set(s * 1.3, s, s * 1.1);
      c.position.set((Math.random() - 0.5) * w * 0.9, 0.06 + Math.random() * 0.12, 0.2 + Math.random() * 0.12);
      c.rotation.set(Math.random() * 3, Math.random() * 3, 0);
      c.material = this.heapMat;
      c.parent = node;
      c.isPickable = false;
    }
    return node;
  }

  // ───────────────────────── пыль в луче фонаря ─────────────────────────

  /** Пылинки — только внутри конуса фонаря 0.3…3 м впереди, мелкие, медленные, едва видны; фонарь не горит — нет. */
  private motesOn(on: boolean) {
    if (!on) {
      // фонарь погас — пылинок не видно сразу
      if (this.motes && this.motes.emitRate > 0) {
        this.motes.emitRate = 0;
        this.motes.reset();
      }
      return;
    }
    if (!this.motes) {
      const p = (this.motes = new ParticleSystem('cellar:motes', 260, this.scene));
      p.particleTexture = this.puffTex();
      p.minSize = 0.005;
      p.maxSize = 0.014;
      p.minLifeTime = 2.5;
      p.maxLifeTime = 5;
      p.minEmitPower = 0.01;
      p.maxEmitPower = 0.04;
      p.gravity = new Vector3(0, -0.004, 0);
      p.color1 = new Color4(0.5, 0.44, 0.35, 0.32);
      p.color2 = new Color4(0.4, 0.35, 0.28, 0.22);
      p.colorDead = new Color4(0.3, 0.26, 0.2, 0);
      p.blendMode = ParticleSystem.BLENDMODE_ADD;
      p.emitter = Vector3.Zero();
      const cam = this.cam, dir = new Vector3(), right = new Vector3(), up = new Vector3();
      p.startPositionFunction = (_w: Matrix, pos: Vector3, _p: Particle) => {
        cam.getDirectionToRef(Vector3.Forward(), dir);
        cam.getDirectionToRef(Vector3.Right(), right);
        cam.getDirectionToRef(Vector3.Up(), up);
        // ближе — гуще (объём конуса растёт с расстоянием), полуугол ~0.28 рад
        const d = 0.3 + 2.7 * Math.pow(Math.random(), 1.6);
        const a = Math.random() * Math.PI * 2, rr = Math.sqrt(Math.random()) * Math.tan(0.28) * d;
        const c = cam.position;
        pos.set(
          c.x + dir.x * d + (right.x * Math.cos(a) + up.x * Math.sin(a)) * rr,
          c.y - 0.05 + dir.y * d + (right.y * Math.cos(a) + up.y * Math.sin(a)) * rr,
          c.z + dir.z * d + (right.z * Math.cos(a) + up.z * Math.sin(a)) * rr,
        );
      };
      p.startDirectionFunction = (_w: Matrix, out: Vector3) => {
        out.set(Math.random() - 0.5, (Math.random() - 0.5) * 0.6, Math.random() - 0.5);
      };
      p.start();
    }
    this.motes.emitRate = 34;
  }

  // ───────────────────────── HUD ─────────────────────────

  private emit(h: CellarHud) {
    const promptOk = !this.host.busy?.();
    const k = hudKey(h) + (promptOk ? '' : '|busy');
    if (k === this.hudKey) return;
    this.hudKey = k;
    this.hudState = h;
    this.hud.show(h, promptOk);
    this.host.onHud?.(h);
  }

  /** Для QA-скриптов (window.__rfCellar). */
  qa() {
    const P = this.posture;
    return {
      on: this.on,
      side: this.side,
      body: P.body,
      ell: { x: this.cam.ellipsoid.x, z: this.cam.ellipsoid.z },
      speed: this.cam.speed,
      yaw: this.cam.rotation.y,
      width: this.free ? { x: widthOf(this.free.x), z: widthOf(this.free.z) } : null,
      wall: this.wall,
      hands: this.hands?.visible ?? false,
      hud: this.hudState,
      phase: this.col.phase,
      crawled: this.col.crawled,
      next: this.col.next,
      dust: dustLevel(this.dustT),
      heaps: [...this.heaps.keys()],
      audio: this.audio.counters,
      motes: this.motes?.getActiveCount() ?? 0,
      shell: !!this.shell,
      rays: this.hands?.rays ?? 0,
      perf: { ...this.perf },
    };
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    if (this.on) this.leave();
    const P = this.posture;
    P.body = null;
    P.side = false;
    this.unview();
    for (const o of this.obs) o.remove();
    this.obs = [];
    if (this.inObs) this.cam.onAfterCheckInputsObservable.remove(this.inObs);
    this.inObs = null;
    if (typeof window !== 'undefined') {
      window.removeEventListener('keydown', this.onDown);
      window.removeEventListener('keyup', this.onUp);
      window.removeEventListener('blur', this.onBlur);
      window.removeEventListener('pointerdown', this.onGesture);
    }
    this.audio.dispose();
    this.hud.dispose();
    this.hands?.dispose();
    for (const p of [this.crumbs, this.puff, this.trickle, this.scrape, this.motes]) p?.dispose();
    for (const f of this.clods) f.mesh.dispose();
    this.clods = [];
    for (const h of this.heaps.values()) h.node.dispose(false, false);
    this.heaps.clear();
    this.clodMat?.dispose();
    this.heapMat?.dispose();
    this.near?.dispose();
  }
}
