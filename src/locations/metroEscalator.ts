// Эскалаторы метро (биом «Метро», docs/LOCATIONS.md §18) — механика без движка.
//
//  • Эскалатор — комната с тегом «эскалатор» (metro_esc_tunnel): марши её лестницы (RunInstance.stair) со стилем
//    'escalator' — дорожки; номер дорожки (lane) — индекс марша в stair.flights. У экземпляра со сломанными дорожками
//    марши сломанных убраны из stair.flights (пандус и опора пропали), а все марши до поломки — в RunInstance.escLanes
//    (сломанные — RunInstance.escBroken): номер дорожки не съезжает.
//  • Опору по высоте даёт обычная опора марша (src/view3d/stairWalk.ts); дорожка только везёт: сдвиг вдоль подъёма со
//    скоростью ESC.speed по наклону (src/view3d/metroWalk.ts). Направления — от сида экземпляра (laneDirs): обычно
//    0 — вверх, средняя — стоит (как лестница) или вниз, последняя — вниз; изредка наоборот.
//  • Срыв — малый шанс: при входе игрока на целую дорожку бросок ESC.chance (не в первые graceS с в метро, не на первой
//    поездке; после любого срыва рядом — пауза pauseS). Выпал — срыв начнётся, когда игрок проедет долю пути at.
//    Стадии (по времени от начала): shudder — рывок, лента встаёт, тряска; runaway — лента бежит вниз, разгон до
//    runawayV; fall — лента обрывается и сползает в приямок (верх соскальзывает с верхней площадки, низ уезжает к нижней —
//    как лестница по стене); broken — навсегда (операция мира 'esc').
//  • Игрок на ленте в runaway: E — перелезть через балюстраду на соседнюю целую дорожку (не у концов, climbTarget);
//    донесло до низа (carriedDown) — выбросило на нижнюю площадку, жив; остался на ленте к fall — падение (escFallPose,
//    по образцу fallPose ангара), смерть.
//  • Фоновый срыв без игрока: пока в поле зрения (≤ bgM) есть целая дорожка — в среднем раз в bgEveryS (только зрелище).
// Координаты — план (x вправо, y вниз), м; высоты абсолютные (низ комнаты RunInstance.z + высота марша).
import { makeRng } from '../model/rng';
import type { RunInstance, RunStair, Side } from '../blockout/types';
import { fallPose, FALL_BREAK_S, FALL_LAND_S, FALL_LIE_EYE } from './hangar';
import { ABYSS_DIRS, isAbyss } from './fractalEntry'; // fractal

export const ESC = {
  /** скорость ленты по наклону, м/с */
  speed: 0.75,
  /** шанс срыва при входе на целую дорожку */
  chance: 0.05,
  /** первые столько секунд в метро — без срыва */
  graceS: 60,
  /** после любого срыва рядом — пауза, с */
  pauseS: 120,
  /** рывок: лента встаёт, тряска, с */
  shudderS: 1.2,
  /** лента встаёт за столько секунд (рывок) */
  jerkS: 0.25,
  /** лента бежит вниз, с; разгон до runawayV, м/с */
  runawayS: 2.5,
  runawayV: 7,
  /** лента сползает в приямок (верх — с площадки на дно), с; вся стадия fall (с пылью и оседанием), с */
  slideS: 0.9,
  fallS: 1.6,
  /** фоновый срыв: в среднем раз в столько секунд, пока в поле зрения ближе bgM м есть целая дорожка */
  bgEveryS: 360,
  bgM: 30,
  /** перелезть нельзя ближе стольких метров (вдоль марша) к концам дорожки — там просто сойти; перелезание длится, с */
  climbEndM: 1.2,
  climbS: 0.7,
} as const;

export type EscSpec = typeof ESC;

/** Куда везёт дорожка: 1 — вверх, −1 — вниз, 0 — стоит (идти пешком, как по лестнице). */
export type LaneDir = 1 | 0 | -1;

/** Дорожка эскалатора в плане (м) и по высоте (абс., м). */
export interface EscLane {
  /** номер дорожки — индекс марша */
  lane: number;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  /** сторона подъёма (к большей высоте) */
  up: Side;
  /** низ и верх, абс. м (z0 < z1) */
  z0: number;
  z1: number;
  /** длина в плане вдоль подъёма и ширина, м */
  len: number;
  width: number;
  /** ступеней по 0.15 м (как у марша в src/blockout/stairs.ts): линия носков — по ним */
  steps: number;
  dir: LaneDir;
  broken: boolean;
}

type RunFlight = RunStair['flights'][number];

/** Высота ступени марша, м (src/blockout/stairs.ts: steps = round(перепад / 0.15)). */
const STEP_R = 0.15;

/** Единичный вектор подъёма в плане. */
export const UP_VEC: Record<Side, readonly [number, number]> = { N: [0, -1], S: [0, 1], E: [1, 0], W: [-1, 0] };
const FLIP: Record<Side, Side> = { N: 'S', S: 'N', E: 'W', W: 'E' };

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
/** Как у марша куска (src/blockout/stairs.ts): метры — до микрона. */
const r6 = (v: number) => Math.round(v * 1e6) / 1e6;

// ───────────────────────── комната и дорожки ─────────────────────────

/** Комната метро (группа спавна — первый тег). */
export function isMetroRoom(tags: readonly string[] | undefined): boolean {
  return !!tags && tags[0] === 'метро';
}

/** Где возрождаться после срыва: зал станции или вестибюль (не эскалатор). */
export function isRespawnRoom(tags: readonly string[] | undefined): boolean {
  return isMetroRoom(tags) && (tags!.includes('зал') || tags!.includes('хаб')) && !tags!.includes('эскалатор');
}

/** Все марши экземпляра до поломки (индекс — номер дорожки): у экземпляра со сломанными дорожками — escLanes. */
export function escFlights(inst: Pick<RunInstance, 'stair' | 'escLanes'>): readonly RunFlight[] {
  return inst.escLanes ?? inst.stair?.flights ?? [];
}

/** Марш — дорожка эскалатора: стиль 'escalator'; у комнаты с тегом «эскалатор», где стиля нет ни у одного марша
 *  (стиль не дошёл до экспорта), — каждый марш. */
function laneFlags(inst: Pick<RunInstance, 'stair' | 'escLanes' | 'roomTags'>): boolean[] {
  const fl = escFlights(inst);
  if (!inst.roomTags?.includes('эскалатор')) return fl.map(() => false);
  const styled = fl.some((f) => f.style === 'escalator');
  return fl.map((f) => (styled ? f.style === 'escalator' : true));
}

/** Эскалатор: тег «эскалатор» и хоть одна дорожка. */
export function isEscalator(inst: Pick<RunInstance, 'stair' | 'escLanes' | 'roomTags'> | null | undefined): boolean {
  return !!inst && laneFlags(inst).some(Boolean);
}

/** Направления n дорожек по ключу экземпляра (сид мира / id): первая — вверх, последняя — вниз, средние — стоят или
 *  вниз (поровну); в четверти случаев — зеркально (первая вниз, последняя вверх). Одна дорожка — вверх. */
export function laneDirs(key: string, n: number): LaneDir[] {
  if (n <= 0) return [];
  if (n === 1) return [1];
  const R = makeRng(`metro-esc:${key}`);
  const flip = R.next() < 0.25;
  const out: LaneDir[] = [];
  for (let i = 0; i < n; i++) out.push(i === 0 ? 1 : i === n - 1 ? -1 : R.next() < 0.5 ? 0 : -1);
  return flip ? out.reverse() : out;
}

/** Дорожки экземпляра (план, м; высоты абсолютные): cellM — клетка плана, key — сид направлений (сид мира + id). */
export function escLanes(inst: Pick<RunInstance, 'stair' | 'escLanes' | 'escBroken' | 'roomTags' | 'z'>, cellM: number, key: string): EscLane[] {
  const fl = escFlights(inst);
  const flags = laneFlags(inst);
  const idx = fl.map((_, i) => i).filter((i) => flags[i]);
  // fractal: бездонный эскалатор — все вниз, средняя стоит (src/locations/fractalEntry.ts)
  const dirs = isAbyss(inst.roomTags) && idx.length === ABYSS_DIRS.length ? ABYSS_DIRS : laneDirs(key, idx.length);
  const broken = new Set(inst.escBroken ?? []);
  const B = num(inst.z);
  const c = cellM > 0 ? cellM : 0.1;
  return idx.map((i, k) => {
    const f = fl[i];
    const rev = num(f.z1) < num(f.z0);
    const z0 = Math.min(num(f.z0), num(f.z1)), z1 = Math.max(num(f.z0), num(f.z1));
    const up = rev ? FLIP[f.up] : f.up;
    const x0 = r6(f.x0 * c), y0 = r6(f.y0 * c), x1 = r6(f.x1 * c), y1 = r6(f.y1 * c);
    const vert = up === 'N' || up === 'S';
    return {
      lane: i, x0, y0, x1, y1, up, z0: r6(z0 + B), z1: r6(z1 + B),
      len: r6(vert ? y1 - y0 : x1 - x0), width: r6(vert ? x1 - x0 : y1 - y0),
      steps: Math.max(1, Math.round((z1 - z0) / STEP_R)),
      dir: dirs[k], broken: broken.has(i),
    };
  });
}

/** Точка плана дорожки: s — от нижнего края вдоль подъёма, a — поперёк (от x0 у N/S, от y0 у E/W), м. */
export function lanePoint(l: EscLane, s: number, a: number): [number, number] {
  switch (l.up) {
    case 'N': return [l.x0 + a, l.y1 - s];
    case 'S': return [l.x0 + a, l.y0 + s];
    case 'E': return [l.x0 + s, l.y0 + a];
    case 'W': return [l.x1 - s, l.y0 + a];
  }
}

/** Оси дорожки в точке плана: s — вдоль подъёма от нижнего края, a — поперёк, м. */
export function laneAxes(l: EscLane, x: number, y: number): { s: number; a: number } {
  const s = l.up === 'N' ? l.y1 - y : l.up === 'S' ? y - l.y0 : l.up === 'E' ? x - l.x0 : l.x1 - x;
  const a = l.up === 'N' || l.up === 'S' ? x - l.x0 : y - l.y0;
  return { s, a };
}

/** Проступь и подъём ступени марша, м. */
export function laneStep(l: EscLane): { t: number; r: number } {
  return { t: l.len / l.steps, r: (l.z1 - l.z0) / l.steps };
}

/** Высота линии носков (опора игрока на марше, src/blockout/stairs.ts) в s, абс. м: от z0 за проступь до марша — до z1
 *  у последней ступени, дальше ровно. */
export function noseZ(l: EscLane, s: number): number {
  const { t, r } = laneStep(l);
  return Math.min(l.z1, Math.max(l.z0, l.z0 + ((s + t) * r) / t));
}

/** Длина ленты по наклону (марш — от низа до верха), м. */
export function slopeLen(l: EscLane): number {
  return Math.hypot(l.len, l.z1 - l.z0);
}

/** Дорожка под точкой плана (поперёк — внутри, вдоль — от проступи перед маршем до верхнего края): дорожка и оси. */
export function laneAt(lanes: readonly EscLane[], x: number, y: number): { lane: EscLane; s: number; a: number } | null {
  for (const l of lanes) {
    const { s, a } = laneAxes(l, x, y);
    const { t } = laneStep(l);
    if (a > 0 && a < l.width && s >= -t && s <= l.len) return { lane: l, s, a };
  }
  return null;
}

/** Сдвиг игрока в плане за dt лентой со скоростью v по наклону (+ вверх), м: проекция на план. */
export function carryStep(l: EscLane, v: number, dt: number): [number, number] {
  const k = l.len / Math.max(1e-6, slopeLen(l));
  const d = v * k * dt;
  const u = UP_VEC[l.up];
  return [u[0] * d, u[1] * d];
}

// ───────────────────────── бросок срыва ─────────────────────────

/** Кости срыва игрока: часы метро (только пока он в метро), поездки, последний срыв рядом, фоновый срыв. */
export interface EscDice {
  seed: string;
  /** сколько раз входил на целую дорожку */
  rides: number;
  /** часы метро, с */
  t: number;
  /** последний срыв рядом (по часам метро), с */
  last: number;
  /** фоновый: сколько секунд в поле зрения целая дорожка, когда срыв, сколько было */
  bgT: number;
  bgNext: number;
  bgN: number;
}

const bgNextOf = (seed: string, n: number, spec: EscSpec): number => spec.bgEveryS * (0.5 + makeRng(`${seed}/bg/${n}`).next());

export function createDice(seed: string, spec: EscSpec = ESC): EscDice {
  return { seed, rides: 0, t: 0, last: -Infinity, bgT: 0, bgNext: bgNextOf(seed, 0, spec), bgN: 0 };
}

/** Часы метро — только пока игрок в метро. */
export function tickDice(d: EscDice, dt: number): void {
  if (dt > 0 && Number.isFinite(dt)) d.t += dt;
}

/** Любой срыв рядом (свой, фоновый, у напарника) — пауза pauseS. */
export function noteBreak(d: EscDice): void {
  d.last = d.t;
}

/** Срыв запрещён сейчас: первые graceS с в метро, пауза после срыва. */
export function calmNow(d: EscDice, spec: EscSpec = ESC): boolean {
  return d.t < spec.graceS || d.t - d.last < spec.pauseS;
}

/** Вход на целую дорожку: бросок (детерминирован сидом и номером поездки). null — едет спокойно; иначе at — доля пути
 *  (от места входа), на которой начнётся срыв. Первая поездка, первые graceS с и пауза после срыва — всегда null. */
export function rideRoll(d: EscDice, spec: EscSpec = ESC): { at: number } | null {
  const n = d.rides++;
  if (n === 0 || calmNow(d, spec)) return null;
  const R = makeRng(`${d.seed}/ride/${n}`);
  if (R.next() >= spec.chance) return null;
  return { at: 0.3 + 0.35 * R.next() };
}

/** Фоновый срыв: копит время, пока в поле зрения целая дорожка (canSee); пора — true (и следующий срок). */
export function bgDue(d: EscDice, dt: number, canSee: boolean, spec: EscSpec = ESC): boolean {
  if (!canSee || !(dt > 0)) return false;
  d.bgT += dt;
  if (d.bgT < d.bgNext || calmNow(d, spec)) return false;
  d.bgT = 0;
  d.bgN++;
  d.bgNext = bgNextOf(d.seed, d.bgN, spec);
  return true;
}

// ───────────────────────── срыв ─────────────────────────

export type EscStage = 'shudder' | 'runaway' | 'fall' | 'broken';

/** Срыв дорожки lane экземпляра inst. */
export interface EscCollapse {
  inst: string;
  lane: number;
  /** с от начала */
  t: number;
  stage: EscStage;
  /** скорость ленты до срыва, по наклону (+ вверх), м/с */
  v0: number;
  /** скорость ленты сейчас и путь ленты с начала срыва (по наклону, + вверх), м/с и м */
  v: number;
  belt: number;
}

export function createCollapse(inst: string, lane: number, v0: number): EscCollapse {
  return { inst, lane, t: 0, stage: 'shudder', v0, v: v0, belt: 0 };
}

/** Стадия в момент t (с от начала срыва). */
export function stageAt(t: number, spec: EscSpec = ESC): EscStage {
  if (t < spec.shudderS) return 'shudder';
  if (t < spec.shudderS + spec.runawayS) return 'runaway';
  if (t < spec.shudderS + spec.runawayS + spec.fallS) return 'fall';
  return 'broken';
}

/** Скорость ленты по наклону (+ вверх) в момент t: рывком встаёт за jerkS, в runaway — вниз с разгоном до runawayV;
 *  оборвалась — 0. */
export function beltSpeed(t: number, v0: number, spec: EscSpec = ESC): number {
  if (t < spec.shudderS) return t < spec.jerkS ? v0 * (1 - t / spec.jerkS) : 0;
  const tau = t - spec.shudderS;
  if (tau < spec.runawayS) return (-spec.runawayV * tau) / spec.runawayS;
  return 0;
}

/** Шаг срыва на dt: время, скорость и путь ленты; возвращает стадии, в которые вошёл (по порядку). */
export function stepCollapse(c: EscCollapse, dt: number, spec: EscSpec = ESC): EscStage[] {
  if (!(dt > 0)) return [];
  const t0 = c.t, t1 = t0 + dt;
  // путь ленты — по кускам стадий (скорость кусочно-линейная): трапеции до границ
  const edges = [t0, ...[spec.jerkS, spec.shudderS, spec.shudderS + spec.runawayS].filter((e) => e > t0 && e < t1), t1];
  for (let k = 0; k + 1 < edges.length; k++) {
    const a = edges[k], b = edges[k + 1];
    const e = 1e-9;
    c.belt += ((beltSpeed(a + e, c.v0, spec) + beltSpeed(b - e, c.v0, spec)) / 2) * (b - a);
  }
  c.t = t1;
  c.v = beltSpeed(t1, c.v0, spec);
  const out: EscStage[] = [];
  const order: EscStage[] = ['shudder', 'runaway', 'fall', 'broken'];
  const from = order.indexOf(c.stage), to = order.indexOf(stageAt(t1, spec));
  for (let k = from + 1; k <= to; k++) out.push(order[k]);
  c.stage = order[to];
  return out;
}

/** Сколько ещё ленты (м по наклону) убежит вниз от момента t до обрыва. */
export function runawayLeft(t: number, spec: EscSpec = ESC): number {
  const T = spec.runawayS, a = spec.runawayV / spec.runawayS;
  const tau = clamp(t - spec.shudderS, 0, T);
  if (t >= spec.shudderS + T) return 0;
  return (a / 2) * (T * T - tau * tau);
}

/** Донесёт ли лента до низа игрока, стоящего в dist м (по наклону) от нижнего конца, если он стоит смирно с момента t:
 *  до обрыва лента убежит не меньше dist. */
export function carriedDown(dist: number, t: number, spec: EscSpec = ESC): boolean {
  return Math.max(0, dist) <= runawayLeft(t, spec) + 1e-9;
}

/** Тряска 0…1.5 в момент срыва t (рывок — сильно, бег — нарастает, обрыв — удар и затухание). */
export function collapseShake(t: number, spec: EscSpec = ESC): number {
  const st = stageAt(t, spec);
  if (st === 'shudder') return t < 0.35 ? 1.4 : 0.8;
  if (st === 'runaway') return 0.5 + 0.5 * ((t - spec.shudderS) / spec.runawayS);
  if (st === 'fall') {
    const tau = t - spec.shudderS - spec.runawayS;
    return tau < spec.slideS ? 0.9 : Math.max(0, 1.5 - 2.5 * (tau - spec.slideS));
  }
  return 0;
}

/** Яркость торшеров у срывающейся дорожки 0…1 (мигание по ключу — у всех одинаково); после обрыва — гаснут. */
export function lampFlicker(t: number, key: string, spec: EscSpec = ESC): number {
  const st = stageAt(t, spec);
  if (st === 'broken') return 0;
  const R = makeRng(`${key}/flick/${Math.floor(t * 14)}`);
  if (st === 'fall') return R.next() < 0.25 ? 0.4 : 0.05;
  const k = st === 'shudder' ? 0.35 : 0.5;
  return R.next() < k ? 0.15 + 0.3 * R.next() : 1;
}

/** Сползание ленты в приямок на стадии fall: доля 0…1 (0 — стоит, 1 — лежит на дне) через tau с от обрыва. */
export function slideAt(tau: number, spec: EscSpec = ESC): number {
  return clamp(tau / spec.slideS, 0, 1) ** 2;
}

/** Поза сползающей ленты при доле k: верх соскальзывает с верхней площадки по её стенке на дно, низ уезжает к нижней
 *  площадке (как лестница по стене). Лента в своих осях (s вдоль, z вверх, от нижнего конца марша на высоте z0):
 *  pitch — на сколько опустилась (рад, к горизонтали), shift — сдвиг нижнего конца назад (−s), м. */
export function slidePose(l: Pick<EscLane, 'len' | 'z0' | 'z1'>, k: number): { pitch: number; shift: number } {
  const H = l.z1 - l.z0, S = Math.hypot(l.len, H);
  const theta = Math.atan2(H, l.len);
  const h = H * (1 - clamp(k, 0, 1));
  const phi = Math.asin(clamp(h / S, 0, 1));
  return { pitch: theta - phi, shift: S * Math.cos(phi) - l.len };
}

// ───────────────────────── перелезть, падение ─────────────────────────

/** Поперечный отрезок дорожки в общей оси (x у N/S, y у E/W). */
const across = (l: EscLane): [number, number] => (l.up === 'N' || l.up === 'S' ? [l.x0, l.x1] : [l.y0, l.y1]);

/** Соседняя целая дорожка, на которую перелезть (E): параллельная, через балюстраду (зазор ≤ 1.5 м), не сломана и не
 *  срывается (busy); игрок не у концов (climbEndM). Ближняя к игроку сторона — первой. null — некуда. */
export function climbTarget(lanes: readonly EscLane[], cur: EscLane, s: number, a: number, busy: (lane: number) => boolean = () => false, spec: EscSpec = ESC): EscLane | null {
  if (s < spec.climbEndM || s > cur.len - spec.climbEndM) return null;
  const [c0, c1] = across(cur);
  const p = c0 + a;
  let best: EscLane | null = null;
  let bd = Infinity;
  for (const l of lanes) {
    if (l === cur || l.lane === cur.lane || l.broken || busy(l.lane)) continue;
    if (l.up !== cur.up && l.up !== FLIP[cur.up]) continue;
    const [l0, l1] = across(l);
    const gap = l0 >= c1 ? l0 - c1 : c0 >= l1 ? c0 - l1 : -1;
    if (gap < 0 || gap > 1.5) continue;
    const d = l0 >= c1 ? l0 - p : p - l1;
    if (d < bd) (bd = d), (best = l);
  }
  return best;
}

/** Глаз лёжа на дне, м (как на куче ангара). */
export const LIE_EYE = FALL_LIE_EYE;

export interface EscFallPose {
  /** высота глаза над дном приямка, м */
  y: number;
  /** тангаж (+ вверх), крен, рад; тряска 0…1 */
  pitch: number;
  roll: number;
  shake: number;
  phase: 'break' | 'fall' | 'lie';
}

/** Когда упавший ударяется о дно, с (h — глаз над дном в начале). */
export function escLandAt(h: number): number {
  return FALL_BREAK_S + Math.sqrt((2 * Math.max(0, h - 0.3 - LIE_EYE)) / 9.81);
}

/** Через сколько секунд после начала падения — смерть (затемнение): удар и полсекунды на дне. */
export function escDeadAt(h: number): number {
  return escLandAt(h) + 0.5;
}

/**
 * Падение с сорвавшейся лентой (t — с от обрыва, h — глаз над дном приямка в начале): лента проседает (0.3 м), свободное
 * падение до дна, лежит. Взгляд, крен и тряска — как у падения в ангар (fallPose), время подогнано под свою высоту.
 */
export function escFallPose(t: number, h: number): EscFallPose {
  const land = escLandAt(h);
  const tt = t < FALL_BREAK_S ? t : t < land ? FALL_BREAK_S + ((t - FALL_BREAK_S) * (FALL_LAND_S - FALL_BREAK_S)) / Math.max(1e-3, land - FALL_BREAK_S) : FALL_LAND_S + (t - land);
  const fp = fallPose(Math.max(0, tt));
  if (t < FALL_BREAK_S) {
    const k = t / FALL_BREAK_S;
    return { y: Math.max(LIE_EYE, h - 0.3 * k * k), pitch: fp.pitch, roll: fp.roll, shake: Math.max(fp.shake, 0.6), phase: 'break' };
  }
  if (t < land) {
    const tf = t - FALL_BREAK_S;
    return { y: Math.max(LIE_EYE, h - 0.3 - 0.5 * 9.81 * tf * tf), pitch: fp.pitch, roll: fp.roll, shake: fp.shake, phase: 'fall' };
  }
  return { y: LIE_EYE, pitch: fp.pitch, roll: fp.roll, shake: fp.shake, phase: 'lie' };
}

// ───────────────────────── возрождение ─────────────────────────

/** Ближайшая (по числу проёмов) комната с ok от from: поиск в ширину по связям-дверям; from тоже проверяется. */
export function nearestRoom(links: readonly { a: { inst: string }; b: { inst: string } }[], from: string, ok: (id: string) => boolean, maxHops = 80): string | null {
  const adj = new Map<string, string[]>();
  for (const l of links) {
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

/** Правило для игрока. */
export function metroRule(spec: EscSpec = ESC): string {
  return `Эскалаторы везут сами (${spec.speed} м/с), но изредка срываются: лента дёргается и встаёт, потом бежит вниз. ` +
    'Перелезь через балюстраду на соседнюю дорожку (E) или успей доехать до низа — оборвавшись, лента падает в приямок.';
}
