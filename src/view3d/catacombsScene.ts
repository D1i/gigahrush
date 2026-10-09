// «Катакомбы» в «Прогулке»: то, что рисуется (логика — ./catacombsWalk.ts).
//  • Вода: в каждой нарисованной комнате катакомб — плоскость по прямоугольникам пола куска (с половинами проёмов) на
//    высоте низа комнаты + уровень наводнения (не выше её потолка: в лазе вода под самым сводом). Мутная тёмная
//    зелёно-бурая, слегка прозрачная, рябь (сдвиг текстуры) и колыхание; течение — сильнее на подъёме и пике. В штиль
//    (лужи, уровень ниже PUDDLE_M) — другой материал: та же вода пятнами (прозрачность текстуры), сквозь неё виден пол.
//    Снизу (игрок под водой) — та же плоскость (без отсечения задних граней).
//  • Туман: в катакомбах — лёгкий, к цвету фона (портал заливает им дальние проёмы); под водой — густая муть рядом.
// Меши воды рисует портальный рендер вместе с комнатой (PortalRenderer.extraProviders, слой PORTAL_LAYER).
import type { Scene } from '@babylonjs/core/scene';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture';
import { Texture } from '@babylonjs/core/Materials/Textures/texture';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { PORTAL_LAYER } from './portal';
import { hash01 } from '../locations/stairLoop';

/** Ниже такого уровня (м над полом) — лужи: вода пятнами. */
export const PUDDLE_M = 0.12;
/** Туман в катакомбах (линейный, м): лёгкий — фонарь бьёт на 16 м, дальше и так темно. */
export const CAT_FOG = { start: 3, end: 18 };
/** Под водой: густая муть, м; цвет — тёмный зелёно-бурый. */
export const UNDER_FOG = { start: 0, end: 2.4, color: new Color3(0.035, 0.05, 0.03) };

type Rects = readonly { x0: number; y0: number; x1: number; y1: number }[];

let mats: { scene: Scene; flood: StandardMaterial; puddle: StandardMaterial } | null = null;

/** Текстура воды 256 px: муть (размытые пятна), разводы ряби; puddle — альфа пятнами (лужи), остальное прозрачно. */
function waterTexture(scene: Scene, puddle: boolean): DynamicTexture {
  const tex = new DynamicTexture(puddle ? 'cat:puddleTex' : 'cat:waterTex', { width: 256, height: 256 }, scene, true);
  const g = tex.getContext() as unknown as CanvasRenderingContext2D;
  g.clearRect(0, 0, 256, 256);
  if (!puddle) {
    g.fillStyle = '#272a1c';
    g.fillRect(0, 0, 256, 256);
  }
  // бесшовно — по модулю (копии пятна со сдвигом ±256)
  const blob = (x: number, y: number, r: number, c0: string) => {
    for (const dx of [-256, 0, 256]) for (const dy of [-256, 0, 256]) {
      const gr = g.createRadialGradient(x + dx, y + dy, 0, x + dx, y + dy, r);
      gr.addColorStop(0, c0);
      gr.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = gr;
      g.fillRect(x + dx - r, y + dy - r, 2 * r, 2 * r);
    }
  };
  if (puddle) {
    // лужи: тёмные непрозрачные пятна разного размера
    for (let i = 0; i < 26; i++) blob(hash01(i, 11) * 256, hash01(i, 12) * 256, 18 + hash01(i, 13) * 46, 'rgba(34,38,24,0.95)');
  } else {
    for (let i = 0; i < 150; i++) {
      const light = hash01(i, 4) > 0.55;
      blob(hash01(i, 1) * 256, hash01(i, 2) * 256, 8 + hash01(i, 3) * 36, light ? 'rgba(88,84,52,0.32)' : 'rgba(12,16,8,0.42)');
    }
  }
  g.strokeStyle = puddle ? 'rgba(120,124,96,0.10)' : 'rgba(140,138,104,0.12)';
  g.lineWidth = 1.2;
  for (let i = 0; i < 24; i++) {
    const y0 = hash01(i, 7) * 256;
    g.beginPath();
    for (let x = 0; x <= 256; x += 8) g.lineTo(x, y0 + 4 * Math.sin((x / 256) * Math.PI * 4 + i));
    g.stroke();
  }
  tex.hasAlpha = puddle;
  tex.update();
  tex.wrapU = tex.wrapV = Texture.WRAP_ADDRESSMODE;
  return tex;
}

function materials(scene: Scene): { flood: StandardMaterial; puddle: StandardMaterial } {
  if (mats && mats.scene === scene && scene.materials.includes(mats.flood) && scene.materials.includes(mats.puddle)) return mats;
  const mk = (name: string, puddle: boolean) => {
    const m = new StandardMaterial(name, scene);
    m.diffuseTexture = waterTexture(scene, puddle);
    if (puddle) m.useAlphaFromDiffuseTexture = true;
    m.diffuseColor = new Color3(0.62, 0.62, 0.5);
    // блик фонаря на мокрой поверхности
    m.specularColor = new Color3(0.3, 0.29, 0.22);
    m.specularPower = 48;
    m.emissiveColor = new Color3(0.006, 0.007, 0.004);
    m.alpha = puddle ? 0.9 : 0.86;
    m.backFaceCulling = false;
    return m;
  };
  mats = { scene, flood: mk('cat:water', false), puddle: mk('cat:puddle', true) };
  return mats;
}

/** Вода комнат катакомб: меш на комнату (по полу куска), высота и вид — каждый кадр (update). */
export class CatacombsWater {
  private by = new Map<string, { mesh: Mesh; used: number; y: number }>();
  private t = 0;
  /** вид уровня кадра: лужи / вода; течение 0…1 */
  private shallow = true;
  private flow = 0;

  constructor(private readonly scene: Scene) {}

  /** Меш воды комнаты на высоте y (абс., м): строится по прямоугольникам пола (план, м) один раз. */
  mesh(room: string, rects: Rects, y: number): Mesh {
    const now = performance.now();
    const hit = this.by.get(room);
    if (hit) {
      hit.used = now;
      hit.y = y;
      return hit.mesh;
    }
    const pos: number[] = [], idx: number[] = [], nrm: number[] = [], uv: number[] = [];
    for (const r of rects) {
      const k = pos.length / 3;
      for (const [x, yy] of [[r.x0, r.y0], [r.x1, r.y0], [r.x1, r.y1], [r.x0, r.y1]]) {
        pos.push(x, 0, -yy);
        nrm.push(0, 1, 0);
        uv.push(x / 3.1, yy / 3.1);
      }
      idx.push(k, k + 2, k + 1, k, k + 3, k + 2);
    }
    const m = new Mesh(`cat:water:${room}`, this.scene);
    const vd = new VertexData();
    vd.positions = pos;
    vd.indices = idx;
    vd.normals = nrm;
    vd.uvs = uv;
    vd.applyToMesh(m, false);
    const M = materials(this.scene);
    m.material = this.shallow ? M.puddle : M.flood;
    m.position.y = y;
    m.layerMask = PORTAL_LAYER;
    m.isPickable = false;
    m.checkCollisions = false;
    m.computeWorldMatrix(true);
    this.by.set(room, { mesh: m, used: now, y });
    return m;
  }

  /**
   * Кадр: уровень (м над полом сети — лужи или вода), течение 0…1 (рябь быстрее, колыхание сильнее), меши — на свою
   * высоту с колыханием; давно не нужные — убрать.
   */
  update(dt: number, level: number, flow: number) {
    const now = performance.now();
    this.t += dt * (1 + 2.5 * flow);
    const t = this.t;
    this.flow = flow;
    const M = materials(this.scene);
    const shallow = level < PUDDLE_M;
    for (const m of [M.flood, M.puddle]) {
      const tex = m.diffuseTexture as Texture | null;
      if (!tex) continue;
      // течение — вдоль u, плюс медленный дрейф по v
      tex.uOffset = (t * 0.016) % 1;
      tex.vOffset = (Math.sin(t * 0.19) * 0.05 + t * 0.005) % 1;
    }
    for (const [room, w] of this.by) {
      if (now - w.used > 20000) {
        w.mesh.dispose(false, false);
        this.by.delete(room);
        continue;
      }
      if (shallow !== this.shallow || w.mesh.material !== (shallow ? M.puddle : M.flood)) w.mesh.material = shallow ? M.puddle : M.flood;
      const amp = shallow ? 0.002 : 0.006 + 0.022 * flow;
      w.mesh.position.y = w.y + amp * Math.sin(t * 1.3 + room.length * 0.7) + amp * 0.5 * Math.sin(t * 2.9 + room.length);
      w.mesh.computeWorldMatrix(true);
    }
    this.shallow = shallow;
  }

  /** Сколько мешей воды сейчас (QA). */
  get count(): number {
    return this.by.size;
  }

  /** Течение кадра (QA). */
  get flowNow(): number {
    return this.flow;
  }

  dispose() {
    for (const w of this.by.values()) w.mesh.dispose(false, false);
    this.by.clear();
  }
}
