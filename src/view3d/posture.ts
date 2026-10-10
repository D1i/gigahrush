// Поза игрока от первого лица (вкладка «3D», все источники: «Прогулка», «Прогон», «Комната», «Файл»): стоя,
// скрючившись, на четвереньках и лёжа (подвид четверенек — под кровать). Клавиша C — на четвереньки / встать (во весь
// рост, если над головой есть место, иначе — скрючившись; совсем низко — «здесь не встать»). Снежные ходы
// (src/view3d/snowWalk.ts) сажают на четвереньки сами.
//
//  • Поза — высота глаза, эллипсоид коллизий (у четверенек — низкий: пролезает в лаз 0.9 м) и скорость. Вниз эллипсоид
//    меняется сразу (ноги на месте; меньше — не застрянет), глаз опускается плавно (~0.4 с, от времени, не от кадров).
//  • Вверх (лёжа → на четвереньки → скрючившись → стоя, любое повышение глаза) — подъём за RISE_S: глаз, эллипсоид
//    (радиус и высота), «шаг» и скорость — вместе, по smoothstep от времени (без рывка в начале и после подвисания; бег
//    не дёргает с места). Верх эллипсоида — не выше места над головой: лучи вверх — середина и 4 по бокам на 0.8
//    радиуса (там поверхность эллипсоида ниже верха — сбоку требуется своя высота; на полном радиусе у эллипсоида
//    высоты нет). Упёрся — ждёт и отходит от края (стол, тумба); дольше RISE_HOLD — назад ниже, «здесь не встать».
//    Растёт вширь (0.25 → 0.3) — сам плавно отходит от стены (4 луча вбок на высоте середины), а не толчком коллизий
//    Babylon. Пока встаёт — опора своя (гравитация — когда встал), толчки хода гаснут с высотой глаза,
//    взгляд сползает к горизонту (±LEVEL_PITCH; мышь работает). Поза не действует (облёт, спец-сцена, телепорт) —
//    переход сразу (finish).
//  • Лёжа (flat, PRONE: глаз 0.22, эллипсоид 0.05…0.25 м над ногами): ползёшь на четвереньках к низкому укрытию
//    (коллайдер мебели с metadata.cover, низ плиты ниже верха четверенек — кровать, плита от 0.30 м;
//    src/blockout/babylon.ts) ближе FLAT_NEAR — ложится сам (впервые за заход на четвереньки — «лёжа — под кровать»);
//    выполз (дальше FLAT_KEEP, не ползёшь к нему, над головой — место четверенек) — подъёмом снова на четвереньки.
//    Куда ползёшь — ход камеры этого кадра до коллизий (упёрся в бок кровати — всё равно «к ней»): стоишь рядом или
//    ползёшь вдоль — не ложится. Под стол (плита от 0.62 м) пролезают на четвереньках. C лёжа: под кроватью —
//    «здесь не встать», рядом, где есть место, — встаёт как обычно. under — под чем середина камеры (bed / table /
//    null; рука общаги: под кроватью — укрытие).
//  • На четвереньках — ход: толчок на каждый шаг рукой (горизонт не кренится), внизу кадра по очереди выбрасываются вперёд
//    руки (src/view3d/snowHands.ts); лёжа — вполсилы, руки по-пластунски (ниже, шире, локти в стороны; переход ~0.3 с).
//    Скрючившись — лёгкое покачивание, рук нет.
//  • Опора: стоя — гравитация Babylon, как была. Скрючившись, на четвереньках, лёжа и пока встаёт — своя: луч вниз до
//    пола (коллайдеры рядом), ноги — на пол (вниз — плавно, падение до 3 м/с; вверх по склону — сразу), коллизии —
//    только стены. Гравитация Babylon — постоянные −16 см за кадр к шагу: на наклонном полу (чаша берлоги, горки лаза)
//    она стаскивает низкий эллипсоид по склону сильнее, чем шаг ползком (4–10 мм за кадр при 60–144 к/с), — игрок не
//    мог проползти. Под плитой укрытия глаз не выше её (иначе луч к полу упёрся бы в плиту).
//  • Камера Babylon: центр эллипсоида = позиция − ellipsoid.y + ellipsoidOffset; глаз над ногами eye, низ эллипсоида
//    на lift над ногами ⇒ ellipsoidOffset.y = lift + 2·ellipsoid.y − eye. Стоя lift = 0 (пол — гравитацией Babylon);
//    низко lift ≈ 0.2 м — как «шаг» у контроллера персонажа: эллипсоид не цепляет пол, горки и склоны до ~40° не мешают.
//  • Крен (rotation.z: roll позы, качание бега, «лежит», шаг боком в погребе): Babylon пересчитывает «верх» камеры
//    (upVector) только когда rotation.z меняется — с поворотом и наклоном взгляда того кадра; крен прошёл, глядя вниз, —
//    дальше поворот мышью валил горизонт (до десятков градусов). Поэтому updateUpVectorFromRotation: верх — каждый кадр.
//  • Скорость: cam.speed = скорость позы (при подъёме — плавно) × speedMul (бег — src/view3d/sprint.ts); засыпало — 0.
//  • Погреб (src/view3d/cellarWalk.ts, src/locations/cellarSqueeze.ts): body — тело-эллипс по взгляду (радиусы x/z
//    эллипсоида — от поворота камеры, в любой позе), side — протискивается боком (скорость × SIDE_SPEED); тело снято —
//    к круглому подъёмом «вширь» (RISE_S, отход от стен — как при подъёме; взгляд не трогает).
import type { Scene } from '@babylonjs/core/scene';
import type { UniversalCamera } from '@babylonjs/core/Cameras/universalCamera';
import type { Observer } from '@babylonjs/core/Misc/observable';
import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import { Ray } from '@babylonjs/core/Culling/ray';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { CrawlHands, CRAWL_CYCLE } from './snowHands';
import { bodyExtents, SIDE_SPEED } from '../locations/cellarSqueeze'; // cellar

export type Pose = 'stand' | 'crouch' | 'crawl';

/** Укрытие — metadata.cover коллайдера мебели (src/blockout/babylon.ts): под кровать — лёжа, под стол — на четвереньках. */
export type Cover = 'bed' | 'table';

export interface PoseDef {
  /** глаз над ногами, м */
  eye: number;
  /** полуоси эллипсоида коллизий */
  ell: [number, number, number];
  /** «шаг»: низ эллипсоида над ногами, м (низко — пол держит своя опора, эллипсоид касается только стен) */
  lift: number;
  /** скорость камеры (UniversalCamera.speed) */
  speed: number;
}

export const POSES: Record<Pose, PoseDef> = {
  stand: { eye: 1.6, ell: [0.3, 0.85, 0.3], lift: 0, speed: 0.22 },
  crouch: { eye: 1.1, ell: [0.28, 0.45, 0.28], lift: 0.2, speed: 0.11 },
  crawl: { eye: 0.5, ell: [0.25, 0.2, 0.25], lift: 0.18, speed: 0.075 },
};

/** Лёжа — подвид четверенек (Posture.flat): верх эллипсоида 0.25 м — под кровать (плита от 0.30 м). */
export const PRONE: PoseDef = { eye: 0.22, ell: [0.25, 0.1, 0.25], lift: 0.05, speed: 0.05 };

/** Над головой нужно (от ног) — встать во весь рост / скрючившись, м. */
export const ROOM_STAND = 1.8;
export const ROOM_CROUCH = 1.25;

/** Подъём: глаз, эллипсоид, «шаг» и скорость — вместе, с. */
export const RISE_S = 0.55;
/** Подъём упёрся дольше стольких с — назад ниже («здесь не встать»). */
export const RISE_HOLD = 0.25;
/** Взгляд при подъёме — к горизонту, в пределах ± стольких рад. */
export const LEVEL_PITCH = 0.15;

/** Подписи для HUD (onChange note). */
export const NOTE_LOW = 'Здесь не встать — низко';
export const NOTE_FLAT = 'Лёжа — под кровать';

export const POSE_NAME: Record<Pose, string> = { stand: 'стоя', crouch: 'скрючившись', crawl: 'на четвереньках' };

/** Верх эллипсоида на четвереньках над ногами, м: укрытие ниже — «низкое», под него только лёжа. */
const CRAWL_TOP = POSES.crawl.lift + 2 * POSES.crawl.ell[1];
/** Лечь: до низкого укрытия ближе стольких м (и ползёшь к нему); снова на четвереньки — отполз дальше FLAT_KEEP. */
const FLAT_NEAR = 0.45;
const FLAT_KEEP = 0.3;
/** Низкое укрытие: низ плиты над ногами выше стольких м. */
const FLAT_MIN = 0.1;
/** «Под укрытием» — низ плиты над ногами от COVER_MIN до COVER_MAX, м (выше — уже не над игроком: этаж выше). */
const COVER_MIN = 0.05;
const COVER_MAX = 1;
/** Верх эллипсоида — ниже упора над головой хотя бы на столько, м. */
const GAP = 0.02;
/** Боковые лучи вверх — на такой доле радиуса (там у эллипсоида SIDE_Q его полувысоты над и под серединой). */
const SIDE = 0.8;
const SIDE_Q = Math.sqrt(1 - SIDE * SIDE);
/** Отход от стены / края стола при подъёме, м/с. */
const PUSH = 0.5;
/** Лучи: середина и 4 стороны (x, z). */
const DIRS: readonly (readonly [number, number])[] = [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]];

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const smooth = (t: number) => t * t * (3 - 2 * t);
const lerp = (a: number, b: number, s: number) => a + (b - a) * s;
/** доля пути к цели за dt при скорости сближения rate (1/с) — от времени, не от частоты кадров */
const ease = (dt: number, rate: number) => 1 - Math.exp(-dt * rate);

/** Подъём: откуда (глаз, верх и радиус эллипсоида, «шаг», скорость), сколько прошло (t: 0…1) и сколько упирается (с). */
interface Rise {
  t: number;
  eye: number;
  top: number;
  rad: number;
  lift: number;
  speed: number;
  held: number;
  /** погреб: радиус по z (тело-эллипс снято — x и z к круглому каждый от своего) и подъём «вширь» (взгляд не трогать) */
  radZ?: number;
  wide?: boolean;
}

/** Укрытия рядом (кадр). */
interface Covers {
  /** под чем середина камеры */
  under: Cover | null;
  /** низ самой низкой плиты над головой (над ногами), м */
  bottom: number | null;
  /** лечь: низкое укрытие над головой или рядом, и ползёшь к нему */
  low: Cover | null;
  /** до ближайшего низкого укрытия, м (Infinity — нет) */
  near: number;
  /** ползёшь к низкому укрытию ближе FLAT_NEAR */
  toward: boolean;
}

export class Posture {
  pose: Pose = 'stand';
  /** лёжа — подвид четверенек (PRONE): ложится сам у низкого укрытия, выползши — снова на четвереньки */
  flat = false;
  /** под чем сейчас середина камеры (низ плиты укрытия — над ногами); обновляется каждый кадр, пока поза действует */
  under: Cover | null = null;
  /** глаз над ногами сейчас (поза + ход) */
  eye = POSES.stand.eye;
  /** не двигаться (засыпало) */
  frozen = false;
  /** множитель скорости позы (бег — src/view3d/sprint.ts) */
  speedMul = 1;
  /** смена позы и отказ («здесь не встать»), «лёжа — под кровать» — для HUD */
  onChange: ((pose: Pose, note: string | null) => void) | null = null;
  /** крен хода (рад) */
  sway = 0;
  /** добавочный крен (тряска обвала в снегу), рад */
  roll = 0;
  /** погреб (src/view3d/cellarWalk.ts): тело — эллипс (a — полуширина плеч, b — полутолщина груди, м), повёрнутый по
   *  взгляду: радиусы эллипсоида x/z каждый кадр от поворота камеры (стены — вдоль осей), в любой позе. null — круглое
   *  (радиус позы); снято — к круглому плавно, подъёмом «вширь» за RISE_S */
  body: { a: number; b: number } | null = null;
  /** погреб: протискивается боком (щель уже плеч) — скорость × SIDE_SPEED, бега нет (sprint.ts), фонарь ниже */
  side = false;
  /** тело-эллипс действовало (снято — подъём «вширь» от его последних радиусов) */
  private bodyOn = false;
  private readonly bodyXZ = { x: POSES.stand.ell[0], z: POSES.stand.ell[2] };
  private base = POSES.stand.eye;
  /** «шаг» сейчас: низ эллипсоида над ногами, м */
  private lift = POSES.stand.lift;
  /** скорость позы сейчас (без speedMul) */
  private speed = POSES.stand.speed;
  private rise: Rise | null = null;
  /** «лёжа — под кровать» уже показано за этот заход на четвереньки */
  private flatNoted = false;
  private bob = 0;
  private phase = 0;
  private last: Vector3 | null = null;
  private hands: CrawlHands | null = null;
  private obs: Observer<Scene> | null = null;
  private readonly rays = DIRS.map(() => new Ray(Vector3.Zero(), Vector3.Up(), 3));
  private readonly ups = [3, 3, 3, 3, 3];
  private readonly hray = new Ray(Vector3.Zero(), new Vector3(1, 0, 0), 1);
  private readonly cov: Covers = { under: null, bottom: null, low: null, near: Infinity, toward: false };

  constructor(
    private readonly scene: Scene,
    private readonly cam: UniversalCamera,
    /** поза действует (от первого лица, без своей сцены поверх) */
    private readonly live: () => boolean,
  ) {
    // верх камеры — от поворота каждый кадр (см. шапку: иначе крен, однажды бывший, валит горизонт при повороте)
    cam.updateUpVectorFromRotation = true;
    this.obs = scene.onBeforeRenderObservable.add(() => this.frame());
  }

  /** Ноги (высота), м. */
  get feet(): number {
    return this.cam.position.y - this.eye;
  }

  /** Встаёт (подъём ещё идёт; опора — своя). */
  get rising(): boolean {
    return this.rise !== null;
  }

  /** Пол под игроком: луч вниз от глаза в коллайдеры рядом (до 1.5 м ниже ног); null — пола нет. */
  floorAt(): number | null {
    const c = this.cam.position;
    const ray = new Ray(new Vector3(c.x, c.y, c.z), Vector3.Down(), this.eye + 1.5);
    let best: number | null = null;
    for (const m of this.scene.meshes) {
      if (!m.checkCollisions || !m.isEnabled()) continue;
      const b = m.getBoundingInfo().boundingBox;
      if (c.x < b.minimumWorld.x - 0.3 || c.x > b.maximumWorld.x + 0.3 || c.z < b.minimumWorld.z - 0.3 || c.z > b.maximumWorld.z + 0.3) continue;
      const hit = ray.intersectsMesh(m as Mesh, false);
      if (hit.hit && (best === null || hit.distance < best)) best = hit.distance;
    }
    return best === null ? null : c.y - best;
  }

  /** Сколько места над ногами, м; 3 — потолка нет. Лучи вверх от 0.25 м над ногами в коллайдеры рядом: середина и
   *  4 по бокам на 0.8·r (r — радиус эллипсоида, по умолчанию нынешний), берётся меньший. */
  headroom(r = this.cam.ellipsoid.x): number {
    const u = this.upRays(r, 0.25);
    return Math.min(u[0], u[1], u[2], u[3], u[4]);
  }

  /** Упор над ногами по 5 лучам вверх (середина — от 0.25 м над ногами, бока на SIDE·r — от ys), м; 3 — нет. */
  private upRays(r: number, ys: number): number[] {
    const c = this.cam.position, feet = c.y - this.eye, o = SIDE * r, pad = 0.5 + o;
    const u = this.ups;
    for (let i = 0; i < 5; i++) {
      const y0 = i ? ys : 0.25;
      this.rays[i].origin.set(c.x + DIRS[i][0] * o, feet + y0, c.z + DIRS[i][1] * o);
      this.rays[i].length = Math.max(0.01, 3 - y0);
      u[i] = 3;
    }
    const lo = feet + Math.min(0.25, ys);
    for (const m of this.scene.meshes) {
      if (!m.checkCollisions || !m.isEnabled()) continue;
      const b = m.getBoundingInfo().boundingBox;
      if (b.maximumWorld.y < lo || b.minimumWorld.y > feet + 3) continue;
      if (c.x < b.minimumWorld.x - pad || c.x > b.maximumWorld.x + pad || c.z < b.minimumWorld.z - pad || c.z > b.maximumWorld.z + pad) continue;
      for (let i = 0; i < 5; i++) {
        const hit = this.rays[i].intersectsMesh(m as Mesh, false);
        const y0 = i ? ys : 0.25;
        if (hit.hit && hit.distance + y0 < u[i]) u[i] = hit.distance + y0;
      }
    }
    return u;
  }

  /** Поза сразу (снежные ходы: на четвереньки; выход из снега — встать). Вниз эллипсоид — сейчас, глаз — плавно;
   *  вверх — подъём за RISE_S. */
  set(pose: Pose, note: string | null = null) {
    if (pose === this.pose) return;
    this.pose = pose;
    if (pose !== 'crawl') {
      this.flat = false;
      this.flatNoted = false;
    }
    this.apply();
    this.last = null;
    this.onChange?.(pose, note);
  }

  /** C: на четвереньки ↔ встать (во весь рост / скрючившись — по месту над головой). false — встать негде. */
  toggle(): boolean {
    if (this.pose !== 'crawl') {
      this.set('crawl');
      return true;
    }
    const room = this.headroom();
    if (room >= ROOM_STAND) this.set('stand');
    else if (room >= ROOM_CROUCH) this.set('crouch');
    else {
      this.onChange?.(this.pose, NOTE_LOW);
      return false;
    }
    return true;
  }

  /** Переход позы — сразу (поза не действует: облёт, спец-сцена; телепорт ставит камеру по eye). Ноги — на месте. */
  finish() {
    const d = this.def();
    if (!this.rise && this.base === d.eye && this.eye === d.eye) return;
    this.rise = null;
    this.cam.ellipsoid.set(d.ell[0], d.ell[1], d.ell[2]);
    this.shape(false); // cellar
    this.lift = d.lift;
    this.speed = d.speed;
    this.base = d.eye;
    this.bob = 0;
    this.cam.position.y += d.eye - this.eye;
    this.eye = d.eye;
    this.cam.ellipsoidOffset.y = d.lift + 2 * d.ell[1] - d.eye;
  }

  /** Параметры позы сейчас: на четвереньках лёжа — PRONE. */
  private def(): PoseDef {
    return this.pose === 'crawl' && this.flat ? PRONE : POSES[this.pose];
  }

  /** К позе: глаз выше — подъём от нынешнего (глаз, эллипсоид, «шаг», скорость); ниже — эллипсоид сразу. */
  private apply() {
    const d = this.def(), e = this.cam.ellipsoid;
    if (d.eye > this.base + 1e-4) {
      this.rise = { t: 0, eye: this.base, top: this.lift + 2 * e.y, rad: e.x, lift: this.lift, speed: this.speed, held: 0 };
    } else {
      this.rise = null;
      e.set(d.ell[0], d.ell[1], d.ell[2]);
      this.shape(this.live()); // cellar
      this.lift = d.lift;
      this.speed = d.speed;
    }
    this.cam.ellipsoidOffset.y = this.lift + 2 * e.y - this.eye;
    if (!this.live()) this.finish();
  }

  /** Погреб: тело-эллипс — радиусы x/z от поворота взгляда (поверх радиуса позы). Снято — подъём «вширь» от последних
   *  радиусов тела к круглому (live — поза действует; иначе — сразу круглое); подъём уже идёт — z тоже от тела. */
  private shape(live: boolean) {
    const e = this.cam.ellipsoid, b = this.body;
    if (b) {
      const k = bodyExtents(b.a, b.b, this.cam.rotation.y);
      e.x = this.bodyXZ.x = k.x;
      e.z = this.bodyXZ.z = k.z;
      this.bodyOn = true;
      return;
    }
    if (!this.bodyOn) return;
    this.bodyOn = false;
    if (!live) return;
    if (this.rise) {
      this.rise.radZ ??= this.bodyXZ.z;
      return;
    }
    this.rise = { t: 0, eye: this.base, top: this.lift + 2 * e.y, rad: this.bodyXZ.x, radZ: this.bodyXZ.z, lift: this.lift, speed: this.speed, held: 0, wide: true };
    e.x = this.bodyXZ.x;
    e.z = this.bodyXZ.z;
  }

  /** Куда игрок движется в этом кадре — до коллизий (упёрся в бок кровати — всё равно «к ней»). Babylon 9: ход камеры
   *  кадра — movement.panDeltaCurrentFrame (cameraDirection к onBeforeRender уже обнулён); прежние — cameraDirection. */
  private intent(): Vector3 {
    const mv = this.cam.movement?.panDeltaCurrentFrame;
    return mv && (mv.x !== 0 || mv.z !== 0) ? mv : this.cam.cameraDirection;
  }

  /** Укрытия рядом: коллайдеры мебели с metadata.cover (включены, с коллизиями — как у floorAt), мир. AABB ≈ след. */
  private covers(feet: number): Covers {
    const c = this.cam.position, v = this.intent(), vl = Math.hypot(v.x, v.z);
    const out = this.cov;
    out.under = out.low = null;
    out.bottom = null;
    out.near = Infinity;
    out.toward = false;
    for (const m of this.scene.meshes) {
      const kind = (m.metadata as { cover?: unknown } | null | undefined)?.cover;
      if (kind !== 'bed' && kind !== 'table') continue;
      if (!m.checkCollisions || !m.isEnabled()) continue;
      const b = m.getBoundingInfo().boundingBox, mn = b.minimumWorld, mx = b.maximumWorld;
      const lo = mn.y - feet;
      if (lo < COVER_MIN || lo > COVER_MAX) continue;
      // к ближайшей точке следа (0 — над головой)
      const nx = Math.min(mx.x, Math.max(mn.x, c.x)) - c.x, nz = Math.min(mx.z, Math.max(mn.z, c.z)) - c.z;
      const dist = Math.hypot(nx, nz);
      if (dist === 0) {
        if (out.under !== 'bed') out.under = kind;
        if (out.bottom === null || lo < out.bottom) out.bottom = lo;
      }
      // низкое: верх четверенек под ним не проходит — лёжа
      if (lo <= FLAT_MIN || lo >= CRAWL_TOP + 0.01) continue;
      if (dist < out.near) out.near = dist;
      if (dist >= FLAT_NEAR) continue;
      const toward = dist > 0 && vl > 1e-4 && nx * v.x + nz * v.z > 0.5 * dist * vl;
      if (toward) out.toward = true;
      if ((dist === 0 || toward) && out.low !== 'bed') out.low = kind;
    }
    return out;
  }

  private frame() {
    if (!this.live()) {
      this.finish();
      this.hands?.update(0, 0, 0.016);
      return;
    }
    const dt = Math.min(0.1, this.scene.getEngine().getDeltaTime() / 1000 || 1 / 60);
    const c = this.cam.position;
    // ── укрытия: под чем игрок; на четвереньках у низкого — лечь, выполз — снова на четвереньки
    const cv = this.covers(c.y - this.eye);
    this.under = cv.under;
    if (this.pose === 'crawl') {
      if (!this.flat && cv.low) {
        this.flat = true;
        this.apply();
        if (!this.flatNoted && cv.low === 'bed') {
          this.flatNoted = true;
          this.onChange?.(this.pose, NOTE_FLAT);
        }
      } else if (this.flat && cv.near > FLAT_KEEP && !cv.toward && this.headroom(POSES.crawl.ell[0]) >= CRAWL_TOP + GAP) {
        this.flat = false;
        this.apply();
      }
    }
    const d = this.def();
    // ── глаз, эллипсоид, «шаг», скорость: вверх — подъём; вниз — глаз плавно (эллипсоид уже)
    if (this.rise) this.riseStep(this.rise, d, dt);
    else {
      this.base += (d.eye - this.base) * ease(dt, 7);
      // под плитой укрытия глаз — под ней (лёг, пока глаз ещё опускался)
      if (cv.bottom !== null) this.base = Math.max(d.eye, Math.min(this.base, cv.bottom - 0.05));
    }
    const rising = this.rise !== null;
    // ход: фаза — по пути
    const p = new Vector3(c.x, 0, c.z);
    const moved = this.last ? Vector3.Distance(p, this.last) : 0;
    this.last = p;
    const step = moved > 0.5 ? 0 : moved;
    this.phase += (step / CRAWL_CYCLE) * Math.PI * 2;
    // насколько ползком: по высоте глаза — при подъёме гаснет плавно; лёжа — вполсилы; стоя — к концу подъёма ноль
    const k = this.pose === 'crawl' || rising ? clamp01((1.0 - this.base) / 0.45) : 0;
    const amp = this.flat ? 0.5 : 1;
    const fade = this.pose !== 'stand' ? 1 : this.rise ? 1 - smooth(this.rise.t) : 0;
    const bobWant = fade * amp * (k * 0.03 * (Math.abs(Math.sin(this.phase)) - 0.5) + (1 - k) * 0.012 * Math.abs(Math.sin(this.phase * 0.8)));
    this.bob += (bobWant - this.bob) * ease(dt, 12);
    const eye = this.base + this.bob;
    c.y += eye - this.eye;
    this.eye = eye;
    // опора: стоя — гравитация Babylon; низко и пока встаёт — своя (ноги на пол по лучу вниз)
    const own = this.pose !== 'stand' || rising;
    this.cam.applyGravity = !own;
    if (own) {
      const floor = this.floorAt();
      const feet = c.y - eye;
      // пола под собой не видно (кусок ещё не собран, коллайдеры соседа не включены) — стоять, а не падать сквозь снег
      if (floor !== null) {
        const target = floor + 0.012;
        if (feet > target) c.y -= Math.min(feet - target, 3 * dt);
        else c.y += target - feet;
      }
    }
    this.cam.ellipsoidOffset.y = this.lift + 2 * this.cam.ellipsoid.y - eye;
    this.cam.speed = this.frozen ? 0 : this.speed * this.speedMul;
    // погреб: тело-эллипс по взгляду (радиусы x/z — поверх позы), боком — медленнее (src/view3d/cellarWalk.ts)
    this.shape(true);
    if (this.side) this.cam.speed *= SIDE_SPEED;
    // горизонт позой не кренится никогда (заказчик: крен плеч ползком читался как «горизонт ломается и заваливается»):
    // ход — только толчок вверх-вниз и руки; крен — лишь тряска обвала в снегу (roll)
    this.sway = 0;
    this.cam.rotation.z = this.sway + this.roll;
    if (k > 0.3 && !this.hands) this.hands = new CrawlHands(this.scene, this.cam);
    this.hands?.update(this.phase, this.frozen ? 0 : k, dt, this.flat);
  }

  /** Кадр подъёма: t += dt/RISE_S, всё — по smoothstep(t); верх эллипсоида не выше места над головой (иначе ждать и
   *  отходить от края; дольше RISE_HOLD — назад ниже); взгляд — к горизонту. */
  private riseStep(r: Rise, d: PoseDef, dt: number) {
    const top1 = d.lift + 2 * d.ell[1];
    const at = (t: number) => {
      const s = smooth(t);
      return { eye: lerp(r.eye, d.eye, s), top: lerp(r.top, top1, s), rad: lerp(r.rad, d.ell[0], s), lift: lerp(r.lift, d.lift, s), speed: lerp(r.speed, d.speed, s) };
    };
    let t = Math.min(1, r.t + dt / RISE_S);
    let st = at(t);
    let px = 0, pz = 0;
    if (top1 > r.top + 1e-4) {
      // середина — до верха; бока (на SIDE радиуса) — до поверхности эллипсоида там
      const h = (st.top - st.lift) / 2;
      const u = this.upRays(st.rad, st.lift + h * (1 - SIDE_Q));
      const side = st.lift + h * (1 + SIDE_Q);
      let ok = u[0] - GAP >= st.top;
      for (let i = 1; i < 5; i++) {
        if (u[i] - GAP >= side) continue;
        ok = false;
        // край сбоку (стол, тумба) — отойти от него
        px -= DIRS[i][0] * 0.05;
        pz -= DIRS[i][1] * 0.05;
      }
      if (ok) r.held = 0;
      else {
        t = r.t;
        st = at(t);
        r.held += dt;
      }
    }
    r.t = t;
    this.base = st.eye;
    this.lift = st.lift;
    this.speed = st.speed;
    // погреб: тело-эллипс снято — z к круглому от своего радиуса; тело действует — радиусы x/z ставит shape
    const rz = r.radZ === undefined ? st.rad : lerp(r.radZ, d.ell[2], smooth(t));
    this.cam.ellipsoid.set(st.rad, Math.max(0.05, (st.top - st.lift) / 2), rz);
    if (!this.frozen) this.pushOut(this.body ? 0.02 : Math.max(st.rad, rz), (st.top + st.lift) / 2, px, pz, dt);
    // взгляд — к горизонту (мышь работает: тянет обратно, пока встаёт); подъём «вширь» (погреб) взгляд не трогает
    const x = this.cam.rotation.x, lim = Math.max(-LEVEL_PITCH, Math.min(LEVEL_PITCH, x));
    if (!r.wide) this.cam.rotation.x = x + (lim - x) * ease(dt, 6);
    if (t >= 1) {
      this.rise = null;
      this.cam.ellipsoid.set(d.ell[0], d.ell[1], d.ell[2]);
      this.lift = d.lift;
      this.speed = d.speed;
      this.base = d.eye;
    } else if (r.held > RISE_HOLD) this.fallBack();
  }

  /** Подъём: эллипсоид растёт вширь — отойти от стен на сколько он «в» них (4 луча вбок от середины на высоте yc над
   *  ногами) + (px, pz) — от краёв сверху; не быстрее PUSH. */
  private pushOut(rad: number, yc: number, px: number, pz: number, dt: number) {
    const c = this.cam.position, y = c.y - this.eye + yc, ray = this.hray;
    for (let i = 1; i < 5; i++) {
      let best = rad;
      ray.origin.set(c.x, y, c.z);
      ray.direction.set(DIRS[i][0], 0, DIRS[i][1]);
      ray.length = rad;
      for (const m of this.scene.meshes) {
        if (!m.checkCollisions || !m.isEnabled()) continue;
        const b = m.getBoundingInfo().boundingBox;
        if (b.maximumWorld.y < y || b.minimumWorld.y > y) continue;
        if (c.x < b.minimumWorld.x - rad || c.x > b.maximumWorld.x + rad || c.z < b.minimumWorld.z - rad || c.z > b.maximumWorld.z + rad) continue;
        const hit = ray.intersectsMesh(m as Mesh, false);
        if (hit.hit && hit.distance < best) best = hit.distance;
      }
      px -= DIRS[i][0] * (rad - best);
      pz -= DIRS[i][1] * (rad - best);
    }
    const l = Math.hypot(px, pz);
    if (l < 1e-5) return;
    const k = Math.min(1, (PUSH * dt) / l);
    c.x += px * k;
    c.z += pz * k;
  }

  /** Подъём упёрся: назад ниже. Из «лёжа» на четвереньки — снова лёжа (сам, без надписи); иначе — скрючившись, если
   *  места хватает, или на четвереньки — «здесь не встать». */
  private fallBack() {
    this.rise = null;
    if (this.pose === 'crawl') {
      this.flat = true;
      this.apply();
      return;
    }
    this.set(this.pose === 'stand' && this.headroom() >= ROOM_CROUCH ? 'crouch' : 'crawl', NOTE_LOW);
  }

  dispose() {
    if (this.obs) this.scene.onBeforeRenderObservable.remove(this.obs);
    this.hands?.dispose();
    this.hands = null;
  }
}
