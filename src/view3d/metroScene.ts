// «Метро» в «Прогулке»: эскалаторный тоннель — то, что рисуется (логика — ./metroWalk.ts, механика —
// src/locations/metroEscalator.ts). Блокаут у марша стиля 'escalator' рисует только пандус, опору и коллайдеры перил
// (src/blockout/stairs.ts) — всё видимое здесь:
//  • бегущая лента ступеней каждой дорожки: цепь ступеней по линии носков марша (опора игрока — та же линия), сдвиг на
//    шаг ступени по кругу; концы ленты — под гребёнками (металлические плиты с жёлтой кромкой);
//  • балюстрады: панели по бокам дорожек (низ — сталь, верх — дерево), чёрные поручни, настилы между дорожками и у стен,
//    на настилах между дорожками — торшеры (бронзовая стойка, матовый светящийся плафон);
//  • наклонный свод тоннеля (тюбинги — текстурой): ровный над площадками, наклонный над маршами;
//  • срыв: лента сползает в приямок (верх — с верхней площадки на дно, низ — к нижней, slidePose), пыль; торшеры у неё
//    мигают (своим материалом); сломанная дорожка — обугленные обломки на дне (и невидимый коллайдер: по завалу не пройти).
// Всё — свои меши комнаты в портальном рендере (PortalRenderer.extraProviders, слой PORTAL_LAYER), в системе тоннеля:
// узел на экземпляр (поворот по стороне подъёма), у каждой дорожки — свой узел (сползание).
import type { Scene } from '@babylonjs/core/scene';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import { VertexBuffer } from '@babylonjs/core/Buffers/buffer';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture';
import { Texture } from '@babylonjs/core/Materials/Textures/texture';
import { Color3, Color4 } from '@babylonjs/core/Maths/math.color';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { ParticleSystem } from '@babylonjs/core/Particles/particleSystem';
import '@babylonjs/core/Particles/particleSystemComponent';
import type { RunInstance, Side } from '../blockout/types';
import { StairBatch } from '../blockout/stairs';
import { hashSeed } from '../model/rng';
import { laneStep, slidePose, slopeLen, UP_VEC, type EscLane } from '../locations/metroEscalator';
import { hash01 } from '../locations/stairLoop';
import { puffTexture } from '../locations/liftTextures';
import { PORTAL_LAYER } from './portal';

/** Свет сцены в метро (BiomeMood.light): чуть приглушён, холодный белый. */
export const METRO_LIGHT = 0.95;
export const COLD_TINT = new Color3(0.86, 0.92, 1);
/** Туман метро: бесконечный зал растворяется во тьме (цвет — фона сцены: портал заливает им дальние проёмы). */
export const METRO_FOG = { start: 20, end: 56 };

/** Шаг ступеней по ленте, м; ступень: проступь вдоль марша и высота тела, м; над линией носков на столько (без мерцания с
 *  полом у гребёнки). */
const PITCH = 0.4;
const TREAD = 0.4;
const STEP_H = 0.24;
const LIFT = 0.012;
/** Лента у нижней гребёнки — плоский участок перед подъёмом, м; балюстрада начинается раньше подъёма, м. */
const FLAT_IN = 0.6;
const BAL_IN = 0.9;
/** Балюстрада: верх настила и поручень над линией носков, м. */
const RAIL_TOP = 1.0;
const DECK_TOP = 0.97;
/** Свод (эллипс поперёк): верх над линией носков (не выше своего потолка комнаты), пята — не ниже VAULT_LOW (у края
 *  торцевого проёма 'esc>hall' 3.2 м свод как раз над ним), м; тюбинг — кольцо по наклону, м. */
const VAULT_TOP = 4.3;
const VAULT_LOW = 2.95;
const RING_M = 0.8;
/** Торшеры на настилах между дорожками — через столько метров плана. */
const TORCH_STEP = 2.8;

type C4 = [number, number, number, number];
type V3 = [number, number, number];
const rgb = (hex: string, a = 1): C4 => {
  const v = parseInt(hex.slice(1), 16);
  return [((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255, a];
};
const C = {
  tread: rgb('#8e9296'), treadSide: rgb('#55595d'), nose: rgb('#d6ae2c'),
  comb: rgb('#a3a7aa'), combSide: rgb('#6a6e72'),
  skirt: rgb('#8b8f93'), panel: rgb('#6e4a30'), panelEdge: rgb('#4f3422'), deck: rgb('#7a5537'),
  rail: rgb('#141414'), bronze: rgb('#8a6a3a'), bronzeDark: rgb('#5e4626'),
  char: rgb('#171412'), ash: rgb('#4a4642'), rust: rgb('#5a3a26'), burnt: rgb('#2b1d14'), steel: rgb('#3a3c3e'),
};

/** Вид дорожки в кадре (от логики). */
export interface LaneView {
  /** скорость ленты по наклону, м/с (+ вверх) */
  v: number;
  /** сползает в приямок: доля 0…1 (стадия fall и после — до пересборки); null — стоит */
  slide: number | null;
  /** яркость торшеров у дорожки 0…1 */
  lamps: number;
}

// ───────────────────────── система тоннеля ─────────────────────────

/** Система: s — вдоль подъёма от нижнего края прямоугольника, b — поперёк (вправо при взгляде вверх), высота — от низа
 *  комнаты. Узел: позиция — угол (s = 0, b = 0), поворот по стороне подъёма. */
interface Frame {
  up: Side;
  px: number;
  py: number;
  yaw: number;
  /** вправо (b) в плане */
  rx: number;
  ry: number;
}

const RIGHT: Record<Side, [number, number]> = { N: [1, 0], S: [-1, 0], E: [0, 1], W: [0, -1] };

function frameOf(up: Side, r: { x0: number; y0: number; x1: number; y1: number }): Frame {
  const [ux, uy] = UP_VEC[up];
  const [rx, ry] = RIGHT[up];
  const px = up === 'S' || up === 'W' ? r.x1 : r.x0;
  const py = up === 'N' || up === 'W' ? r.y1 : r.y0;
  return { up, px, py, yaw: Math.atan2(ux, -uy), rx, ry };
}

/** План → (s, b) системы. */
function toLocal(f: Frame, x: number, y: number): { s: number; b: number } {
  const [ux, uy] = UP_VEC[f.up];
  const dx = x - f.px, dy = y - f.py;
  return { s: dx * ux + dy * uy, b: dx * f.rx + dy * f.ry };
}

/** Профиль ленты (своя дорожка, высота — от её низа): линия носков. */
function profile(l: EscLane): { t: number; H: number; h: (s: number) => number } {
  const { t, r } = laneStep(l);
  const H = l.z1 - l.z0;
  return { t, H, h: (s: number) => Math.min(H, Math.max(0, ((s + t) * r) / t)) };
}

/** Слэб вдоль профиля: поперёк [b0, b1], по s — участки между точками ss, низ/верх — h(s) + lo/hi. */
function slab(B: StairBatch, b0: number, b1: number, ss: number[], h: (s: number) => number, lo: number, hi: number, top: C4, side: C4) {
  for (let k = 0; k + 1 < ss.length; k++) {
    const sa = ss[k], sb = ss[k + 1];
    if (sb - sa < 1e-6) continue;
    const ha = h(sa), hb = h(sb);
    B.hexa(
      [[b0, ha + lo, sa], [b1, ha + lo, sa], [b1, hb + lo, sb], [b0, hb + lo, sb]],
      [[b0, ha + hi, sa], [b1, ha + hi, sa], [b1, hb + hi, sb], [b0, hb + hi, sb]],
      top, side,
    );
  }
}

/** Бокс в локальных осях узла (b, h, s), повёрнутый вокруг своего центра (рад: вокруг h, затем s и b). */
function rotBox(B: StairBatch, c: V3, half: V3, yaw: number, pitch: number, roll: number, top: C4, side: C4) {
  const cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch), cr = Math.cos(roll), sr = Math.sin(roll);
  const tr = (x: number, y: number, z: number): V3 => {
    // крен вокруг s, тангаж вокруг b, рыскание вокруг h
    let X = x * cr - y * sr, Y = x * sr + y * cr, Z = z;
    const Y2 = Y * cp - Z * sp, Z2 = Y * sp + Z * cp;
    Y = Y2;
    Z = Z2;
    const X3 = X * cy + Z * sy, Z3 = -X * sy + Z * cy;
    X = X3;
    Z = Z3;
    return [c[0] + X, c[1] + Y, c[2] + Z];
  };
  const [hx, hy, hz] = half;
  B.hexa(
    [tr(-hx, -hy, -hz), tr(hx, -hy, -hz), tr(hx, -hy, hz), tr(-hx, -hy, hz)],
    [tr(-hx, hy, -hz), tr(hx, hy, -hz), tr(hx, hy, hz), tr(-hx, hy, hz)],
    top, side,
  );
}

/** Восьмигранная призма (плафон, стойка): центр низа (b, h, s), радиус, высота. */
function prism(B: StairBatch, b: number, h: number, s: number, r: number, height: number, col: C4) {
  const n = 8;
  const ring = (y: number): V3[] => Array.from({ length: n }, (_, k) => [b + r * Math.cos((k / n) * Math.PI * 2), y, s + r * Math.sin((k / n) * Math.PI * 2)] as V3);
  const lo = ring(h), hi = ring(h + height);
  const mid: V3 = [b, h + height / 2, s];
  B.color = col;
  B.poly(lo, mid);
  B.poly(hi, mid);
  for (let k = 0; k < n; k++) B.poly([lo[k], lo[(k + 1) % n], hi[(k + 1) % n], hi[k]], mid);
}

function meshOf(scene: Scene, name: string, B: StairBatch, mat: StandardMaterial, parent: TransformNode, updatable = false): Mesh | null {
  if (B.empty) return null;
  const m = new Mesh(name, scene);
  const vd = new VertexData();
  vd.positions = B.p;
  vd.normals = B.n;
  vd.colors = B.c;
  vd.indices = B.i;
  vd.applyToMesh(m, updatable);
  m.material = mat;
  m.parent = parent;
  m.layerMask = PORTAL_LAYER;
  m.isPickable = false;
  m.checkCollisions = false;
  m.alwaysSelectAsActiveMesh = true;
  return m;
}

// ───────────────────────── материалы ─────────────────────────

interface Mats {
  body: StandardMaterial;
  vault: StandardMaterial;
  lampOn: StandardMaterial;
  lampFlick: StandardMaterial;
  lampOff: StandardMaterial;
}

const LAMP = new Color3(1, 0.88, 0.66);

function makeMats(scene: Scene): Mats {
  const body = new StandardMaterial('metro:esc', scene);
  body.diffuseColor = Color3.White();
  body.specularColor = new Color3(0.12, 0.12, 0.12);
  body.specularPower = 32;
  body.backFaceCulling = false;
  const lamp = (name: string, k: number) => {
    const m = new StandardMaterial(name, scene);
    m.diffuseColor = Color3.Black();
    m.specularColor = Color3.Black();
    m.emissiveColor = LAMP.scale(k);
    m.disableLighting = true;
    return m;
  };
  // тюбинги свода: кольца по наклону (шов — тёмная полоса), стыки сегментов поперёк, болты, лёгкая грязь
  const tex = new DynamicTexture('metro:vaultTex', { width: 256, height: 256 }, scene, true);
  const g = tex.getContext() as unknown as CanvasRenderingContext2D;
  g.fillStyle = '#d2cdc2';
  g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 90; i++) {
    const x = hash01(i, 1) * 256, y = hash01(i, 2) * 256, r = 10 + hash01(i, 3) * 40;
    for (const dx of [-256, 0, 256]) for (const dy of [-256, 0, 256]) {
      const gr = g.createRadialGradient(x + dx, y + dy, 0, x + dx, y + dy, r);
      gr.addColorStop(0, hash01(i, 4) > 0.5 ? 'rgba(120,112,98,0.16)' : 'rgba(240,236,226,0.18)');
      gr.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = gr;
      g.fillRect(x + dx - r, y + dy - r, 2 * r, 2 * r);
    }
  }
  g.fillStyle = 'rgba(70,64,56,0.55)';
  g.fillRect(0, 0, 256, 7);
  g.fillStyle = 'rgba(255,255,255,0.25)';
  g.fillRect(0, 7, 256, 2);
  g.fillStyle = 'rgba(70,64,56,0.4)';
  for (const x of [0, 128]) g.fillRect(x, 0, 4, 256);
  g.fillStyle = 'rgba(60,56,50,0.6)';
  for (const x of [20, 64, 108, 148, 192, 236]) for (const y of [16, 240]) g.fillRect(x, y, 5, 5);
  tex.update();
  tex.wrapU = tex.wrapV = Texture.WRAP_ADDRESSMODE;
  const vault = new StandardMaterial('metro:vault', scene);
  vault.diffuseTexture = tex;
  vault.diffuseColor = new Color3(0.86, 0.85, 0.82);
  vault.specularColor = new Color3(0.04, 0.04, 0.04);
  vault.emissiveColor = new Color3(0.05, 0.05, 0.055);
  vault.backFaceCulling = false;
  return { body, vault, lampOn: lamp('metro:escLamp', 1), lampFlick: lamp('metro:escLampFlick', 1), lampOff: lamp('metro:escLampOff', 0.04) };
}

// ───────────────────────── тоннель ─────────────────────────

interface LaneMeshes {
  lane: EscLane;
  node: TransformNode;
  /** узел дорожки в покое: (b, высота, s) в системе тоннеля */
  rest: V3;
  body: Mesh | null;
  steps: Mesh | null;
  /** ступень-образец (позиции у носка в 0) и буфер позиций ленты */
  tpl: Float32Array;
  pos: Float32Array;
  n: number;
  phase: number;
  debris: Mesh | null;
  collider: Mesh | null;
  /** профиль ленты: длина пути и точка пути (s, h) по u */
  U: number;
  path: (u: number) => [number, number];
  t: number;
  /** сейчас показаны: лента (целая или сползает) / обломки */
  showBelt: boolean;
  showDebris: boolean;
  /** пыль уже была (сползла до дна) */
  dusted: boolean;
}

interface Gap {
  /** соседние дорожки (номера; −1 — стена) */
  a: number;
  b: number;
  lamps: Mesh | null;
}

interface Tunnel {
  key: string;
  inst: string;
  root: TransformNode;
  statics: Mesh[];
  lanes: LaneMeshes[];
  gaps: Gap[];
  used: number;
  list: Mesh[];
}

/** Меши тоннеля в кадре: статика, торшеры, у дорожек — лента (целая или сползает) или обломки. */
function listOf(T: Tunnel): Mesh[] {
  return [
    ...T.statics,
    ...T.gaps.flatMap((g) => (g.lamps ? [g.lamps] : [])),
    ...T.lanes.flatMap((L) => [...(L.showBelt ? [L.body, L.steps] : []), ...(L.showDebris ? [L.debris] : [])].filter((m): m is Mesh => !!m)),
  ];
}

export class MetroEscScene {
  private mats: Mats;
  private by = new Map<string, Tunnel>();
  private dust: ParticleSystem | null = null;

  constructor(private readonly scene: Scene) {
    this.mats = makeMats(scene);
  }

  /** Меши тоннеля экземпляра для портала (строятся при первом обращении и при смене сломанных дорожек). */
  meshes(inst: RunInstance, lanes: readonly EscLane[], cellM: number): readonly Mesh[] {
    const key = `${inst.id}|${(inst.escBroken ?? []).join(',')}|${inst.z ?? 0}|${lanes.length}`;
    let T = this.by.get(inst.id);
    if (T && T.key !== key) {
      this.disposeTunnel(T);
      T = undefined;
    }
    if (!T) {
      T = this.build(inst, lanes, cellM, key);
      this.by.set(inst.id, T);
    }
    T.used = performance.now();
    return T.list;
  }

  /** Кадр: лента бежит (фаза по скорости), сползание, торшеры, что показывать; коллайдеры обломков — у комнат с
   *  коллизиями. Только тоннели, нарисованные недавно. */
  update(dt: number, view: (inst: string, lane: number) => LaneView, colliding: (inst: string) => boolean) {
    const now = performance.now();
    let flick = 1;
    for (const T of this.by.values()) {
      if (now - T.used > 1500) {
        for (const L of T.lanes) if (L.collider) L.collider.checkCollisions = false;
        continue;
      }
      const lamps = new Map<number, number>();
      for (const L of T.lanes) {
        const v = view(T.inst, L.lane.lane);
        lamps.set(L.lane.lane, L.lane.broken && v.slide === null ? 0 : v.lamps);
        const sliding = v.slide !== null;
        L.showBelt = !L.lane.broken || sliding;
        L.showDebris = L.lane.broken && !sliding;
        if (L.collider) L.collider.checkCollisions = L.showDebris && colliding(T.inst);
        // сползание: узел дорожки — вниз вокруг нижнего конца и назад (slidePose)
        if (sliding) {
          const p = slidePose(L.lane, v.slide!);
          L.node.position.set(L.rest[0], L.rest[1], L.rest[2] - p.shift);
          L.node.rotation.x = p.pitch;
          if (v.slide! >= 0.999 && !L.dusted) {
            L.dusted = true;
            this.puff(L);
          }
        } else if (L.node.rotation.x !== 0 || L.node.position.z !== L.rest[2]) {
          L.node.position.set(L.rest[0], L.rest[1], L.rest[2]);
          L.node.rotation.x = 0;
        }
        if (!sliding) L.dusted = false;
        L.node.computeWorldMatrix(true);
        if (L.showBelt && L.steps) {
          if (!sliding) L.phase += v.v * dt;
          this.layout(L);
          L.steps.computeWorldMatrix(true);
        }
        L.body?.computeWorldMatrix(true);
      }
      // торшеры: мигают, если рядом срыв; гаснут у сломанной
      for (const g of T.gaps) {
        if (!g.lamps) continue;
        const k = Math.min(g.a >= 0 ? (lamps.get(g.a) ?? 1) : 1, g.b >= 0 ? (lamps.get(g.b) ?? 1) : 1);
        g.lamps.material = k >= 0.999 ? this.mats.lampOn : k <= 0.05 ? this.mats.lampOff : this.mats.lampFlick;
        if (k < 0.999 && k > 0.05) flick = Math.min(flick, k);
      }
      T.list = listOf(T);
    }
    this.mats.lampFlick.emissiveColor.copyFrom(LAMP.scale(flick));
    // давно не нужные — прочь
    for (const [id, T] of this.by) {
      if (now - T.used < 20000) continue;
      this.disposeTunnel(T);
      this.by.delete(id);
    }
  }

  /** Точка дорожки в мире (Babylon) — для звука: середина ленты по s, над линией носков. */
  lanePoint(inst: string, lane: number, s: number): Vector3 | null {
    const L = this.by.get(inst)?.lanes.find((x) => x.lane.lane === lane);
    if (!L) return null;
    const p = profile(L.lane);
    return Vector3.TransformCoordinates(new Vector3(L.lane.width / 2, p.h(s) + 0.5, s), L.node.getWorldMatrix());
  }

  // ───────────────────────── постройка ─────────────────────────

  private build(inst: RunInstance, lanes: readonly EscLane[], cellM: number, key: string): Tunnel {
    const scene = this.scene;
    const c = cellM > 0 ? cellM : 0.1;
    const Bz = Number(inst.z) || 0;
    const room = { x0: inst.bbox.x0 * c, y0: inst.bbox.y0 * c, x1: inst.bbox.x1 * c, y1: inst.bbox.y1 * c };
    const up = lanes[0]?.up ?? 'N';
    const fr = frameOf(up, room);
    const root = new TransformNode(`metro:esc:${inst.id}`, scene);
    root.position.set(fr.px, Bz, -fr.py);
    root.rotation.y = fr.yaw;
    const vert = up === 'N' || up === 'S';
    const Ltun = vert ? room.y1 - room.y0 : room.x1 - room.x0;
    const Wtun = vert ? room.x1 - room.x0 : room.y1 - room.y0;
    const T: Tunnel = { key, inst: inst.id, root, statics: [], lanes: [], gaps: [], used: performance.now(), list: [] };
    const same = lanes.filter((l) => l.up === up);
    // дорожки в системе тоннеля: угол дорожки (s = 0, b = 0 в её системе) → (s, b)
    const placed = same.map((l) => {
      const lf = frameOf(l.up, l);
      const o = toLocal(fr, lf.px, lf.py);
      return { l, s: o.s, b: o.b };
    }).sort((p, q) => p.b - q.b);
    const seed = hashSeed(inst.id);
    for (const P of placed) T.lanes.push(this.buildLane(inst, P.l, [P.b, P.l.z0 - Bz, P.s], root, seed));
    // ── статика тоннеля: настилы, торшеры, свод
    const S = new StairBatch();
    const lead = placed[0];
    if (lead) {
      const pr = profile(lead.l);
      const s0 = lead.s - pr.t - BAL_IN, s1 = lead.s + lead.l.len;
      const hz = lead.l.z0 - Bz;
      const hT = (s: number) => hz + pr.h(s - lead.s);
      const ss = [s0, lead.s - pr.t, lead.s + lead.l.len - pr.t, s1];
      // промежутки поперёк: стена — дорожка — … — стена
      const edges: { b0: number; b1: number; a: number; b: number }[] = [];
      let prevB = 0, prevLane = -1;
      for (const P of placed) {
        edges.push({ b0: prevB, b1: P.b, a: prevLane, b: P.l.lane });
        prevB = P.b + P.l.width;
        prevLane = P.l.lane;
      }
      edges.push({ b0: prevB, b1: Wtun, a: prevLane, b: -1 });
      for (const e of edges) {
        if (e.b1 - e.b0 < 0.05) continue;
        const intact = (n: number) => n < 0 || !same.find((l) => l.lane === n)?.broken;
        const wall = e.a < 0 || e.b < 0;
        if (!intact(e.a) && !intact(e.b)) continue;
        if (wall && !intact(e.a < 0 ? e.b : e.a)) continue;
        // настил и торец у нижней площадки
        slab(S, e.b0, e.b1, ss, hT, DECK_TOP - 0.06, DECK_TOP, C.deck, C.panelEdge);
        S.hexa(
          [[e.b0, hz, s0], [e.b1, hz, s0], [e.b1, hz, s0 + 0.04], [e.b0, hz, s0 + 0.04]],
          [[e.b0, hz + DECK_TOP - 0.06, s0], [e.b1, hz + DECK_TOP - 0.06, s0], [e.b1, hz + DECK_TOP - 0.06, s0 + 0.04], [e.b0, hz + DECK_TOP - 0.06, s0 + 0.04]],
          C.panelEdge, C.panel,
        );
        if (wall) continue;
        // торшеры: бронзовая стойка и матовый плафон (светится — отдельный меш промежутка)
        const L = new StairBatch();
        const bm = (e.b0 + e.b1) / 2;
        for (let s = lead.s + 1.2; s < lead.s + lead.l.len - 0.8; s += TORCH_STEP) {
          const h = hT(s) + DECK_TOP;
          prism(S, bm, h, s, 0.06, 0.05, C.bronzeDark);
          prism(S, bm, h, s, 0.022, 0.78, C.bronze);
          prism(S, bm, h + 0.78, s, 0.05, 0.04, C.bronze);
          prism(L, bm, h + 0.82, s, 0.085, 0.3, [1, 1, 1, 1]);
          prism(S, bm, h + 1.12, s, 0.06, 0.03, C.bronze);
        }
        T.gaps.push({ a: e.a, b: e.b, lamps: meshOf(scene, `metro:escLamps:${inst.id}:${e.a}`, L, this.mats.lampOn, root) });
      }
      const st = meshOf(scene, `metro:escDeck:${inst.id}`, S, this.mats.body, root);
      if (st) T.statics.push(st);
      // свод: ровный над площадками, наклонный над маршами; пята — над линией носков, поперёк — дуга на всю ширину
      const vault = this.vault(inst.id, Ltun, Wtun, hT, ss, Number(inst.ceilM) || 0, root);
      if (vault) T.statics.push(vault);
    }
    root.computeWorldMatrix(true);
    for (const m of root.getChildMeshes(false)) m.computeWorldMatrix(true);
    T.list = listOf(T);
    return T;
  }

  /** Свод тоннеля: дуга поперёк [0, W] (полуэллипс над пятой), вдоль — по профилю (без изломов внутри участков ss). */
  private vault(id: string, Ltun: number, W: number, hT: (s: number) => number, ss: number[], ceil: number, root: TransformNode): Mesh | null {
    if (!(Ltun > 0) || !(W > 0)) return null;
    const along = [0, ...ss.slice(1, 3).filter((s) => s > 0 && s < Ltun), Ltun];
    // верх — не выше своего потолка комнаты над верхней площадкой (Room.ceilM), стрела — что останется над пятой
    const top = ceil > 0 ? Math.min(VAULT_TOP, ceil - 0.05) : VAULT_TOP;
    const rise = Math.min(1.2, Math.max(0.3, top - VAULT_LOW));
    const spring = top - rise;
    const NB = 18;
    const arch = (b: number) => spring + rise * Math.sqrt(Math.max(0, 1 - (2 * b / W - 1) ** 2));
    const pos: number[] = [], nrm: number[] = [], uv: number[] = [], idx: number[] = [];
    let v0 = 0;
    for (let k = 0; k + 1 < along.length; k++) {
      const sa = along[k], sb = along[k + 1];
      const ha = hT(sa), hb = hT(sb);
      const len = Math.hypot(sb - sa, hb - ha);
      const base = pos.length / 3;
      for (let j = 0; j <= NB; j++) {
        // гуще у стен (там дуга круче)
        const b = (W / 2) * (1 - Math.cos((Math.PI * j) / NB));
        // нормаль — внутрь (вниз к оси): наклон дуги поперёк, у пяты — почти горизонтально
        const e = W / 400;
        const dh = Math.max(-8, Math.min(8, (arch(Math.min(W, b + e)) - arch(Math.max(0, b - e))) / (Math.min(W, b + e) - Math.max(0, b - e))));
        const l = Math.hypot(dh, 1);
        for (const [s, h, v] of [[sa, ha, v0], [sb, hb, v0 + len]] as const) {
          pos.push(b, h + arch(b), s);
          nrm.push(dh / l, -1 / l, 0);
          uv.push(b / 1.6, v / RING_M);
        }
      }
      for (let j = 0; j < NB; j++) {
        const a = base + j * 2, c2 = base + (j + 1) * 2;
        idx.push(a, c2, a + 1, a + 1, c2, c2 + 1);
      }
      v0 += len;
    }
    const m = new Mesh(`metro:vault:${id}`, this.scene);
    const vd = new VertexData();
    vd.positions = pos;
    vd.normals = nrm;
    vd.uvs = uv;
    vd.indices = idx;
    vd.applyToMesh(m, false);
    m.material = this.mats.vault;
    m.parent = root;
    m.layerMask = PORTAL_LAYER;
    m.isPickable = false;
    m.alwaysSelectAsActiveMesh = true;
    return m;
  }

  /** Дорожка: узел (сползание), балюстрады с поручнями и гребёнки (body), лента ступеней (steps), у сломанной —
   *  обломки на дне и их коллайдер. */
  private buildLane(inst: RunInstance, l: EscLane, rest: V3, root: TransformNode, seed: number): LaneMeshes {
    const scene = this.scene;
    const node = new TransformNode(`metro:escLane:${inst.id}:${l.lane}`, scene);
    node.parent = root;
    node.position.set(rest[0], rest[1], rest[2]);
    const W = l.width;
    const { t, H, h } = profile(l);
    const s0 = -t - BAL_IN;
    const ss = [s0, -t, l.len - t, l.len];
    // ── балюстрады: сталь внизу, дерево выше, поручень; гребёнки
    const B = new StairBatch();
    for (const [b0, b1, rb0, rb1] of [[-0.05, 0, -0.07, 0.03], [W, W + 0.05, W - 0.03, W + 0.07]] as const) {
      slab(B, b0, b1, ss, h, -0.15, 0.12, C.skirt, C.skirt);
      slab(B, b0, b1, ss, h, 0.12, 0.92, C.panelEdge, C.panel);
      slab(B, rb0, rb1, [s0 - 0.3, ...ss, l.len + 0.55], (s) => h(Math.min(l.len, Math.max(s0, s))), 0.92, RAIL_TOP, C.rail, C.rail);
    }
    const comb = (sa: number, sb: number, z: number, edge: number) => {
      B.hexa([[0.02, z, sa], [W - 0.02, z, sa], [W - 0.02, z, sb], [0.02, z, sb]], [[0.02, z + 0.026, sa], [W - 0.02, z + 0.026, sa], [W - 0.02, z + 0.026, sb], [0.02, z + 0.026, sb]], C.comb, C.combSide);
      B.hexa([[0.02, z, edge], [W - 0.02, z, edge], [W - 0.02, z, edge + 0.035], [0.02, z, edge + 0.035]], [[0.02, z + 0.028, edge], [W - 0.02, z + 0.028, edge], [W - 0.02, z + 0.028, edge + 0.035], [0.02, z + 0.028, edge + 0.035]], C.nose, C.nose);
    };
    comb(-t - 0.35, -t + 0.1, 0, -t + 0.065);
    comb(l.len - 0.5, l.len + 0.15, H, l.len - 0.5);
    const body = meshOf(scene, `metro:escBody:${inst.id}:${l.lane}`, B, this.mats.body, node);
    // ── лента: путь по линии носков (плоско у нижней гребёнки — подъём — плоско у верхней)
    const pts: [number, number][] = [[-t - FLAT_IN, 0], [-t, 0], [l.len - t, H], [l.len, H]];
    const segs = pts.slice(1).map((p, k) => Math.hypot(p[0] - pts[k][0], p[1] - pts[k][1]));
    const U = segs.reduce((a, b) => a + b, 0);
    const path = (u: number): [number, number] => {
      let r = u;
      for (let k = 0; k < segs.length; k++) {
        if (r <= segs[k] || k === segs.length - 1) {
          const q = segs[k] > 0 ? Math.min(1, r / segs[k]) : 0;
          return [pts[k][0] + (pts[k + 1][0] - pts[k][0]) * q, pts[k][1] + (pts[k + 1][1] - pts[k][1]) * q];
        }
        r -= segs[k];
      }
      return pts[pts.length - 1];
    };
    const n = Math.ceil(U / PITCH) + 1;
    const S1 = new StairBatch();
    S1.hexa(
      [[0.04, -STEP_H, 0], [W - 0.04, -STEP_H, 0], [W - 0.04, -STEP_H, TREAD], [0.04, -STEP_H, TREAD]],
      [[0.04, 0, 0], [W - 0.04, 0, 0], [W - 0.04, 0, TREAD], [0.04, 0, TREAD]],
      C.tread, C.treadSide,
    );
    S1.hexa(
      [[0.04, -0.012, -0.002], [W - 0.04, -0.012, -0.002], [W - 0.04, -0.012, 0.045], [0.04, -0.012, 0.045]],
      [[0.04, 0.003, -0.002], [W - 0.04, 0.003, -0.002], [W - 0.04, 0.003, 0.045], [0.04, 0.003, 0.045]],
      C.nose, C.nose,
    );
    const tpl = new Float32Array(S1.p);
    const S = new StairBatch();
    for (let k = 0; k < n; k++) {
      const o = S.p.length / 3;
      S.p.push(...S1.p);
      S.n.push(...S1.n);
      S.c.push(...S1.c);
      S.uv.push(...S1.uv);
      for (const i of S1.i) S.i.push(i + o);
    }
    const steps = meshOf(scene, `metro:escSteps:${inst.id}:${l.lane}`, S, this.mats.body, node, true);
    const L: LaneMeshes = {
      lane: l, node, rest, body, steps, tpl, pos: new Float32Array(S.p), n, phase: 0, debris: null, collider: null, U, path, t,
      showBelt: !l.broken, showDebris: l.broken, dusted: false,
    };
    if (l.broken) this.wreck(inst, L, seed);
    if (steps) this.layout(L);
    return L;
  }

  /** Обломки сорвавшейся дорожки: лента лежит на дне (как сползла — slidePose(1)), обугленная, ступени вразброс, гнутый
   *  поручень, горелые доски; коллайдер — над приямком (по завалу не пройти). */
  private wreck(inst: RunInstance, L: LaneMeshes, seed: number) {
    const l = L.lane, W = l.width;
    const S = slopeLen(l);
    const sA = l.len - S, sB = l.len;
    const B = new StairBatch();
    const r = (k: number, j: number) => hash01(seed, l.lane, k, j);
    // фермы ленты — две балки по бокам, чуть смяты
    for (const b of [0.05, W - 0.05]) {
      for (let k = 0; k < 6; k++) {
        const a = sA + ((sB - sA) * k) / 6, z = sA + ((sB - sA) * (k + 1)) / 6;
        rotBox(B, [b, 0.12 + 0.08 * r(k, b > 1 ? 1 : 2), (a + z) / 2], [0.05, 0.12, (z - a) / 2 + 0.02], (r(k, 3) - 0.5) * 0.12, (r(k, 4) - 0.5) * 0.1, (r(k, 5) - 0.5) * 0.3, C.char, C.steel);
      }
    }
    // ступени вразброс по всей длине
    const count = Math.round((sB - sA) / 0.35);
    for (let k = 0; k < count; k++) {
      const s = sA + 0.2 + (sB - sA - 0.4) * r(k, 10);
      const b = 0.15 + (W - 0.3) * r(k, 11);
      const tilt = (r(k, 12) - 0.5) * 1.6;
      rotBox(B, [b, 0.18 + 0.25 * r(k, 13), s], [(W - 0.1) / 2 * (0.6 + 0.4 * r(k, 14)), 0.1, TREAD / 2], (r(k, 15) - 0.5) * 1.2, tilt, (r(k, 16) - 0.5) * 0.8, r(k, 17) < 0.3 ? C.rust : C.char, C.ash);
    }
    // горелые доски балюстрады и гнутый поручень
    for (let k = 0; k < 7; k++) {
      const s = sA + (sB - sA) * r(k, 20);
      rotBox(B, [r(k, 21) < 0.5 ? -0.1 : W + 0.1, 0.1 + 0.2 * r(k, 22), s], [0.03, 0.35, 0.5 + 0.6 * r(k, 23)], (r(k, 24) - 0.5) * 0.8, 1.2 + (r(k, 25) - 0.5) * 0.6, (r(k, 26) - 0.5) * 0.8, C.burnt, C.char);
    }
    for (let k = 0; k < 4; k++) {
      const s = sA + 1 + (sB - sA - 2) * (k / 4) + r(k, 30);
      rotBox(B, [W / 2 + (r(k, 31) - 0.5) * W, 0.45 + 0.3 * r(k, 32), s], [0.04, 0.03, 0.9], (r(k, 33) - 0.5) * 1.4, (r(k, 34) - 0.5) * 0.9, 0, C.rail, C.rail);
    }
    // пепел — плоские пятна на дне
    for (let k = 0; k < 10; k++) {
      const s = sA + (sB - sA) * r(k, 40), b = W * r(k, 41);
      rotBox(B, [b, 0.006, s], [0.25 + 0.3 * r(k, 42), 0.006, 0.3 + 0.5 * r(k, 43)], r(k, 44) * 3, 0, 0, C.ash, C.ash);
    }
    // обломки — в системе тоннеля под узлом дорожки в покое (низ — дно приямка: высота узла — низ дорожки над полом)
    const holder = new TransformNode(`metro:escWreckAt:${inst.id}:${l.lane}`, this.scene);
    holder.parent = L.node.parent;
    holder.position.set(L.rest[0], 0, L.rest[2]);
    L.debris = meshOf(this.scene, `metro:escWreck:${inst.id}:${l.lane}`, B, this.mats.body, holder);
    // коллайдер завала — только над приямком (на нижней площадке обломки низкие — по ним проходят)
    const col = new Mesh(`metro:escWreckCol:${inst.id}:${l.lane}`, this.scene);
    const cb = new StairBatch();
    cb.hexa([[0, 0, 0.3], [W, 0, 0.3], [W, 0, l.len - 0.2], [0, 0, l.len - 0.2]], [[0, 0.9, 0.3], [W, 0.9, 0.3], [W, 0.9, l.len - 0.2], [0, 0.9, l.len - 0.2]], C.char, C.char);
    const vd = new VertexData();
    vd.positions = cb.p;
    vd.normals = cb.n;
    vd.indices = cb.i;
    vd.applyToMesh(col, false);
    col.parent = holder;
    col.isVisible = false;
    col.isPickable = false;
    col.checkCollisions = false;
    col.layerMask = PORTAL_LAYER;
    L.collider = col;
  }

  /** Ступени по ленте: фаза — путь ленты; у гребёнок — спрятаны (схлопнуты). */
  private layout(L: LaneMeshes) {
    if (!L.steps) return;
    const { tpl, pos, n, U, t } = L;
    const len = L.lane.len;
    const chain = n * PITCH;
    const per = tpl.length;
    const W = L.lane.width;
    for (let k = 0; k < n; k++) {
      let u = (k * PITCH + L.phase) % chain;
      if (u < 0) u += chain;
      const o = k * per;
      const [s, hh] = u <= U ? L.path(u) : [0, -1];
      const shown = u <= U && s >= -t - 0.3 && s <= len - 0.45;
      if (!shown) {
        for (let i = 0; i < per; i += 3) {
          pos[o + i] = W / 2;
          pos[o + i + 1] = -1;
          pos[o + i + 2] = 0;
        }
        continue;
      }
      for (let i = 0; i < per; i += 3) {
        pos[o + i] = tpl[i];
        pos[o + i + 1] = tpl[i + 1] + hh + LIFT;
        pos[o + i + 2] = tpl[i + 2] + s;
      }
    }
    L.steps.updateVerticesData(VertexBuffer.PositionKind, pos, false, false);
  }

  /** Пыль: дорожка сползла на дно. */
  private puff(L: LaneMeshes) {
    if (!this.dust) {
      const p = (this.dust = new ParticleSystem('metro:dust', 400, this.scene));
      p.particleTexture = puffTexture(this.scene);
      p.minSize = 0.4;
      p.maxSize = 1.2;
      p.minLifeTime = 1.2;
      p.maxLifeTime = 2.6;
      p.minEmitPower = 0.2;
      p.maxEmitPower = 1.1;
      p.direction1 = new Vector3(-1, 0.4, -1);
      p.direction2 = new Vector3(1, 1.2, 1);
      p.gravity = new Vector3(0, -0.2, 0);
      p.color1 = new Color4(0.42, 0.4, 0.37, 0.55);
      p.color2 = new Color4(0.3, 0.29, 0.27, 0.45);
      p.colorDead = new Color4(0.3, 0.29, 0.27, 0);
      p.targetStopDuration = 0.35;
      p.blendMode = ParticleSystem.BLENDMODE_STANDARD;
    }
    const l = L.lane;
    const a = L.node.getWorldMatrix();
    const p0 = Vector3.TransformCoordinates(new Vector3(l.width / 2, 0.2, 0), a);
    const p1 = Vector3.TransformCoordinates(new Vector3(l.width / 2, 0.2, slopeLen(l)), a);
    const mid = p0.add(p1).scale(0.5);
    const d = p1.subtract(p0);
    this.dust.emitter = mid;
    this.dust.minEmitBox = new Vector3(-Math.abs(d.x) / 2 - 0.4, 0, -Math.abs(d.z) / 2 - 0.4);
    this.dust.maxEmitBox = new Vector3(Math.abs(d.x) / 2 + 0.4, 0.4, Math.abs(d.z) / 2 + 0.4);
    this.dust.manualEmitCount = 320;
    this.dust.start();
  }

  private disposeTunnel(T: Tunnel) {
    T.root.dispose(false, false);
  }

  dispose() {
    for (const T of this.by.values()) this.disposeTunnel(T);
    this.by.clear();
    this.dust?.dispose();
    this.dust = null;
    const m = this.mats;
    m.vault.diffuseTexture?.dispose();
    for (const x of [m.body, m.vault, m.lampOn, m.lampFlick, m.lampOff]) x.dispose(true, false);
  }
}
