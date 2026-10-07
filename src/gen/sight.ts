// Предел дальности обзора (§7 GENERATOR.md): самая длинная прямая линия видимости сквозь связанные
// метки. Проходимое пространство W — клетки экземпляров + клетки проёмов связей. Всё остальное — стена.
import { OUT_SIGN, segLine, segStart, type SegGeom } from './geom';

/** Направления линий: горизонталь, вертикаль, диагонали (+1,+1) и (+1,−1). */
export const SIGHT_DIRS: readonly (readonly [number, number])[] = [[1, 0], [0, 1], [1, 1], [1, -1]];

/** Владелец клетки: ≥ 0 — экземпляр (комната), PORTAL — проём связи, undefined — стена. */
export const PORTAL = -1;
export type OwnerFn = (x: number, y: number) => number | undefined;
/** Множество разрешённых рёбер (ключи edgeKey) — нужно только при gap = 0. */
export interface EdgeSet { readonly size: number; has(k: string): boolean }

/** Ключ ребра между соседними по стороне клетками (для gap = 0, где проёма-клеток нет). */
export function edgeKey(ax: number, ay: number, bx: number, by: number): string {
  return ax < bx || ay < by ? `${ax},${ay},${bx},${by}` : `${bx},${by},${ax},${ay}`;
}

/**
 * Ортогональный шаг a → b (соседи по стороне) разрешён, если обе клетки в W и
 * (один владелец | одна из клеток — проём | ребро лежит в проёме связи при gap = 0).
 */
function orthoOk(own: OwnerFn, edges: EdgeSet, ax: number, ay: number, bx: number, by: number): boolean {
  const oa = own(ax, ay);
  if (oa === undefined) return false;
  const ob = own(bx, by);
  if (ob === undefined) return false;
  if (oa === ob || oa === PORTAL || ob === PORTAL) return true;
  return edges.size > 0 && edges.has(edgeKey(ax, ay, bx, by));
}

/** Шаг из (x, y) в (x+dx, y+dy). Диагональный — только если проходимы оба «угловых» обхода. */
export function stepOk(own: OwnerFn, edges: EdgeSet, x: number, y: number, dx: number, dy: number): boolean {
  if (dx === 0 || dy === 0) return orthoOk(own, edges, x, y, x + dx, y + dy);
  return (
    orthoOk(own, edges, x, y, x + dx, y) && orthoOk(own, edges, x + dx, y, x + dx, y + dy) &&
    orthoOk(own, edges, x, y, x, y + dy) && orthoOk(own, edges, x, y + dy, x + dx, y + dy)
  );
}

/** Предел в клетках по прямой и по диагонали для предела sightM метров. */
export function sightLimits(sightM: number, cellM: number): { ortho: number; diag: number } {
  return { ortho: Math.floor(sightM / cellM + 1e-9), diag: Math.floor(sightM / (cellM * Math.SQRT2) + 1e-9) };
}

/** Длина линии из n клеток в метрах. */
export const runMeters = (n: number, diag: boolean, cellM: number) => n * cellM * (diag ? Math.SQRT2 : 1);

/** Пара соседних по стороне клеток с известными владельцами проходима (см. orthoOk). */
function pairOk(oa: number | undefined, ob: number | undefined, edges: EdgeSet, ax: number, ay: number, bx: number, by: number): boolean {
  if (oa === undefined || ob === undefined) return false;
  if (oa === ob || oa === PORTAL || ob === PORTAL) return true;
  return edges.size > 0 && edges.has(edgeKey(ax, ay, bx, by));
}

/** Сколько шагов подряд можно пройти от (x, y) в направлении (dx, dy); не больше cap + 1. */
function walk(own: OwnerFn, edges: EdgeSet, x: number, y: number, dx: number, dy: number, cap: number): number {
  const diag = dx !== 0 && dy !== 0;
  let o = own(x, y);
  let n = 0;
  while (n <= cap) {
    const nx = x + dx, ny = y + dy;
    const oq = own(nx, ny);
    if (oq === undefined) break;
    if (!diag) {
      if (!pairOk(o, oq, edges, x, y, nx, ny)) break;
    } else {
      const o1 = own(nx, y), o2 = own(x, ny);
      if (
        !pairOk(o, o1, edges, x, y, nx, y) || !pairOk(o1, oq, edges, nx, y, nx, ny) ||
        !pairOk(o, o2, edges, x, y, x, ny) || !pairOk(o2, oq, edges, x, ny, nx, ny)
      ) break;
    }
    x = nx; y = ny; o = oq; n++;
  }
  return n;
}

/**
 * Все линии через клетки seeds (по 4 направлениям) не длиннее предела.
 * От каждой клетки идём назад и вперёд, останавливаясь, как только превысили предел.
 */
export function seedsWithinLimit(
  own: OwnerFn,
  edges: EdgeSet,
  seeds: readonly (readonly [number, number])[],
  lim: { ortho: number; diag: number },
): boolean {
  for (const [dx, dy] of SIGHT_DIRS) {
    const max = dx !== 0 && dy !== 0 ? lim.diag : lim.ortho;
    for (const [sx, sy] of seeds) {
      if (own(sx, sy) === undefined) continue;
      const back = walk(own, edges, sx, sy, -dx, -dy, max);
      if (1 + back > max) return false;
      const fwd = walk(own, edges, sx, sy, dx, dy, max - back);
      if (1 + back + fwd > max) return false;
    }
  }
  return true;
}

export interface SightResult {
  maxM: number;
  /** отрезок «от края до края» в клеточных координатах (углы/края клеток), null — W пуст */
  line: [number, number, number, number] | null;
}

/**
 * Полный скан: самая длинная линия по всему W. Динамика по плотной сетке bbox (с рамкой в 1 клетку):
 * len(c) = шаг(c − d → c) разрешён ? len(c − d) + 1 : 1. Клетки обходятся по возрастанию (y, x),
 * для направления (1, −1) — по убыванию; направления — в порядке SIGHT_DIRS. Побеждает строго
 * большая длина (при равных — найденная раньше); отрезок восстанавливается от конца линии.
 */
export function scanSight(
  cells: { xs: ArrayLike<number>; ys: ArrayLike<number>; owners: ArrayLike<number> },
  edges: EdgeSet,
  cellM: number,
): SightResult {
  const n = cells.xs.length;
  if (n === 0) return { maxM: 0, line: null };
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let i = 0; i < n; i++) {
    const x = cells.xs[i], y = cells.ys[i];
    if (x < x0) x0 = x;
    if (y < y0) y0 = y;
    if (x > x1) x1 = x;
    if (y > y1) y1 = y;
  }
  // рамка в 1 клетку — соседи всегда в пределах сетки
  x0 -= 1; y0 -= 1;
  const W = x1 - x0 + 2, H = y1 - y0 + 2;
  const NONE = -2;
  const grid = new Int32Array(W * H).fill(NONE);
  const idx = new Int32Array(n);
  for (let i = 0; i < n; i++) {
    const g = (cells.ys[i] - y0) * W + (cells.xs[i] - x0);
    grid[g] = cells.owners[i];
    idx[i] = g;
  }
  idx.sort(); // по возрастанию (y, x)
  const useEdges = edges.size > 0;
  const ok = (a: number, b: number): boolean => {
    const oa = grid[a], ob = grid[b];
    if (oa === NONE || ob === NONE) return false;
    if (oa === ob || oa === PORTAL || ob === PORTAL) return true;
    if (!useEdges) return false;
    return edges.has(edgeKey((a % W) + x0, Math.floor(a / W) + y0, (b % W) + x0, Math.floor(b / W) + y0));
  };
  const len = new Int32Array(W * H);
  let best = 0;
  let line: SightResult['line'] = null;
  for (const [dx, dy] of SIGHT_DIRS) {
    const diag = dx !== 0 && dy !== 0;
    const d = dy * W + dx;
    const reverse = dy < 0;
    for (let t = 0; t < n; t++) {
      const c = idx[reverse ? n - 1 - t : t];
      const p = c - d;
      let step: boolean;
      if (!diag) step = ok(p, c);
      else {
        const r1 = p + dx, r2 = p + dy * W; // обходы через угол
        step = ok(p, r1) && ok(r1, c) && ok(p, r2) && ok(r2, c);
      }
      const k = step ? len[p] + 1 : 1;
      len[c] = k;
      const m = runMeters(k, diag, cellM);
      if (m > best + 1e-9) {
        best = m;
        const ex = (c % W) + x0, ey = Math.floor(c / W) + y0;
        line = lineOf(ex - (k - 1) * dx, ey - (k - 1) * dy, dx, dy, k);
      }
    }
  }
  return { maxM: Math.round(best * 1000) / 1000, line };
}

/** Отрезок линии из k клеток от (sx, sy) «от края до края» (длина = k клеток). */
function lineOf(sx: number, sy: number, dx: number, dy: number, k: number): [number, number, number, number] {
  if (dy === 0) return [sx, sy + 0.5, sx + k, sy + 0.5];
  if (dx === 0) return [sx + 0.5, sy, sx + 0.5, sy + k];
  if (dy > 0) return [sx, sy, sx + k, sy + k];
  return [sx, sy + 1, sx + k, sy + 1 - k];
}

/**
 * Проём связи A–B (мировые метки лицом к лицу): при gap ≥ 1 — клетки зазора между линиями меток
 * на пересечении их длин; при gap = 0 клеток нет, проходимы рёбра между клетками A и B на пересечении.
 * seeds — клетки, через которые проходит любая новая линия (проём или клетки A у проёма при gap 0).
 */
export function portalOf(a: SegGeom, b: SegGeom, gap: number): {
  cells: [number, number][];
  edges: string[];
  seeds: [number, number][];
} {
  const horiz = a.side === 'N' || a.side === 'S';
  const lo = Math.max(segStart(a), segStart(b));
  const hi = Math.min(segStart(a) + a.len, segStart(b) + b.len);
  const la = segLine(a);
  const sign = OUT_SIGN[a.side];
  const at = (t: number, nn: number): [number, number] => (horiz ? [t, nn] : [nn, t]);
  const cells: [number, number][] = [];
  const edges: string[] = [];
  if (gap > 0) {
    const n0 = sign > 0 ? la : la - gap;
    for (let t = lo; t < hi; t++) for (let nn = n0; nn < n0 + gap; nn++) cells.push(at(t, nn));
    return { cells, edges, seeds: cells };
  }
  const na = sign > 0 ? la - 1 : la; // клетки A у линии
  const nb = sign > 0 ? la : la - 1; // клетки B у линии
  const seeds: [number, number][] = [];
  for (let t = lo; t < hi; t++) {
    const [ax, ay] = at(t, na);
    const [bx, by] = at(t, nb);
    edges.push(edgeKey(ax, ay, bx, by));
    seeds.push([ax, ay]);
  }
  return { cells, edges, seeds };
}
