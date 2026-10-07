// Отрисовка холста редактора комнаты: сетка, пол, стены, размеры, двери, метки, декор, споты,
// выделение и «призраки» инструментов. Всё в экранных CSS-px поверх камеры (View).
import type { Connector, LayerKey, Project, Prop, Room, Segment, Selection } from '../model/types';
import { bbox, outlineLines, parseKey, type BBox } from '../model/cells';
import { segmentLine } from '../model/segments';
import { getVersion } from '../model/store';
import { toScreen, type View } from '../render/camera';
import { drawProp } from '../render/props';
import { CANVAS } from '../render/palette';
import type { WalkResult } from '../gen/walk';

export type Overlay =
  | { kind: 'shape'; shape: 'rect' | 'ellipse'; x0: number; y0: number; x1: number; y1: number; mode: 'add' | 'sub' }
  | { kind: 'brush'; x: number; y: number; r: number; mode: 'add' | 'sub' }
  | { kind: 'segment'; cat: 'door' | 'connector'; seg: Pick<Segment, 'cx' | 'cy' | 'side' | 'len'> }
  | { kind: 'decor'; prop: Prop; x: number; y: number; rot: number }
  | { kind: 'spot'; x: number; y: number; color: string }
  | null;

export interface DrawOpts {
  layers: Record<LayerKey, boolean>;
  selection: Selection;
  overlay: Overlay;
  /** рисовать габаритную рамку с ручками (инструмент «выбор») */
  handles: boolean;
  /** подпись у курсора */
  cursorHud: { sx: number; sy: number; text: string } | null;
  /** проходимость комнаты (слой «Проходимость»), null — не рисовать */
  walk?: WalkResult | null;
}

export const MONO = '11px "IBM Plex Mono", ui-monospace, monospace';
const MONO_S = '10px "IBM Plex Mono", ui-monospace, monospace';

/** Радиус кружка спота на экране. */
export const spotRadiusPx = (v: View) => Math.max(5, Math.min(13, 0.14 * v.scale));
/** Размер ручки габарита, px. */
export const HANDLE_PX = 8;
/** Толщина стены на экране: растёт с масштабом, 3..8 px. */
export const wallWidth = (v: View) => Math.max(CANVAS.wallW, Math.min(8, 0.05 * v.scale));
const WALL_HALO = '#6b665c';
/** Вынос метки стыковки наружу от стены (от оси стены), px. */
export const conOffsetPx = (v: View) => wallWidth(v) / 2 + 5;

// ───────────── кэш пола и контура ─────────────

interface FloorCache {
  cells: Set<string>;
  ver: number;
  floor: Path2D;
  lines: [number, number, number, number][];
  bb: BBox | null;
}
let floorCache: FloorCache | null = null;

/** Пол — прямоугольники по непрерывным отрезкам рядов (в клеточных координатах). */
function roomGeom(room: Room): FloorCache {
  const ver = getVersion();
  if (floorCache && floorCache.cells === room.cells && floorCache.ver === ver) return floorCache;
  const rows = new Map<number, number[]>();
  for (const k of room.cells) {
    const [x, y] = parseKey(k);
    const r = rows.get(y);
    if (r) r.push(x);
    else rows.set(y, [x]);
  }
  const floor = new Path2D();
  for (const [y, xs] of rows) {
    xs.sort((a, b) => a - b);
    let s = xs[0];
    for (let i = 1; i <= xs.length; i++) {
      if (i < xs.length && xs[i] === xs[i - 1] + 1) continue;
      floor.rect(s, y, xs[i - 1] - s + 1, 1);
      s = xs[i];
    }
  }
  floorCache = { cells: room.cells, ver, floor, lines: outlineLines(room.cells), bb: bbox(room.cells) };
  return floorCache;
}

export function roomBBox(room: Room): BBox | null {
  return roomGeom(room).bb;
}

// ───────────── сетка ─────────────

function drawGrid(ctx: CanvasRenderingContext2D, v: View, color: string, stepCells: number, lw: number) {
  const step = stepCells * v.ppc;
  const x0 = Math.floor(-v.ox / step) * step + v.ox;
  const y0 = Math.floor(-v.oy / step) * step + v.oy;
  ctx.beginPath();
  for (let x = x0; x <= v.w; x += step) {
    const px = Math.round(x) + 0.5;
    ctx.moveTo(px, 0);
    ctx.lineTo(px, v.h);
  }
  for (let y = y0; y <= v.h; y += step) {
    const py = Math.round(y) + 0.5;
    ctx.moveTo(0, py);
    ctx.lineTo(v.w, py);
  }
  ctx.strokeStyle = color;
  ctx.lineWidth = lw;
  ctx.stroke();
}

/** Адаптивная сетка: мелкая (клетка) видна при ≥ 6 px, крупная — 1 м (или 10 м при сильном отдалении). */
function grid(ctx: CanvasRenderingContext2D, v: View, minor: string, major: string) {
  const perM = Math.max(1, Math.round(1 / v.cellM));
  if (v.ppc >= 6) drawGrid(ctx, v, minor, 1, 1);
  const majorStep = v.scale >= 10 ? perM : perM * 10;
  drawGrid(ctx, v, major, majorStep, 1);
}

// ───────────── основная отрисовка ─────────────

export function drawRoom(ctx: CanvasRenderingContext2D, v: View, p: Project, room: Room | null, o: DrawOpts) {
  ctx.fillStyle = CANVAS.bg;
  ctx.fillRect(0, 0, v.w, v.h);
  if (o.layers.grid) grid(ctx, v, CANVAS.gridMinor, CANVAS.gridMajor);
  if (!room) return;

  const g = roomGeom(room);
  const L = o.layers;
  const sel = o.selection;

  // пол
  ctx.save();
  ctx.translate(v.ox, v.oy);
  ctx.scale(v.ppc, v.ppc);
  ctx.fillStyle = CANVAS.floor;
  ctx.fill(g.floor);
  ctx.restore();

  // сетка на полу — тёмная полупрозрачная, только внутри пола
  if (L.grid) {
    ctx.save();
    ctx.translate(v.ox, v.oy);
    ctx.scale(v.ppc, v.ppc);
    ctx.clip(g.floor);
    ctx.setTransform(v.dpr, 0, 0, v.dpr, 0, 0);
    grid(ctx, v, 'rgba(60,50,30,0.10)', 'rgba(60,50,30,0.24)');
    ctx.restore();
  }

  // проходимость: заливка пола, где центр капсулы встать не может / отрезан от дверей
  if (L.walk && o.walk) drawWalkFill(ctx, v, g.floor, o.walk);

  // стены: светлый ореол (виден на тёмном фоне) + тёмная линия (видна на полу)
  const ww = wallWidth(v);
  ctx.beginPath();
  for (const [x1, y1, x2, y2] of g.lines) {
    const [a, b] = toScreen(v, x1, y1);
    const [c, d] = toScreen(v, x2, y2);
    ctx.moveTo(a, b);
    ctx.lineTo(c, d);
  }
  ctx.lineCap = 'square';
  ctx.strokeStyle = WALL_HALO;
  ctx.lineWidth = ww + 3;
  ctx.stroke();
  ctx.strokeStyle = CANVAS.wall;
  ctx.lineWidth = ww;
  ctx.stroke();
  ctx.lineCap = 'butt';

  if (g.bb) dimensions(ctx, v, g.bb);

  // двери
  if (L.doors) for (const d of room.doors) drawDoor(ctx, v, d, sel?.kind === 'door' && sel.id === d.id, 1);
  // метки стыковки
  if (L.connectors)
    for (const c of room.connectors) {
      drawConnector(ctx, v, c, c.tag, sel?.kind === 'connector' && sel.id === c.id, 1);
      // порог складчатого генератора: 'always' — фиолетовая молния, 'never' — серый замок
      if (c.shift === 'always' || c.shift === 'never') drawShiftBadge(ctx, v, c, c.shift);
    }

  // декор
  if (L.decor) {
    const props = new Map(p.props.map((x) => [x.id, x]));
    for (const d of room.decor) {
      const prop = props.get(d.propId);
      if (!prop) continue;
      const [sx, sy] = toScreen(v, d.x, d.y);
      drawProp(ctx, prop, sx, sy, d.rot, v.scale, { selected: sel?.kind === 'decor' && sel.id === d.id, accent: CANVAS.select });
    }
  }

  // споты
  if (L.spots) {
    const groups = new Map(room.spotGroups.map((x) => [x.id, x]));
    for (const s of room.spots) {
      const color = (s.groupId && groups.get(s.groupId)?.color) || '#8a8d92';
      drawSpot(ctx, v, s.x, s.y, s.rot, color, s.name, sel?.kind === 'spot' && sel.id === s.id, 1);
    }
  }

  // маркеры проёмов: зелёный — достижим, красный — отрезан
  if (L.walk && o.walk) drawWalkMarkers(ctx, v, o.walk);

  // габаритная рамка с ручками
  if (o.handles && g.bb) drawHandles(ctx, v, g.bb);

  drawOverlay(ctx, v, o.overlay);
  if (o.cursorHud) drawCursorHud(ctx, v, o.cursorHud.sx, o.cursorHud.sy, o.cursorHud.text);
}

// ───────────── проходимость ─────────────

interface WalkPaths {
  blocked: Path2D;
  cut: Path2D;
}
const walkPaths = new WeakMap<WalkResult, WalkPaths>();

/** Пути заливки по состояниям центров клеток (кэш по результату — walkCheck его переиспользует). */
function walkPathsOf(r: WalkResult): WalkPaths {
  let wp = walkPaths.get(r);
  if (wp) return wp;
  const { x0, y0, w, h, cell } = r.grid;
  const blocked = new Path2D();
  const cut = new Path2D();
  for (let j = 0; j < h; j++) {
    // ряды одинаковых клеток — одним прямоугольником
    let i = 0;
    while (i < w) {
      const st = cell[i + j * w];
      let e = i + 1;
      while (e < w && cell[e + j * w] === st) e++;
      if (st === 0) blocked.rect(x0 + i, y0 + j, e - i, 1);
      else if (st === 1) cut.rect(x0 + i, y0 + j, e - i, 1);
      i = e;
    }
  }
  wp = { blocked, cut };
  walkPaths.set(r, wp);
  return wp;
}

function drawWalkFill(ctx: CanvasRenderingContext2D, v: View, floor: Path2D, r: WalkResult) {
  const wp = walkPathsOf(r);
  ctx.save();
  ctx.translate(v.ox, v.oy);
  ctx.scale(v.ppc, v.ppc);
  ctx.clip(floor);
  ctx.fillStyle = CANVAS.walkBlocked;
  ctx.fill(wp.blocked);
  ctx.fillStyle = CANVAS.walkCut;
  ctx.fill(wp.cut);
  ctx.restore();
}

/** Маркеры у проёмов внутри комнаты: зелёный с галочкой — достижим, красный с крестом — отрезан. */
function drawWalkMarkers(ctx: CanvasRenderingContext2D, v: View, r: WalkResult) {
  const rad = Math.max(5, Math.min(9, 0.08 * v.scale));
  for (const o of r.openings) {
    const [x1, y1, x2, y2] = segmentLine(o);
    const [ix, iy] = INWARD[o.side];
    const [mx, my] = toScreen(v, (x1 + x2) / 2, (y1 + y2) / 2);
    const d = Math.max(rad + wallWidth(v) / 2 + 3, 0.3 * v.scale);
    const x = mx + ix * d, y = my + iy * d;
    ctx.save();
    ctx.beginPath();
    ctx.arc(x, y, rad, 0, Math.PI * 2);
    ctx.fillStyle = o.ok ? CANVAS.walkOk : CANVAS.walkBad;
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = '#111';
    ctx.stroke();
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2;
    ctx.beginPath();
    const q = rad * 0.45;
    if (o.ok) {
      ctx.moveTo(x - q, y);
      ctx.lineTo(x - q * 0.2, y + q * 0.8);
      ctx.lineTo(x + q, y - q * 0.7);
    } else {
      ctx.moveTo(x - q, y - q);
      ctx.lineTo(x + q, y + q);
      ctx.moveTo(x + q, y - q);
      ctx.lineTo(x - q, y + q);
    }
    ctx.stroke();
    ctx.restore();
  }
}

/** Размерные линии габарита: сверху (ширина) и слева (глубина), как на чертеже. */
function dimensions(ctx: CanvasRenderingContext2D, v: View, bb: BBox) {
  const [ax, ay] = toScreen(v, bb.x0, bb.y0);
  const [bx, by] = toScreen(v, bb.x1, bb.y1);
  const off = 24;
  const tick = 4;
  ctx.save();
  ctx.strokeStyle = '#7f838a';
  ctx.fillStyle = CANVAS.text;
  ctx.lineWidth = 1;
  ctx.font = MONO;
  ctx.beginPath();
  // сверху
  const ty = Math.round(ay - off) + 0.5;
  ctx.moveTo(ax, ty);
  ctx.lineTo(bx, ty);
  ctx.moveTo(ax, ay - 4);
  ctx.lineTo(ax, ty - tick);
  ctx.moveTo(bx, ay - 4);
  ctx.lineTo(bx, ty - tick);
  // засечки
  ctx.moveTo(ax - tick, ty + tick);
  ctx.lineTo(ax + tick, ty - tick);
  ctx.moveTo(bx - tick, ty + tick);
  ctx.lineTo(bx + tick, ty - tick);
  // слева
  const lx = Math.round(ax - off) + 0.5;
  ctx.moveTo(lx, ay);
  ctx.lineTo(lx, by);
  ctx.moveTo(ax - 4, ay);
  ctx.lineTo(lx - tick, ay);
  ctx.moveTo(ax - 4, by);
  ctx.lineTo(lx - tick, by);
  ctx.moveTo(lx - tick, ay + tick);
  ctx.lineTo(lx + tick, ay - tick);
  ctx.moveTo(lx - tick, by + tick);
  ctx.lineTo(lx + tick, by - tick);
  ctx.stroke();

  const wT = (bb.w * v.cellM).toFixed(2);
  const hT = (bb.h * v.cellM).toFixed(2);
  labelBox(ctx, wT, (ax + bx) / 2, ty);
  ctx.save();
  ctx.translate(lx, (ay + by) / 2);
  ctx.rotate(-Math.PI / 2);
  labelBox(ctx, hT, 0, 0);
  ctx.restore();
  ctx.restore();
}

/** Подпись с подложкой цвета фона, центр в (x, y). */
function labelBox(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, fg = CANVAS.text, bg = CANVAS.bg) {
  const w = ctx.measureText(text).width;
  ctx.fillStyle = bg;
  ctx.fillRect(x - w / 2 - 3, y - 7, w + 6, 14);
  ctx.fillStyle = fg;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, x, y);
}

/** Направление внутрь комнаты для стороны отрезка. */
const INWARD: Record<string, [number, number]> = { N: [0, 1], S: [0, -1], E: [-1, 0], W: [1, 0] };

export function drawDoor(
  ctx: CanvasRenderingContext2D,
  v: View,
  d: Pick<Segment, 'cx' | 'cy' | 'side' | 'len'>,
  selected: boolean,
  alpha: number,
  ghostColor?: string,
) {
  const [x1, y1, x2, y2] = segmentLine(d);
  const [a, b] = toScreen(v, x1, y1);
  const [c, e] = toScreen(v, x2, y2);
  const [ix, iy] = INWARD[d.side];
  const r = d.len * v.ppc;
  const color = ghostColor ?? (selected ? CANVAS.select : CANVAS.door);
  ctx.save();
  ctx.globalAlpha = alpha;
  // разрыв в стене
  if (!ghostColor) {
    ctx.strokeStyle = CANVAS.floor;
    ctx.lineWidth = wallWidth(v) + 5;
    ctx.beginPath();
    ctx.moveTo(a, b);
    ctx.lineTo(c, e);
    ctx.stroke();
    // торцы стены у проёма
    const [ix0, iy0] = INWARD[d.side];
    const ww = wallWidth(v);
    ctx.strokeStyle = CANVAS.wall;
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (const [px, py] of [[a, b], [c, e]]) {
      ctx.moveTo(px - ix0 * (ww / 2 + 1.5), py - iy0 * (ww / 2 + 1.5));
      ctx.lineTo(px + ix0 * (ww / 2), py + iy0 * (ww / 2));
    }
    ctx.stroke();
  }
  // проём — тонкая линия порога
  ctx.strokeStyle = color;
  ctx.lineWidth = selected ? 3 : 1.5;
  ctx.setLineDash(ghostColor ? [4, 3] : [2, 3]);
  ctx.beginPath();
  ctx.moveTo(a, b);
  ctx.lineTo(c, e);
  ctx.stroke();
  ctx.setLineDash([]);
  // полотно: от петли (начало отрезка) внутрь комнаты
  const lx = a + ix * r;
  const ly = b + iy * r;
  ctx.lineWidth = selected ? 3 : 2;
  ctx.beginPath();
  ctx.moveTo(a, b);
  ctx.lineTo(lx, ly);
  ctx.stroke();
  // дуга открывания: от конца полотна к концу проёма
  const angLeaf = Math.atan2(iy, ix);
  const angEnd = Math.atan2(e - b, c - a);
  let diff = angEnd - angLeaf;
  while (diff > Math.PI) diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(a, b, r, angLeaf, angLeaf + diff, diff < 0);
  ctx.stroke();
  ctx.restore();
}

export function drawConnector(
  ctx: CanvasRenderingContext2D,
  v: View,
  c: Pick<Connector, 'cx' | 'cy' | 'side' | 'len'>,
  tag: string,
  selected: boolean,
  alpha: number,
  ghostColor?: string,
) {
  const [x1, y1, x2, y2] = segmentLine(c);
  const [ix, iy] = INWARD[c.side];
  const off = conOffsetPx(v);
  const ox = -ix * off;
  const oy = -iy * off;
  const [a, b] = toScreen(v, x1, y1);
  const [d, e] = toScreen(v, x2, y2);
  const color = ghostColor ?? (selected ? CANVAS.select : CANVAS.connector);
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = color;
  ctx.lineWidth = selected ? 5 : 4;
  if (ghostColor) ctx.setLineDash([5, 3]);
  ctx.beginPath();
  ctx.moveTo(a + ox, b + oy);
  ctx.lineTo(d + ox, e + oy);
  ctx.stroke();
  ctx.setLineDash([]);
  // концевые засечки к стене
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(a, b);
  ctx.lineTo(a + ox * 1.6, b + oy * 1.6);
  ctx.moveTo(d, e);
  ctx.lineTo(d + ox * 1.6, e + oy * 1.6);
  ctx.stroke();
  // подпись снаружи
  const text = `${tag || '—'} · ${(c.len * v.cellM).toFixed(2)} м`;
  ctx.font = MONO_S;
  const mx = (a + d) / 2 - ix * (off + 13);
  const my = (b + e) / 2 - iy * (off + 13);
  ctx.save();
  ctx.translate(mx, my);
  if (c.side === 'E' || c.side === 'W') ctx.rotate(c.side === 'E' ? Math.PI / 2 : -Math.PI / 2);
  labelBox(ctx, text, 0, 0, color, '#0d0e10cc');
  ctx.restore();
  ctx.restore();
}

/** Значок режима порога (4D) у метки: внутри комнаты, напротив середины метки. */
function drawShiftBadge(ctx: CanvasRenderingContext2D, v: View, c: Pick<Connector, 'cx' | 'cy' | 'side' | 'len'>, mode: 'always' | 'never') {
  const [x1, y1, x2, y2] = segmentLine(c);
  const [ix, iy] = INWARD[c.side];
  const [a, b] = toScreen(v, (x1 + x2) / 2, (y1 + y2) / 2);
  const r = 7;
  const x = a + ix * (wallWidth(v) / 2 + r + 4);
  const y = b + iy * (wallWidth(v) / 2 + r + 4);
  ctx.save();
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fillStyle = mode === 'always' ? '#2a1640' : '#26282c';
  ctx.fill();
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = mode === 'always' ? '#b67cff' : '#8a8e95';
  ctx.stroke();
  if (mode === 'always') {
    // молния
    ctx.beginPath();
    ctx.moveTo(x + 1.5, y - 5);
    ctx.lineTo(x - 3, y + 1);
    ctx.lineTo(x, y + 1);
    ctx.lineTo(x - 1.5, y + 5);
    ctx.lineTo(x + 3, y - 1);
    ctx.lineTo(x, y - 1);
    ctx.closePath();
    ctx.fillStyle = '#b67cff';
    ctx.fill();
  } else {
    // замок: дужка + корпус
    ctx.strokeStyle = '#a3a7ad';
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.arc(x, y - 1.5, 2.6, Math.PI, 0);
    ctx.stroke();
    ctx.fillStyle = '#a3a7ad';
    ctx.fillRect(x - 3.6, y - 1.2, 7.2, 5.2);
  }
  ctx.restore();
}

export function drawSpot(
  ctx: CanvasRenderingContext2D,
  v: View,
  x: number,
  y: number,
  rot: number,
  color: string,
  name: string,
  selected: boolean,
  alpha: number,
) {
  const [sx, sy] = toScreen(v, x, y);
  const r = spotRadiusPx(v);
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(sx, sy);
  if (selected) {
    ctx.strokeStyle = CANVAS.select;
    ctx.lineWidth = 2;
    ctx.strokeRect(-r - 4, -r - 4, r * 2 + 8, r * 2 + 8);
  }
  ctx.save();
  ctx.rotate((rot * Math.PI) / 180);
  // кружок
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.fillStyle = color + 'cc';
  ctx.fill();
  ctx.strokeStyle = '#111';
  ctx.lineWidth = 1.2;
  ctx.stroke();
  // стрелка «лицом» (вниз при rot = 0, как передняя грань декора)
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(0, r * 1.7);
  ctx.moveTo(-r * 0.45, r * 1.25);
  ctx.lineTo(0, r * 1.75);
  ctx.lineTo(r * 0.45, r * 1.25);
  ctx.strokeStyle = '#111';
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.restore();
  if (name) {
    ctx.font = MONO_S;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = CANVAS.textDark;
    ctx.fillText(name, r + 4, -r);
  }
  ctx.restore();
}

/** Экранные позиции 8 ручек габарита: [id, sx, sy]; id — комбинация n/s/e/w. */
export function handlePositions(v: View, bb: BBox): [string, number, number][] {
  const [ax, ay] = toScreen(v, bb.x0, bb.y0);
  const [bx, by] = toScreen(v, bb.x1, bb.y1);
  const mx = (ax + bx) / 2;
  const my = (ay + by) / 2;
  return [
    ['nw', ax, ay], ['n', mx, ay], ['ne', bx, ay], ['e', bx, my],
    ['se', bx, by], ['s', mx, by], ['sw', ax, by], ['w', ax, my],
  ];
}

function drawHandles(ctx: CanvasRenderingContext2D, v: View, bb: BBox) {
  const [ax, ay] = toScreen(v, bb.x0, bb.y0);
  const [bx, by] = toScreen(v, bb.x1, bb.y1);
  ctx.save();
  ctx.strokeStyle = CANVAS.select + '99';
  ctx.setLineDash([3, 4]);
  ctx.lineWidth = 1;
  ctx.strokeRect(Math.round(ax) - 5.5, Math.round(ay) - 5.5, bx - ax + 11, by - ay + 11);
  ctx.setLineDash([]);
  const h = HANDLE_PX;
  for (const [id, x, y] of handlePositions(v, bb)) {
    const hx = x + (id.includes('e') ? 5 : id.includes('w') ? -5 : 0);
    const hy = y + (id.includes('s') ? 5 : id.includes('n') ? -5 : 0);
    ctx.fillStyle = '#18191c';
    ctx.strokeStyle = CANVAS.select;
    ctx.lineWidth = 1.5;
    ctx.fillRect(hx - h / 2, hy - h / 2, h, h);
    ctx.strokeRect(hx - h / 2, hy - h / 2, h, h);
  }
  ctx.restore();
}

/** Смещение ручки наружу от угла габарита (как рисуется). */
export function handleOffset(id: string): [number, number] {
  return [id.includes('e') ? 5 : id.includes('w') ? -5 : 0, id.includes('s') ? 5 : id.includes('n') ? -5 : 0];
}

function drawOverlay(ctx: CanvasRenderingContext2D, v: View, o: Overlay) {
  if (!o) return;
  switch (o.kind) {
    case 'shape': {
      const color = o.mode === 'add' ? CANVAS.ghostAdd : CANVAS.ghostSub;
      const [ax, ay] = toScreen(v, Math.min(o.x0, o.x1), Math.min(o.y0, o.y1));
      const [bx, by] = toScreen(v, Math.max(o.x0, o.x1), Math.max(o.y0, o.y1));
      ctx.save();
      ctx.beginPath();
      if (o.shape === 'rect') ctx.rect(ax, ay, bx - ax, by - ay);
      else ctx.ellipse((ax + bx) / 2, (ay + by) / 2, Math.max(0.1, (bx - ax) / 2), Math.max(0.1, (by - ay) / 2), 0, 0, Math.PI * 2);
      ctx.fillStyle = color + '40';
      ctx.fill();
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.5;
      ctx.setLineDash([5, 3]);
      ctx.stroke();
      ctx.restore();
      break;
    }
    case 'brush': {
      const color = o.mode === 'add' ? CANVAS.ghostAdd : CANVAS.ghostSub;
      const [sx, sy] = toScreen(v, o.x, o.y);
      ctx.save();
      ctx.beginPath();
      ctx.arc(sx, sy, Math.max(1, o.r * v.ppc), 0, Math.PI * 2);
      ctx.fillStyle = color + '30';
      ctx.fill();
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.restore();
      break;
    }
    case 'segment':
      if (o.cat === 'door') drawDoor(ctx, v, o.seg, false, 0.9, CANVAS.ghostAdd);
      else drawConnector(ctx, v, o.seg, '', false, 0.9, CANVAS.ghostAdd);
      break;
    case 'decor': {
      const [sx, sy] = toScreen(v, o.x, o.y);
      drawProp(ctx, o.prop, sx, sy, o.rot, v.scale, { alpha: 0.35 });
      drawProp(ctx, o.prop, sx, sy, o.rot, v.scale, { ghost: true, accent: CANVAS.ghostAdd });
      break;
    }
    case 'spot':
      drawSpot(ctx, v, o.x, o.y, 0, o.color, '', false, 0.55);
      break;
  }
}

function drawCursorHud(ctx: CanvasRenderingContext2D, v: View, sx: number, sy: number, text: string) {
  ctx.save();
  ctx.font = MONO;
  const w = ctx.measureText(text).width + 12;
  let x = sx + 16;
  let y = sy + 18;
  if (x + w > v.w - 4) x = sx - 16 - w;
  if (y + 20 > v.h - 4) y = sy - 38;
  ctx.fillStyle = '#18191cee';
  ctx.strokeStyle = '#3a3e44';
  ctx.lineWidth = 1;
  ctx.fillRect(x, y, w, 20);
  ctx.strokeRect(x + 0.5, y + 0.5, w - 1, 19);
  ctx.fillStyle = CANVAS.text;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, x + 6, y + 10.5);
  ctx.restore();
}
