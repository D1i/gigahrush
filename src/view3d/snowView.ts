// Снежные ходы в Babylon: меш оболочки куска (сетка — ./snowMesh.ts), материал снега, зерно снега (карта нормалей
// из шума, без файлов), коллайдер — та же полость гладкой сеткой с шагом 10 см (камера в лазе ползёт по ней).
//
// Материал: матовый холодный снег (палитра набора пользователя snow-models: 0.85…0.95), вершинные цвета — затенение
// впадин и чуть светлее свод; слабое собственное свечение (умножается на цвет вершины — свод светится сильнее): свет
// сквозь толщу снега, как на концептах набора. Блики — едва заметные, ледяные.
import type { Scene } from '@babylonjs/core/scene';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Material } from '@babylonjs/core/Materials/material';
import { RawTexture } from '@babylonjs/core/Materials/Textures/rawTexture';
import { Texture } from '@babylonjs/core/Materials/Textures/texture';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture';
import { buildSnowMesh, snowSpecOf, vnoise, type SnowDoorState, type SnowMeshData, type SnowPieceSpec } from './snowMesh';
import type { RunConnector, RunExport, RunInstance } from '../blockout/types';
// воркер — встроенный (сборка в один HTML: отдельного файла воркера нет)
import SnowWorker from './snowWorker?worker&inline';

const mats = new WeakMap<Scene, { snow: StandardMaterial; collider: StandardMaterial }>();

/** Зерно снега: бесшовная карта нормалей size² (бугорки 2–4 см на повтор 0.6 м). */
export function snowGrain(scene: Scene, size = 256): Texture {
  const h = new Float32Array(size * size);
  // периодический шум: решётка по модулю периода — повтор без шва
  const per = (x: number, y: number, p: number, s: number) => {
    const xi = Math.floor(x), yi = Math.floor(y);
    const fx = x - xi, fy = y - yi;
    const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
    const c = (a: number, b: number) => (vnoise(((xi + a) % p + p) % p, ((yi + b) % p + p) % p, 0.5, s) + 1) / 2;
    return (c(0, 0) * (1 - u) + c(1, 0) * u) * (1 - v) + (c(0, 1) * (1 - u) + c(1, 1) * u) * v;
  };
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const fx = x / size, fy = y / size;
      h[y * size + x] = per(fx * 8, fy * 8, 8, 11) * 0.5 + per(fx * 24, fy * 24, 24, 12) * 0.3 + per(fx * 64, fy * 64, 64, 13) * 0.2;
    }
  }
  const data = new Uint8Array(size * size * 4);
  const H = (x: number, y: number) => h[((y + size) % size) * size + ((x + size) % size)];
  const k = 3.2;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (H(x + 1, y) - H(x - 1, y)) * k, dy = (H(x, y + 1) - H(x, y - 1)) * k;
      const l = Math.hypot(dx, dy, 1);
      const o = (y * size + x) * 4;
      data[o] = Math.round((-dx / l * 0.5 + 0.5) * 255);
      data[o + 1] = Math.round((-dy / l * 0.5 + 0.5) * 255);
      data[o + 2] = Math.round((1 / l * 0.5 + 0.5) * 255);
      data[o + 3] = 255;
    }
  }
  const t = RawTexture.CreateRGBATexture(data, size, size, scene, true, false, Texture.TRILINEAR_SAMPLINGMODE);
  t.name = 'snow:grain';
  t.wrapU = t.wrapV = Texture.WRAP_ADDRESSMODE;
  return t;
}

/** Материалы снега сцены (один на сцену). */
export function snowMaterials(scene: Scene): { snow: StandardMaterial; collider: StandardMaterial } {
  let m = mats.get(scene);
  if (m) return m;
  const snow = new StandardMaterial('snow:shell', scene);
  snow.diffuseColor = new Color3(0.93, 0.96, 1.0);
  snow.specularColor = new Color3(0.09, 0.1, 0.12);
  snow.specularPower = 28;
  snow.emissiveColor = new Color3(0.05, 0.058, 0.07);
  snow.bumpTexture = snowGrain(scene);
  snow.bumpTexture.level = 0.55;
  // сетка оболочки — изнутри: обход граней не важен (свет — по нормалям вершин)
  snow.backFaceCulling = false;
  const collider = new StandardMaterial('snow:collider', scene);
  collider.disableColorWrite = true;
  collider.disableDepthWrite = true;
  m = { snow, collider };
  mats.set(scene, m);
  return m;
}

/** Меш из данных сетки (координаты — уже Babylon). */
export function meshOf(scene: Scene, name: string, d: SnowMeshData, withAttrs = true): Mesh {
  const mesh = new Mesh(name, scene);
  const vd = new VertexData();
  vd.positions = d.positions;
  vd.indices = d.indices;
  if (withAttrs) {
    vd.normals = d.normals;
    vd.colors = d.colors;
    vd.uvs = d.uvs;
  }
  vd.applyToMesh(mesh, false);
  return mesh;
}

export interface SnowPieceMeshes {
  shell: Mesh;
  /** гладкая полость 10 см — коллайдер (невидимый) */
  collider: Mesh;
  /** прочее видимое (пятно подтаявшего снега) */
  extra: Mesh[];
  ms: number;
}

/** Оболочка и коллайдер куска. data — готовая сетка (из кэша / воркера), иначе строится здесь. */
export function buildSnowPiece(scene: Scene, name: string, spec: SnowPieceSpec, data?: SnowMeshData, col?: SnowMeshData): SnowPieceMeshes {
  const t0 = performance.now();
  const { snow, collider } = snowMaterials(scene);
  const shell = meshOf(scene, name + ':snow', data ?? buildSnowMesh(spec));
  shell.material = snow;
  const c = meshOf(scene, name + ':snowcol', col ?? buildSnowMesh(spec, 0.1, false), false);
  c.material = collider;
  c.isVisible = false;
  c.checkCollisions = true;
  return { shell, collider: c, extra: [], ms: performance.now() - t0 };
}

// ───────────────────────── подтаявший снег: пятно в полу берлоги ─────────────────────────

export interface ThawPatch {
  mesh: Mesh;
  /** трещины: stage 0…1 */
  crack(stage: number): void;
}

const patches = new WeakMap<Scene, Map<string, ThawPatch>>();

/** Пятно подтаявшей берлоги id (есть, пока её кусок построен). */
export function thawPatchOf(scene: Scene, id: string): ThawPatch | null {
  return patches.get(scene)?.get(id) ?? null;
}

/** Пятно: мокрый тёмный снег, тёплый отсвет снизу (ламп ангара), трещины по ударам. */
function thawPatch(scene: Scene, id: string, x: number, y: number, floorY: number): ThawPatch {
  const S = 256;
  const tex = new DynamicTexture(`snow:thaw:${id}`, { width: S, height: S }, scene, true);
  tex.hasAlpha = true;
  const draw = (stage: number) => {
    const g = tex.getContext() as CanvasRenderingContext2D;
    // мокрая каша: тёмная середина (снизу просвечивает тёплое), к краю — серый подтаявший снег; край — неровный, вырезом
    // по альфе (портальный рендер куски не смешивает: полупрозрачное рисовалось бы чёрным); за краем цвет — снег
    const img = g.createImageData(S, S);
    const lerp = (a: number[], b: number[], t: number) => a.map((v, k) => v + (b[k] - v) * t);
    const C0 = [96, 72, 54], C1 = [58, 62, 70], C2 = [128, 136, 150], SNOW = [205, 212, 224];
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        const dx = x - S / 2 + 0.5, dy = y - S / 2 + 0.5;
        const r = Math.hypot(dx, dy) / (S / 2);
        const a = Math.atan2(dy, dx);
        const edge = 0.74 + 0.07 * Math.sin(a * 3 + 1.3) + 0.05 * Math.sin(a * 7 + 0.4) + 0.03 * Math.sin(a * 13);
        const c = r < 0.3 ? lerp(C0, C1, r / 0.3) : r < edge ? lerp(C1, C2, (r - 0.3) / Math.max(0.05, edge - 0.3)) : SNOW;
        const o = (y * S + x) * 4;
        img.data[o] = c[0];
        img.data[o + 1] = c[1];
        img.data[o + 2] = c[2];
        img.data[o + 3] = r < edge ? 255 : 0;
      }
    }
    g.putImageData(img, 0, 0);
    // трещины: лучи от середины, длиннее с каждым ударом; сквозь них — свет ангара
    let h = 0x9e3779b9 ^ id.length;
    const rnd = () => ((h = Math.imul(h ^ (h >>> 15), 2246822507) >>> 0) / 4294967296);
    const n = Math.round(4 + 8 * stage);
    g.lineCap = 'round';
    for (let k = 0; k < n; k++) {
      let a = rnd() * Math.PI * 2, px = S / 2, py = S / 2;
      const len = (0.12 + 0.24 * stage) * S * (0.6 + 0.4 * rnd());
      g.strokeStyle = `rgba(255,170,80,${0.5 + 0.5 * stage})`;
      g.lineWidth = 1 + 2 * stage;
      g.beginPath();
      g.moveTo(px, py);
      for (let t = 0; t < len; t += 8) {
        a += (rnd() - 0.5) * 0.7;
        px += Math.cos(a) * 8;
        py += Math.sin(a) * 8;
        g.lineTo(px, py);
      }
      g.stroke();
    }
    tex.update();
  };
  draw(0);
  const mat = new StandardMaterial(`snow:thawMat:${id}`, scene);
  mat.diffuseTexture = tex;
  mat.emissiveTexture = tex;
  mat.emissiveColor = new Color3(0.3, 0.17, 0.07);
  mat.useAlphaFromDiffuseTexture = true;
  mat.transparencyMode = Material.MATERIAL_ALPHATEST;
  mat.alphaCutOff = 0.5;
  mat.specularColor = new Color3(0.35, 0.36, 0.4);
  mat.specularPower = 60;
  mat.backFaceCulling = false;
  mat.zOffset = -2;
  const mesh = MeshBuilder.CreateDisc(`snow:thaw:${id}`, { radius: 0.7, tessellation: 28 }, scene);
  mesh.rotation.x = Math.PI / 2;
  mesh.position.set(x, floorY + 0.02, -y);
  mesh.material = mat;
  mesh.isPickable = false;
  return { mesh, crack: draw };
}

// ───────────────────────── куски мира: спецификация, кэш, воркер ─────────────────────────

/** Комната снежных ходов (по тегам экземпляра). */
export const isSnowRoom = (inst: Pick<RunInstance, 'roomTags'> | null | undefined): boolean => !!inst?.roomTags.includes('снег');

/** Состояние проёма куска по метке экспорта: связан / не раскрыт / выход — открыт; завал — пробка; остальное
 *  (тупик, приход перехода) — глухо. */
export function snowDoorState(k: RunConnector): SnowDoorState {
  if (k.collapsed) return 'collapsed';
  if (k.linkedTo || k.cut || k.exit) return 'open';
  return 'closed';
}

/** Спецификация куска экземпляра id прогона. */
export function snowSpecFor(run: RunExport, id: string): { spec: SnowPieceSpec; key: string } | null {
  const inst = run.instances.find((i) => i.id === id);
  if (!inst || !isSnowRoom(inst)) return null;
  const gap = typeof run.settings?.gap === 'number' ? run.settings.gap : 1;
  const states = new Map(inst.connectors.map((k) => [k.id, snowDoorState(k)]));
  const spec = snowSpecOf(inst, run.cellM > 0 ? run.cellM : 0.1, (c) => states.get(c) ?? 'closed', gap);
  // раскопка завала — пробка меньше (четвертями: кусок пересобирается 3 раза)
  for (const d of spec.doors) {
    const k = inst.connectors.find((x) => x.id === d.id);
    if (k?.collapsed && k.dug) d.dug = k.dug;
  }
  const key = `${id}|${inst.connectors.map((k) => (states.get(k.id) ?? 'c')[0] + (k.collapsed && k.dug ? k.dug : '')).join('')}|${spec.x0},${spec.y0},${spec.floorY}`;
  return { spec, key };
}

interface Built {
  shell: SnowMeshData;
  col: SnowMeshData;
}

/** Кэш сеток кусков (по экземпляру и состояниям проёмов) и воркер: prefetch — заранее, take — сейчас (готово —
 *  из кэша, иначе строится на месте). */
export class SnowMeshCache {
  private done = new Map<string, Built>();
  private queued = new Set<string>();
  private worker: Worker | null = null;
  private failed = false;
  /** сколько кусков построено на месте (воркер не успел) — для QA */
  syncBuilt = 0;
  workerBuilt = 0;

  constructor(private readonly limit = 160) {}

  private ensureWorker(): Worker | null {
    if (this.worker || this.failed || typeof Worker === 'undefined') return this.worker;
    try {
      this.worker = new SnowWorker();
      this.worker.onmessage = (e: MessageEvent<{ key: string; shell?: SnowMeshData; col?: SnowMeshData; error?: string }>) => {
        const { key, shell, col, error } = e.data;
        this.queued.delete(key);
        if (error || !shell || !col) return;
        this.workerBuilt++;
        this.put(key, { shell, col });
      };
      this.worker.onerror = () => {
        this.failed = true;
        this.worker?.terminate();
        this.worker = null;
      };
    } catch {
      this.failed = true;
    }
    return this.worker;
  }

  private put(key: string, b: Built) {
    this.done.set(key, b);
    if (this.done.size > this.limit) this.done.delete(this.done.keys().next().value as string);
  }

  prefetch(spec: SnowPieceSpec, key: string) {
    if (this.done.has(key) || this.queued.has(key)) return;
    const w = this.ensureWorker();
    if (!w) return;
    this.queued.add(key);
    w.postMessage({ key, spec });
  }

  take(spec: SnowPieceSpec, key: string): Built {
    const hit = this.done.get(key);
    if (hit) return hit;
    this.syncBuilt++;
    const b = { shell: buildSnowMesh(spec), col: buildSnowMesh(spec, 0.1, false) };
    this.put(key, b);
    return b;
  }

  dispose() {
    this.worker?.terminate();
    this.worker = null;
    this.done.clear();
    this.queued.clear();
  }
}

const caches = new WeakMap<Scene, SnowMeshCache>();
export function snowCache(scene: Scene): SnowMeshCache {
  let c = caches.get(scene);
  if (!c) caches.set(scene, (c = new SnowMeshCache()));
  return c;
}

/** Заранее — сетки кусков снежных комнат ids (мир вырос). */
export function snowPrefetch(scene: Scene, run: RunExport, ids: Iterable<string>) {
  const c = snowCache(scene);
  for (const id of ids) {
    const s = snowSpecFor(run, id);
    if (s) c.prefetch(s.spec, s.key);
  }
}

/** Оболочка и коллайдер куска мира (портальный рендер): null — не снежная комната. */
export function snowPieceFor(scene: Scene, run: RunExport, id: string): SnowPieceMeshes | null {
  const s = snowSpecFor(run, id);
  if (!s) return null;
  const b = snowCache(scene).take(s.spec, s.key);
  const p = buildSnowPiece(scene, `snow:${id}`, s.spec, b.shell, b.col);
  const inst = run.instances.find((i) => i.id === id)!;
  if (inst.roomTags.includes('подтаявшая')) {
    const t = thawPatch(scene, id, (s.spec.x0 + s.spec.x1) / 2, (s.spec.y0 + s.spec.y1) / 2, s.spec.floorY);
    let m = patches.get(scene);
    if (!m) patches.set(scene, (m = new Map()));
    m.set(id, t);
    t.mesh.onDisposeObservable.add(() => {
      if (m!.get(id) === t) m!.delete(id);
    });
    p.extra.push(t.mesh);
  }
  return p;
}
