// Копии тел во «Фрактальной станции» (./sceneFractal.ts): «иногда видеть себя» и напарники.
//  • Своё тело — модель кооп-аватара (src/coop/avatarModel.ts, AvatarModels / AvatarBody) в соседних копиях k·P,
//    |k|∞ = 1 (дальше — туман): каждый кадр-через-кадр кандидаты — 26 сдвигов; в конусе камеры и в прямой видимости от
//    глаза (DDA по вокселям: твёрдость — solidAt, как у физики, плюс объём целых эскалаторов — ступени, балюстрады и
//    короба воксельной твёрдости не дают, а взгляд закрывают) до груди или головы копии;
//    ближайшие видимые получают тела из пула (≤ 4), прочие спрятаны. Копию k = 0 не рисуем (камера внутри).
//  • Чужая гравитация: AvatarBody.update ставит root в Y-up с yaw — делаем родителя-«кадр» (TransformNode) с поворотом
//    из базиса (right, up, fwd) тела и позицией ступней + k·P, а update зовём с канонической позой (x = z = 0, yaw 0).
//  • Копии чуть светятся (клон материала с emissive) — иначе в 76 м и в тумане их не заметить.
//  • LOOK «видеть себя»: у копии на поясе — фонарь (тёплый огонёк + ореол-билборд без тумана, размер ореола растёт с
//    дальностью — в 76 м пятно ~8 пикселей, вблизи не слепит); холодный контур по краям (френель emissive); туман на
//    копиях — своя мягкая кривая (./fractalFade.ts), а не туман сцены. Своего тела в кадре нет — огонёк виден только у копий.
//  • Напарники (fx 'frPos' — ./sceneFractal.ts): тело — ближайший образ напарника (сдвиг по модулю P к игроку),
//    сглаживание как в presence (экспонента, щелчок при скачке > 3 м) + до 2 его копий по той же видимости.
import type { Scene } from '@babylonjs/core/scene';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { FresnelParameters } from '@babylonjs/core/Materials/fresnelParameters';
import { Constants } from '@babylonjs/core/Engines/constants';
import type { Material } from '@babylonjs/core/Materials/material';
import type { Texture } from '@babylonjs/core/Materials/Textures/texture';
import { AvatarModels, EYE_STAND, type AvatarBody } from '../coop/avatarModel';
import { AXIS_VEC, FRAME, type Axis6, type V3 } from './fractalAxes';
import { isEscVx, solidAt, vidx, VX, type FractalCell } from './fractalCell';
import { FrFadePlugin } from './fractalFade';
import { haloTexture } from './fractalFinish';

/** Сдвиги соседних копий (26). */
export const SHIFTS: readonly V3[] = (() => {
  const out: V3[] = [];
  for (let x = -1; x <= 1; x++) for (let y = -1; y <= 1; y++) for (let z = -1; z <= 1; z++) if (x || y || z) out.push([x, y, z]);
  return out;
})();

const SELF_MAX = 4;
const MATE_COPIES = 2;
/** Дальше — не искать (диагональ куба копий √3·54 ≈ 94 м). */
const SEE_MAX = 100;
/** Конус камеры для копий: косинус половины угла (диагональ кадра ~55° + запас). */
const SEE_COS = Math.cos((62 * Math.PI) / 180);
/** Грудь и голова над ступнями, м. */
const CHEST = 1.2;
const HEAD = 1.62;
/** Самоподсветка копий. */
const GLOW = 0.18;
/** Фонарь на поясе копии (в кадре тела: вправо, вверх, вперёд), м; ореол — м на метр дальности, пределы, м. */
const LANTERN: V3 = [0.3, 0.95, 0.12];
const HALO_K = 0.03;
const HALO_MIN = 0.3;
const HALO_MAX = 3.2;
export const LANTERN_COLOR = new Color3(1, 0.78, 0.45);

/** Поза тела в координатах ячейки игрока. */
export interface FrPose {
  feet: V3;
  up: V3;
  /** взгляд в плоскости пола (единичный, ⊥ up) */
  fwd: V3;
  pitch: number;
  speed: number;
}

/** Взгляд в плоскости пола по кадру up и yaw (как физика: yaw от FRAME[up].fwd к FRAME[up].right). */
export function yawFwd(up: Axis6, yaw: number): V3 {
  const f = AXIS_VEC[FRAME[up].fwd], r = AXIS_VEC[FRAME[up].right];
  const c = Math.cos(yaw), s = Math.sin(yaw);
  return [f[0] * c + r[0] * s, f[1] * c + r[1] * s, f[2] * c + r[2] * s];
}

/** Воксели объёма эскалатора e для маски взгляда — короб от низа подложки до верха балюстрады во всю ширину, от начала
 *  балюстрады до её конца (индексы vidx, с повторами). */
function escSightVox(cell: FractalCell, e: FractalCell['esc'][number], put: (v: number) => void): void {
  const P = cell.P;
  const tan = Math.tan(Math.PI / 6);
  const w = (v: number) => ((Math.floor(v) % P) + P) % P;
  const u = AXIS_VEC[e.up], f = AXIS_VEC[e.fwd];
  const r: V3 = [u[1] * f[2] - u[2] * f[1], u[2] * f[0] - u[0] * f[2], u[0] * f[1] - u[1] * f[0]];
  for (let s = -0.9; s <= e.run + 0.6; s += 0.25) {
    const h0 = Math.min(e.run, Math.max(0, s)) * tan;
    for (let b = -e.width / 2; b <= e.width / 2 + 1e-6; b += 0.25) {
      // короб по бокам — от низа подложки (не ниже пола) до настила (fractalView: SKIRT_LOW, DECK_TOP)
      for (let h = Math.max(0.05, h0 - 3.45); h <= h0 + 0.97; h += 0.25) {
        const x = e.o[0] + r[0] * b + u[0] * h + f[0] * s;
        const y = e.o[1] + r[1] * b + u[1] * h + f[1] * s;
        const z = e.o[2] + r[2] * b + u[2] * h + f[2] * s;
        put(vidx(P, w(x), w(y), w(z)));
      }
    }
  }
}

/** Маска заслонов взгляда (P³): твёрдое (solidAt) и объём целых эскалаторов (escSightVox). Полная сборка — эталон
 *  для SightMask (тесты); в кадре — SightMask. */
export function sightMask(cell: FractalCell, broken?: ReadonlySet<number>): Uint8Array {
  const P = cell.P;
  const m = new Uint8Array(P * P * P);
  for (let z = 0; z < P; z++) for (let y = 0; y < P; y++) for (let x = 0; x < P; x++) if (solidAt(cell, x, y, z, broken)) m[vidx(P, x, y, z)] = 1;
  for (const e of cell.esc) {
    if (broken?.has(e.i)) continue;
    escSightVox(cell, e, (v) => (m[v] = 1));
  }
  return m;
}

/** Маска заслонов взгляда с правкой по срывам: та же, что sightMask(cell, broken), но срыв эскалатора i снимает только
 *  его объём (короб и подложку) — без пересборки P³ (было 27–33 мс в кадре срыва). cover — сколько целых эскалаторов
 *  закрывают воксель (короба соседних перекрываются). Сломанные в игре только прибавляются (fractalEsc: broken.add) —
 *  проверка в кадре по числу (без аллокаций); убыль — полная пересборка. ver — +1 на каждую правку (ключ кэшей). */
export class SightMask {
  readonly m: Uint8Array;
  ver = 0;
  private readonly cover: Uint8Array;
  /** воксели короба эскалатора (по e.i, без повторов) */
  private readonly box: Int32Array[] = [];
  /** воксели подложки эскалатора (VX.ESC0 + i) */
  private readonly band: Int32Array[] = [];
  /** сломанные, уже снятые с маски */
  private readonly applied = new Set<number>();

  constructor(
    private readonly cell: FractalCell,
    broken?: ReadonlySet<number>,
  ) {
    const P = cell.P, n = P * P * P, vox = cell.vox;
    this.m = new Uint8Array(n);
    this.cover = new Uint8Array(n);
    const bands: number[][] = [];
    for (let v = 0; v < n; v++) {
      const c = vox[v];
      if (c === VX.AIR) continue;
      this.m[v] = 1;
      if (isEscVx(c)) (bands[c - VX.ESC0] ??= []).push(v);
    }
    const stamp = new Int32Array(n).fill(-1);
    for (const e of cell.esc) {
      const list: number[] = [];
      escSightVox(cell, e, (v) => {
        if (stamp[v] === e.i) return;
        stamp[v] = e.i;
        list.push(v);
      });
      this.box[e.i] = Int32Array.from(list);
      this.band[e.i] = Int32Array.from(bands[e.i] ?? []);
      for (const v of list) {
        this.cover[v]++;
        this.m[v] = 1;
      }
    }
    if (broken) this.sync(broken);
  }

  /** Привести к набору сломанных. Без перемен — O(1), без аллокаций. */
  sync(broken: ReadonlySet<number>): void {
    if (broken.size === this.applied.size) return;
    if (broken.size < this.applied.size) {
      this.rebuild(broken);
      return;
    }
    for (const i of broken) if (!this.applied.has(i)) this.drop(i);
  }

  /** Эскалатор i сорвался: его короб и подложка больше не заслоняют (кроме вокселей, что закрывает другой целый). */
  private drop(i: number): void {
    this.applied.add(i);
    this.ver++;
    const box = this.box[i], band = this.band[i], vox = this.cell.vox, m = this.m, cover = this.cover;
    if (!box) return;
    for (let j = 0; j < box.length; j++) cover[box[j]]--;
    for (let j = 0; j < box.length; j++) {
      const v = box[j], c = vox[v];
      const solid = c !== VX.AIR && (!isEscVx(c) || !this.applied.has(c - VX.ESC0));
      m[v] = solid || cover[v] > 0 ? 1 : 0;
    }
    for (let j = 0; j < band.length; j++) m[band[j]] = cover[band[j]] > 0 ? 1 : 0;
  }

  private rebuild(broken: ReadonlySet<number>): void {
    const full = sightMask(this.cell, broken);
    this.m.set(full);
    this.cover.fill(0);
    for (const e of this.cell.esc) {
      if (broken.has(e.i)) continue;
      const box = this.box[e.i];
      for (let j = 0; j < box.length; j++) this.cover[box[j]]++;
    }
    this.applied.clear();
    for (const i of broken) this.applied.add(i);
    this.ver++;
  }
}

/** Прямая видимость от a до b (м, координаты ячейки; мир периодичен): DDA по вокселям, твёрдость — solidAt (или маска
 *  sightMask, если дана). Воксели a и b не проверяются. */
export function lineOfSight(cell: FractalCell, a: V3, b: V3, broken?: ReadonlySet<number>, mask?: Uint8Array): boolean {
  const P = cell.P;
  const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2];
  let x = Math.floor(a[0]), y = Math.floor(a[1]), z = Math.floor(a[2]);
  const ex = Math.floor(b[0]), ey = Math.floor(b[1]), ez = Math.floor(b[2]);
  const sx = dx > 0 ? 1 : -1, sy = dy > 0 ? 1 : -1, sz = dz > 0 ? 1 : -1;
  const tdx = dx !== 0 ? Math.abs(1 / dx) : Infinity, tdy = dy !== 0 ? Math.abs(1 / dy) : Infinity, tdz = dz !== 0 ? Math.abs(1 / dz) : Infinity;
  let tx = dx !== 0 ? (dx > 0 ? x + 1 - a[0] : a[0] - x) * tdx : Infinity;
  let ty = dy !== 0 ? (dy > 0 ? y + 1 - a[1] : a[1] - y) * tdy : Infinity;
  let tz = dz !== 0 ? (dz > 0 ? z + 1 - a[2] : a[2] - z) * tdz : Infinity;
  const n = Math.abs(ex - x) + Math.abs(ey - y) + Math.abs(ez - z);
  for (let i = 0; i < n; i++) {
    if (tx <= ty && tx <= tz) {
      x += sx;
      tx += tdx;
    } else if (ty <= tz) {
      y += sy;
      ty += tdy;
    } else {
      z += sz;
      tz += tdz;
    }
    if (x === ex && y === ey && z === ez) return true;
    if (mask ? mask[vidx(P, ((x % P) + P) % P, ((y % P) + P) % P, ((z % P) + P) % P)] : solidAt(cell, x, y, z, broken)) return false;
  }
  return true;
}

/** Ближайший образ точки p (сдвиг на кратное P) к точке o. */
export function nearestImage(p: V3, o: V3, P: number): V3 {
  const w = (v: number, c: number) => v - P * Math.round((v - c) / P);
  return [w(p[0], o[0]), w(p[1], o[1]), w(p[2], o[2])];
}

/** Запас к полупериоду, м: на границе образ не дёргается туда-сюда. */
const MATE_HYST = 2;

/** Образ напарника для его тела: ближайший к МОИМ ступням. Прежний (ближайший к прошлой сглаженной позе prev) держится,
 *  пока он не дальше P/2 + MATE_HYST от моих ступней по каждой оси — без дрожи на границе полупериода. Раньше брался
 *  только ближайший к прошлой позе: напарник, уходящий в одну сторону, уползал на 2P и пропадал в тумане. */
export function mateImage(feet: V3, prev: V3 | null, myFeet: V3, P: number): V3 {
  const img = nearestImage(feet, myFeet, P);
  if (!prev) return img;
  const keep = nearestImage(img, prev, P);
  const lim = P / 2 + MATE_HYST;
  for (let a = 0; a < 3; a++) if (Math.abs(keep[a] - myFeet[a]) > lim) return img;
  return keep;
}

/** Материалы фонаря копий (общие на все тела). */
interface LampMats {
  core: StandardMaterial;
  halo: StandardMaterial;
}

/** Тело с кадром (родитель root аватара) и фонарём на поясе. */
class Holder {
  readonly frame: TransformNode;
  readonly q = new Quaternion();
  private readonly r = new Vector3();
  private readonly u = new Vector3();
  private readonly f = new Vector3();
  private readonly lamp: Mesh;
  private readonly halo: Mesh;
  private on = false;
  constructor(
    scene: Scene,
    readonly body: AvatarBody,
    name: string,
    mats: LampMats,
  ) {
    this.frame = new TransformNode(name, scene);
    this.frame.rotationQuaternion = Quaternion.Identity();
    body.root.parent = this.frame;
    // фонарь: огонёк (чистый эмиссив) и ореол-билборд (сложение, без записи глубины, без тумана сцены)
    this.lamp = MeshBuilder.CreateSphere(`${name}:lamp`, { diameter: 0.13, segments: 4 }, scene);
    this.lamp.material = mats.core;
    this.halo = MeshBuilder.CreatePlane(`${name}:halo`, { size: 1 }, scene);
    this.halo.material = mats.halo;
    this.halo.billboardMode = Mesh.BILLBOARDMODE_ALL;
    // огонёк — ребёнок кадра; ореол — без родителя: билборд Babylon не берёт поворот родителя (в чужой гравитации ореол
    // оказывался по другую сторону ступней — в камне), его точка считается в place()
    this.lamp.parent = this.frame;
    this.lamp.position.set(LANTERN[0], LANTERN[1], LANTERN[2]);
    for (const m of [this.lamp, this.halo]) {
      m.isPickable = false;
      m.applyFog = false;
      m.setEnabled(false);
    }
  }

  show(on: boolean) {
    this.body.setEnabled(on);
    if (on !== this.on) {
      this.on = on;
      this.lamp.setEnabled(on);
      this.halo.setEnabled(on);
    }
  }

  /** Поставить: ступни (м), базис, наклон головы, скорость; eye — глаз камеры (размер ореола по дальности). */
  place(feet: V3, up: V3, fwd: V3, pitch: number, speed: number, eye?: V3) {
    this.u.set(up[0], up[1], up[2]);
    this.f.set(fwd[0], fwd[1], fwd[2]);
    Vector3.CrossToRef(this.u, this.f, this.r);
    Quaternion.RotationQuaternionFromAxisToRef(this.r, this.u, this.f, this.q);
    this.frame.rotationQuaternion!.copyFrom(this.q);
    this.frame.position.set(feet[0], feet[1], feet[2]);
    this.frame.computeWorldMatrix(true);
    this.body.update({ x: 0, y: EYE_STAND, z: 0, eye: EYE_STAND, yaw: 0, pitch, speed });
    const r = this.r, u = this.u, f = this.f, L = LANTERN;
    this.halo.position.set(feet[0] + r.x * L[0] + u.x * L[1] + f.x * L[2], feet[1] + r.y * L[0] + u.y * L[1] + f.y * L[2], feet[2] + r.z * L[0] + u.z * L[1] + f.z * L[2]);
    if (eye) {
      const d = Math.hypot(feet[0] - eye[0], feet[1] - eye[1], feet[2] - eye[2]);
      this.halo.scaling.setAll(Math.min(HALO_MAX, Math.max(HALO_MIN, HALO_K * d)));
    }
  }

  dispose() {
    this.lamp.dispose(false, false);
    this.halo.dispose(false, false);
    this.body.dispose();
    this.frame.dispose(false, false);
  }
}

interface MateState {
  id: string;
  slot?: number;
  /** поза в координатах МОЕЙ ячейки (уже ближайший образ), сглаженная */
  feet: V3;
  up: V3;
  fwd: V3;
  pitch: number;
  speed: number;
  /** цель от последнего пакета */
  tFeet: V3;
  tUp: V3;
  tFwd: V3;
  last: number;
  bodies: Holder[];
  /** показанные сдвиги (первый — сам) */
  shifts: V3[] | null;
  seen: number;
}

export class FractalCopies {
  readonly models: AvatarModels;
  /** сколько своих копий сейчас видно */
  selfSeen = 0;
  /** сдвиги видимых своих копий (QA) */
  selfShifts: V3[] = [];
  private self: Holder[] = [];
  private mates = new Map<string, MateState>();
  private glow = new Map<Material, StandardMaterial>();
  /** заслоны взгляда: собраны раз, срывы снимают объём сорвавшегося */
  private readonly sight: SightMask;
  private frame = 0;
  private time = 0;
  private disposed = false;

  private readonly lampMats: LampMats;
  private readonly haloTex: Texture;

  constructor(
    private readonly scene: Scene,
    private readonly cell: FractalCell,
    private readonly slot: number | undefined,
  ) {
    this.models = new AvatarModels(scene);
    this.sight = new SightMask(cell);
    // фонарь копий: огонёк и ореол (сложение цвета, альфа — из текстуры)
    const core = new StandardMaterial('fr:copyLamp', scene);
    core.disableLighting = true;
    core.diffuseColor = Color3.Black();
    core.specularColor = Color3.Black();
    core.emissiveColor = new Color3(1, 0.9, 0.7);
    const halo = new StandardMaterial('fr:copyHalo', scene);
    this.haloTex = haloTexture(scene, 'fr:copyHaloTex');
    halo.disableLighting = true;
    halo.diffuseColor = Color3.Black();
    halo.specularColor = Color3.Black();
    // цвет — emissiveColor, форма — альфа текстуры (emissiveTexture сложилась бы с цветом в белое)
    halo.emissiveColor = LANTERN_COLOR.clone();
    halo.opacityTexture = this.haloTex;
    halo.alphaMode = Constants.ALPHA_ADD;
    halo.disableDepthWrite = true;
    halo.backFaceCulling = false;
    this.lampMats = { core, halo };
  }

  get loaded(): Promise<void> {
    return this.models.loaded;
  }

  /** Клон материала со свечением (на материал набора — один). */
  private lit(b: AvatarBody) {
    for (const m of b.meshes) {
      const src = m.material;
      if (!src) continue;
      let g = this.glow.get(src);
      if (!g) {
        g = (src as StandardMaterial).clone(`${src.name}:fr`) as StandardMaterial;
        const d = (src as StandardMaterial).diffuseColor ?? Color3.Gray();
        g.emissiveColor = d.scale(0.45).add(new Color3(GLOW, GLOW, GLOW));
        // LOOK: холодный контур по краям силуэта (френель Babylon УМНОЖАЕТ emissive: leftColor — края, rightColor —
        // середина) — копия отделяется от камня и в 76 м
        g.emissiveFresnelParameters = new FresnelParameters({ leftColor: new Color3(2.4, 2.9, 3.8), rightColor: Color3.White(), bias: 0.1, power: 1.5 });
        // туман сцены копию съедал (в 76 м — на 50–65 %): своя кривая — до 40 м без спада, дальше мягко
        const fp = new FrFadePlugin(g);
        fp.fade.set(40, 260, 0, 0);
        this.glow.set(src, g);
      }
      m.material = g;
    }
  }

  private make(id: string, slot: number | undefined): Holder | null {
    const b = this.models.make(id, slot);
    if (!b) return null;
    this.lit(b);
    for (const m of b.meshes) m.applyFog = false;
    return new Holder(this.scene, b, `fr:copy:${id}`, this.lampMats);
  }

  /** Прямая видимость с заслонами (твёрдое и эскалаторы); срыв снимает с маски только объём сорвавшегося (SightMask).
   *  Без аллокаций (маска собрана в конструкторе). */
  los(a: V3, b: V3, broken: ReadonlySet<number>): boolean {
    this.sight.sync(broken);
    return lineOfSight(this.cell, a, b, broken, this.sight.m);
  }

  /** Версия маски взгляда (+1 на каждый снятый срыв) — QA. */
  get sightVer(): number {
    return this.sight.ver;
  }

  /** Видимые копии позы (сдвиги из SHIFTS, плюс k = 0 при with0): по расстоянию, ≤ max. */
  private visible(pose: { feet: V3; up: V3 }, eye: V3, camFwd: V3, broken: ReadonlySet<number>, max: number, with0: boolean): V3[] {
    const P = this.cell.P;
    const hits: { k: V3; d: number }[] = [];
    const ks = with0 ? [[0, 0, 0] as V3, ...SHIFTS] : SHIFTS;
    for (const k of ks) {
      const base: V3 = [pose.feet[0] + k[0] * P, pose.feet[1] + k[1] * P, pose.feet[2] + k[2] * P];
      let ok = false, dist = 0;
      for (const hgt of [CHEST, HEAD]) {
        const t: V3 = [base[0] + pose.up[0] * hgt, base[1] + pose.up[1] * hgt, base[2] + pose.up[2] * hgt];
        const dx = t[0] - eye[0], dy = t[1] - eye[1], dz = t[2] - eye[2];
        dist = Math.hypot(dx, dy, dz);
        if (dist > SEE_MAX || dist < 0.5) break;
        if ((dx * camFwd[0] + dy * camFwd[1] + dz * camFwd[2]) / dist < SEE_COS) break;
        if (this.los(eye, t, broken)) {
          ok = true;
          break;
        }
      }
      if (ok) hits.push({ k, d: dist });
    }
    hits.sort((a, b) => a.d - b.d);
    return hits.slice(0, max).map((h) => h.k);
  }

  /** Пакет напарника: поза уже переведена в координаты моей ячейки (feet — любой образ). */
  mate(id: string, slot: number | undefined, feet: V3, up: V3, fwd: V3, pitch: number, speed: number, myFeet: V3) {
    const P = this.cell.P;
    let m = this.mates.get(id);
    const img = mateImage(feet, m ? m.feet : null, myFeet, P);
    if (!m) {
      m = { id, slot, feet: [...img], up: [...up], fwd: [...fwd], pitch, speed, tFeet: img, tUp: up, tFwd: fwd, last: this.time, bodies: [], shifts: null, seen: 0 };
      this.mates.set(id, m);
    }
    // образ — у моих ступней (mateImage); перескочил дальше 3 м (обёртка, граница полупериода) — щелчок
    m.tFeet = img;
    m.tUp = up;
    m.tFwd = fwd;
    m.pitch = pitch;
    m.speed = speed;
    m.slot = slot;
    m.last = this.time;
    if (Math.hypot(img[0] - m.feet[0], img[1] - m.feet[1], img[2] - m.feet[2]) > 3) {
      m.feet = [...img];
      m.up = [...up];
      m.fwd = [...fwd];
    }
  }

  /** Я обернулся на d (ячейки): позы напарников — в новые координаты. */
  shift(d: V3) {
    const P = this.cell.P;
    for (const m of this.mates.values()) {
      for (const p of [m.feet, m.tFeet]) {
        p[0] -= d[0] * P;
        p[1] -= d[1] * P;
        p[2] -= d[2] * P;
      }
    }
  }

  removeMate(id: string) {
    const m = this.mates.get(id);
    if (!m) return;
    for (const b of m.bodies) b.dispose();
    this.mates.delete(id);
  }

  get mateCount(): number {
    return this.mates.size;
  }

  /** Кадр: свои копии и напарники. eye — глаз игрока, camFwd — взгляд (единичный), координаты ячейки. */
  update(dt: number, me: FrPose, eye: V3, camFwd: V3, broken: ReadonlySet<number>) {
    if (this.disposed || !this.models.ready) return;
    this.time += dt;
    this.frame++;
    const P = this.cell.P;
    // свои: видимость — через кадр (≤ 52 луча по ≤ 100 м)
    if (this.frame % 2 === 0 || this.selfShifts.length !== this.selfSeen) this.selfShifts = this.visible(me, eye, camFwd, broken, SELF_MAX, false);
    this.selfSeen = this.selfShifts.length;
    while (this.self.length < this.selfSeen) {
      const h = this.make(`self:${this.self.length}`, this.slot);
      if (!h) break;
      this.self.push(h);
    }
    this.self.forEach((h, i) => {
      const k = this.selfShifts[i];
      h.show(!!k);
      if (k) h.place([me.feet[0] + k[0] * P, me.feet[1] + k[1] * P, me.feet[2] + k[2] * P], me.up, me.fwd, me.pitch, me.speed, eye);
    });
    // напарники: 2 с без пакетов — прочь
    const kk = 1 - Math.exp(-dt * 10);
    for (const m of [...this.mates.values()]) {
      if (this.time - m.last > 2) {
        this.removeMate(m.id);
        continue;
      }
      for (let a = 0; a < 3; a++) {
        m.feet[a] += (m.tFeet[a] - m.feet[a]) * kk;
        m.up[a] += (m.tUp[a] - m.up[a]) * kk;
        m.fwd[a] += (m.tFwd[a] - m.fwd[a]) * kk;
      }
      const up = norm(m.up), fwd = norm(orth(m.fwd, up));
      // сам напарник (ближайший образ) — всегда; его копии — по видимости, через кадр
      if (this.frame % 2 === 0 || !m.shifts) m.shifts = [[0, 0, 0], ...this.visible({ feet: m.feet, up }, eye, camFwd, broken, MATE_COPIES, false)];
      const shown = m.shifts;
      m.seen = shown.length - 1;
      while (m.bodies.length < shown.length) {
        const h = this.make(`mate:${m.id}:${m.bodies.length}`, m.slot);
        if (!h) break;
        m.bodies.push(h);
      }
      m.bodies.forEach((h, i) => {
        const k = shown[i];
        h.show(!!k);
        if (k) h.place([m.feet[0] + k[0] * P, m.feet[1] + k[1] * P, m.feet[2] + k[2] * P], up, fwd, m.pitch, m.speed, eye);
      });
    }
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    for (const h of this.self) h.dispose();
    for (const m of this.mates.values()) for (const b of m.bodies) b.dispose();
    this.self = [];
    this.mates.clear();
    for (const g of this.glow.values()) g.dispose();
    this.glow.clear();
    this.lampMats.core.dispose();
    this.lampMats.halo.dispose();
    this.haloTex.dispose();
    this.models.dispose();
  }
}

const norm = (v: V3): V3 => {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
};
/** v без составляющей вдоль единичного u. */
const orth = (v: V3, u: V3): V3 => {
  const d = v[0] * u[0] + v[1] * u[1] + v[2] * u[2];
  const r: V3 = [v[0] - u[0] * d, v[1] - u[1] * d, v[2] - u[2] * d];
  return Math.hypot(r[0], r[1], r[2]) < 1e-4 ? (Math.abs(u[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0]) : r;
};
