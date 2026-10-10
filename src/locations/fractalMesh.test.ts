import { describe, expect, it } from 'vitest';
import { buildFractalCell, isStaticVx, vidx, VX, type FractalCell } from './fractalCell';
import { meshCell, meshEscBand, surfOf, type SurfMesh } from './fractalMesh';

const SEEDS: [string, 54 | 81][] = [...Array.from({ length: 20 }, (_, i): [string, 54] => ['fr' + i, 54]), ['fr81a', 81], ['fr81b', 81], ['fr81c', 81]];
const cache = new Map<string, FractalCell>();
const cellOf = (seed: string, P: 54 | 81): FractalCell => {
  const k = P + ':' + seed;
  let c = cache.get(k);
  if (!c) { c = buildFractalCell(seed, { P }); cache.set(k, c); }
  return c;
};
const wrap = (i: number, P: number) => ((i % P) + P) % P;
const isFrame = (v: number) => v >= VX.SLAB && v <= VX.ROD;

/** Открытые грани: воксель «свой» (inc), сосед по нормали (по модулю P) не твёрд (sol). */
function openFaces(c: FractalCell, inc: (v: number) => boolean, sol: (v: number) => boolean): number {
  const P = c.P, V = c.vox;
  let n = 0;
  for (let z = 0; z < P; z++) for (let y = 0; y < P; y++) for (let x = 0; x < P; x++) {
    if (!inc(V[vidx(P, x, y, z)])) continue;
    for (const [dx, dy, dz] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]) {
      if (!sol(V[vidx(P, wrap(x + dx, P), wrap(y + dy, P), wrap(z + dz, P))])) n++;
    }
  }
  return n;
}

/** Проверка всех квадов: каждая единичная клетка — грань своего вокселя к нетвёрдому соседу; обход — по часовой с нормали.
 *  Возвращает сумму площадей и список нарушений. */
function checkQuads(c: FractalCell, meshes: SurfMesh[], inc: (v: number) => boolean, sol: (v: number) => boolean): { area: number; bad: string[] } {
  const P = c.P, V = c.vox, bad: string[] = [];
  let area = 0;
  for (const m of meshes) {
    expect(m.positions.length).toBe(m.quads * 12);
    expect(m.indices.length).toBe(m.quads * 6);
    for (let q = 0; q < m.quads; q++) {
      const b = q * 12;
      const n = [m.normals[b], m.normals[b + 1], m.normals[b + 2]];
      const ax = n.findIndex((v) => v !== 0), s = n[ax];
      const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
      for (let k = 0; k < 4; k++) for (let i = 0; i < 3; i++) {
        lo[i] = Math.min(lo[i], m.positions[b + k * 3 + i]); hi[i] = Math.max(hi[i], m.positions[b + k * 3 + i]);
      }
      if (lo[ax] !== hi[ax]) bad.push(`${m.surf} квад ${q} не плоский`);
      const w = lo[ax];
      const [ua, va] = [0, 1, 2].filter((i) => i !== ax);
      area += (hi[ua] - lo[ua]) * (hi[va] - lo[va]);
      for (let u = lo[ua]; u < hi[ua]; u++) for (let v = lo[va]; v < hi[va]; v++) {
        const own = [0, 0, 0], nb = [0, 0, 0];
        own[ax] = s > 0 ? w - 1 : w; own[ua] = u; own[va] = v;
        nb[ax] = s > 0 ? w : w - 1; nb[ua] = u; nb[va] = v;
        const vo = V[vidx(P, wrap(own[0], P), wrap(own[1], P), wrap(own[2], P))];
        const vn = V[vidx(P, wrap(nb[0], P), wrap(nb[1], P), wrap(nb[2], P))];
        if (!inc(vo) || sol(vn)) bad.push(`${m.surf} грань ${own} → ${nb}: ${vo}/${vn}`);
      }
      // обход: cross(B − A, C − A) · n < 0 у обоих треугольников
      for (let t = 0; t < 2; t++) {
        const ids = [m.indices[q * 6 + t * 3], m.indices[q * 6 + t * 3 + 1], m.indices[q * 6 + t * 3 + 2]];
        const p = ids.map((i) => [m.positions[i * 3], m.positions[i * 3 + 1], m.positions[i * 3 + 2]]);
        const e1 = [0, 1, 2].map((i) => p[1][i] - p[0][i]), e2 = [0, 1, 2].map((i) => p[2][i] - p[0][i]);
        const cr = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
        if (cr[0] * n[0] + cr[1] * n[1] + cr[2] * n[2] >= 0) bad.push(`${m.surf} квад ${q}: обход`);
      }
      // uv — метры в плоскости грани (X: z, y; Y: x, z; Z: x, y)
      const UV = [[2, 1], [0, 2], [0, 1]][ax];
      for (let k = 0; k < 4; k++) {
        const uu = m.uvs[q * 8 + k * 2], vv = m.uvs[q * 8 + k * 2 + 1];
        if (uu !== m.positions[b + k * 3 + UV[0]] || vv !== m.positions[b + k * 3 + UV[1]]) bad.push(`${m.surf} квад ${q}: uv`);
      }
    }
  }
  return { area, bad: bad.slice(0, 10) };
}

describe('fractalMesh', () => {
  it('lod 0: грани только к пустоте (и через границу P), площадь = числу открытых граней, ≤ 6000 квадов', () => {
    for (const [s, P] of SEEDS) {
      const c = cellOf(s, P);
      const m = meshCell(c);
      const { area, bad } = checkQuads(c, m, isStaticVx, isStaticVx);
      expect(bad, s).toEqual([]);
      expect(area).toBe(openFaces(c, isStaticVx, isStaticVx));
      const q = m.reduce((a, x) => a + x.quads, 0);
      expect(q).toBeLessThanOrEqual(6000);
      const surfs = new Set(m.map((x) => x.surf));
      for (const k of ['granite', 'trim', 'marble', 'marbleDark', 'core', 'landing']) expect(surfs.has(k as never), `${s} ${k}`).toBe(true);
      expect(surfs.has('far')).toBe(false);
      for (const x of m) {
        for (const v of x.positions) { expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThanOrEqual(P); }
      }
    }
  }, 120_000);

  it('lod 1: только каркас, поверхности far + core, ≤ 1500 квадов', () => {
    for (const [s, P] of SEEDS) {
      const c = cellOf(s, P);
      const m = meshCell(c, { lod: 1 });
      const { area, bad } = checkQuads(c, m, isFrame, isFrame);
      expect(bad, s).toEqual([]);
      expect(area).toBe(openFaces(c, isFrame, isFrame));
      expect(m.map((x) => x.surf).sort()).toEqual(['core', 'far']);
      expect(m.reduce((a, x) => a + x.quads, 0)).toBeLessThanOrEqual(1500);
    }
  }, 120_000);

  it('meshEscBand: ровно подложка эскалатора i, к любому твёрдому граней нет', () => {
    for (const [s, P] of SEEDS.slice(0, 5)) {
      const c = cellOf(s, P);
      for (const e of c.esc) {
        const band = VX.ESC0 + e.i;
        const m = meshEscBand(c, e.i);
        expect(m.length).toBeGreaterThan(0);
        const { area, bad } = checkQuads(c, m, (v) => v === band, (v) => v !== VX.AIR);
        expect(bad).toEqual([]);
        expect(area).toBe(openFaces(c, (v) => v === band, (v) => v !== VX.AIR));
      }
      expect(meshEscBand(c, 31)).toEqual([]);
    }
  }, 60_000);

  it('surfOf: плита — гранит по оси плиты, обод дыры — тёмный мрамор; классы → поверхности', () => {
    const P = 54;
    expect(surfOf(VX.SLAB, 1, 5, 0, 5, P)).toBe('granite');
    expect(surfOf(VX.SLAB, 1, 5, P - 1, 5, P)).toBe('granite');
    expect(surfOf(VX.SLAB, 0, 17, 0, 20, P)).toBe('trim');
    expect(surfOf(VX.SHELL1, 0, 18, 20, 20, P)).toBe('marble');
    expect(surfOf(VX.PYLON, 2, 18, 18, 5, P)).toBe('marble');
    expect(surfOf(VX.SHELL2, 0, 24, 25, 25, P)).toBe('marbleDark');
    expect(surfOf(VX.ROD, 0, 5, 24, 24, P)).toBe('marbleDark');
    expect(surfOf(VX.CORE, 0, 26, 26, 26, P)).toBe('core');
    expect(surfOf(VX.LANDING, 1, 10, 17, 40, P)).toBe('landing');
  });

  it('бюджет: buildFractalCell + meshCell ≤ 400 мс (мягко), > 1500 — провал', () => {
    const times: number[] = [];
    for (const s of ['bud0', 'bud1', 'bud2', 'bud3', 'bud4']) {
      const t0 = performance.now();
      const c = buildFractalCell(s);
      meshCell(c);
      meshCell(c, { lod: 1 });
      for (const e of c.esc) meshEscBand(c, e.i);
      times.push(performance.now() - t0);
    }
    const worst = Math.max(...times);
    if (worst > 400) console.warn(`fractal: сборка + меши ${worst.toFixed(0)} мс > 400`);
    console.info('fractal: сборка + меши, мс', times.map((t) => t.toFixed(0)).join(' '));
    expect(worst).toBeLessThan(1500);
  });
});
