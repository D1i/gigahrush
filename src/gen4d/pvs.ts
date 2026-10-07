// Потенциально видимые наборы (PVS) складчатого прогона (§14 docs/GENERATOR-4D.md).
// PVS(A) — комнаты, в которые из A (из любой точки её пола и клеток её проёмов) можно увидеть хоть
// что-то по прямой в плане (любого направления) сквозь цепочку проёмов не дальше reach, независимо от W.
//
// Считается консервативно (надмножество настоящей видимости): обход цепочек проёмов от A; цепочка
// «прокалываема», если есть прямая, проходящая источник и все проёмы в нужную сторону. Прямые ищутся
// по корзинам направлений (720 × 0.5°): для корзины интервал смещений каждого отрезка берётся в центре
// корзины и расширяется на максимальный сдвиг внутри неё (|p − o|·полуширина) — значит, если прямая есть
// хоть при каком-то угле корзины, проверка её не пропустит. Проёмы удлинены на допуск tol; источник —
// выпуклая оболочка комнаты с её проёмами; стены промежуточных комнат и порядок пересечения проёмов не
// учитываются. Всё это только расширяет набор.
import type { SightSpace } from './sight4d';

/**
 * Горизонт обзора без тумана, м: докуда портальный рендер открывает проёмы и докуда бесконечный мир
 * раскрывает комнаты заранее (StreamWorld.ensureVisible). Генератор не пускает прямые по осям и
 * диагоналям дальше sightM, но косые линии сквозь цепочки проёмов бывают длиннее — с запасом ×3, не
 * меньше 24 м; без предела обзора (sightM = 0) — 40 м.
 */
export function viewHorizonM(sightM: number): number {
  return sightM > 0 ? Math.max(3 * sightM, 24) : 40;
}

const NB = 720;
/** полуширина корзины, рад */
const HW = Math.PI / NB;
const CS = new Float64Array(NB);
const SN = new Float64Array(NB);
for (let k = 0; k < NB; k++) {
  const t = ((k + 0.5) * 2 * Math.PI) / NB;
  CS[k] = Math.cos(t);
  SN[k] = Math.sin(t);
}

/** Живые корзины цепочки: номера корзин и интервалы смещений прямой [lo, hi] (вдоль нормали (−sin, cos)). */
interface Frame {
  bins: Int32Array;
  lo: Float64Array;
  hi: Float64Array;
  n: number;
}

/**
 * PVS комнаты src (индексы комнат SightSpace, по возрастанию, включая src).
 * reach — предел дальности в клетках (проёмы цепочки дальше reach от источника не рассматриваются);
 * tol — допуск расширения проёмов, клетки.
 */
export function computePvs(S: SightSpace, src: number, reach: number, tol: number): number[] {
  const R = S.rooms[src];
  // источник: оболочка комнаты + прямоугольники всех её проёмов (взгляд из дверного проёма)
  const pts: number[] = [];
  const hull = R.sh.hull;
  for (let i = 0; i < hull.length; i += 2) pts.push(hull[i] + R.dx, hull[i + 1] + R.dy);
  for (const pi of R.portals) {
    const P = S.portals[pi];
    for (const t of [P.lo, P.hi]) {
      for (const n of [P.aLine, P.bLine]) pts.push(P.horiz ? t : n, P.horiz ? n : t);
    }
  }
  const np = pts.length / 2;
  let ox = 0, oy = 0;
  let bx0 = Infinity, by0 = Infinity, bx1 = -Infinity, by1 = -Infinity;
  for (let i = 0; i < np; i++) {
    const x = pts[2 * i], y = pts[2 * i + 1];
    ox += x; oy += y;
    if (x < bx0) bx0 = x;
    if (x > bx1) bx1 = x;
    if (y < by0) by0 = y;
    if (y > by1) by1 = y;
  }
  ox /= np; oy /= np;
  let rmax = 0;
  for (let i = 0; i < np; i++) rmax = Math.max(rmax, Math.hypot(pts[2 * i] - ox, pts[2 * i + 1] - oy));
  const es = rmax * HW;
  const f0: Frame = { bins: new Int32Array(NB), lo: new Float64Array(NB), hi: new Float64Array(NB), n: NB };
  for (let k = 0; k < NB; k++) {
    let mn = Infinity, mx = -Infinity;
    for (let i = 0; i < np; i++) {
      const s = -(pts[2 * i] - ox) * SN[k] + (pts[2 * i + 1] - oy) * CS[k];
      if (s < mn) mn = s;
      if (s > mx) mx = s;
    }
    f0.bins[k] = k;
    f0.lo[k] = mn - es;
    f0.hi[k] = mx + es;
  }
  const reach2 = (reach + tol) * (reach + tol);
  const out = new Set<number>([src]);
  const chain: number[] = [];

  /** Пройти проём pi из комнаты u. first — проём самой комнаты-источника: взгляд может начинаться внутри
   *  него, поэтому требуется только дальняя линия проёма. */
  const go = (u: number, pi: number, fr: Frame, first: boolean): void => {
    if (chain.includes(pi)) return;
    const P = S.portals[pi];
    const v = P.a === u ? P.b : P.a;
    // проём дальше reach от источника — прямая длиной ≤ reach до него не дотянется
    const nA = Math.min(P.aLine, P.bLine), nB = Math.max(P.aLine, P.bLine);
    const rx0 = P.horiz ? P.lo : nA, rx1 = P.horiz ? P.hi : nB, ry0 = P.horiz ? nA : P.lo, ry1 = P.horiz ? nB : P.hi;
    const ddx = Math.max(0, bx0 - rx1, rx0 - bx1), ddy = Math.max(0, by0 - ry1, ry0 - by1);
    if (ddx * ddx + ddy * ddy > reach2) return;
    const tau = u === P.a ? P.dir : -P.dir; // ход по нормали проёма: из u в v
    const nearL = u === P.a ? P.aLine : P.bLine, farL = u === P.a ? P.bLine : P.aLine;
    const t0 = P.lo - tol, t1 = P.hi + tol;
    // концы отрезков относительно o; запас корзины — по дальнему концу
    const seg = (line: number) => {
      const x1 = (P.horiz ? t0 : line) - ox, y1 = (P.horiz ? line : t0) - oy;
      const x2 = (P.horiz ? t1 : line) - ox, y2 = (P.horiz ? line : t1) - oy;
      return [x1, y1, x2, y2, Math.max(Math.hypot(x1, y1), Math.hypot(x2, y2)) * HW];
    };
    const [fx1, fy1, fx2, fy2, fe] = seg(farL);
    const [mx1, my1, mx2, my2, me] = seg(nearL);
    const checkNear = !first && nearL !== farL;
    const nf: Frame = { bins: new Int32Array(fr.n), lo: new Float64Array(fr.n), hi: new Float64Array(fr.n), n: 0 };
    for (let j = 0; j < fr.n; j++) {
      const k = fr.bins[j];
      const sn = SN[k], cs = CS[k];
      if ((P.horiz ? sn : cs) * tau < -HW) continue; // идёт не в ту сторону
      let lo = fr.lo[j], hi = fr.hi[j];
      const s1 = -fx1 * sn + fy1 * cs, s2 = -fx2 * sn + fy2 * cs;
      lo = Math.max(lo, Math.min(s1, s2) - fe);
      hi = Math.min(hi, Math.max(s1, s2) + fe);
      if (lo > hi) continue;
      if (checkNear) {
        const m1 = -mx1 * sn + my1 * cs, m2 = -mx2 * sn + my2 * cs;
        lo = Math.max(lo, Math.min(m1, m2) - me);
        hi = Math.min(hi, Math.max(m1, m2) + me);
        if (lo > hi) continue;
      }
      nf.bins[nf.n] = k;
      nf.lo[nf.n] = lo;
      nf.hi[nf.n] = hi;
      nf.n++;
    }
    if (nf.n === 0) return;
    out.add(v);
    chain.push(pi);
    for (const pj of S.rooms[v].portals) if (pj !== pi) go(v, pj, nf, false);
    chain.pop();
  };
  for (const pi of R.portals) go(src, pi, f0, true);
  return [...out].sort((a, b) => a - b);
}
