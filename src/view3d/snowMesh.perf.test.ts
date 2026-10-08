import { it } from 'vitest';
import { buildSnowMesh, snowField, type SnowPieceSpec, type SnowDoor } from './snowMesh';
const door = (id: string, side: SnowDoor['side'], x: number, y: number): SnowDoor => {
  const n = { N: [0, 1], S: [0, -1], E: [-1, 0], W: [1, 0] }[side];
  return { id, side, x, y, nx: n[0], ny: n[1], half: 0.6, state: 'open' };
};
it('bench', () => {
  const specs: [string, SnowPieceSpec][] = [
    ['straight3', { x0: 0, y0: 0, x1: 1.2, y1: 3, floorY: 0, den: false, rise: 0.25, bench: false, seed: 1, doors: [door('n', 'N', 0.6, 0), door('s', 'S', 0.6, 3)] }],
    ['turn2', { x0: 0, y0: 0, x1: 2, y1: 2, floorY: 0, den: false, rise: 0, bench: false, seed: 1, doors: [door('s', 'S', 0.6, 2), door('e', 'E', 2, 0.6)] }],
    ['den3', { x0: 0, y0: 0, x1: 3, y1: 3, floorY: 0, den: true, rise: 0, bench: true, seed: 3, doors: [door('s', 'S', 1.5, 3), door('w', 'W', 0, 1.5), door('e', 'E', 3, 1.5)] }],
  ];
  for (const [name, s] of specs) {
    let best = 1e9;
    for (let r = 0; r < 6; r++) { const t0 = performance.now(); buildSnowMesh(s); best = Math.min(best, performance.now() - t0); }
    const F = snowField(s);
    let t0 = performance.now(); let acc = 0;
    for (let i = 0; i < 100000; i++) acc += F.f(Math.random() * 2, Math.random() * 2, Math.random(), true);
    const tn = performance.now() - t0;
    t0 = performance.now();
    for (let i = 0; i < 100000; i++) acc += F.f(Math.random() * 2, Math.random() * 2, Math.random(), false);
    const tb = performance.now() - t0;
    console.log(name, 'build min', best.toFixed(1), 'ms; f(noise) 100k', tn.toFixed(0), 'ms; f(base) 100k', tb.toFixed(0), 'ms', acc > 0 ? '' : ' ');
  }
});
