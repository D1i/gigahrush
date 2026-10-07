// Дальность обзора в складчатом прогоне (§13 docs/GENERATOR-4D.md). Линия обзора — прямая по клеткам
// ТЕКУЩЕЙ комнаты; дойдя до проёма связи этой комнаты, она проходит сквозь него и продолжается в связанной
// комнате (двери стоят лицом к лицу — прямая непрерывна в мировых координатах), независимо от W.
// Комнаты других слоёв, занимающие те же клетки, для луча не существуют: проходимость определяется
// только цепочкой «контекстов» вдоль луча (комната → проём → комната …). Несвязанные двери — стена.
//
// Контекст: ≥ 0 — экземпляр (индекс = order), < 0 — проём связи (−1 − индекс проёма, индекс = номер связи).
import { OUT_SIGN, segLine, segStart, type SegGeom } from '../gen/geom';
import { runMeters, SIGHT_DIRS, type SightResult } from '../gen/sight';
import type { FShape } from './space';

/** «Шаг невозможен». */
export const BLOCK = 0x7fffffff;

export interface SRoom {
  sh: FShape;
  dx: number;
  dy: number;
  /** индексы проёмов этой комнаты (в порядке связей) */
  portals: number[];
}

/** Проём связи a–b. t — координата вдоль стены, n — по нормали; horiz — метки N/S (t = x, n = y). */
export interface SPortal {
  a: number;
  b: number;
  horiz: boolean;
  /** линии стены (координата n) со стороны a и со стороны b: bLine = aLine ± gap (при gap = 0 совпадают) */
  aLine: number;
  bLine: number;
  /** направление по n от a к b (±1) */
  dir: number;
  /** вдоль стены: [lo, hi) — пересечение пролётов меток */
  lo: number;
  hi: number;
  /** gap ≥ 1: клетки проёма по нормали [n0, n1); gap = 0: n0 — ряд клеток a у стены, n1 — ряд клеток b */
  n0: number;
  n1: number;
}

/** Отрезок линии из k клеток от (sx, sy) «от края до края» — как в src/gen/sight.ts. */
function lineOf(sx: number, sy: number, dx: number, dy: number, k: number): [number, number, number, number] {
  if (dy === 0) return [sx, sy + 0.5, sx + k, sy + 0.5];
  if (dx === 0) return [sx + 0.5, sy, sx + 0.5, sy + k];
  if (dy > 0) return [sx, sy, sx + k, sy + k];
  return [sx, sy + 1, sx + k, sy + 1 - k];
}

/** Пространство лучей прогона: комнаты и проёмы связей; комнаты/проёмы можно добавить на пробу и снять. */
export class SightSpace {
  readonly rooms: SRoom[] = [];
  readonly portals: SPortal[] = [];
  constructor(readonly gap: number) {}

  addRoom(sh: FShape, dx: number, dy: number): number {
    this.rooms.push({ sh, dx, dy, portals: [] });
    return this.rooms.length - 1;
  }

  popRoom(): void {
    this.rooms.pop();
  }

  /** Проём связи: мировые метки A (комнаты a) и B (комнаты b) стоят лицом к лицу через gap. */
  addPortal(a: number, A: SegGeom, b: number, B: SegGeom): number {
    const horiz = A.side === 'N' || A.side === 'S';
    const lo = Math.max(segStart(A), segStart(B));
    const hi = Math.min(segStart(A) + A.len, segStart(B) + B.len);
    const la = segLine(A);
    const sign = OUT_SIGN[A.side];
    const g = this.gap;
    let n0: number, n1: number;
    if (g > 0) {
      n0 = sign > 0 ? la : la - g;
      n1 = n0 + g;
    } else {
      n0 = sign > 0 ? la - 1 : la;
      n1 = sign > 0 ? la : la - 1;
    }
    const i = this.portals.length;
    this.portals.push({ a, b, horiz, lo, hi, n0, n1, aLine: la, bLine: la + sign * g, dir: sign });
    this.rooms[a].portals.push(i);
    this.rooms[b].portals.push(i);
    return i;
  }

  /** Снять последний проём (добавленный на пробу). */
  popPortal(): void {
    const P = this.portals.pop()!;
    this.rooms[P.a].portals.pop();
    this.rooms[P.b].portals.pop();
  }

  inRoom(r: number, x: number, y: number): boolean {
    const R = this.rooms[r];
    const m = R.sh.own;
    const lx = x - R.dx - m.x0, ly = y - R.dy - m.y0;
    return lx >= 0 && lx < m.w && ly >= 0 && ly < m.h && m.bits[ly * m.w + lx] !== 0;
  }

  /** Ортогональный шаг (x, y) → (nx, ny) из контекста ctx: новый контекст или BLOCK. */
  step(ctx: number, x: number, y: number, nx: number, ny: number): number {
    if (ctx >= 0) {
      if (this.inRoom(ctx, nx, ny)) return ctx;
      const ps = this.rooms[ctx].portals;
      for (let k = 0; k < ps.length; k++) {
        const P = this.portals[ps[k]];
        const t = P.horiz ? nx : ny, n = P.horiz ? ny : nx;
        if (t < P.lo || t >= P.hi) continue;
        if (this.gap > 0) {
          if (n >= P.n0 && n < P.n1) return -1 - ps[k];
        } else {
          // gap = 0: ребро между рядом a и рядом b на пересечении пролётов
          const n0 = P.horiz ? y : x;
          const from = P.a === ctx ? P.n0 : P.n1, to = P.a === ctx ? P.n1 : P.n0;
          if ((P.horiz ? x === nx : y === ny) && n0 === from && n === to) return P.a === ctx ? P.b : P.a;
        }
      }
      return BLOCK;
    }
    const P = this.portals[-1 - ctx];
    const t = P.horiz ? nx : ny, n = P.horiz ? ny : nx;
    if (t >= P.lo && t < P.hi && n >= P.n0 && n < P.n1) return ctx;
    if (this.inRoom(P.a, nx, ny)) return P.a;
    if (this.inRoom(P.b, nx, ny)) return P.b;
    return BLOCK;
  }

  /** Шаг на (dx, dy). Диагональный — только если проходимы оба обхода через угловые клетки и они
   *  приводят в один контекст (сквозь угол смотреть нельзя). */
  move(ctx: number, x: number, y: number, dx: number, dy: number): number {
    if (dx === 0 || dy === 0) return this.step(ctx, x, y, x + dx, y + dy);
    const c1 = this.step(ctx, x, y, x + dx, y);
    if (c1 === BLOCK) return BLOCK;
    const e1 = this.step(c1, x + dx, y, x + dx, y + dy);
    if (e1 === BLOCK) return BLOCK;
    const c2 = this.step(ctx, x, y, x, y + dy);
    if (c2 === BLOCK) return BLOCK;
    const e2 = this.step(c2, x, y + dy, x + dx, y + dy);
    return e1 === e2 ? e1 : BLOCK;
  }

  /** Сколько шагов подряд можно пройти от (ctx, x, y) в направлении (dx, dy); не больше cap + 1. */
  walk(ctx: number, x: number, y: number, dx: number, dy: number, cap: number): number {
    const diag = dx !== 0 && dy !== 0;
    let n = 0;
    while (n <= cap) {
      if (ctx >= 0) {
        // быстрый путь: шаги, не выходящие из комнаты (у диагонали и обе угловые клетки — в комнате);
        // на границе — общий шаг move (там проёмы и угол двери)
        const R = this.rooms[ctx];
        const m = R.sh.own;
        const bits = m.bits, w = m.w, h = m.h;
        const ox = R.dx + m.x0, oy = R.dy + m.y0;
        let lx = x - ox, ly = y - oy;
        while (n <= cap) {
          const nx = lx + dx, ny = ly + dy;
          if (nx < 0 || nx >= w || ny < 0 || ny >= h || bits[ny * w + nx] === 0) break;
          if (diag && (bits[ly * w + nx] === 0 || bits[ny * w + lx] === 0)) break;
          lx = nx; ly = ny; n++;
        }
        x = lx + ox; y = ly + oy;
        if (n > cap) break;
      }
      const c = this.move(ctx, x, y, dx, dy);
      if (c === BLOCK) break;
      ctx = c; x += dx; y += dy; n++;
    }
    return n;
  }

  /** Клетки, через которые проходит любая линия сквозь проём pi: клетки проёма (gap ≥ 1) или клетки a у
   *  стены на пересечении пролётов (gap = 0). Тройки [контекст, x, y]. */
  portalSeeds(pi: number): [number, number, number][] {
    const P = this.portals[pi];
    const out: [number, number, number][] = [];
    const at = (t: number, n: number, c: number) => out.push(P.horiz ? [c, t, n] : [c, n, t]);
    if (this.gap > 0) {
      for (let n = P.n0; n < P.n1; n++) for (let t = P.lo; t < P.hi; t++) at(t, n, -1 - pi);
    } else {
      for (let t = P.lo; t < P.hi; t++) at(t, P.n0, P.a);
    }
    return out;
  }

  /** Все линии через проём pi не длиннее предела (в клетках по прямой и по диагонали). */
  portalOk(pi: number, lim: { ortho: number; diag: number }): boolean {
    const seeds = this.portalSeeds(pi);
    for (const [dx, dy] of SIGHT_DIRS) {
      const max = dx !== 0 && dy !== 0 ? lim.diag : lim.ortho;
      for (const [c, sx, sy] of seeds) {
        const back = this.walk(c, sx, sy, -dx, -dy, max);
        if (1 + back > max) return false;
        const fwd = this.walk(c, sx, sy, dx, dy, max - back);
        if (1 + back + fwd > max) return false;
      }
    }
    return true;
  }

  // ── Дозаказ для растущего мира (stream.ts): линии только растут (комнаты и проёмы лишь добавляются),
  // поэтому максимум полного скана = max(старый, линии новой комнаты, линии сквозь новые проёмы). ──

  /** Самая длинная из линий, начинающихся в комнате r (как полный скан, только эта комната); m — в метрах, без округления. */
  scanRoom(r: number, cellM: number): { m: number; line: SightResult['line'] } {
    let best = 0;
    let line: SightResult['line'] = null;
    const R = this.rooms[r];
    const { xs, ys, ord } = R.sh;
    const om = R.sh.own;
    const bits = om.bits, w = om.w, h = om.h;
    for (const [dx, dy] of SIGHT_DIRS) {
      const diag = dx !== 0 && dy !== 0;
      for (let j = 0; j < ord.length; j++) {
        const lx = xs[ord[j]] - om.x0, ly = ys[ord[j]] - om.y0;
        const px = lx - dx, py = ly - dy;
        if (px >= 0 && px < w && py >= 0 && py < h && bits[py * w + px] !== 0 &&
          (!diag || (bits[ly * w + px] !== 0 && bits[py * w + lx] !== 0))) continue;
        const x = xs[ord[j]] + R.dx, y = ys[ord[j]] + R.dy;
        if (this.move(r, x, y, -dx, -dy) !== BLOCK) continue;
        const k = 1 + this.walk(r, x, y, dx, dy, Infinity);
        const m = runMeters(k, diag, cellM);
        if (m > best + 1e-9) { best = m; line = lineOf(x, y, dx, dy, k); }
      }
    }
    return { m: best, line };
  }

  /** Самая длинная линия, проходящая сквозь проём pi (от каждой его клетки — назад до упора и вперёд). */
  scanPortal(pi: number, cellM: number): { m: number; line: SightResult['line'] } {
    let best = 0;
    let line: SightResult['line'] = null;
    const seeds = this.portalSeeds(pi);
    for (const [dx, dy] of SIGHT_DIRS) {
      const diag = dx !== 0 && dy !== 0;
      for (const [c, sx, sy] of seeds) {
        const back = this.walk(c, sx, sy, -dx, -dy, Infinity);
        const k = 1 + back + this.walk(c, sx, sy, dx, dy, Infinity);
        const m = runMeters(k, diag, cellM);
        if (m > best + 1e-9) { best = m; line = lineOf(sx - back * dx, sy - back * dy, dx, dy, k); }
      }
    }
    return { m: best, line };
  }

  /**
   * Полный скан: самая длинная линия прогона. Каждая максимальная линия начинается в единственном
   * состоянии (контекст, клетка), из которого шаг назад невозможен, — от таких состояний и идём вперёд.
   * Порядок: направления SIGHT_DIRS; комнаты по order, затем проёмы по номеру связи; клетки по
   * возрастанию (y, x). Побеждает строго большая длина.
   */
  scan(cellM: number): SightResult {
    let best = 0;
    let line: SightResult['line'] = null;
    for (const [dx, dy] of SIGHT_DIRS) {
      const diag = dx !== 0 && dy !== 0;
      const visit = (ctx: number, x: number, y: number) => {
        if (this.move(ctx, x, y, -dx, -dy) !== BLOCK) return;
        const k = 1 + this.walk(ctx, x, y, dx, dy, Infinity);
        const m = runMeters(k, diag, cellM);
        if (m > best + 1e-9) {
          best = m;
          line = lineOf(x, y, dx, dy, k);
        }
      };
      for (let r = 0; r < this.rooms.length; r++) {
        const R = this.rooms[r];
        const { xs, ys, ord } = R.sh;
        const m = R.sh.own;
        const bits = m.bits, w = m.w, h = m.h;
        for (let j = 0; j < ord.length; j++) {
          const lx = xs[ord[j]] - m.x0, ly = ys[ord[j]] - m.y0;
          // шаг назад внутри комнаты — не начало линии (быстрая отсечка, без move)
          const px = lx - dx, py = ly - dy;
          if (px >= 0 && px < w && py >= 0 && py < h && bits[py * w + px] !== 0 &&
            (!diag || (bits[ly * w + px] !== 0 && bits[py * w + lx] !== 0))) continue;
          visit(r, xs[ord[j]] + R.dx, ys[ord[j]] + R.dy);
        }
      }
      if (this.gap > 0) {
        for (let pi = 0; pi < this.portals.length; pi++) {
          const P = this.portals[pi];
          if (P.horiz) {
            for (let n = P.n0; n < P.n1; n++) for (let t = P.lo; t < P.hi; t++) visit(-1 - pi, t, n);
          } else {
            for (let t = P.lo; t < P.hi; t++) for (let n = P.n0; n < P.n1; n++) visit(-1 - pi, n, t);
          }
        }
      }
    }
    return { maxM: Math.round(best * 1000) / 1000, line };
  }
}
