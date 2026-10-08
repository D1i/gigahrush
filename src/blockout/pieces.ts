// «Куски» комнат для портального рендера складчатого (4D) прогона. Без зависимостей от приложения и движка.
//
// Портальный рендер (docs/BLOCKOUT-BABYLON.md §12) рисует каждую комнату отдельно: текущую — обычно,
// соседнюю — только внутри экранной области проёма, и так далее по цепочкам проёмов. Поэтому болванка
// нужна ПО КОМНАТАМ, причём такая, что:
//  • кусок комнаты не зависит от того, откуда на неё смотрят (кэшируется один раз);
//  • комната + любой её сосед стыкуются без щелей и наложений (стена между ними поделена пополам,
//    проём — тоже: пол, перемычка и откосы — по половине каждой стороне);
//  • комнаты, пересекающиеся в 3D (другие слои W), друг от друга не зависят вовсе.
// Кусок комнаты A строится по модели «A + все её соседи» с владением (BlockoutOptions.ownership): каждый
// объём получает владельца — ближайший пол (Воронов), — и из модели берётся только то, что принадлежит A.
// Соседи между собой могут пересекаться (localRadius = 1) — на кусок A это не влияет: ему нужны только
// границы «A | сосед», а их задают две комнаты.
import { buildBlockoutModel } from './core';
import { adjacencyOf, subRun } from './subrun';
import type { BlockoutModel, BlockoutOptions, Opening, Rect, RunExport, RunInstance, Side, Surface } from './types';

/** Соседи по связям (каждый один раз, в порядке run.instances). */
export function neighborIds(run: RunExport, id: string): string[] {
  const adj = adjacencyOf(run).get(id) ?? [];
  const set = new Set(adj);
  set.delete(id);
  return (run.instances ?? []).filter((i) => set.has(i.id)).map((i) => i.id);
}

/**
 * Модель окрестности «комната + соседи» с владением — исходник куска. Связи соседей наружу окрестности —
 * просто стены (это не их кусок; свои связи у комнаты все внутри). openCut — метки самой комнаты с флагом
 * cut (во входе: например, ещё не раскрытая дверь бесконечного мира, src/gen4d/stream.ts) — проём в
 * темноту ('open'), а не стена.
 */
export function neighborhoodModel(run: RunExport, id: string, opts?: Partial<BlockoutOptions>, openCut = false): BlockoutModel {
  const sub = unwrapAround(subRun(run, [id, ...neighborIds(run, id)]), id);
  if (!openCut) return buildBlockoutModel(sub, { ...(opts ?? {}), ownership: true, cutEnds: 'wall' });
  // у соседей cut снимается (обычный тупик — их панели в кусок комнаты не попадают)
  const instances = sub.instances.map((i) => (i.id === id ? i : { ...i, connectors: i.connectors.map((k) => (k.cut ? { ...k, cut: false } : k)) }));
  return buildBlockoutModel({ ...sub, instances }, { ...(opts ?? {}), ownership: true, cutEnds: 'open' });
}

/**
 * Шов бесконечного хода (links[].wrap): сосед комнаты id по шву сдвигается так, чтобы встать лицом к ней (как
 * обычный сосед), у связи снимается wrap — ядро открывает проём. Соседи по шву и по обычной связи не совпадают
 * (бесконечный участок — не меньше трёх комнат).
 */
function unwrapAround(sub: RunExport, id: string): RunExport {
  const moves = new Map<string, [number, number]>();
  const links = (sub.links ?? []).map((l) => {
    if (!l.wrap || (l.a.inst !== id && l.b.inst !== id)) return l;
    const { wrap, ...rest } = l;
    if (l.a.inst === id) moves.set(l.b.inst, [wrap[0], wrap[1]]);
    else moves.set(l.a.inst, [-wrap[0], -wrap[1]]);
    return rest;
  });
  if (!moves.size) return sub;
  const instances = sub.instances.map((i) => {
    const m = moves.get(i.id);
    return m && i.id !== id ? translateInstance(i, m[0], m[1]) : i;
  });
  return { ...sub, instances, links };
}

/** Экземпляр прогона, сдвинутый на (tx, ty) клеток плана. */
export function translateInstance(i: RunInstance, tx: number, ty: number): RunInstance {
  const rows = (i.cells ?? []).map((r) => {
    const cut = r.indexOf(':');
    const y = Number(r.slice(0, cut)) + ty;
    const xs = r
      .slice(cut + 1)
      .split(',')
      .map((part) => part.split('-').map((v) => String(Number(v) + tx)).join('-'));
    return `${y}:${xs.join(',')}`;
  });
  const seg = <T extends { cx: number; cy: number }>(s: T): T => ({ ...s, cx: s.cx + tx, cy: s.cy + ty });
  return {
    ...i,
    dx: i.dx + tx,
    dy: i.dy + ty,
    bbox: { x0: i.bbox.x0 + tx, y0: i.bbox.y0 + ty, x1: i.bbox.x1 + tx, y1: i.bbox.y1 + ty },
    cells: rows,
    doors: (i.doors ?? []).map(seg),
    connectors: (i.connectors ?? []).map(seg),
    decor: (i.decor ?? []).map((d) => ({ ...d, x: d.x + tx, y: d.y + ty })),
    spots: (i.spots ?? []).map((s) => ({ ...s, x: s.x + tx, y: s.y + ty })),
  };
}

/** Собственная геометрия комнаты id из модели с владением: её объёмы, пол и потолок (с половинами
 *  проёмов), облицовка, тупики, мебель, проёмы к соседям. Вход не мутируется. */
export function pieceOf(model: BlockoutModel, id: string): BlockoutModel {
  const mine = (s: Surface): boolean => s.inst === id || (s.inst === null && s.owner === id);
  const solids = model.solids.filter((s) => s.inst === id);
  const floors = model.floors.filter(mine);
  const ceilings = model.ceilings.filter(mine);
  const openings = model.openings.filter((o) => o.a.inst === id || o.b.inst === id);
  const deadEnds = model.deadEnds.filter((d) => d.inst === id);
  const doors = model.doors?.filter((d) => d.inst === id);
  const faces = model.faces.filter((f) => f.inst === id);
  const props = model.props.filter((p) => p.inst === id);
  const rooms = model.rooms.filter((r) => r.inst === id);
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const grow = (r: Rect): void => {
    x0 = Math.min(x0, r.x0);
    y0 = Math.min(y0, r.y0);
    x1 = Math.max(x1, r.x1);
    y1 = Math.max(y1, r.y1);
  };
  for (const s of solids) grow(s.rect);
  for (const f of floors) f.rects.forEach(grow);
  const cell = model.cellM > 0 ? model.cellM : 0.1;
  const floorCells = floors.reduce((n, f) => n + (f.inst ? f.rects.reduce((a, r) => a + Math.round(((r.x1 - r.x0) * (r.y1 - r.y0)) / (cell * cell)), 0) : 0), 0);
  // проблемы входа — только те, где упомянута эта комната (у соседей между собой бывают пересечения)
  const re = new RegExp(`(^|[^\\w])${id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^\\w]|$)`);
  return {
    ...model,
    bounds: x0 === Infinity ? { x0: 0, y0: 0, x1: 0, y1: 0 } : { x0, y0, x1, y1 },
    solids,
    floors,
    ceilings,
    openings,
    deadEnds,
    faces,
    props,
    rooms,
    stats: { ...model.stats, floorCells, solids: solids.length, openings: openings.length, deadEnds: deadEnds.length },
    issues: model.issues.filter((s) => re.test(s)),
    ...(doors ? { doors } : {}),
  };
}

/** Кусок комнаты: pieceOf(neighborhoodModel(...)). */
export function buildPiece(run: RunExport, id: string, opts?: Partial<BlockoutOptions>, openCut = false): BlockoutModel {
  return pieceOf(neighborhoodModel(run, id, opts, openCut), id);
}

/** Пол комнаты в куске для определения «где стоит игрок»: её пол + её половины проёмов. Граница с
 *  соседом проходит ровно по середине проёма — там же, где плоскость портала. */
export function pieceFloorRects(piece: BlockoutModel, id: string): Rect[] {
  return piece.floors.filter((s) => s.inst === id || (s.inst === null && s.owner === id)).flatMap((s) => s.rects);
}

/** Портал — проём связи, увиденный из комнаты from: плоскость посередине толщины стены. */
export interface PiecePortal {
  from: string;
  to: string;
  /** метки связи, как в Opening */
  a: Opening['a'];
  b: Opening['b'];
  /** 'x' — проходят вдоль x (плоскость x = at), 'y' — вдоль y (плоскость y = at); план, м */
  axis: 'x' | 'y';
  at: number;
  /** куда идти из from в to вдоль оси: +1 / −1 (по плану, y вниз) */
  dir: 1 | -1;
  /** проём в свету по другой оси, м */
  lo: number;
  hi: number;
  /** высота проёма от пола, м */
  h: number;
  /** проём целиком (на всю толщину стены) */
  rect: Rect;
  /** шов бесконечного хода: комната to видна сдвинутой на shift (м плана [dx, dy]; её настоящее место — без сдвига) */
  shift?: [number, number];
}

const SIDE_DIR: Record<Side, ['x' | 'y', 1 | -1]> = { E: ['x', 1], W: ['x', -1], S: ['y', 1], N: ['y', -1] };

/** Порталы комнаты id по проёмам её куска (направление — по стороне её метки в прогоне). */
export function piecePortals(run: RunExport, piece: BlockoutModel, id: string): PiecePortal[] {
  const inst = (run.instances ?? []).find((i) => i.id === id);
  const out: PiecePortal[] = [];
  const cell = run.cellM > 0 ? run.cellM : 0.1;
  const wraps = (run.links ?? []).filter((l) => l.wrap && (l.a.inst === id || l.b.inst === id));
  for (const op of piece.openings) {
    const mineA = op.a.inst === id;
    if (!mineA && op.b.inst !== id) continue;
    const me = mineA ? op.a : op.b;
    const other = mineA ? op.b : op.a;
    const k = inst?.connectors?.find((c) => c.id === me.connector);
    if (!k) continue;
    const [axis, dir] = SIDE_DIR[k.side];
    const r = op.rect;
    const at = axis === 'x' ? (r.x0 + r.x1) / 2 : (r.y0 + r.y1) / 2;
    const wl = wraps.find((l) => (l.a.inst === me.inst && l.a.connector === me.connector) || (l.b.inst === me.inst && l.b.connector === me.connector));
    const sgn = wl ? (wl.a.inst === id && wl.a.connector === me.connector ? 1 : -1) : 0;
    out.push({
      ...(wl ? { shift: [sgn * wl.wrap![0] * cell, sgn * wl.wrap![1] * cell] as [number, number] } : {}),
      from: id,
      to: other.inst,
      a: { ...op.a },
      b: { ...op.b },
      axis,
      at: Math.round(at * 1e6) / 1e6,
      dir,
      lo: axis === 'x' ? r.y0 : r.x0,
      hi: axis === 'x' ? r.y1 : r.x1,
      h: op.heightM,
      rect: { ...r },
    });
  }
  return out;
}

/** Склеить куски в одну модель (для проверки стыковки validateBlockout). Проёмы к комнатам вне склейки
 *  остаются открытыми половинами — поэтому cutEnds = 'open' (край пола проёма наружу не считается утечкой). */
export function mergePieces(pieces: BlockoutModel[]): BlockoutModel {
  if (!pieces.length) throw new Error('mergePieces: пусто');
  const first = pieces[0];
  const seen = new Set<string>();
  const openings: Opening[] = [];
  const inside = new Set(pieces.flatMap((p) => p.rooms.map((r) => r.inst)));
  for (const p of pieces) {
    for (const o of p.openings) {
      const k = `${o.a.inst}/${o.a.connector}|${o.b.inst}/${o.b.connector}`;
      if (seen.has(k)) continue;
      seen.add(k);
      const inA = inside.has(o.a.inst), inB = inside.has(o.b.inst);
      if (inA && inB) openings.push(o);
      // проём к комнате вне склейки — открытая половина своей комнаты: вторую половину вправе занимать
      // чужой кусок (соседи соседа пересекаются в 3D — они никогда не рисуются вместе)
      else openings.push({ ...o, rect: ownHalf(o, p, inA ? o.a.inst : o.b.inst) });
    }
  }
  const b = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
  for (const p of pieces) {
    b.x0 = Math.min(b.x0, p.bounds.x0);
    b.y0 = Math.min(b.y0, p.bounds.y0);
    b.x1 = Math.max(b.x1, p.bounds.x1);
    b.y1 = Math.max(b.y1, p.bounds.y1);
  }
  const all = <T>(f: (m: BlockoutModel) => T[]): T[] => pieces.flatMap(f);
  return {
    ...first,
    options: { ...first.options, cutEnds: 'open' },
    bounds: b,
    solids: all((m) => m.solids),
    floors: all((m) => m.floors),
    ceilings: all((m) => m.ceilings),
    openings,
    deadEnds: all((m) => m.deadEnds),
    faces: all((m) => m.faces),
    props: all((m) => m.props),
    rooms: all((m) => m.rooms),
    issues: all((m) => m.issues),
    ...(pieces.some((m) => m.doors) ? { doors: all((m) => m.doors ?? []) } : {}),
  };
}

/** Половина проёма со стороны комнаты id (ближе к её полу), чуть заходящая (5e−7 м — меньше допуска
 *  проверки) за середину: ребро проёма gap = 0 оказывается строго внутри. */
function ownHalf(o: Opening, piece: BlockoutModel, id: string): Rect {
  const r = o.rect;
  const floor = pieceFloorRects(piece, id).filter((f) => piece.floors.some((s) => s.inst === id && s.rects.includes(f)));
  const dist = (x: number, y: number): number =>
    Math.min(...floor.map((f) => Math.hypot(Math.max(0, f.x0 - x, x - f.x1), Math.max(0, f.y0 - y, y - f.y1))), Infinity);
  const e = 5e-7;
  if (o.axis === 'x') {
    const m = (r.x0 + r.x1) / 2, cy = (r.y0 + r.y1) / 2;
    return dist((r.x0 + m) / 2, cy) <= dist((m + r.x1) / 2, cy) ? { ...r, x1: m + e } : { ...r, x0: m - e };
  }
  const m = (r.y0 + r.y1) / 2, cx = (r.x0 + r.x1) / 2;
  return dist(cx, (r.y0 + m) / 2) <= dist(cx, (m + r.y1) / 2) ? { ...r, y1: m + e } : { ...r, y0: m - e };
}
