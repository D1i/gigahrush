// «Фрактальная станция» — стыки ролей (INTEGRATE, tmp/metro-wip/FRACTAL.md §7.2, notes-fr-integrate.md): страховка
// «застрял» (замкнутый карман графа ходьбы — щель «станции 6»), сборка ячейки + мешер в бюджете §7.3.
import { describe, expect, it } from 'vitest';
import { AXES6, AXIS_VEC, axisIdx, axisSign, type V3 } from './fractalAxes';
import { buildFractalCell, navPocket, solidAt } from './fractalCell';
import { meshCell, meshEscBand } from './fractalMesh';
import { createBody, placeBody, stepBody, type FrInput } from './fractalPhysics';
import { createEscWorld } from './fractalEsc';

const CAP = 400;
const SEEDS = ['t1', 'j1', 'j2'];

describe('fractal: страховка «застрял» (navPocket)', () => {
  it('прибытие и все точки страховки — не карман; ядро под дырой и щель «станции 6» — карман', () => {
    for (const seed of SEEDS) {
      const cell = buildFractalCell(seed);
      const P = cell.P, c = P / 2, c1 = (13 * P) / 27, c2 = (14 * P) / 27, n1 = (12 * P) / 27;
      for (const s of [cell.arrival, ...cell.spots]) expect(navPocket(cell, s.at, s.up, undefined, CAP), `${seed} ${s.at}`).toBe(CAP);
      // все сломаны (кроме выхода) — с прибытия всё равно не карман
      const all = new Set(cell.esc.filter((e) => e.kind !== 'exit').map((e) => e.i));
      expect(navPocket(cell, cell.arrival.at, cell.arrival.up, all, CAP)).toBe(CAP);
      for (const up of AXES6) {
        const a = axisIdx(up);
        // верх ядра в дыре оболочки: шагнул в дыру — стоишь на ядре головой в дыре
        const core: V3 = [c, c, c];
        core[a] = axisSign(up) > 0 ? c2 : c1;
        const n = navPocket(cell, core, up, undefined, CAP);
        expect(n, `${seed} ядро up ${up}`).toBeGreaterThan(0);
        expect(n, `${seed} ядро up ${up}`).toBeLessThan(CAP);
        // щель 1 м между оболочкой и ядром — пол оболочки изнутри (у её стенки)
        const gap: V3 = [n1 + 1.5, n1 + 1.5, n1 + 1.5];
        gap[a] = axisSign(up) > 0 ? n1 + 1 : P - n1 - 1;
        expect(navPocket(cell, gap, up, undefined, CAP), `${seed} щель up ${up}`).toBeLessThan(CAP);
      }
    }
  });

  it('шагнул в дыру крыши «станции 6» — физика держит в кармане (страховка сцены нужна), перенос на точку — свободен', () => {
    const cell = buildFractalCell('t1');
    const env = { cell, esc: createEscWorld(cell, 't1') };
    const P = cell.P, c = P / 2, n2 = (15 * P) / 27;
    const b = createBody(cell.arrival, [1, 1, 1]);
    // крыша «станции 6» (up +Y), в 2 м от дыры, лицом к ней (+Z)
    placeBody(b, [c, n2, c - 2], 2, 0);
    const go: FrInput = { fwd: 1, side: 0, run: false, dYaw: 0, dPitch: 0, use: false };
    for (let i = 0; i < 60 * 3; i++) stepBody(env, b, go, 1 / 60);
    expect(b.ground).toBe('floor');
    expect(navPocket(cell, b.pos, b.up, env.esc.broken, CAP)).toBeLessThan(CAP);
    // во все стороны 3 с — из кармана не выйти
    for (let k = 0; k < 8; k++) {
      b.yaw = (k * Math.PI) / 4;
      for (let i = 0; i < 60 * 3; i++) stepBody(env, b, go, 1 / 60);
      expect(navPocket(cell, b.pos, b.up, env.esc.broken, CAP), `yaw ${k}`).toBeLessThan(CAP);
    }
    // перенос (как rescue сцены) — на ближайшую точку: она не карман, тело стоит
    const near = [...cell.spots].sort((p, q) => dist(p.at, b.pos) - dist(q.at, b.pos))[0];
    placeBody(b, near.at, near.up, 0);
    for (let i = 0; i < 30; i++) stepBody(env, b, { ...go, fwd: 0 }, 1 / 60);
    expect(b.ground).toBe('floor');
    expect(navPocket(cell, b.pos, b.up, env.esc.broken, CAP)).toBe(CAP);
    // ступня на полу: под ней твёрдое
    const U = AXIS_VEC[b.up];
    expect(solidAt(cell, Math.floor(b.pos[0] - U[0] * 0.5), Math.floor(b.pos[1] - U[1] * 0.5), Math.floor(b.pos[2] - U[2] * 0.5))).toBe(true);
  });
});

describe('fractal: бюджет сборки (§7.3)', () => {
  it('ячейка + мешер lod 0/1 + подложки ≤ 400 мс (Worker не нужен)', () => {
    buildFractalCell('warm');
    const times: number[] = [];
    for (const seed of ['b1', 'b2', 'b3', 'b4']) {
      const t0 = performance.now();
      const cell = buildFractalCell(seed);
      meshCell(cell, { lod: 0 });
      meshCell(cell, { lod: 1 });
      for (const e of cell.esc) meshEscBand(cell, e.i);
      times.push(performance.now() - t0);
    }
    times.sort((a, b) => a - b);
    expect(times[times.length >> 1]).toBeLessThan(400);
  });
});

function dist(a: V3, b: V3): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}
