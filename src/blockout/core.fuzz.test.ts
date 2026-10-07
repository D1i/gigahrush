// Случайные планировки: дерево разрезов прямоугольника (много Т- и Х-узлов), Г-вырезы, дыры,
// связи по общим границам, тупики-метки и двери. Любая из них должна давать чистую модель.
import { describe, expect, it } from 'vitest';
import { buildBlockoutModel, validateBlockout } from './core';
import type { RunExport, RunInstance, Side } from './types';

/** mulberry32 */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface R4 {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

const segLine = (s: { side: Side; cx: number; cy: number; len: number }): [number, number, number, number] =>
  s.side === 'N' ? [s.cx, s.cy, s.cx + s.len, s.cy]
    : s.side === 'S' ? [s.cx, s.cy + 1, s.cx + s.len, s.cy + 1]
      : s.side === 'W' ? [s.cx, s.cy, s.cx, s.cy + s.len]
        : [s.cx + 1, s.cy, s.cx + 1, s.cy + s.len];

function rows(cells: Set<string>): string[] {
  const by = new Map<number, number[]>();
  for (const k of cells) {
    const [x, y] = k.split(',').map(Number);
    by.set(y, [...(by.get(y) ?? []), x]);
  }
  return [...by.keys()].sort((a, b) => a - b).map((y) => {
    const xs = by.get(y)!.sort((a, b) => a - b);
    const parts: string[] = [];
    for (let i = 0; i < xs.length; ) {
      let j = i;
      while (j + 1 < xs.length && xs[j + 1] === xs[j] + 1) j++;
      parts.push(i === j ? `${xs[i]}` : `${xs[i]}-${xs[j]}`);
      i = j + 1;
    }
    return `${y}:${parts.join(',')}`;
  });
}

/** Случайная планировка: разрезы прямоугольника, при gap > 0 комнаты усажены справа/снизу на gap. */
function gen(seed: number, gap: number): RunExport {
  const r = rng(seed);
  const leaves: R4[] = [];
  const split = (q: R4, depth: number): void => {
    const w = q.x1 - q.x0, h = q.y1 - q.y0;
    if (depth > 5 || (w < 12 && h < 12) || (depth > 1 && r() < 0.15)) return void leaves.push(q);
    const vert = w > h ? true : h > w ? false : r() < 0.5;
    const len = vert ? w : h;
    if (len < 12) return void leaves.push(q);
    // разрезы по сетке 3 клетки — чаще совпадают, получаются Х-узлы
    const at = Math.round((6 + r() * (len - 12)) / 3) * 3;
    if (vert) {
      split({ ...q, x1: q.x0 + at }, depth + 1);
      split({ ...q, x0: q.x0 + at }, depth + 1);
    } else {
      split({ ...q, y1: q.y0 + at }, depth + 1);
      split({ ...q, y0: q.y0 + at }, depth + 1);
    }
  };
  split({ x0: 0, y0: 0, x1: 60 + Math.floor(r() * 30), y1: 60 + Math.floor(r() * 30) }, 0);

  const rs = leaves.map((q) => ({ x0: q.x0, y0: q.y0, x1: q.x1 - gap, y1: q.y1 - gap }));
  const cells: Set<string>[] = rs.map((q) => {
    const s = new Set<string>();
    for (let y = q.y0; y < q.y1; y++) for (let x = q.x0; x < q.x1; x++) s.add(`${x},${y}`);
    return s;
  });
  // Г-вырезы углов и дыры 2×1
  rs.forEach((q, i) => {
    const w = q.x1 - q.x0, h = q.y1 - q.y0;
    if (w >= 8 && h >= 8 && r() < 0.3) {
      const cw = 2 + Math.floor(r() * (w / 2 - 2)), ch = 2 + Math.floor(r() * (h / 2 - 2));
      const right = r() < 0.5, bottom = r() < 0.5;
      for (let y = 0; y < ch; y++) {
        for (let x = 0; x < cw; x++) cells[i].delete(`${right ? q.x1 - 1 - x : q.x0 + x},${bottom ? q.y1 - 1 - y : q.y0 + y}`);
      }
    }
    if (w >= 10 && h >= 10 && r() < 0.2) {
      const hx = q.x0 + 4 + Math.floor(r() * (w - 8)), hy = q.y0 + 4 + Math.floor(r() * (h - 8));
      cells[i].delete(`${hx},${hy}`);
      cells[i].delete(`${hx + 1},${hy}`);
    }
  });
  const has = (i: number, x: number, y: number): boolean => cells[i].has(`${x},${y}`);

  const insts: RunInstance[] = rs.map((q, i) => ({
    id: `i${i}`, roomId: `r${i}`, roomName: `R${i}`, roomTags: [], rot: 0, dx: 0, dy: 0, depth: 0, parent: null,
    bbox: q, cells: rows(cells[i]), doors: [], connectors: [], decor: [], spots: [], tier: null, danger: 0, dangerAcc: 0, loot: [],
  }));
  const links: RunExport['links'] = [];
  let kc = 0;
  const addCon = (i: number, side: Side, cx: number, cy: number, len: number, linkedTo: { inst: string; connector: string } | null): void => {
    const id = `k${kc++}`;
    insts[i].connectors.push({ id, name: id, tag: 't', side, cx, cy, len, line: segLine({ side, cx, cy, len }), linkedTo });
  };
  /** связь a → b по общей границе: span — клетки вдоль, где с обеих сторон пол */
  const link = (a: number, b: number, span: number[], make: (s0: number, len: number, ka: string, kb: string) => void): void => {
    if (!span.length || r() >= 0.6) return;
    const s0 = span[Math.floor(r() * span.length)];
    let len = 1;
    while (len < 5 && span.includes(s0 + len)) len++;
    const ka = `k${kc}`, kb = `k${kc + 1}`;
    make(s0, len, ka, kb);
    links.push({ a: { inst: `i${a}`, connector: ka }, b: { inst: `i${b}`, connector: kb } });
  };
  for (let a = 0; a < rs.length; a++) {
    for (let b = 0; b < rs.length; b++) {
      if (a === b) continue;
      const A = rs[a], B = rs[b];
      if (A.x1 + gap === B.x0) {
        const ys: number[] = [];
        for (let y = Math.max(A.y0, B.y0); y < Math.min(A.y1, B.y1); y++) if (has(a, A.x1 - 1, y) && has(b, B.x0, y)) ys.push(y);
        link(a, b, ys, (s0, len, ka, kb) => {
          addCon(a, 'E', A.x1 - 1, s0, len, { inst: `i${b}`, connector: kb });
          addCon(b, 'W', B.x0, s0, len, { inst: `i${a}`, connector: ka });
        });
      }
      if (A.y1 + gap === B.y0) {
        const xs: number[] = [];
        for (let x = Math.max(A.x0, B.x0); x < Math.min(A.x1, B.x1); x++) if (has(a, x, A.y1 - 1) && has(b, x, B.y0)) xs.push(x);
        link(a, b, xs, (s0, len, ka, kb) => {
          addCon(a, 'S', s0, A.y1 - 1, len, { inst: `i${b}`, connector: kb });
          addCon(b, 'N', s0, B.y0, len, { inst: `i${a}`, connector: ka });
        });
      }
    }
  }
  // тупики: несвязанная метка и дверь без метки на верхней стороне
  rs.forEach((q, i) => {
    if (r() < 0.3) {
      for (let x = q.x0; x < q.x1; x++) if (has(i, x, q.y0)) {
        addCon(i, 'N', x, q.y0, 1, null);
        break;
      }
    }
    if (r() < 0.3) {
      for (let x = q.x1 - 1; x >= q.x0; x--) if (has(i, x, q.y0)) {
        insts[i].doors.push({ id: `d${i}`, side: 'N', cx: x, cy: q.y0, len: 1, line: segLine({ side: 'N', cx: x, cy: q.y0, len: 1 }) });
        break;
      }
    }
  });
  return { format: 'room-forge-run', version: 1, seed: String(seed), cellM: 0.1, settings: { gap }, props: [], items: [], instances: insts, links, openConnectors: [] };
}

describe('blockout: случайные планировки', () => {
  for (const gap of [0, 1, 2]) {
    it(`gap ${gap}: 20 планировок × режимы тупиков — без пересечений, утечек и проблем входа`, () => {
      for (let seed = 1; seed <= 20; seed++) {
        const run = gen(seed * 7 + gap, gap);
        for (const deadEnds of ['wall', 'panel', 'open'] as const) {
          const m = buildBlockoutModel(run, { deadEnds, outerWallCells: 1 + (seed % 3) });
          expect(m.issues).toEqual([]);
          expect(validateBlockout(m)).toEqual([]);
          expect(m.openings.length).toBe(run.links.length);
        }
      }
    }, 60000);
  }
});
