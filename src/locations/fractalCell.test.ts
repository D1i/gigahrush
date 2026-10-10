import { describe, expect, it } from 'vitest';
import { makeRng } from '../model/rng';
import { PROP_BY_ID } from '../data/props';
import { AXES6, AXIS_VEC, axisIdx, axisSign, FR_ARRIVAL_CELL, isExitCell, opp, type Axis6, type V3 } from './fractalAxes';
import {
  axisRay, buildFractalCell, crossAxis, exitCopies, exitSampleFitsAllCorners, footVox, FR_HANGING_PROPS, isEscVx, isStaticVx,
  navReach, openAxisLines, solidAt, standable, vidx, voxAt, VX, type FractalCell,
} from './fractalCell';

/** 20 сидов P = 54 и 3 сида P = 81 (§3.5); ячейки собираются один раз. */
const SEEDS54 = Array.from({ length: 20 }, (_, i) => 'fr' + i);
const SEEDS81 = ['fr81a', 'fr81b', 'fr81c'];
const ALL: [string, 54 | 81][] = [...SEEDS54.map((s): [string, 54] => [s, 54]), ...SEEDS81.map((s): [string, 81] => [s, 81])];
const cache = new Map<string, FractalCell>();
const cellOf = (seed: string, P: 54 | 81 = 54): FractalCell => {
  const k = P + ':' + seed;
  let c = cache.get(k);
  if (!c) { c = buildFractalCell(seed, { P }); cache.set(k, c); }
  return c;
};
const TAN30 = Math.tan(Math.PI / 6);
const wrap = (i: number, P: number) => ((i % P) + P) % P;
const add = (p: V3, a: Axis6, k: number): V3 => [p[0] + AXIS_VEC[a][0] * k, p[1] + AXIS_VEC[a][1] * k, p[2] + AXIS_VEC[a][2] * k];
const solidP = (c: FractalCell, p: V3, broken?: ReadonlySet<number>) => solidAt(c, Math.floor(p[0]), Math.floor(p[1]), Math.floor(p[2]), broken);
const allBroken = (c: FractalCell) => new Set(c.esc.map((e) => e.i));
function fnv(a: Uint8Array): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < a.length; i++) { h ^= a[i]; h = Math.imul(h, 0x01000193); }
  return h >>> 0;
}
/** Осевые линии без твёрдого (по произвольному предикату твёрдости). */
function openLines(c: FractalCell, solid: (x: number, y: number, z: number) => boolean): number {
  const P = c.P, cov = [new Uint8Array(P * P), new Uint8Array(P * P), new Uint8Array(P * P)];
  for (let z = 0; z < P; z++) for (let y = 0; y < P; y++) for (let x = 0; x < P; x++) {
    if (!solid(x, y, z)) continue;
    cov[0][y + P * z] = 1; cov[1][x + P * z] = 1; cov[2][x + P * y] = 1;
  }
  let n = 0;
  for (const a of cov) for (const v of a) if (!v) n++;
  return n;
}
/** Луч по оси через воксели (свой, для проверки с поломками). */
function ray(c: FractalCell, p: V3, dir: Axis6, maxM: number, broken: ReadonlySet<number>): number | null {
  const a = axisIdx(dir), s = axisSign(dir), q = [Math.floor(p[0]), Math.floor(p[1]), Math.floor(p[2])];
  for (let k = 1; k <= maxM + 2; k++) {
    q[a] += s;
    if (solidAt(c, q[0], q[1], q[2], broken)) { const d = s > 0 ? q[a] - p[a] : p[a] - (q[a] + 1); return d <= maxM ? d : null; }
  }
  return null;
}
/** Компоненты пустоты (6-связность по тору): размеры по убыванию. */
function voidComps(c: FractalCell, broken?: ReadonlySet<number>): number[] {
  const P = c.P, N = P * P * P, seen = new Uint8Array(N), st = new Int32Array(N), sizes: number[] = [];
  const air = (i: number) => { const v = c.vox[i]; return v === VX.AIR || (broken !== undefined && isEscVx(v) && broken.has(v - VX.ESC0)); };
  for (let i0 = 0; i0 < N; i0++) {
    if (seen[i0] || !air(i0)) continue;
    let top = 0, n = 0;
    st[top++] = i0; seen[i0] = 1;
    while (top) {
      const i = st[--top]; n++;
      const x = i % P, y = Math.floor(i / P) % P, z = Math.floor(i / (P * P));
      for (const d of AXIS_VEC) {
        const j = vidx(P, wrap(x + d[0], P), wrap(y + d[1], P), wrap(z + d[2], P));
        if (!seen[j] && air(j)) { seen[j] = 1; st[top++] = j; }
      }
    }
    sizes.push(n);
  }
  return sizes.sort((a, b) => b - a);
}
/** Коробки кубов «станция 6» (каркас и павильоны): компоненты SHELL2 по 6-связности → их рамки. */
function st6Boxes(c: FractalCell): { lo: V3; hi: V3 }[] {
  const P = c.P, N = P * P * P, seen = new Uint8Array(N), out: { lo: V3; hi: V3 }[] = [];
  for (let i0 = 0; i0 < N; i0++) {
    if (seen[i0] || c.vox[i0] !== VX.SHELL2) continue;
    const lo: V3 = [P, P, P], hi: V3 = [0, 0, 0], st = [i0];
    seen[i0] = 1;
    while (st.length) {
      const i = st.pop()!;
      const p = [i % P, Math.floor(i / P) % P, Math.floor(i / (P * P))];
      for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], p[k]); hi[k] = Math.max(hi[k], p[k] + 1); }
      for (const d of AXIS_VEC) {
        const q = [p[0] + d[0], p[1] + d[1], p[2] + d[2]];
        if (q.some((v) => v < 0 || v >= P)) continue;
        const j = vidx(P, q[0], q[1], q[2]);
        if (!seen[j] && c.vox[j] === VX.SHELL2) { seen[j] = 1; st.push(j); }
      }
    }
    out.push({ lo, hi });
  }
  return out;
}

describe('fractalCell: каркас и инварианты', () => {
  it('детерминизм: две сборки — одинаковые vox, esc, props, lights', { timeout: 60_000 }, () => {
    for (const [s, P] of ALL) {
      const a = buildFractalCell(s, { P }), b = buildFractalCell(s, { P });
      expect(fnv(a.vox)).toBe(fnv(b.vox));
      expect(JSON.stringify(a.esc)).toBe(JSON.stringify(b.esc));
      expect(JSON.stringify(a.props)).toBe(JSON.stringify(b.props));
      expect(JSON.stringify(a.lights)).toBe(JSON.stringify(b.lights));
      expect(JSON.stringify([a.exit, a.arrival, a.spots, a.pylons])).toBe(JSON.stringify([b.exit, b.arrival, b.spots, b.pylons]));
    }
    expect(fnv(cellOf('fr0').vox)).not.toBe(fnv(cellOf('fr1').vox));
  });

  it('пилоны и стержни: ≥ 2 углов из 4 на каждую ось', () => {
    for (const [s, P] of ALL) {
      const c = cellOf(s, P);
      for (const L of [c.pylons.L1, c.pylons.L2]) {
        expect(L).toHaveLength(3);
        for (const a of L) { expect(a.length).toBeGreaterThanOrEqual(2); expect(a.every((k) => k >= 0 && k < 4)).toBe(true); }
      }
    }
  });

  it('нет бесконечных осевых линий; 2000 случайных точек пустоты × 6 осей — твёрдое не дальше P (и со сломанными подложками)', () => {
    for (const [s, P] of ALL) {
      const c = cellOf(s, P), br = allBroken(c);
      expect(openAxisLines(c)).toBe(0);
      expect(openLines(c, (x, y, z) => solidAt(c, x, y, z, br))).toBe(0);
      const r = makeRng('rays:' + s);
      const bad: string[] = [];
      let n = 0;
      while (n < 2000) {
        const p: V3 = [r.next() * P, r.next() * P, r.next() * P];
        if (solidP(c, p)) continue;
        n++;
        for (const a of AXES6) {
          const d = axisRay(c, p, a, 2 * P), d2 = ray(c, p, a, 2 * P, br);
          if (d === null || d > P || d2 === null || d2 > P) bad.push(`${s} ${p} ${a}: ${d} ${d2}`);
        }
      }
      expect(bad).toEqual([]);
    }
  }, 60_000);

  it('axisRay: с пола вниз — 0, из воздуха — до ближайшей грани', () => {
    const c = cellOf('fr0');
    expect(axisRay(c, [9.5, 1, 9.5], 3, 108)).toBe(0);
    expect(axisRay(c, [9.5, 1.5, 9.5], 3, 108)).toBeCloseTo(0.5, 9);
    expect(axisRay(c, [9.5, 1.5, 9.5], 3, 0.2)).toBeNull();
    expect(axisRay(c, [0.5, 0.5, 0.5], 2, 10)).toBe(0); // в твёрдом
  });

  it('пустота связна по тору (замкнутые щели ≤ 64 вокселей), в том числе без подложек', { timeout: 60_000 }, () => {
    const pockets: string[] = [];
    for (const [s, P] of ALL) {
      const c = cellOf(s, P);
      for (const br of [undefined, allBroken(c)]) {
        const sizes = voidComps(c, br);
        expect(sizes[0]).toBeGreaterThan(P * P * P * 0.8);
        for (const n of sizes.slice(1)) expect(n).toBeLessThanOrEqual(64);
        if (sizes.length > 1) pockets.push(`${P}:${s}${br ? ' (сломаны)' : ''}: ${sizes.slice(1).join(',')}`);
      }
    }
    // перечень щелей — в notes-fr-gen.md
    if (pockets.length) console.info('fractal: замкнутые щели', pockets);
  });
});

describe('fractalCell: эскалаторы, выход, прибытие', () => {
  it('запасной образец выхода годен при любом подмножестве углов', () => {
    expect(exitSampleFitsAllCorners(54)).toBe(true);
    expect(exitSampleFitsAllCorners(81)).toBe(true);
  });

  it('exit — ровно один, 3 дорожки (вверх/стоит/вниз), подъём P/3; main ≥ 4; индексы и подложки на месте', () => {
    for (const [s, P] of ALL) {
      const c = cellOf(s, P);
      const exits = c.esc.filter((e) => e.kind === 'exit');
      expect(exits).toHaveLength(1);
      const ex = c.esc[c.exit.esc];
      expect(ex.kind).toBe('exit');
      expect(ex.lanes.map((l) => l.dir)).toEqual([1, 0, -1]);
      expect(ex.lanes.map((l) => l.off)).toEqual([-2, 0, 2]);
      expect(ex.rise).toBe(P / 3);
      expect(ex.width).toBe(6);
      expect(c.esc.filter((e) => e.kind === 'main').length).toBeGreaterThanOrEqual(4);
      expect(c.esc.length).toBeLessThanOrEqual(32);
      for (const [i, e] of c.esc.entries()) {
        expect(e.i).toBe(i);
        expect(axisIdx(e.up)).not.toBe(axisIdx(e.fwd));
        expect(e.run).toBeCloseTo(e.rise / TAN30, 9);
        expect(e.width === 6 ? e.lanes.length : 1).toBe(e.lanes.length);
        expect(Number.isInteger(e.rise)).toBe(true);
        expect(e.dropM).toBeGreaterThan(0);
        expect(e.dropM).toBeLessThanOrEqual(P);
        let band = 0;
        for (const v of c.vox) if (v === VX.ESC0 + i) band++;
        expect(band).toBeGreaterThan(0);
        // площадка — LANDING (или каркас, с которым она слилась), верх — на высоте подъёма над полом
        const top = e.top, ua = axisIdx(e.up);
        const topLevel = axisSign(e.up) > 0 ? top.hi[ua] : top.lo[ua];
        const floorLevel = e.o[ua];
        expect(Math.abs(topLevel - floorLevel)).toBeCloseTo(e.rise, 9);
        const mid: V3 = [(top.lo[0] + top.hi[0]) / 2, (top.lo[1] + top.hi[1]) / 2, (top.lo[2] + top.hi[2]) / 2];
        expect(voxAt(c, Math.floor(mid[0]), Math.floor(mid[1]), Math.floor(mid[2]))).toBe(VX.LANDING);
      }
    }
  });

  it('объём «голов» над наклоном и площадкой пуст; подложка ниже наклона на ≥ 0.25 м во всём следе', () => {
    for (const [s, P] of ALL) {
      const c = cellOf(s, P);
      const bad: string[] = [];
      for (const e of c.esc) {
        const right = crossAxis(e.up, e.fwd);
        // над наклоном до 2.35 м
        for (const ln of e.lanes) for (let sM = 0; sM <= e.run; sM += 0.25) for (const da of [-0.5, 0, 0.5]) for (const h of [0.05, 0.6, 1.2, 1.8, 2.35]) {
          const p = add(add(add(e.o, e.fwd, sM), right, ln.off + da), e.up, sM * TAN30 + h);
          if (solidP(c, p)) bad.push(`${s} esc ${e.i} голова s=${sM} h=${h}`);
        }
        // над площадкой: первые 2 м (у выхода и павильонов — вся)
        const strict = e.kind === 'main' ? 2 : e.kind === 'exit' ? 4 : 2;
        for (let d = 0.05; d < strict; d += 0.3) for (let a = -e.width / 2 + 0.1; a < e.width / 2; a += 0.4) for (const h of [0.05, 1.2, 2.35]) {
          const p = add(add(add(e.o, e.fwd, e.run + d), right, a), e.up, e.rise + h);
          if (solidP(c, p)) bad.push(`${s} esc ${e.i} площадка d=${d}`);
        }
        // подложка ниже поверхности наклона в следе ступней
        for (let sM = 0; sM < e.run - 0.01; sM += 0.05) {
          const h = sM * TAN30 - 0.25;
          if (h < 0.05) continue;
          for (let a = -e.width / 2 + 0.3; a <= e.width / 2 - 0.3; a += 0.3) {
            const p = add(add(add(e.o, e.fwd, sM), right, a), e.up, h);
            if (solidP(c, p)) bad.push(`${s} esc ${e.i} подложка s=${sM}`);
          }
        }
        // пол перед низом стоячий
        for (const ln of e.lanes) {
          const f = footVox(add(add(e.o, right, ln.off), e.fwd, -1.5), e.up);
          if (!standable(c, f[0], f[1], f[2], e.up)) bad.push(`${s} esc ${e.i} низ`);
        }
      }
      expect(bad).toEqual([]);
    }
  }, 60_000);

  it('ниша выхода: глубина 1 вокселя, за ней статичное твёрдое; триггер внутри ниши; прибытие — верх выхода, дорожка 2', () => {
    for (const [s, P] of ALL) {
      const c = cellOf(s, P), x = c.exit, e = c.esc[x.esc];
      const fa = axisIdx(x.facing);
      expect(x.arch.hi[fa] - x.arch.lo[fa]).toBe(1);
      expect(x.facing).toBe(opp(e.fwd));
      expect(x.up).toBe(e.up);
      const dims = [0, 1, 2].map((k) => x.arch.hi[k] - x.arch.lo[k]).filter((_, k) => k !== fa).sort();
      expect(dims).toEqual([4, 4]);
      for (let i = x.arch.lo[0]; i < x.arch.hi[0]; i++) for (let j = x.arch.lo[1]; j < x.arch.hi[1]; j++) for (let k = x.arch.lo[2]; k < x.arch.hi[2]; k++) {
        expect(voxAt(c, i, j, k)).toBe(VX.AIR);
        const b = add([i, j, k], opp(x.facing), 1);
        expect(isStaticVx(voxAt(c, b[0], b[1], b[2]))).toBe(true);
      }
      for (let k = 0; k < 3; k++) {
        expect(x.trigger.lo[k]).toBeGreaterThanOrEqual(x.arch.lo[k]);
        expect(x.trigger.hi[k]).toBeLessThanOrEqual(x.arch.hi[k]);
        expect(x.trigger.hi[k]).toBeGreaterThan(x.trigger.lo[k]);
      }
      // площадка вплотную к стене с нишей, низ ниши — на уровне верха площадки
      const ua = axisIdx(e.up);
      const topLevel = axisSign(e.up) > 0 ? e.top.hi[ua] : e.top.lo[ua];
      expect(axisSign(e.up) > 0 ? x.arch.lo[ua] : x.arch.hi[ua]).toBe(topLevel);
      // прибытие
      const a = c.arrival;
      expect(a.up).toBe(e.up);
      expect(a.fwd).toBe(opp(e.fwd));
      const f = footVox(a.at, a.up);
      expect(standable(c, f[0], f[1], f[2], a.up)).toBe(true);
      for (let k = 0; k < 3; k++) {
        if (k === ua) continue;
        expect(a.at[k]).toBeGreaterThan(e.top.lo[k]);
        expect(a.at[k]).toBeLessThan(e.top.hi[k]);
      }
      expect(a.at[ua]).toBe(topLevel);
      const right = crossAxis(e.up, e.fwd);
      const rel = [a.at[0] - e.o[0], a.at[1] - e.o[1], a.at[2] - e.o[2]];
      const R = AXIS_VEC[right], F = AXIS_VEC[e.fwd];
      expect(rel[0] * R[0] + rel[1] * R[1] + rel[2] * R[2]).toBeCloseTo(e.lanes[2].off, 9);
      expect(rel[0] * F[0] + rel[1] * F[1] + rel[2] * F[2]).toBeCloseTo(e.run + 1, 9);
    }
  });

  it('exitCopies и сверхпериод: ближайшая выходная копия — соседняя по каждой оси от прибытия', () => {
    expect(exitCopies(FR_ARRIVAL_CELL, 1)).toEqual([[-1, -1, -1]]);
    expect(exitCopies([0, 0, 0], 1)).toEqual([[0, 0, 0]]);
    const k2 = exitCopies([1, 0, 0], 2);
    expect(k2).toEqual([[-1, 0, 0], [2, 0, 0]]);
    for (const k of k2) expect(isExitCell([1 + k[0], k[1], k[2]])).toBe(true);
    expect(exitCopies([5, 7, -4], 3).every((k) => isExitCell([5 + k[0], 7 + k[1], -4 + k[2]]))).toBe(true);
  });
});

describe('fractalCell: граф ходьбы', () => {
  it('navReach(arrival): ≥ 95 % стоячих узлов; площадка выхода, станция 18 (верх и пол изнутри), верх станции 6, все 6 граней атриума', () => {
    const report: string[] = [];
    for (const [s, P] of ALL) {
      const c = cellOf(s, P);
      const t1 = P / 3, t2 = 2 * P / 3, n1 = 4 * P / 9, n2 = 5 * P / 9;
      const nr = navReach(c, c.arrival);
      expect(nr.maxFall).toBeLessThanOrEqual(P);
      // стоячие узлы: на статичном твёрдом и не в щели вокруг ядра станции 6/павильона (1 м — туда не войти, §notes)
      const boxes = st6Boxes(c);
      const inBox = (x: number, y: number, z: number) => boxes.some((b) => x >= b.lo[0] && x < b.hi[0] && y >= b.lo[1] && y < b.hi[1] && z >= b.lo[2] && z < b.hi[2]);
      let tot = 0, got = 0;
      const V = c.vox, at = (x: number, y: number, z: number) => V[vidx(P, wrap(x, P), wrap(y, P), wrap(z, P))];
      for (let z = 0; z < P; z++) for (let y = 0; y < P; y++) for (let x = 0; x < P; x++) {
        if (V[vidx(P, x, y, z)] !== VX.AIR) continue;
        for (const up of AXES6) {
          const d = AXIS_VEC[up];
          if (at(x + d[0], y + d[1], z + d[2]) !== VX.AIR || !isStaticVx(at(x - d[0], y - d[1], z - d[2])) || inBox(x, y, z)) continue;
          tot++;
          if (nr.seen[vidx(P, x, y, z) * 6 + up]) got++;
        }
      }
      report.push(`${P}:${s} ${(100 * got / tot).toFixed(1)}% (${got}/${tot}, всего узлов ${nr.count}/${nr.total})`);
      expect(got / tot, s).toBeGreaterThanOrEqual(0.95);
      // площадка выхода
      const e = c.esc[c.exit.esc];
      expect(nr.has(c.arrival.at, c.arrival.up)).toBe(true);
      expect(nr.has(add(add(e.o, e.fwd, e.run + 3.5), e.up, e.rise), e.up)).toBe(true);
      // слой ступней: есть ли достигнутый узел с этим up в слое feet по оси up и в квадрате [lo, hi)² по двум другим
      const up = c.arrival.up, a = axisIdx(up), sg = axisSign(up);
      const anyIn = (u: Axis6, feet: number, lo: number, hi: number): boolean => {
        const ax = axisIdx(u), j = (ax + 1) % 3, k = (ax + 2) % 3;
        for (let p = lo; p < hi; p++) for (let q = lo; q < hi; q++) {
          const v = [0, 0, 0]; v[ax] = feet; v[j] = p; v[k] = q;
          if (nr.seen[vidx(P, v[0], v[1], v[2]) * 6 + u]) return true;
        }
        return false;
      };
      expect(anyIn(up, sg > 0 ? t2 : t1 - 1, t1, t2), `${s}: верх станции 18`).toBe(true);
      expect(anyIn(up, sg > 0 ? t1 + 1 : t2 - 2, t1 + 1, t2 - 1), `${s}: пол станции 18 изнутри`).toBe(true);
      expect(anyIn(up, sg > 0 ? n2 : n1 - 1, n1, n2), `${s}: верх станции 6`).toBe(true);
      for (const u of AXES6) expect(anyIn(u, axisSign(u) > 0 ? 1 : P - 2, 1, P - 1), `${s}: грань атриума ${u}`).toBe(true);
      void a;
    }
    console.info('fractal: navReach', report);
  }, 120_000);
});

describe('fractalCell: точки, пропы, линии', () => {
  it('spots: ≥ 24 стоячих точек, все 6 направлений up', () => {
    for (const [s, P] of ALL) {
      const c = cellOf(s, P);
      expect(c.spots.length).toBeGreaterThanOrEqual(24);
      for (const sp of c.spots) {
        const f = footVox(sp.at, sp.up);
        expect(standable(c, f[0], f[1], f[2], sp.up)).toBe(true);
        expect(axisIdx(sp.fwd)).not.toBe(axisIdx(sp.up));
      }
      expect(new Set(c.spots.map((sp) => sp.up)).size).toBe(6);
    }
  });

  it('пропы: id есть в props.ts, up — нормаль настоящей грани (висячие — наоборот), ≤ 400', () => {
    for (const [s, P] of ALL) {
      const c = cellOf(s, P);
      expect(c.props.length).toBeLessThanOrEqual(400);
      expect(c.props.length).toBeGreaterThan(100);
      for (const p of c.props) {
        expect(PROP_BY_ID[p.id], p.id).toBeDefined();
        expect(axisIdx(p.fwd)).not.toBe(axisIdx(p.up));
        expect([1, 1 / 3, 1 / 9]).toContain(p.s);
        const hang = FR_HANGING_PROPS.has(p.id);
        const under = footVox(p.at, opp(p.up)), over = footVox(p.at, p.up);
        const vu = voxAt(c, under[0], under[1], under[2]), vo = voxAt(c, over[0], over[1], over[2]);
        if (hang) { expect(vu, `${s} ${p.id}`).toBe(VX.AIR); expect(isStaticVx(vo), `${s} ${p.id}`).toBe(true); }
        else { expect(isStaticVx(vu), `${s} ${p.id} ${p.at}`).toBe(true); expect(vo, `${s} ${p.id} ${p.at}`).toBe(VX.AIR); }
      }
      const ids = new Set(c.props.map((p) => p.id));
      for (const id of ['p_metro_edge', 'p_metro_bench', 'p_metro_track', 'p_metro_mini_track', 'p_metro_micro_track', 'p_metro_panel', 'p_metro_esc_booth', 'p_metro_sign']) {
        expect(ids.has(id), `${s}: ${id}`).toBe(true);
      }
    }
  });

  it('световые линии: осевые отрезки, |out| = 1 ⊥ отрезку, ободья плит/станций и рёбра есть', () => {
    for (const [s, P] of ALL) {
      const c = cellOf(s, P);
      const kinds = new Set(c.lights.map((l) => l.kind)), scales = new Set(c.lights.map((l) => l.scale));
      for (const k of ['rim', 'edge', 'pav', 'landing']) expect(kinds.has(k as never), `${s} ${k}`).toBe(true);
      for (const k of [1, 3, 9]) expect(scales.has(k as never)).toBe(true);
      expect(c.lights.filter((l) => l.kind === 'rim' && l.scale === 1)).toHaveLength(24);
      for (const l of c.lights) {
        const d = [l.b[0] - l.a[0], l.b[1] - l.a[1], l.b[2] - l.a[2]];
        expect(d.filter((v) => v !== 0)).toHaveLength(1);
        expect(Math.hypot(...l.out)).toBeCloseTo(1, 9);
        expect(d[0] * l.out[0] + d[1] * l.out[1] + d[2] * l.out[2]).toBeCloseTo(0, 9);
        for (const v of [...l.a, ...l.b]) { expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThanOrEqual(P); }
      }
    }
  });
});
