// Кэш геометрии прогона для предпросмотра: мировые экземпляры, Path2D пола и стен
// (в клеточных координатах — рисуются через setTransform), точки подписей, связи, пути.
// Строится один раз на прогон (вызывающий мемоизирует по run).
import { cellKey, outlineLines, parseKey } from '../model/cells';
import type { Instance, InstanceContent, Project, Room, Run } from '../model/types';
import { runWorld, type InstanceWorld } from '../gen/world';
import { overlapPairs } from '../gen4d/fold';
import { isFoldRun } from './genMode';

export interface PeerLink {
  /** соседний экземпляр */
  inst: string;
  /** метка этого экземпляра */
  connector: string;
  /** метка соседа */
  peerConnector: string;
  /** сдвиг слоя W при переходе отсюда к соседу (складчатый прогон; 0 — обычный порог) */
  dw: number;
}

export interface InstGeo {
  w: InstanceWorld;
  inst: Instance;
  room: Room | undefined;
  content: InstanceContent | undefined;
  floor: Path2D;
  walls: Path2D;
  /** точка подписи/лута: клетка комнаты, ближайшая к центроиду (центр клетки) */
  cx: number;
  cy: number;
  /** id меток, задействованных в связях */
  linked: Set<string>;
  /** id меток-тупиков */
  open: Set<string>;
  peers: PeerLink[];
  /** слой W (0 у евклидова прогона) */
  layer: number;
  /** экземпляры, занимающие то же место в 3D (в других слоях) — только складчатый прогон */
  overlaps: string[];
}

export interface RunGeo {
  list: InstGeo[];
  byId: Map<string, InstGeo>;
  bbox: { x0: number; y0: number; x1: number; y1: number } | null;
  maxAcc: number;
  maxDepth: number;
  error: string | null;
  /** складчатый (4D) прогон */
  fold: boolean;
  minW: number;
  maxW: number;
  /** W → число экземпляров, по возрастанию W */
  layers: [number, number][];
  /** пар экземпляров, пересекающихся в 3D */
  overlapCount: number;
}

function floorPath(cells: Set<string>): Path2D {
  const rows = new Map<number, number[]>();
  for (const k of cells) {
    const [x, y] = parseKey(k);
    let r = rows.get(y);
    if (!r) rows.set(y, (r = []));
    r.push(x);
  }
  const path = new Path2D();
  for (const [y, xs] of rows) {
    xs.sort((a, b) => a - b);
    let s = xs[0];
    for (let i = 1; i <= xs.length; i++) {
      if (i < xs.length && xs[i] === xs[i - 1] + 1) continue;
      path.rect(s, y, xs[i - 1] - s + 1, 1);
      s = xs[i];
    }
  }
  return path;
}

function wallPath(cells: Set<string>): Path2D {
  const path = new Path2D();
  for (const [x1, y1, x2, y2] of outlineLines(cells)) {
    path.moveTo(x1, y1);
    path.lineTo(x2, y2);
  }
  return path;
}

function labelPoint(cells: Set<string>): [number, number] {
  let sx = 0, sy = 0, n = 0;
  for (const k of cells) {
    const [x, y] = parseKey(k);
    sx += x + 0.5;
    sy += y + 0.5;
    n++;
  }
  if (!n) return [0, 0];
  const mx = sx / n, my = sy / n;
  const fx = Math.floor(mx), fy = Math.floor(my);
  if (cells.has(cellKey(fx, fy))) return [mx, my];
  let best: [number, number] = [mx, my];
  let bd = Infinity;
  for (const k of cells) {
    const [x, y] = parseKey(k);
    const d = (x + 0.5 - mx) ** 2 + (y + 0.5 - my) ** 2;
    if (d < bd) {
      bd = d;
      best = [x + 0.5, y + 0.5];
    }
  }
  return best;
}

export function buildRunGeo(p: Project, run: Run): RunGeo {
  let worlds: InstanceWorld[];
  try {
    worlds = runWorld(p, run);
  } catch (e: any) {
    return {
      list: [], byId: new Map(), bbox: null, maxAcc: 0, maxDepth: 0, error: String(e?.message ?? e),
      fold: false, minW: 0, maxW: 0, layers: [], overlapCount: 0,
    };
  }
  const contentBy = new Map(run.content.map((c) => [c.inst, c]));
  const list: InstGeo[] = [];
  const byId = new Map<string, InstGeo>();
  let bb: RunGeo['bbox'] = null;
  let maxAcc = 0;
  let maxDepth = 0;
  for (const w of worlds) {
    const [cx, cy] = labelPoint(w.cells);
    const g: InstGeo = {
      w,
      inst: w.inst,
      room: p.rooms.find((r) => r.id === w.inst.roomId),
      content: contentBy.get(w.inst.id),
      floor: floorPath(w.cells),
      walls: wallPath(w.cells),
      cx,
      cy,
      linked: new Set(),
      open: new Set(),
      peers: [],
      layer: w.inst.w ?? 0,
      overlaps: [],
    };
    list.push(g);
    byId.set(g.inst.id, g);
    const b = w.bbox;
    bb = bb
      ? { x0: Math.min(bb.x0, b.x0), y0: Math.min(bb.y0, b.y0), x1: Math.max(bb.x1, b.x1), y1: Math.max(bb.y1, b.y1) }
      : { ...b };
    maxAcc = Math.max(maxAcc, g.content?.dangerAcc ?? 0);
    maxDepth = Math.max(maxDepth, g.inst.depth);
  }
  for (const l of run.links) {
    const a = byId.get(l.a.inst);
    const b = byId.get(l.b.inst);
    const dw = l.dw ?? 0;
    if (a) {
      a.linked.add(l.a.connector);
      a.peers.push({ inst: l.b.inst, connector: l.a.connector, peerConnector: l.b.connector, dw });
    }
    if (b) {
      b.linked.add(l.b.connector);
      b.peers.push({ inst: l.a.inst, connector: l.b.connector, peerConnector: l.a.connector, dw: dw ? -dw : 0 });
    }
  }
  for (const o of run.openConnectors) byId.get(o.inst)?.open.add(o.connector);

  // складчатый прогон: слои и пересечения в 3D
  const fold = isFoldRun(run);
  const cnt = new Map<number, number>();
  for (const g of list) cnt.set(g.layer, (cnt.get(g.layer) ?? 0) + 1);
  const layers = [...cnt].sort((x, y) => x[0] - y[0]);
  let overlapCount = 0;
  if (fold) {
    try {
      const pairs = overlapPairs(p, run);
      overlapCount = pairs.length;
      for (const [x, y] of pairs) {
        byId.get(x)?.overlaps.push(y);
        byId.get(y)?.overlaps.push(x);
      }
    } catch (e) {
      console.warn('overlapPairs', e);
    }
  }
  return {
    list, byId, bbox: bb, maxAcc, maxDepth, error: null,
    fold, minW: layers.length ? layers[0][0] : 0, maxW: layers.length ? layers[layers.length - 1][0] : 0, layers, overlapCount,
  };
}

/** Путь от старта до экземпляра по parent (включительно, от старта). */
export function pathTo(geo: RunGeo, instId: string | null): InstGeo[] {
  const out: InstGeo[] = [];
  const seen = new Set<string>();
  let cur = instId ? geo.byId.get(instId) : undefined;
  while (cur && !seen.has(cur.inst.id)) {
    seen.add(cur.inst.id);
    out.push(cur);
    cur = cur.inst.parent ? geo.byId.get(cur.inst.parent) : undefined;
  }
  return out.reverse();
}

/** Экземпляр под точкой (клеточные координаты). filter — какие экземпляры считать (режимы слоёв). */
export function hitInst(geo: RunGeo, x: number, y: number, filter?: (g: InstGeo) => boolean): InstGeo | null {
  const all = hitAll(geo, x, y, filter);
  return all.length ? all[all.length - 1] : null;
}

/** Все экземпляры под точкой (в складчатом прогоне их может быть несколько — разные слои). */
export function hitAll(geo: RunGeo, x: number, y: number, filter?: (g: InstGeo) => boolean): InstGeo[] {
  const fx = Math.floor(x), fy = Math.floor(y);
  const k = cellKey(fx, fy);
  const out: InstGeo[] = [];
  for (const g of geo.list) {
    const b = g.w.bbox;
    if (fx < b.x0 || fy < b.y0 || fx >= b.x1 || fy >= b.y1) continue;
    if (filter && !filter(g)) continue;
    if (g.w.cells.has(k)) out.push(g);
  }
  return out;
}
