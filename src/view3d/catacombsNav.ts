// Катакомбы в «Прогулке» (./catacombsWalk.ts): чистая геометрия без движка — тесты в catacombsNav.test.ts.
// План: x вправо, y вниз, м; высоты — абсолютные, м (Babylon: X = x, Y = высота, Z = −y).
//  • Комнаты: isCatacombs — первый тег «катакомбы»; лаз (тег «лаз», квадратный ход 0.8 × 0.8 — только ползком);
//    убежище — площадка лестницы Room.stair.pads не ниже CATACOMBS.refugeM (сухо на пике).
//  • Сухие площадки (dryPads, nearestDry): площадки экземпляра в мировых метрах (клетки · cellM) и абсолютной высоте
//    (RunInstance.z + pad.z); ближайшая — обходом связей в ширину от комнаты игрока (сначала своя).
//  • Перелаз (pipeGeo, pipeApproach, climbTarget): труба поперёк хода — повёрнутый прямоугольник предмета, длинная ось —
//    пролёт. Подходит ли игрок (ближе near к трубе, в пределах пролёта, смотрит поперёк неё на другую сторону) и есть ли
//    место за трубой (точка на полу кусков с запасом радиуса игрока, не в другом предмете на высоте тела).
//  • Вода: глубина у ног, «под водой» с гистерезисом (глаз качается на ходу — без дрожи «нырнул-вынырнул»).
import type { RunInstance } from '../blockout/types';
import { CATACOMBS } from '../locations/catacombsFlood';

/** Первый тег комнат биома (группа), теги лаза, убежища, трубы-перелаза и мусора. */
export const CAT_TAG = 'катакомбы';
export const TAG_DUCT = 'лаз';
export const TAG_REFUGE = 'убежище';
export const TAG_HUB = 'хаб';
export const TAG_CLIMB = 'перелаз';
export const TAG_TRASH = 'мусор';

/** Перелаз: подсказка — ближе стольких метров к трубе (от её грани), смотрит поперёк (cos угла не меньше). */
export const CLIMB_NEAR = 1.0;
export const CLIMB_FACING = 0.5;
/** За трубой встать — середина игрока на столько дальше её грани, м (тело — ≥ 0.2 м от неё при радиусе 0.3). */
export const CLIMB_BEYOND = 0.55;
/** Радиус игрока (эллипсоид стоя), м. */
export const PLAYER_R = 0.3;
/** Высота тела стоя над ногами для проверки места за трубой, м. */
export const BODY_H = 1.75;
/** «Под водой»: нырнул — глаз ниже уровня на столько; вынырнул — выше на столько, м. */
export const UNDER_IN = 0.03;
export const UNDER_OUT = 0.03;

export interface Rect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** Комната биома «Катакомбы» (первый тег). */
export function isCatacombs(tags: readonly string[] | null | undefined): boolean {
  return !!tags && tags[0] === CAT_TAG;
}

/** Лаз: квадратный ход 0.8 × 0.8 — только ползком. */
export function isDuct(tags: readonly string[] | null | undefined): boolean {
  return isCatacombs(tags) && tags!.includes(TAG_DUCT);
}

/** Предмет — труба-перелаз (тег «перелаз»; без тегов — по id набора). */
export function isClimbPipe(p: { propId: string; tags?: readonly string[] }): boolean {
  return !!p.tags?.includes(TAG_CLIMB) || /^p_cat_pipe_(low|mid)$/.test(p.propId);
}

/** Высокая труба — пройти пригнувшись (подсказка «C»). */
export function isHighPipe(p: { propId: string }): boolean {
  return p.propId === 'p_cat_pipe_high';
}

/** Бутылка на полу (мусор): звякнуть, проходя вплотную. */
export function isBottle(p: { propId: string; name?: string; tags?: readonly string[] }): boolean {
  if (!p.tags?.includes(TAG_TRASH)) return false;
  return /бутыл/i.test(p.name ?? '') || /бутыл|bottle/i.test(p.propId);
}

// ───────────────────────── сухие площадки ─────────────────────────

export interface DryPad {
  inst: string;
  /** середина площадки, план, м */
  x: number;
  y: number;
  /** пол площадки, абс., м */
  z: number;
  /** размеры, м */
  w: number;
  d: number;
}

type PadInst = Pick<RunInstance, 'id' | 'roomTags' | 'stair'> & { z?: number };

/** Сухие площадки экземпляра (пол не ниже minZ над низом комнаты) — сначала большие. */
export function dryPads(inst: PadInst, cellM: number, minZ: number = CATACOMBS.refugeM): DryPad[] {
  const out: DryPad[] = [];
  const base = Number(inst.z) || 0;
  for (const p of inst.stair?.pads ?? []) {
    if (!(p.z >= minZ - 1e-6)) continue;
    const w = (p.x1 - p.x0) * cellM, d = (p.y1 - p.y0) * cellM;
    if (w <= 0 || d <= 0) continue;
    out.push({ inst: inst.id, x: ((p.x0 + p.x1) / 2) * cellM, y: ((p.y0 + p.y1) / 2) * cellM, z: base + p.z, w, d });
  }
  return out.sort((a, b) => b.w * b.d - a.w * a.d);
}

type Link = { a: { inst: string }; b: { inst: string }; kind?: string; sealed?: true };

/** Ближайшая (по числу проходов) комната, для которой ok — обход связей в ширину от from (сама from — первой);
 *  переходы спец-локаций (спуск, лифт) и запечатанные двери — не проходы. */
export function nearestRoom(links: readonly Link[], from: string, ok: (id: string) => boolean, maxHops = 60): string | null {
  const adj = new Map<string, string[]>();
  for (const l of links) {
    if (l.kind === 'descent' || l.kind === 'lift' || l.sealed) continue;
    const a = l.a.inst, b = l.b.inst;
    if (a === b) continue;
    (adj.get(a) ?? adj.set(a, []).get(a)!).push(b);
    (adj.get(b) ?? adj.set(b, []).get(b)!).push(a);
  }
  const hops = new Map<string, number>([[from, 0]]);
  const q = [from];
  for (let k = 0; k < q.length; k++) {
    const id = q[k];
    if (ok(id)) return id;
    const h = hops.get(id)!;
    if (h >= maxHops) continue;
    for (const n of adj.get(id) ?? []) {
      if (hops.has(n)) continue;
      hops.set(n, h + 1);
      q.push(n);
    }
  }
  return null;
}

/** Ближайшая сухая площадка: комната катакомб с площадкой не ниже refugeM (своя — первой), её самая большая
 *  площадка. null — в досягаемости нет. */
export function nearestDry(
  rx: { instances: readonly PadInst[]; links: readonly Link[]; cellM: number },
  from: string,
  minZ: number = CATACOMBS.refugeM,
): DryPad | null {
  const by = new Map(rx.instances.map((i) => [i.id, i]));
  const padsOf = (id: string): DryPad[] => {
    const i = by.get(id);
    return i && isCatacombs(i.roomTags) ? dryPads(i, rx.cellM, minZ) : [];
  };
  const id = nearestRoom(rx.links, from, (x) => padsOf(x).length > 0);
  return id ? padsOf(id)[0] : null;
}

// ───────────────────────── перелаз ─────────────────────────

/** Предмет плана (PropBox): середина, поворот по часовой (град), ширина по x и глубина по y при rot 0, высота. */
export interface PlanProp {
  inst: string;
  propId: string;
  x: number;
  y: number;
  rot: number;
  w: number;
  d: number;
  h: number;
  z?: number;
  clear?: number;
  tags?: readonly string[];
  name?: string;
}

export interface PipeGeo {
  /** ключ предмета (экземпляр, id, место) */
  key: string;
  propId: string;
  /** середина, план */
  cx: number;
  cy: number;
  /** вдоль пролёта и поперёк (единичные), план */
  tx: number;
  ty: number;
  nx: number;
  ny: number;
  /** полутолщина (поперёк) и полупролёт (вдоль), м */
  half: number;
  len: number;
  /** пол под трубой и верх трубы, абс., м */
  base: number;
  top: number;
}

/** Ключ предмета плана (по разу на предмет: звон бутылки, перелаз). */
export const propKey = (p: Pick<PlanProp, 'inst' | 'propId' | 'x' | 'y'>): string => `${p.inst}/${p.propId}/${p.x.toFixed(2)}/${p.y.toFixed(2)}`;

/** Оси предмета на плане: локальная x (ширина w) и y (глубина d) после поворота rot по часовой (y вниз). */
function axesOf(rot: number): { ux: number; uy: number; vx: number; vy: number } {
  const r = ((Number(rot) || 0) * Math.PI) / 180;
  return { ux: Math.cos(r), uy: Math.sin(r), vx: -Math.sin(r), vy: Math.cos(r) };
}

/** Геометрия трубы: длинная сторона — пролёт; base — пол под ней (p.z или пол комнаты floorZ). */
export function pipeGeo(p: PlanProp, floorZ: number): PipeGeo {
  const { ux, uy, vx, vy } = axesOf(p.rot);
  const alongW = p.w >= p.d;
  const base = p.z ?? floorZ;
  return {
    key: propKey(p),
    propId: p.propId,
    cx: p.x,
    cy: p.y,
    tx: alongW ? ux : vx,
    ty: alongW ? uy : vy,
    nx: alongW ? vx : ux,
    ny: alongW ? vy : uy,
    half: (alongW ? p.d : p.w) / 2,
    len: (alongW ? p.w : p.d) / 2,
    base,
    top: base + p.h,
  };
}

export interface PipeApproach {
  /** сторона игрока: +1 — со стороны +n, −1 — со стороны −n */
  side: 1 | -1;
  /** от грани трубы до середины игрока, м */
  gap: number;
  /** вдоль пролёта от середины трубы, м */
  along: number;
  /** cos угла между взглядом и направлением перелаза */
  dot: number;
}

/**
 * Подходит ли игрок (план p, взгляд f) к трубе g: в пределах пролёта, ближе near к грани и смотрит на другую её
 * сторону (cos угла не меньше facing). null — нет.
 */
export function pipeApproach(
  g: PipeGeo,
  p: { x: number; y: number },
  f: { x: number; y: number },
  near = CLIMB_NEAR,
  facing = CLIMB_FACING,
): PipeApproach | null {
  const dx = p.x - g.cx, dy = p.y - g.cy;
  const s = dx * g.nx + dy * g.ny;
  const along = dx * g.tx + dy * g.ty;
  if (Math.abs(along) > g.len + 0.05) return null;
  const gap = Math.abs(s) - g.half;
  if (gap > near || gap < -0.05) return null;
  const side: 1 | -1 = s >= 0 ? 1 : -1;
  const fl = Math.hypot(f.x, f.y);
  if (fl < 1e-6) return null;
  const dot = (f.x * -side * g.nx + f.y * -side * g.ny) / fl;
  if (dot < facing) return null;
  return { side, gap, along, dot };
}

/** Точка за трубой (со стороны −side), на along вдоль пролёта (не ближе радиуса к его концам). */
export function landingOf(g: PipeGeo, side: 1 | -1, along: number, beyond = CLIMB_BEYOND, r = PLAYER_R): { x: number; y: number } {
  const lim = Math.max(0, g.len - r);
  const a = Math.min(lim, Math.max(-lim, along));
  const k = -side * (g.half + beyond);
  return { x: g.cx + g.tx * a + g.nx * k, y: g.cy + g.ty * a + g.ny * k };
}

/** Круг радиуса r вокруг (x, y) на полу: середина и 4 точки по осям — в прямоугольниках пола (стыки кусков — внутри). */
export function onFloor(rects: readonly Rect[], x: number, y: number, r = PLAYER_R): boolean {
  const e = 1e-6;
  const inAny = (px: number, py: number) => rects.some((q) => px >= q.x0 - e && px <= q.x1 + e && py >= q.y0 - e && py <= q.y1 + e);
  return inAny(x, y) && inAny(x - r, y) && inAny(x + r, y) && inAny(x, y - r) && inAny(x, y + r);
}

/** Помеха для места за трубой: повёрнутый прямоугольник предмета и его высоты (абс.). */
export interface Obstacle {
  cx: number;
  cy: number;
  ux: number;
  uy: number;
  vx: number;
  vy: number;
  /** полуразмеры по u (ширина) и v (глубина) */
  hw: number;
  hd: number;
  z0: number;
  z1: number;
}

/** Предмет → помеха (низ — над просветом укрытия) или null: мусор (не мешает ходить) и подвесные под потолком. */
export function obstacleOf(p: PlanProp, floorZ: number): Obstacle | null {
  if (p.tags?.includes(TAG_TRASH) || p.tags?.includes('потолок')) return null;
  const { ux, uy, vx, vy } = axesOf(p.rot);
  const base = p.z ?? floorZ;
  return { cx: p.x, cy: p.y, ux, uy, vx, vy, hw: p.w / 2, hd: p.d / 2, z0: base + (p.clear ?? 0), z1: base + p.h };
}

/** Мешает ли что-то стоять в (x, y) с ногами на feet: тело [feet + 0.1, feet + BODY_H] радиуса r. */
export function blocked(obs: readonly Obstacle[], x: number, y: number, feet: number, r = PLAYER_R): boolean {
  for (const o of obs) {
    if (o.z1 <= feet + 0.1 || o.z0 >= feet + BODY_H) continue;
    const dx = x - o.cx, dy = y - o.cy;
    if (Math.abs(dx * o.ux + dy * o.uy) < o.hw + r && Math.abs(dx * o.vx + dy * o.vy) < o.hd + r) return true;
  }
  return false;
}

/**
 * Куда встать за трубой: напротив игрока (along), а занято — сдвигом вдоль пролёта (±0.3, ±0.6 м). Точка — на полу
 * кусков (rects) и не в предмете (obs, без самой трубы) на высоте тела над полом под трубой. null — места нет.
 */
export function climbTarget(g: PipeGeo, a: PipeApproach, rects: readonly Rect[], obs: readonly Obstacle[]): { x: number; y: number } | null {
  for (const sh of [0, 0.3, -0.3, 0.6, -0.6]) {
    const l = landingOf(g, a.side, a.along + sh);
    if (onFloor(rects, l.x, l.y) && !blocked(obs, l.x, l.y, g.base)) return l;
  }
  return null;
}

/** Длительность перелаза, с: от 0.8 (низкая труба) до 1.3 (по грудь и выше). */
export function climbDuration(pipeH: number): number {
  return Math.min(1.3, Math.max(0.8, 0.8 + 0.5 * ((pipeH - 0.6) / 0.7)));
}

/**
 * Высота глаза на дуге перелаза в доле k (0…1): от y0 к y1 (плавно), с горбом — в середине не ниже верха трубы + 0.35
 * м и не меньше чем на 0.08 м выше прямой.
 */
export function climbEye(k: number, y0: number, y1: number, top: number): number {
  const u = Math.min(1, Math.max(0, k));
  const s = u * u * (3 - 2 * u);
  const mid = (y0 + y1) / 2;
  const bump = Math.max(0.08, top + 0.35 - mid);
  return y0 + (y1 - y0) * s + bump * Math.sin(Math.PI * u);
}

// ───────────────────────── вода ─────────────────────────

/** Глубина воды у ног, м (≥ 0): уровень (абс.) минус ноги. */
export function depthAt(waterY: number, feet: number): number {
  return Math.max(0, waterY - feet);
}

/** Под водой ли глаз (гистерезис: нырнул — ниже уровня на UNDER_IN, вынырнул — выше на UNDER_OUT). */
export function underNow(was: boolean, eye: number, waterY: number): boolean {
  return was ? eye < waterY + UNDER_OUT : eye < waterY - UNDER_IN;
}

/** Уровень плоскости воды в комнате (абс., м): низ комнаты + уровень, не выше её потолка (лаз 0.85 м — вода под сводом). */
export function waterPlaneY(base: number, level: number, ceil: number | null): number {
  const y = base + level;
  return ceil !== null && ceil > 0.1 ? Math.min(y, base + ceil - 0.03) : y;
}
