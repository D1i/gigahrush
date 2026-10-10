// «Фрактальная станция» — жадный мешер ячейки (контракт tmp/metro-wip/FRACTAL.md §3.2). Без Babylon.
//
//  • Грань вокселя рисуется, если сосед по нормали (по модулю P — копии стыкуются без граней) не твёрд. Слой за слоем по
//    каждой оси и знаку нормали маска P×P кодов поверхности сливается в прямоугольники (жадно: вдоль u, потом вдоль v).
//  • lod 0 — всё статичное (подложки эскалаторов — отдельно, meshEscBand: при срыве меш просто прячут; грани каркаса за
//    подложкой рисуются заранее). lod 1 — только каркас, поверхности слиты в 'far' + 'core' (дальние 98 копий).
//  • Обход треугольников — лицевые по часовой при взгляде с нормали (Babylon левосторонний, как sceneStairwell).
//  • uv — метры в плоскости грани: X-грань (z, y), Y-грань (x, z), Z-грань (x, y); плитку задаёт материал (1 / tileW).
import { axisIdx } from './fractalAxes';
import { isStaticVx, VX, type FractalCell } from './fractalCell';

export type Surf = 'granite' | 'trim' | 'marble' | 'marbleDark' | 'core' | 'landing' | 'far';
export interface SurfMesh { surf: Surf; positions: Float32Array; normals: Float32Array; uvs: Float32Array; indices: Uint32Array; quads: number }

const SURFS: readonly Surf[] = ['granite', 'trim', 'marble', 'marbleDark', 'core', 'landing', 'far'];
const SURF_I: Readonly<Record<Surf, number>> = { granite: 0, trim: 1, marble: 2, marbleDark: 3, core: 4, landing: 5, far: 6 };
/** Оси плоскости грани (u, v) для нормали вдоль ax — как uv по контракту. */
const UV_AX: readonly (readonly [number, number])[] = [[2, 1], [0, 2], [0, 1]];
/** Знак (e_u × e_v)[ax]: −1 у X и Y, +1 у Z. */
const UV_SIGN = [-1, -1, 1];
const isFrameVx = (v: number): boolean => v >= VX.SLAB && v <= VX.ROD;

/** Поверхность грани вокселя класса v с нормалью вдоль оси ax (0/1/2). SLAB: ось грани = ось плиты → 'granite', иначе 'trim'. */
export function surfOf(v: number, ax: 0 | 1 | 2, x: number, y: number, z: number, P: number): Surf {
  switch (v) {
    case VX.SLAB: {
      const c = ax === 0 ? x : ax === 1 ? y : z;
      return c === 0 || c === P - 1 ? 'granite' : 'trim';
    }
    case VX.SHELL1: case VX.PYLON: return 'marble';
    case VX.SHELL2: case VX.ROD: return 'marbleDark';
    case VX.CORE: return 'core';
    case VX.LANDING: return 'landing';
    default: return 'granite'; // TERRACE и подложки эскалаторов
  }
}

class Acc {
  pos: number[] = []; nrm: number[] = []; uv: number[] = []; idx: number[] = []; quads = 0;
  constructor(readonly surf: Surf) {}
  out(): SurfMesh {
    return {
      surf: this.surf, positions: new Float32Array(this.pos), normals: new Float32Array(this.nrm), uvs: new Float32Array(this.uv),
      indices: new Uint32Array(this.idx), quads: this.quads,
    };
  }
}

/** Квадрат в плоскости ax = w (м), u ∈ [u0, u1), v ∈ [v0, v1), нормаль s·e_ax. */
function quad(acc: Acc, ax: number, s: 1 | -1, w: number, u0: number, v0: number, u1: number, v1: number): void {
  const [ua, va] = UV_AX[ax];
  const k = acc.pos.length / 3;
  const corners = [[u0, v0], [u1, v0], [u1, v1], [u0, v1]];
  for (const [u, v] of corners) {
    const p = [0, 0, 0];
    p[ax] = w; p[ua] = u; p[va] = v;
    acc.pos.push(p[0], p[1], p[2]);
    const n = [0, 0, 0]; n[ax] = s;
    acc.nrm.push(n[0], n[1], n[2]);
    acc.uv.push(u, v);
  }
  // (A, B, C): cross ∝ UV_SIGN[ax]·e_ax; лицевая — cross · n < 0
  if (UV_SIGN[ax] * s < 0) acc.idx.push(k, k + 1, k + 2, k, k + 2, k + 3);
  else acc.idx.push(k, k + 2, k + 1, k, k + 3, k + 2);
  acc.quads++;
}

/** Жадный проход по коробке lo..hi (воксели) с обёрткой соседей по P. code(i, ax, x, y, z) → индекс SURFS или −1. */
function greedy(
  P: number, vox: Uint8Array, lo: number[], hi: number[],
  include: (v: number) => boolean, solidN: (v: number) => boolean,
  code: (v: number, ax: 0 | 1 | 2, x: number, y: number, z: number) => number,
  accs: (Acc | null)[], mk: (i: number) => Acc,
): void {
  const st = [1, P, P * P];
  for (let ax = 0; ax < 3; ax++) {
    const [ua, va] = UV_AX[ax];
    const nu = hi[ua] - lo[ua], nv = hi[va] - lo[va];
    const mask = new Int8Array(nu * nv);
    for (const s of [1, -1] as const) {
      for (let t = lo[ax]; t < hi[ax]; t++) {
        const tn = (t + s + P) % P;
        let any = false;
        for (let v = 0; v < nv; v++) for (let u = 0; u < nu; u++) {
          const cu = lo[ua] + u, cv = lo[va] + v;
          const base = cu * st[ua] + cv * st[va];
          const vv = vox[base + t * st[ax]];
          let m = -1;
          if (include(vv) && !solidN(vox[base + tn * st[ax]])) {
            const c = [0, 0, 0]; c[ax] = t; c[ua] = cu; c[va] = cv;
            m = code(vv, ax as 0 | 1 | 2, c[0], c[1], c[2]);
          }
          mask[u + nu * v] = m + 1;
          if (m >= 0) any = true;
        }
        if (!any) continue;
        const w = s > 0 ? t + 1 : t;
        for (let v = 0; v < nv; v++) for (let u = 0; u < nu; u++) {
          const m = mask[u + nu * v];
          if (!m) continue;
          let du = 1;
          while (u + du < nu && mask[u + du + nu * v] === m) du++;
          let dv = 1;
          grow: while (v + dv < nv) {
            for (let q = 0; q < du; q++) if (mask[u + q + nu * (v + dv)] !== m) break grow;
            dv++;
          }
          for (let r = 0; r < dv; r++) for (let q = 0; q < du; q++) mask[u + q + nu * (v + r)] = 0;
          const si = m - 1;
          const acc = accs[si] ?? (accs[si] = mk(si));
          quad(acc, ax, s, w, lo[ua] + u, lo[va] + v, lo[ua] + u + du, lo[va] + v + dv);
        }
      }
    }
  }
}

/** Жадный мешер ячейки по поверхностям. lod 0 — всё, кроме подложек эскалаторов; lod 1 — только каркас
 *  (SLAB, SHELL1, SHELL2, CORE, PYLON, ROD), поверхности слиты в 'far' + 'core'. Соседи — по модулю P
 *  (граней между копиями нет). Позиции — м в [0, P]; uv — м в плоскости грани (X-грань: (z, y), Y: (x, z), Z: (x, y)). */
export function meshCell(cell: FractalCell, opts?: { lod?: 0 | 1 }): SurfMesh[] {
  const P = cell.P, lod = opts?.lod ?? 0;
  const accs: (Acc | null)[] = SURFS.map(() => null);
  const mk = (i: number) => new Acc(SURFS[i]);
  if (lod === 1) {
    greedy(P, cell.vox, [0, 0, 0], [P, P, P], isFrameVx, isFrameVx,
      (v) => (v === VX.CORE ? SURF_I.core : SURF_I.far), accs, mk);
  } else {
    greedy(P, cell.vox, [0, 0, 0], [P, P, P], isStaticVx, isStaticVx,
      (v, ax, x, y, z) => SURF_I[surfOf(v, ax, x, y, z, P)], accs, mk);
  }
  return accs.filter((a): a is Acc => a !== null).map((a) => a.out());
}

/** Ступенчатая подложка эскалатора i (отдельно — чтобы при срыве просто спрятать). Проступи и низ (нормаль вдоль up
 *  эскалатора) — 'granite', торцы и бока — 'trim'. */
export function meshEscBand(cell: FractalCell, i: number): SurfMesh[] {
  const P = cell.P, vox = cell.vox, band = VX.ESC0 + i;
  const lo = [P, P, P], hi = [0, 0, 0];
  for (let z = 0, k = 0; z < P; z++) for (let y = 0; y < P; y++) for (let x = 0; x < P; x++, k++) {
    if (vox[k] !== band) continue;
    if (x < lo[0]) lo[0] = x; if (y < lo[1]) lo[1] = y; if (z < lo[2]) lo[2] = z;
    if (x >= hi[0]) hi[0] = x + 1; if (y >= hi[1]) hi[1] = y + 1; if (z >= hi[2]) hi[2] = z + 1;
  }
  if (hi[0] <= lo[0]) return [];
  const e = cell.esc[i];
  const upAx = e ? axisIdx(e.up) : 1;
  const accs: (Acc | null)[] = SURFS.map(() => null);
  greedy(P, vox, lo, hi, (v) => v === band, (v) => v !== VX.AIR,
    (_v, ax) => (ax === upAx ? SURF_I.granite : SURF_I.trim), accs, (k) => new Acc(SURFS[k]));
  return accs.filter((a): a is Acc => a !== null).map((a) => a.out());
}
