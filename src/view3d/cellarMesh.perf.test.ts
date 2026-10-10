import { it } from 'vitest';
import { buildCellarMesh, cellarField, type CellarDoor, type CellarPieceSpec } from './cellarMesh';

// Замер оболочки погреба (npm run test:perf): ход 0.6 × 3 м, щель 0.6 — 0.4 — 0.6 × 2.4 м, хаб 1.6 × 2 м с выходом наверх.
const door = (id: string, side: CellarDoor['side'], x: number, y: number, half: number, slot?: number): CellarDoor => {
  const n = { N: [0, 1], S: [0, -1], E: [-1, 0], W: [1, 0] }[side];
  return { id, side, x, y, nx: n[0], ny: n[1], half, state: slot ? 'closed' : 'open', top: 1.8, ...(slot ? { slot } : {}) };
};
const P = (rects: [number, number, number, number][], doors: CellarDoor[], vault: number): CellarPieceSpec => {
  const r = rects.map(([x0, y0, x1, y1]) => ({ x0, y0, x1, y1 }));
  return {
    rects: r, cell: 0.1, x0: Math.min(...r.map((q) => q.x0)), y0: Math.min(...r.map((q) => q.y0)), x1: Math.max(...r.map((q) => q.x1)), y1: Math.max(...r.map((q) => q.y1)),
    floorY: 0, pad: 0.05, doors, vault, seed: 7,
  };
};
it('bench', { timeout: 120000 }, () => {
  const specs: [string, number, CellarPieceSpec][] = [
    ['pass3', 3, P([[0, 0, 0.6, 3]], [door('n', 'N', 0.3, -0.05, 0.3), door('s', 'S', 0.3, 3.05, 0.3)], 1.85)],
    ['squeeze24', 3, P([[0, 0, 0.6, 0.3], [0.1, 0.3, 0.5, 2.7], [0, 2.7, 0.6, 3]], [door('n', 'N', 0.3, -0.05, 0.3), door('s', 'S', 0.3, 3.05, 0.3)], 1.85)],
    ['hub', 0, P([[0, 0, 1.6, 2]], [door('s', 'S', 0.8, 2.05, 0.3), door('w', 'W', -0.05, 1.0, 0.3), door('e', 'E', 1.65, 1.0, 0.3), door('up', 'N', 0.8, -0.05, 0.55, 2.1)], 1.95)],
  ];
  for (const [name, len, s] of specs) {
    let best = 1e9, tris = 0;
    for (let r = 0; r < 6; r++) {
      const t0 = performance.now();
      tris = buildCellarMesh(s).indices.length / 3;
      best = Math.min(best, performance.now() - t0);
    }
    const F = cellarField(s);
    const t0 = performance.now();
    let acc = 0;
    for (let i = 0; i < 100000; i++) acc += F.f(Math.random() * 0.6, Math.random() * 2, Math.random() * 2, true);
    console.log(name, 'build min', best.toFixed(1), 'ms;', tris, 'tris', len ? `(${Math.round(tris / len)}/m)` : '', '; f 100k', (performance.now() - t0).toFixed(0), 'ms', acc > 0 ? '' : ' ');
  }
});
