// Подвижные части моделей предметов («всё крутится» на заводе): шестерни, маховики, валы, вентиляторы, ролики
// конвейера, пресс, дверца печи, ковш, таль, поршень насоса, поворотный круг, шлагбаум, вентиль, капли из трубы.
//
//  • Ассет (tools/optimize-factory.mjs): у узла предмета дочерние узлы `<id>:<k>` — подвижные части в позе покоя, в
//    extras.anim — движение относительно покоя (система предмета, glTF): равномерное вращение { spin, pivot, turns,
//    period } или выборки { period, n, p, q, s? } за период (линейно / сферически, по кругу).
//  • src/view3d/propModels.ts сливает подвижную часть в свой шаблон — ребёнок шаблона предмета с именем
//    `rotor:<id>:<k>` (покой = единичная трансформация) — и отдаёт движения (motions).
//  • Болванка (src/blockout/babylon.ts) клонирует шаблон с детьми: клон части — `<клон предмета>.rotor:<id>:<k>`.
//    PropAnimator ловит такие меши при добавлении в сцену и каждый кадр ставит им позу; кусок комнаты портального
//    рендера заморожен (freezeWorldMatrix) — матрица части перезамораживается.
//  • Фаза — по имени клона предмета: части одного предмета (пара шестерён) крутятся согласованно, соседние предметы —
//    вразнобой.
//
// glTF → Babylon: загрузчик отражает ось x (корень: поворот 180° вокруг Y и масштаб z −1 ⇒ (x, y, z) → (−x, y, z)).
// Движение D = [R | p] в Babylon — F·D·F, F = diag(−1, 1, 1): кватернион (x, y, z, w) → (x, −y, −z, w), перенос
// (x, y, z) → (−x, y, z); ось вращения (ax, ay, az) → (−ax, ay, az) с углом −θ.
import { Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector';
import type { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh';
import type { Observer } from '@babylonjs/core/Misc/observable';
import type { Scene } from '@babylonjs/core/scene';

/** Движение из extras.anim (glTF, система предмета). */
export type PropMotion =
  | { spin: [number, number, number]; pivot: [number, number, number]; turns: number; period: number }
  | { period: number; n: number; p: number[]; q: number[]; s?: number[] };

/** Движение в системе Babylon. */
export type BabylonMotion =
  | { kind: 'spin'; axis: Vector3; pivot: Vector3; rate: number; period: number }
  | { kind: 'keys'; period: number; n: number; p: Vector3[]; q: Quaternion[]; s: Vector3[] | null };

const fin = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const nums = (v: unknown, len: number): v is number[] => Array.isArray(v) && v.length >= len && v.slice(0, len).every(fin);

/** Разбор extras.anim (мусор — null) и перевод в Babylon. */
export function babylonMotion(v: unknown): BabylonMotion | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  const period = fin(o.period) && o.period > 0 ? o.period : 0;
  if (!period) return null;
  if (nums(o.spin, 3) && nums(o.pivot, 3) && fin(o.turns)) {
    const a = new Vector3(-o.spin[0], o.spin[1], o.spin[2]);
    if (a.length() < 1e-9) return null;
    // угол в glTF +θ вокруг a — в Babylon −θ вокруг F·a
    return { kind: 'spin', axis: a.normalize(), pivot: new Vector3(-o.pivot[0], o.pivot[1], o.pivot[2]), rate: (-2 * Math.PI * o.turns) / period, period };
  }
  const n = fin(o.n) ? Math.floor(o.n) : 0;
  if (n < 1 || !nums(o.p, n * 3) || !nums(o.q, n * 4)) return null;
  const s = nums(o.s, n * 3) ? o.s : null;
  const P: Vector3[] = [], Q: Quaternion[] = [], S: Vector3[] = [];
  for (let k = 0; k < n; k++) {
    P.push(new Vector3(-o.p[k * 3], o.p[k * 3 + 1], o.p[k * 3 + 2]));
    Q.push(new Quaternion(o.q[k * 4], -o.q[k * 4 + 1], -o.q[k * 4 + 2], o.q[k * 4 + 3]).normalize());
    if (s) S.push(new Vector3(s[k * 3], s[k * 3 + 1], s[k * 3 + 2]));
  }
  return { kind: 'keys', period, n, p: P, q: Q, s: s ? S : null };
}

const tmpV = new Vector3();

/** Поза части в момент t (с): перенос, поворот, масштаб — относительно покоя (в системе шаблона). */
export function motionPose(m: BabylonMotion, t: number, pos: Vector3, rot: Quaternion, scl: Vector3): void {
  if (m.kind === 'spin') {
    // вращение вокруг оси через pivot: x → R·(x − c) + c, т. е. перенос c − R·c
    const ang = (m.rate * t) % (2 * Math.PI);
    Quaternion.RotationAxisToRef(m.axis, ang, rot);
    m.pivot.rotateByQuaternionToRef(rot, tmpV);
    pos.copyFrom(m.pivot).subtractInPlace(tmpV);
    scl.setAll(1);
    return;
  }
  const u = ((((t / m.period) % 1) + 1) % 1) * m.n;
  const a = Math.floor(u) % m.n, b = (a + 1) % m.n, f = u - Math.floor(u);
  Vector3.LerpToRef(m.p[a], m.p[b], f, pos);
  Quaternion.SlerpToRef(m.q[a], m.q[b], f, rot);
  if (m.s) Vector3.LerpToRef(m.s[a], m.s[b], f, scl);
  else scl.setAll(1);
}

/** Признак клона подвижной части в имени меша. */
export const ROTOR_MARK = 'rotor:';

/** Фаза предмета по имени его клона, с: 0…period. */
export function phaseOf(name: string, period: number): number {
  let h = 2166136261;
  for (let i = 0; i < name.length; i++) h = Math.imul(h ^ name.charCodeAt(i), 16777619);
  return ((h >>> 0) / 4294967296) * period;
}

interface Rotor {
  mesh: AbstractMesh;
  motion: BabylonMotion;
  phase: number;
}

/**
 * Крутит клоны подвижных частей сцены: меш с именем `….rotor:<id>:<k>` (или сам шаблон-ребёнок не трогается — он
 * выключен вместе с шаблоном). motions — по ключу `rotor:<id>:<k>`.
 */
export class PropAnimator {
  private readonly list: Rotor[] = [];
  private readonly add: Observer<AbstractMesh>;
  private readonly tick: Observer<Scene>;
  /** скорость времени (0 — стоп) */
  speed = 1;
  private t = 0;
  private last = performance.now();

  constructor(private readonly scene: Scene, private readonly motions: Map<string, BabylonMotion>) {
    this.add = scene.onNewMeshAddedObservable.add((m) => this.track(m));
    this.tick = scene.onBeforeRenderObservable.add(() => this.update());
    for (const m of scene.meshes) this.track(m);
  }

  get count(): number {
    return this.list.length;
  }

  private track(m: AbstractMesh) {
    const i = m.name.lastIndexOf('.' + ROTOR_MARK);
    if (i < 0) return;
    const motion = this.motions.get(m.name.slice(i + 1));
    if (!motion) return;
    this.list.push({ mesh: m, motion, phase: phaseOf(m.name.slice(0, i), motion.period) });
  }

  private update() {
    const now = performance.now();
    this.t += ((now - this.last) / 1000) * this.speed;
    this.last = now;
    const L = this.list;
    for (let i = L.length - 1; i >= 0; i--) {
      const r = L[i];
      if (r.mesh.isDisposed()) {
        L[i] = L[L.length - 1];
        L.pop();
        continue;
      }
      if (!r.mesh.isEnabled()) continue;
      // клон получает поворот шаблона (null) уже после добавления в сцену — кватернион заводим здесь
      const q = r.mesh.rotationQuaternion ?? (r.mesh.rotationQuaternion = new Quaternion());
      motionPose(r.motion, this.t + r.phase, r.mesh.position, q, r.mesh.scaling);
      if (r.mesh.isWorldMatrixFrozen) r.mesh.freezeWorldMatrix();
    }
  }

  /** Время аниматора, с. */
  get time(): number {
    return this.t;
  }

  dispose() {
    this.scene.onNewMeshAddedObservable.remove(this.add);
    this.scene.onBeforeRenderObservable.remove(this.tick);
    this.list.length = 0;
  }
}

/** Для тестов: поза в виде чисел. */
export function poseNumbers(m: BabylonMotion, t: number): { p: number[]; q: number[]; s: number[] } {
  const p = new Vector3(), q = new Quaternion(), s = new Vector3();
  motionPose(m, t, p, q, s);
  return { p: p.asArray(), q: q.asArray(), s: s.asArray() };
}
