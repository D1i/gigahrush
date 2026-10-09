// «Общага» в «Прогулке»: то, что рисуется и светит (логика — ./obshagaWalk.ts).
//  • Свет: светящиеся материалы ламп (плафоны и лампа вахтёра obsh_lamp_glow, ЛДС obsh_tube_glow, экран obsh_tv_glow) —
//    по яркости ламп режиссёра; свет сцены — через BiomeMood.light (тусклый тёплый при свете, почти чёрный в темноте).
//    Огонь керосиновых ламп (obsh_lantern_glow) горит всегда и чуть дрожит.
//  • Лампа в руке: модель p_obsh_lantern у камеры (группа рендера 1 — поверх стен, как руки в снегу), покачивание на
//    ходу, тусклый жёлтый точечный свет (радиус — LANTERN_LIGHT_R) с дрожью пламени. Лампа напарника — свет у его аватара
//    (одна, ближайшая видимая: у материалов предел 4 источника; модель — у аватара, src/coop/presence.ts).
//  • Вода по пояс в затопленных помещениях: мутная полупрозрачная плоскость на 0.9 м над полом комнаты, рябь.
//  • Темнота за запертой дверью: распахнутая (рукой) дверь на глухой стене — чёрный проём.
//  • Рука-заглушка (пока нет src/view3d/obshagaHand.ts): трубки по следу и кисть; невидимые коллайдеры по следу —
//    рука занимает весь проход.
// Всё, что стоит в мире «Прогулки», рисуется портальным рендером вместе со своей комнатой (PortalRenderer.extraProviders,
// слой PORTAL_LAYER): меши по комнатам — byRoom.
import type { Scene } from '@babylonjs/core/scene';
import type { Camera } from '@babylonjs/core/Cameras/camera';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import { CreateCylinder } from '@babylonjs/core/Meshes/Builders/cylinderBuilder';
import { CreateSphere } from '@babylonjs/core/Meshes/Builders/sphereBuilder';
import { CreateBox } from '@babylonjs/core/Meshes/Builders/boxBuilder';
import { CreatePlane } from '@babylonjs/core/Meshes/Builders/planeBuilder';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture';
import { Texture } from '@babylonjs/core/Materials/Textures/texture';
import { PointLight } from '@babylonjs/core/Lights/pointLight';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector';
import { LANTERN_LIGHT_R, type HandView, type Pt } from '../locations/obshaga';
import { PORTAL_LAYER } from './portal';
import type { ObshDoor } from './obshagaNav';
import { hash01 } from '../locations/stairLoop';
import { HandMesh } from './obshagaHand';

/** Свет сцены в общаге при горящих лампах и в темноте (множитель hemi / sun) и тёплый оттенок. */
export const LIT_MUL = 0.62;
export const DARK_MUL = 0.03;
export const WARM_TINT = new Color3(1, 0.88, 0.7);
/** Огонь лампы: #E8B050. */
export const LANTERN_COLOR = new Color3(0.91, 0.69, 0.31);
/** Вода: над полом комнаты, м. */
export const WATER_M = 0.9;

const ELECTRIC = ['obsh_lamp_glow', 'obsh_tube_glow', 'obsh_tv_glow'];

/** Множитель света сцены по яркости ламп 0…1. */
export function sceneMul(level: number): number {
  const l = Math.min(1, Math.max(0, level));
  return DARK_MUL + (LIT_MUL - DARK_MUL) * l;
}

// ───────────────────────── свет ламп ─────────────────────────

export class ObshagaGlow {
  private mats = new Map<string, { m: StandardMaterial; base: Color3 }>();
  private lantern: { m: StandardMaterial; base: Color3 } | null = null;
  private lookAt = 0;
  private level = 1;

  constructor(private readonly scene: Scene) {}

  private find(now: number) {
    if (this.mats.size === ELECTRIC.length && this.lantern) return;
    if (now - this.lookAt < 1000) return;
    this.lookAt = now;
    for (const name of ELECTRIC) {
      if (this.mats.has(name)) continue;
      const m = this.scene.getMaterialByName('propModel:' + name) as StandardMaterial | null;
      if (m?.emissiveColor) this.mats.set(name, { m, base: m.emissiveColor.clone() });
    }
    if (!this.lantern) {
      const m = this.scene.getMaterialByName('propModel:obsh_lantern_glow') as StandardMaterial | null;
      if (m?.emissiveColor) this.lantern = { m, base: m.emissiveColor.clone() };
    }
  }

  /** Яркость электрических ламп 0…1 (в общаге — по режиссёру; вне — 1). */
  set(level: number) {
    const now = performance.now();
    this.find(now);
    const l = Math.min(1, Math.max(0, level));
    if (Math.abs(l - this.level) > 1e-3) {
      this.level = l;
      for (const { m, base } of this.mats.values()) m.emissiveColor.copyFrom(base.scale(0.02 + 0.98 * l));
    }
    // огонь керосиновых ламп дрожит всегда
    if (this.lantern) {
      const t = now / 1000;
      const k = 0.86 + 0.08 * Math.sin(t * 9.1) + 0.06 * Math.sin(t * 23.7 + 1.3);
      this.lantern.m.emissiveColor.copyFrom(this.lantern.base.scale(k));
    }
  }

  restore() {
    this.set(1);
  }

  dispose() {
    for (const { m, base } of this.mats.values()) m.emissiveColor.copyFrom(base);
    if (this.lantern) this.lantern.m.emissiveColor.copyFrom(this.lantern.base);
    this.mats.clear();
    this.lantern = null;
  }
}

// ───────────────────────── лампа в руке ─────────────────────────

/** Где ручка лампы у камеры: справа внизу, 0.6 м перед глазом (оси камеры: x вправо, y вверх, z вперёд); бачок висит ниже. */
const HOLD = new Vector3(0.27, -0.1, 0.6);
/** Свет лампы у камеры: ближе к глазу, чем модель, — не уходит в стену, к которой игрок вплотную. */
const LIGHT_AT = new Vector3(0.12, -0.3, 0.12);

export class HeldLantern {
  private node: TransformNode | null = null;
  private model: Mesh | null = null;
  readonly light: PointLight;
  private phase = 0;
  private swing = 0;
  private last: Vector3 | null = null;
  private on = false;

  constructor(
    private readonly scene: Scene,
    private readonly cam: Camera,
    private readonly template: () => Mesh | null,
  ) {
    const l = (this.light = new PointLight('obsh:lantern', Vector3.Zero(), scene));
    l.diffuse = LANTERN_COLOR.clone();
    l.specular = LANTERN_COLOR.scale(0.25);
    l.range = LANTERN_LIGHT_R + 0.5;
    l.intensity = 0;
    l.setEnabled(false);
  }

  get shown(): boolean {
    return this.on;
  }

  /** Показать / спрятать (взял лампу — показать; умер, ушёл со сцены — спрятать). */
  show(on: boolean) {
    if (on === this.on) return;
    this.on = on;
    this.light.setEnabled(on);
    if (on && !this.node) this.build();
    this.node?.setEnabled(on);
  }

  private build() {
    const tpl = this.template();
    const node = (this.node = new TransformNode('obsh:heldLantern', this.scene));
    node.parent = this.cam;
    node.position.copyFrom(HOLD);
    if (tpl) {
      const m = (this.model = tpl.clone('obsh:heldLanternModel', node, false));
      if (m) {
        m.setEnabled(true);
        m.isVisible = true;
        m.position.set(0, -0.336, 0); // начало модели — низ бачка; держат за ручку (0, 0.336, 0)
        m.rotation.set(0, 0.5, 0);
        for (const x of [m, ...m.getChildMeshes(false)]) {
          x.isPickable = false;
          x.checkCollisions = false;
          x.renderingGroupId = 1;
          x.alwaysSelectAsActiveMesh = true;
          x.layerMask = 0x0fffffff;
        }
      }
    }
  }

  /** Кадр: покачивание на ходу, дрожь пламени, свет — у глаза. */
  update(dt: number, moving: number) {
    if (!this.on) return;
    const t = performance.now() / 1000;
    // ход: фаза по пройденному пути
    const p = this.cam.globalPosition;
    const step = this.last ? Math.min(0.3, Math.hypot(p.x - this.last.x, p.z - this.last.z)) : 0;
    this.last = p.clone();
    this.phase += step * 7;
    this.swing += ((moving > 0.01 ? 1 : 0) - this.swing) * Math.min(1, dt * 4);
    if (this.node) {
      const sw = this.swing;
      this.node.position.set(HOLD.x + 0.012 * Math.sin(this.phase * 0.5) * sw, HOLD.y + 0.01 * Math.abs(Math.sin(this.phase * 0.5)) * sw + 0.004 * Math.sin(t * 1.3), HOLD.z);
      this.node.rotation.set(0.06 * Math.sin(this.phase * 0.5 + 0.6) * sw + 0.015 * Math.sin(t * 1.1), 0, 0.08 * Math.sin(this.phase * 0.5) * sw + 0.02 * Math.sin(t * 0.9));
    }
    const flick = 0.92 + 0.05 * Math.sin(t * 11.3) + 0.03 * Math.sin(t * 27.1 + 0.7) + 0.02 * (hash01(Math.floor(t * 14)) - 0.5);
    this.light.intensity = 1.05 * flick;
    const w = this.cam.getWorldMatrix();
    Vector3.TransformCoordinatesToRef(LIGHT_AT, w, this.light.position);
  }

  dispose() {
    this.light.dispose();
    this.model?.dispose(false, false);
    this.node?.dispose();
  }
}

// ───────────────────────── вода ─────────────────────────

let waterMat: StandardMaterial | null = null;

function waterMaterial(scene: Scene): StandardMaterial {
  if (waterMat && waterMat.getScene() === scene && scene.materials.includes(waterMat)) return waterMat;
  const tex = new DynamicTexture('obsh:waterTex', { width: 256, height: 256 }, scene, true);
  const g = tex.getContext() as unknown as CanvasRenderingContext2D;
  g.fillStyle = '#2f3a2a';
  g.fillRect(0, 0, 256, 256);
  // муть и рябь: размытые пятна и тонкие светлые разводы (бесшовно — по модулю)
  for (let i = 0; i < 140; i++) {
    const x = hash01(i, 1) * 256, y = hash01(i, 2) * 256, r = 8 + hash01(i, 3) * 34;
    const light = hash01(i, 4) > 0.5;
    for (const dx of [-256, 0, 256]) for (const dy of [-256, 0, 256]) {
      const gr = g.createRadialGradient(x + dx, y + dy, 0, x + dx, y + dy, r);
      gr.addColorStop(0, light ? 'rgba(92,104,74,0.35)' : 'rgba(18,24,16,0.4)');
      gr.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = gr;
      g.fillRect(x + dx - r, y + dy - r, 2 * r, 2 * r);
    }
  }
  g.strokeStyle = 'rgba(150,160,130,0.12)';
  g.lineWidth = 1.2;
  for (let i = 0; i < 26; i++) {
    const y0 = hash01(i, 7) * 256;
    g.beginPath();
    for (let x = 0; x <= 256; x += 8) g.lineTo(x, y0 + 4 * Math.sin((x / 256) * Math.PI * 4 + i));
    g.stroke();
  }
  tex.update();
  tex.wrapU = tex.wrapV = Texture.WRAP_ADDRESSMODE;
  const m = new StandardMaterial('obsh:water', scene);
  m.diffuseTexture = tex;
  m.diffuseColor = new Color3(0.75, 0.8, 0.7);
  m.specularColor = new Color3(0.32, 0.3, 0.24);
  m.specularPower = 40;
  m.emissiveColor = new Color3(0.01, 0.012, 0.01);
  m.alpha = 0.84;
  m.backFaceCulling = false;
  waterMat = m;
  return m;
}

/** Вода в затопленных комнатах: меш на комнату (по полу куска — с половинами проёмов). */
export class ObshagaWater {
  private by = new Map<string, { mesh: Mesh; used: number }>();

  constructor(private readonly scene: Scene) {}

  /** Меш воды комнаты (строится по прямоугольникам пола, план, м; z — пол комнаты). */
  mesh(room: string, rects: readonly { x0: number; y0: number; x1: number; y1: number }[], z: number): Mesh {
    const hit = this.by.get(room);
    const now = performance.now();
    if (hit) {
      hit.used = now;
      return hit.mesh;
    }
    const pos: number[] = [], idx: number[] = [], nrm: number[] = [], uv: number[] = [];
    for (const r of rects) {
      const k = pos.length / 3;
      for (const [x, y] of [[r.x0, r.y0], [r.x1, r.y0], [r.x1, r.y1], [r.x0, r.y1]]) {
        pos.push(x, 0, -y);
        nrm.push(0, 1, 0);
        uv.push(x / 2.2, y / 2.2);
      }
      idx.push(k, k + 2, k + 1, k, k + 3, k + 2);
    }
    const m = new Mesh(`obsh:water:${room}`, this.scene);
    const vd = new VertexData();
    vd.positions = pos;
    vd.indices = idx;
    vd.normals = nrm;
    vd.uvs = uv;
    vd.applyToMesh(m, false);
    m.material = waterMaterial(this.scene);
    m.position.y = z + WATER_M;
    m.layerMask = PORTAL_LAYER;
    m.isPickable = false;
    m.checkCollisions = false;
    this.by.set(room, { mesh: m, used: now });
    return m;
  }

  /** Рябь (сдвиг текстуры, лёгкое колыхание) и уборка давно не нужных. */
  update() {
    const now = performance.now();
    const t = now / 1000;
    const m = waterMat;
    if (m?.diffuseTexture) {
      const tex = m.diffuseTexture as Texture;
      tex.uOffset = (t * 0.013) % 1;
      tex.vOffset = (Math.sin(t * 0.21) * 0.04 + t * 0.006) % 1;
    }
    for (const [room, w] of this.by) {
      if (now - w.used > 20000) {
        w.mesh.dispose(false, false);
        this.by.delete(room);
        continue;
      }
      const base = w.mesh.metadata?.base ?? (w.mesh.metadata = { base: w.mesh.position.y }).base;
      w.mesh.position.y = base + 0.006 * Math.sin(t * 1.3 + room.length);
      w.mesh.computeWorldMatrix(true);
    }
  }

  dispose() {
    for (const w of this.by.values()) w.mesh.dispose(false, false);
    this.by.clear();
  }
}

// ───────────────────────── темнота за запертой дверью ─────────────────────────

export class VoidPlanes {
  private by = new Map<string, Mesh>();
  private mat: StandardMaterial;

  constructor(private readonly scene: Scene) {
    const m = (this.mat = new StandardMaterial('obsh:void', scene));
    m.diffuseColor = Color3.Black();
    m.specularColor = Color3.Black();
    m.emissiveColor = new Color3(0.004, 0.004, 0.004);
    m.disableLighting = true;
    m.backFaceCulling = false;
  }

  /** Чёрный проём запертой двери (на грани стены коридора, чуть в коридор). */
  get(d: ObshDoor, heightM = 2.1): Mesh {
    let m = this.by.get(d.id);
    if (m) return m;
    m = CreatePlane(`obsh:void:${d.id}`, { width: Math.max(0.3, d.widthM - 0.02), height: heightM - 0.01 }, this.scene);
    m.material = this.mat;
    m.position.set(d.x + d.nx * 0.002, d.z + heightM / 2, -(d.y + d.ny * 0.002));
    m.rotation.y = Math.atan2(d.nx, -d.ny);
    m.layerMask = PORTAL_LAYER;
    m.isPickable = false;
    m.computeWorldMatrix(true);
    this.by.set(d.id, m);
    return m;
  }

  drop(id: string) {
    this.by.get(id)?.dispose(false, false);
    this.by.delete(id);
  }

  dispose() {
    for (const m of this.by.values()) m.dispose(false, false);
    this.by.clear();
    this.mat.dispose();
  }
}

// ───────────────────────── рука: заглушка и коллайдеры ─────────────────────────

/** Как рисовать руку по виду механики: HandMeshRender (src/view3d/obshagaHand.ts) или заглушка HandPlaceholder. */
export interface HandRender {
  /** вид руки (null — нет); zOf — пол комнаты точки, м; roomOf — комната точки (по полу); doorway — проём двери руки */
  update(v: HandView | null, dt: number, ctx: { zOf(room: string | undefined): number; roomOf(p: Pt): string | null; doorway?: Pt | null }): void;
  /** меши руки, что рисуются вместе с комнатой room */
  meshes(room: string): readonly Mesh[] | undefined;
  /** свои коллайдеры: включить у комнат с коллизиями (нет метода — коллайдеры ArmColliders) */
  colliders?(on: boolean, colliding: (room: string) => boolean): void;
  /** куда ставить схваченного (мир Babylon), null — по кончику */
  grip?(): Vector3 | null;
  /** сколько коллайдеров у руки сейчас (QA) */
  colliderCount?(): number;
  dispose(): void;
}

/** Настоящая рука (src/view3d/obshagaHand.ts): модель во весь коридор, пальцы, кулак, свои коллайдеры по комнатам. */
export class HandMeshRender implements HandRender {
  private readonly hm: HandMesh;

  constructor(scene: Scene) {
    this.hm = new HandMesh(scene, { corridorW: 2, ceilH: 2.5 });
  }

  update(v: HandView | null, _dt: number, ctx: { zOf(room: string | undefined): number; doorway?: Pt | null }) {
    this.hm.update(v, (p) => new Vector3(p.x, ctx.zOf(p.room), -p.y), performance.now() / 1000, ctx.doorway ?? null);
  }

  meshes(room: string): readonly Mesh[] | undefined {
    return this.hm.byRoom().get(room);
  }

  colliders(on: boolean, colliding: (room: string) => boolean) {
    for (const [room, list] of this.hm.colliders()) {
      const c = on && colliding(room);
      for (const m of list) m.checkCollisions = c;
    }
  }

  grip(): Vector3 | null {
    return this.hm.fistCenter();
  }

  colliderCount(): number {
    return this.hm.stats().colliders;
  }

  dispose() {
    this.hm.dispose();
  }
}

/** Рука: настоящая модель, а если не собралась — заглушка. */
export function makeHand(scene: Scene): HandRender {
  try {
    return new HandMeshRender(scene);
  } catch (e) {
    console.error(e);
    return new HandPlaceholder(scene);
  }
}

/** Высота оси руки над полом, м; радиус у двери и у кисти. */
const ARM_Y = 1.0;
const ARM_R0 = 0.78;
const ARM_R1 = 0.5;
/** Коллайдер руки: ширина и высота, м (проход 2 м — не протиснуться). */
const COL_W = 1.55;
const COL_H = 2.2;

/** Точки руки для рисования и коллайдеров: не чаще step м, с концами. */
export function armSamples(trail: readonly Pt[], step = 0.6): Pt[] {
  if (trail.length <= 2) return trail.slice();
  const out: Pt[] = [trail[0]];
  let acc = 0;
  for (let i = 1; i < trail.length - 1; i++) {
    const a = trail[i - 1], b = trail[i];
    acc += Math.hypot(b.x - a.x, b.y - a.y);
    const turn = i + 1 < trail.length ? Math.abs(Math.atan2(trail[i + 1].y - b.y, trail[i + 1].x - b.x) - Math.atan2(b.y - a.y, b.x - a.x)) : 0;
    if (acc >= step || (turn > 0.3 && turn < 2 * Math.PI - 0.3) || b.room !== a.room) {
      out.push(b);
      acc = 0;
    }
  }
  out.push(trail[trail.length - 1]);
  return out;
}

export class HandPlaceholder implements HandRender {
  private segs: Mesh[] = [];
  private palm: Mesh;
  private fingers: Mesh[] = [];
  private byRoom = new Map<string, Mesh[]>();
  private mat: StandardMaterial;
  private q = new Quaternion();

  constructor(private readonly scene: Scene) {
    const m = (this.mat = new StandardMaterial('obsh:handSkin', scene));
    m.diffuseColor = new Color3(0.58, 0.53, 0.5);
    m.specularColor = new Color3(0.06, 0.05, 0.05);
    this.palm = this.prep(CreateSphere('obsh:handPalm', { diameter: 1, segments: 10 }, scene));
    for (let i = 0; i < 5; i++) this.fingers.push(this.prep(CreateCylinder(`obsh:handFinger${i}`, { height: 1, diameterTop: 0.6, diameterBottom: 1, tessellation: 8 }, scene)));
  }

  private prep(m: Mesh): Mesh {
    m.material = this.mat;
    m.layerMask = PORTAL_LAYER;
    m.isPickable = false;
    m.rotationQuaternion = new Quaternion();
    m.setEnabled(false);
    return m;
  }

  private seg(i: number): Mesh {
    while (this.segs.length <= i) this.segs.push(this.prep(CreateCylinder(`obsh:armSeg${this.segs.length}`, { height: 1, diameter: 1, tessellation: 14 }, this.scene)));
    return this.segs[i];
  }

  private put(room: string | null | undefined, m: Mesh) {
    if (!room) return;
    let l = this.byRoom.get(room);
    if (!l) this.byRoom.set(room, (l = []));
    if (!l.includes(m)) l.push(m);
  }

  /** Цилиндр от a до b (Babylon), радиус r. */
  private orient(m: Mesh, a: Vector3, b: Vector3, r: number, extra = 0) {
    const d = b.subtract(a);
    const len = d.length();
    m.position.copyFrom(a.add(b).scale(0.5));
    if (len > 1e-6) Quaternion.FromUnitVectorsToRef(Vector3.Up(), d.scale(1 / len), this.q);
    m.rotationQuaternion!.copyFrom(this.q);
    m.scaling.set(r * 2, Math.max(0.01, len + extra), r * 2);
    m.setEnabled(true);
    m.computeWorldMatrix(true);
  }

  update(v: HandView | null, _dt: number, ctx: { zOf(room: string | undefined): number; roomOf(p: Pt): string | null }) {
    this.byRoom.clear();
    for (const m of [...this.segs, this.palm, ...this.fingers]) m.setEnabled(false);
    if (!v || !v.visible || v.trail.length < 2) return;
    const pts = armSamples(v.trail);
    const rooms = pts.map((p) => ctx.roomOf(p) ?? p.room ?? null);
    const P = pts.map((p, i) => new Vector3(p.x, ctx.zOf(rooms[i] ?? p.room) + ARM_Y, -p.y));
    const n = pts.length;
    for (let i = 1; i < n; i++) {
      const m = this.seg(i - 1);
      const u = (i - 0.5) / n;
      this.orient(m, P[i - 1], P[i], ARM_R0 + (ARM_R1 - ARM_R0) * u, 0.25);
      this.put(rooms[i - 1], m);
      this.put(rooms[i], m);
    }
    // кисть: ладонь вниз по направлению руки, пальцы вперёд и в стороны (подёргиваются)
    const tip = P[n - 1];
    const room = rooms[n - 1];
    const h = v.heading;
    const fx = Math.cos(h), fz = -Math.sin(h);
    const t = performance.now() / 1000;
    this.palm.position.set(tip.x + fx * 0.35, tip.y - 0.15, tip.z + fz * 0.35);
    Quaternion.FromEulerAnglesToRef(0, Math.atan2(fx, fz), 0, this.palm.rotationQuaternion!);
    this.palm.scaling.set(1.15, 0.36, 0.95);
    this.palm.setEnabled(true);
    this.palm.computeWorldMatrix(true);
    this.put(room, this.palm);
    const twitch = v.frozen ? 0 : 0.08 * Math.sin(t * 3 + v.variant * 10);
    for (let i = 0; i < 5; i++) {
      const thumb = i === 4;
      const spread = thumb ? 1.15 : -0.42 + i * 0.28;
      const a = h + spread;
      const base = new Vector3(tip.x + fx * 0.55 + Math.cos(a) * 0.15, tip.y - 0.2, tip.z + fz * 0.55 - Math.sin(a) * 0.15);
      const L = thumb ? 0.55 : 0.85 + 0.1 * Math.sin(i * 2.1);
      const end = base.add(new Vector3(Math.cos(a) * L, -0.25 - twitch * (i % 2 ? 1 : -1), -Math.sin(a) * L));
      this.orient(this.fingers[i], base, end, thumb ? 0.09 : 0.075);
      this.put(room, this.fingers[i]);
    }
  }

  meshes(room: string): readonly Mesh[] | undefined {
    return this.byRoom.get(room);
  }

  dispose() {
    for (const m of [...this.segs, this.palm, ...this.fingers]) m.dispose(false, false);
    this.mat.dispose();
  }
}

/** Невидимые коллайдеры по следу руки: включены у отрезков в комнатах с коллизиями (текущая и сосед у порога). */
export class ArmColliders {
  private boxes: Mesh[] = [];
  private q = new Quaternion();

  constructor(private readonly scene: Scene) {}

  private box(i: number): Mesh {
    while (this.boxes.length <= i) {
      const b = CreateBox(`obsh:armCol${this.boxes.length}`, { size: 1 }, this.scene);
      b.isVisible = false;
      b.isPickable = false;
      b.layerMask = PORTAL_LAYER;
      b.rotationQuaternion = new Quaternion();
      b.checkCollisions = false;
      this.boxes.push(b);
    }
    return this.boxes[i];
  }

  update(v: HandView | null, on: boolean, ctx: { zOf(room: string | undefined): number; roomOf(p: Pt): string | null; colliding(room: string): boolean }) {
    let used = 0;
    if (v && v.visible && on && v.trail.length >= 2) {
      const pts = armSamples(v.trail, 1.0);
      for (let i = 1; i < pts.length; i++) {
        const a = pts[i - 1], b = pts[i];
        const ra = ctx.roomOf(a) ?? a.room, rb = ctx.roomOf(b) ?? b.room;
        if (!(ra && ctx.colliding(ra)) && !(rb && ctx.colliding(rb))) continue;
        const len = Math.hypot(b.x - a.x, b.y - a.y);
        if (len < 0.05) continue;
        const m = this.box(used++);
        const z = Math.min(ctx.zOf(ra), ctx.zOf(rb));
        m.position.set((a.x + b.x) / 2, z + COL_H / 2, -(a.y + b.y) / 2);
        Quaternion.FromEulerAnglesToRef(0, Math.atan2(b.x - a.x, -(b.y - a.y)), 0, this.q);
        m.rotationQuaternion!.copyFrom(this.q);
        m.scaling.set(COL_W, COL_H, len + 0.2);
        m.checkCollisions = true;
        m.setEnabled(true);
        m.computeWorldMatrix(true);
      }
    }
    for (let i = used; i < this.boxes.length; i++) {
      this.boxes[i].checkCollisions = false;
      this.boxes[i].setEnabled(false);
    }
  }

  dispose() {
    for (const b of this.boxes) b.dispose(false, false);
    this.boxes = [];
  }
}
