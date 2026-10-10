// Земляной погреб в Babylon: меш оболочки куска (сетка — ./cellarMesh.ts), материал чёрной земли, текстура земли
// (крошки, поры, светлые песчинки — из шума, без файлов), кэш сеток и воркер (общие со снежными ходами: ./snowView.ts
// SnowMeshCache, ./snowWorker.ts).
//
// Материал: матовая сырая чёрная земля — цвет в вершинах (чёрно-бурая, к полу темнее, прожилки глины), текстура земли
// и её карта нормалей (крошки 1–4 см на повтор 0.5 м); блик слабый и широкий (сырость); собственного свечения нет —
// света в погребе нет, видно только то, что выхватывает фонарь игрока. Лимит источников поднимает ensureLightSlots
// (./flashlight.ts) — материал обычный StandardMaterial.
//
// Куски мира (портальный рендер, ./portal.ts): у комнаты погреба (первый тег «погреб») стены, потолок, облицовка и пол
// болванки прячутся (isVisible = false; коробки стен и пол — по-прежнему коллайдеры), видна оболочка; двери, предметы,
// крепь — как есть.
import type { Scene } from '@babylonjs/core/scene';
import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { RawTexture } from '@babylonjs/core/Materials/Textures/rawTexture';
import { Texture } from '@babylonjs/core/Materials/Textures/texture';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import type { BabylonBlockout, BlockoutMeta } from '../blockout/babylon';
import type { BlockoutOptions, RunExport } from '../blockout/types';
import { buildCellarMesh, cellarSpecFor, markCellarShell, SOIL_TEX_MEAN, type CellarPieceSpec, type CellarSpecOptions } from './cellarMesh';
import type { SnowMeshData } from './snowMesh';
import { meshOf, SnowMeshCache } from './snowView';

export { isCellarRoom } from './cellarMesh';

// ───────────────────────── текстура земли ─────────────────────────

/** Хэш клетки решётки периода p → 0…1 (по модулю периода — повтор без шва). */
function cellHash(i: number, j: number, p: number, s: number): number {
  const a = ((i % p) + p) % p, b = ((j % p) + p) % p;
  let h = Math.imul(a, 374761393) ^ Math.imul(b, 668265263) ^ Math.imul(s, 1274126177);
  h = Math.imul(h ^ (h >>> 13), 1103515245);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** Клеточный шум (Ворли) периода p клеток на текстуру: F1, F2 (в долях клетки) и номер ближайшей точки. */
function worley(u: number, v: number, p: number, s: number): [number, number, number] {
  const x = u * p, y = v * p;
  const xi = Math.floor(x), yi = Math.floor(y);
  let f1 = 9, f2 = 9, id = 0;
  for (let dj = -1; dj <= 1; dj++) {
    for (let di = -1; di <= 1; di++) {
      const i = xi + di, j = yi + dj;
      const px = i + 0.1 + 0.8 * cellHash(i, j, p, s), py = j + 0.1 + 0.8 * cellHash(i, j, p, s + 1);
      const d = Math.hypot(px - x, py - y);
      if (d < f1) {
        f2 = f1;
        f1 = d;
        id = cellHash(i, j, p, s + 2);
      } else if (d < f2) f2 = d;
    }
  }
  return [f1, f2, id];
}

/** Периодический шум значений (период p клеток на текстуру), 0…1. */
function perNoise(u: number, v: number, p: number, s: number): number {
  const x = u * p, y = v * p;
  const xi = Math.floor(x), yi = Math.floor(y);
  const fx = x - xi, fy = y - yi;
  const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
  const c = (a: number, b: number) => cellHash(xi + a, yi + b, p, s);
  return (c(0, 0) * (1 - sx) + c(1, 0) * sx) * (1 - sy) + (c(0, 1) * (1 - sx) + c(1, 1) * sx) * sy;
}

/**
 * Текстура земли size²: цвет (серый с тёплым оттенком, средняя яркость SOIL_TEX_MEAN — цвет вершин поделён на неё) и
 * карта нормалей. Повтор 0.5 м: мелкая неровная крошка — комочки 1…3 см (клеточный шум двух размеров, у каждого комочка
 * свои радиус, высота и оттенок: суше / сырее), между ними — поры потемнее; пятна (шум значений) и редкие светлые
 * песчинки.
 */
export function soilTextures(scene: Scene, size = 256): { albedo: Texture; normal: Texture } {
  const n = size * size;
  const h = new Float32Array(n), a = new Float32Array(n);
  // период (клеток на текстуру), высота, зерно
  const oct: [number, number, number][] = [[14, 0.7, 21], [34, 0.45, 22]];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u0 = (x + 0.5) / size, v0 = (y + 0.5) / size;
      // комочки неровные: координаты чуть сбиты шумом
      const u = u0 + 0.018 * (perNoise(u0, v0, 10, 51) - 0.5) + 0.008 * (perNoise(u0, v0, 30, 52) - 0.5);
      const v = v0 + 0.018 * (perNoise(u0, v0, 10, 53) - 0.5) + 0.008 * (perNoise(u0, v0, 30, 54) - 0.5);
      let hh = 0, tint = 0, cover = 0;
      for (const [p, w, s] of oct) {
        const [f1, , id] = worley(u, v, p, s);
        // комочек: радиус 0.45…0.85 клетки, высота 0.35…1 — приплюснутый бугорок с пологим краем
        const r = 0.45 + 0.4 * cellHash(Math.floor(id * 9973), 7, 1 << 20, s + 5);
        const k = 0.35 + 0.65 * cellHash(Math.floor(id * 7919), 3, 1 << 20, s + 9);
        const t = Math.min(1, f1 / r);
        cover = Math.max(cover, 1 - t);
        const dome = w * k * (1 - t * t) * (1 - t * t);
        if (dome > hh) {
          hh = dome;
          tint = (id - 0.5) * 2;
        }
      }
      // зернистость (шум значений нескольких масштабов) и пятна
      const g1 = perNoise(u0, v0, 64, 41), g2 = perNoise(u0, v0, 128, 42);
      const blot = perNoise(u0, v0, 5, 43) * 0.6 + perNoise(u0, v0, 16, 44) * 0.4;
      hh += 0.16 * g1 + 0.1 * g2;
      const o = y * size + x;
      h[o] = hh;
      const pore = 1 - Math.min(1, cover * 2.5);
      const speck = cellHash(x * 7 + 3, y * 13 + 5, 1 << 20, 31) > 0.99 ? 0.25 : cellHash(x * 5 + 1, y * 11 + 7, 1 << 20, 33) > 0.985 ? -0.2 : 0;
      a[o] = 0.66 + 0.12 * Math.min(1, hh) - 0.08 * pore + 0.07 * tint + 0.18 * (blot - 0.5) + 0.1 * (g2 - 0.5) + speck;
    }
  }
  // средняя яркость — SOIL_TEX_MEAN
  let mean = 0;
  for (let i = 0; i < n; i++) mean += Math.min(1, Math.max(0, a[i]));
  mean /= n;
  const k = SOIL_TEX_MEAN / (mean || 1);
  const col = new Uint8Array(n * 4), nor = new Uint8Array(n * 4);
  const H = (x: number, y: number) => h[((y + size) % size) * size + ((x + size) % size)];
  const st = 2.6;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const o = y * size + x;
      const c = Math.min(1, Math.max(0, a[o] * k));
      col[o * 4] = Math.round(Math.min(1, c * 1.04) * 255);
      col[o * 4 + 1] = Math.round(c * 255);
      col[o * 4 + 2] = Math.round(c * 0.94 * 255);
      col[o * 4 + 3] = 255;
      const dx = (H(x + 1, y) - H(x - 1, y)) * st, dy = (H(x, y + 1) - H(x, y - 1)) * st;
      const l = Math.hypot(dx, dy, 1);
      nor[o * 4] = Math.round((-dx / l * 0.5 + 0.5) * 255);
      nor[o * 4 + 1] = Math.round((-dy / l * 0.5 + 0.5) * 255);
      nor[o * 4 + 2] = Math.round((1 / l * 0.5 + 0.5) * 255);
      nor[o * 4 + 3] = 255;
    }
  }
  const albedo = RawTexture.CreateRGBATexture(col, size, size, scene, true, false, Texture.TRILINEAR_SAMPLINGMODE);
  albedo.name = 'cellar:soil';
  const normal = RawTexture.CreateRGBATexture(nor, size, size, scene, true, false, Texture.TRILINEAR_SAMPLINGMODE);
  normal.name = 'cellar:soilNormal';
  for (const t of [albedo, normal]) {
    t.wrapU = t.wrapV = Texture.WRAP_ADDRESSMODE;
    t.anisotropicFilteringLevel = 4;
  }
  return { albedo, normal };
}

const mats = new WeakMap<Scene, StandardMaterial>();

/** Материал земли погреба (один на сцену). */
export function cellarMaterial(scene: Scene): StandardMaterial {
  let m = mats.get(scene);
  if (m) return m;
  m = new StandardMaterial('cellar:earth', scene);
  const { albedo, normal } = soilTextures(scene);
  m.diffuseColor = Color3.White();
  m.diffuseTexture = albedo;
  m.bumpTexture = normal;
  m.bumpTexture.level = 0.9;
  // сырая земля: блик слабый и широкий, свечения нет
  m.specularColor = new Color3(0.06, 0.055, 0.05);
  m.specularPower = 14;
  m.emissiveColor = Color3.Black();
  m.ambientColor = Color3.Black();
  // сетка полости — изнутри: обход граней не важен (свет — по нормалям вершин)
  m.backFaceCulling = false;
  m.onDisposeObservable.add(() => {
    albedo.dispose();
    normal.dispose();
    if (mats.get(scene) === m) mats.delete(scene);
  });
  mats.set(scene, m);
  return m;
}

/** Оболочка куска: data — готовая сетка (из кэша / воркера), иначе строится здесь. */
export function buildCellarPiece(scene: Scene, name: string, spec: CellarPieceSpec, data?: SnowMeshData): { shell: Mesh; ms: number } {
  const t0 = performance.now();
  const shell = meshOf(scene, name + ':earth', data ?? buildCellarMesh(spec));
  shell.material = cellarMaterial(scene);
  shell.isPickable = false;
  shell.checkCollisions = false;
  // поле полости — по мешу (руки на стене ложатся на бугры земли: ./cellarWalk.ts)
  markCellarShell(shell, spec);
  return { shell, ms: performance.now() - t0 };
}

// ───────────────────────── куски мира: кэш, воркер, болванка ─────────────────────────

/** Что нужно спецификации куска из настроек болванки портального рендера. */
export function cellarOptsOf(blockout: Partial<BlockoutOptions> | undefined, openCut: boolean): CellarSpecOptions {
  return { doorHeightM: blockout?.doorHeightM, wallHeightM: blockout?.wallHeightM, deadEnds: blockout?.deadEnds, openCut };
}

const caches = new WeakMap<Scene, SnowMeshCache<CellarPieceSpec>>();
export function cellarCache(scene: Scene): SnowMeshCache<CellarPieceSpec> {
  let c = caches.get(scene);
  if (!c) caches.set(scene, (c = new SnowMeshCache<CellarPieceSpec>(160, 'cellar', (s) => ({ shell: buildCellarMesh(s) }))));
  return c;
}

/** Заранее — сетки кусков погреба ids (мир вырос): строит воркер. */
export function cellarPrefetch(scene: Scene, run: RunExport, ids: Iterable<string>, opts: CellarSpecOptions) {
  let c: SnowMeshCache<CellarPieceSpec> | null = null;
  for (const id of ids) {
    const s = cellarSpecFor(run, id, opts);
    if (s) (c ??= cellarCache(scene)).prefetch(s.spec, s.key);
  }
}

/** Оболочка куска мира (портальный рендер): null — не погреб. Высота комнаты (RunInstance.z) — сдвиг меша. */
export function cellarPieceFor(scene: Scene, run: RunExport, id: string, opts: CellarSpecOptions): Mesh | null {
  const s = cellarSpecFor(run, id, opts);
  if (!s) return null;
  const b = cellarCache(scene).take(s.spec, s.key);
  const { shell } = buildCellarPiece(scene, `cellar:${id}`, s.spec, b.shell);
  const z = Number(run.instances.find((i) => i.id === id)?.z) || 0;
  if (z) shell.position.y += z;
  return shell;
}

/** Виды мешей болванки, которые в погребе заменяет оболочка: стены, перемычки, колонны, пол, потолок, облицовка. */
const HIDDEN: ReadonlySet<BlockoutMeta['kind']> = new Set(['wall', 'partition', 'lintel', 'column', 'floor', 'portalFloor', 'ceiling', 'portalCeiling', 'facing']);

/** Спрятать в куске погреба то, что заменяет оболочка (коллизии не трогаются: коробки стен и пол — коллайдеры). */
export function hideCellarBlockout(bo: BabylonBlockout) {
  for (const m of [...bo.walls, ...bo.floors, ...bo.ceilings, ...bo.facings]) {
    const k = (m.metadata as BlockoutMeta | undefined)?.kind;
    if (k && HIDDEN.has(k)) m.isVisible = false;
  }
}
