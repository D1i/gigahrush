// Эскалаторы «Фрактальной станции» (FRACTAL.md §4.3) — конвейер и срывы без движка.
//
//  • Механика срыва — та же, что в метро (src/locations/metroEscalator.ts без изменений): ESC, кости createDice /
//    rideRoll / bgDue / noteBreak, стадии createCollapse / stepCollapse / beltSpeed / collapseShake / lampFlicker.
//  • Срывается ВЕСЬ эскалатор (все дорожки, все копии — геометрия периодична): inst = 'fr/' + i. Эскалатор выхода
//    (kind 'exit') не срывается никогда.
//  • Отличия от метро: часы костей идут от входа в локацию (первые graceS с — без срыва); в стадии fall подложка
//    исчезает сразу (i попадает в broken — solidAt считает её пустой, наклона нет), игрок на нём — свободное падение
//    (fractalPhysics.ts), без смерти; донесло до низа в runaway — выбросило на пол (там же).
//  • Бросок при входе на дорожку (событие 'ride' тела): выпал — срыв начнётся, когда игрок проедет долю at пути от
//    места входа (ctx.ride; без него — по времени на скорости ленты). Сошёл раньше — бросок пропал.
import { makeRng } from '../model/rng';
import type { FractalCell } from './fractalCell';
import {
  bgDue, beltSpeed, collapseShake, createCollapse, createDice, ESC, lampFlicker, noteBreak, rideRoll, stageAt, stepCollapse, tickDice,
  type EscCollapse, type EscDice, type EscStage,
} from './metroEscalator';

const COS30 = Math.cos(Math.PI / 6);

/** Отложенный срыв под игроком (бросок выпал): начнётся, когда он проедет at·len м в плане от s0. */
export interface FrEscPend { esc: number; lane: number; s0: number | null; len: number; at: number; t: number }

export interface FrEscWorld {
  cell: FractalCell;
  /** сломанные (подложка пуста, наклона нет) — с начала стадии fall */
  broken: Set<number>;
  /** идущие срывы (inst = 'fr/' + i, lane — дорожка, где начался); по стадии broken — удаляются */
  runs: Map<number, EscCollapse>;
  dice: EscDice;
  /** с от входа (grace) */
  sinceEnter: number;
  /** м/с по наклону, + вверх (dir·0.75 или beltSpeed при срыве) */
  belt(esc: number, lane: number): number;
  stage(esc: number): EscStage | null;
  /** бросок выпал — ждём, пока игрок проедет долю пути */
  pend: FrEscPend | null;
  /** события срывов, начатых извне (startCollapse), — отдаёт ближайший stepEscWorld */
  queue: FrEscEvent[];
}

export type FrEscEvent =
  | { k: 'start'; esc: number; lane: number; bg: boolean }
  | { k: 'stage'; esc: number; stage: EscStage }
  | { k: 'broken'; esc: number };

/** Ключ срыва (мигание торшеров, кооп) — одинаков во всех копиях и у всех игроков. */
export const frEscKey = (esc: number): string => `fr/${esc}`;

export function createEscWorld(cell: FractalCell, seed: string): FrEscWorld {
  const w: FrEscWorld = {
    cell,
    broken: new Set(),
    runs: new Map(),
    dice: createDice(`fractal:${seed}/esc`),
    sinceEnter: 0,
    belt(esc, lane) {
      const e = cell.esc[esc];
      const l = e?.lanes[lane];
      if (!l) return 0;
      const v0 = l.dir * ESC.speed;
      const r = w.runs.get(esc);
      if (r) return beltSpeed(r.t, v0);
      return w.broken.has(esc) ? 0 : v0;
    },
    stage(esc) {
      const r = w.runs.get(esc);
      if (r) return r.stage;
      return w.broken.has(esc) ? 'broken' : null;
    },
    pend: null,
    queue: [],
  };
  return w;
}

/** Начать срыв извне (кооп fx / QA). false — уже идёт / сломан / выход / нет такого. */
export function startCollapse(w: FrEscWorld, esc: number, lane: number, bg: boolean): boolean {
  const e = w.cell.esc[esc];
  if (!e || e.kind === 'exit' || w.broken.has(esc) || w.runs.has(esc)) return false;
  const ln = Math.max(0, Math.min(e.lanes.length - 1, Math.floor(lane) || 0));
  w.runs.set(esc, createCollapse(frEscKey(esc), ln, e.lanes[ln].dir * ESC.speed));
  noteBreak(w.dice);
  if (w.pend?.esc === esc) w.pend = null;
  w.queue.push({ k: 'start', esc, lane: ln, bg });
  return true;
}

/** Может ли эскалатор сорваться сейчас (целый, не выход, не идёт срыв). */
const canBreak = (w: FrEscWorld, esc: number): boolean => {
  const e = w.cell.esc[esc];
  return !!e && e.kind !== 'exit' && !w.broken.has(esc) && !w.runs.has(esc);
};

/** Шаг: ride — где едет игрок (бросок rideRoll при входе на дорожку — по событию 'ride' из stepBody), near — индексы
 *  эскалаторов в кадре ≤ ESC.bgM (фоновый срыв). ctx.ride (необязательно) — текущая поездка игрока: по ней отложенный
 *  срыв ждёт доли пути; без неё — ждёт по времени. */
export function stepEscWorld(
  w: FrEscWorld,
  dt: number,
  ctx: { rideStart: { esc: number; lane: number } | null; near: number[]; ride?: { esc: number; lane: number; s: number } | null },
): FrEscEvent[] {
  const out: FrEscEvent[] = w.queue.length ? w.queue.splice(0) : [];
  if (!(dt > 0) || !Number.isFinite(dt)) return out;
  w.sinceEnter += dt;
  tickDice(w.dice, dt);
  // стадии идущих срывов (начатые в этом шаге пойдут со следующего); fall — подложка и наклон пропали сразу
  for (const [i, r] of w.runs) {
    for (const st of stepCollapse(r, dt)) {
      out.push({ k: 'stage', esc: i, stage: st });
      if ((st === 'fall' || st === 'broken') && !w.broken.has(i)) {
        w.broken.add(i);
        out.push({ k: 'broken', esc: i });
      }
      if (st === 'broken') w.runs.delete(i);
    }
  }
  // бросок при входе на целую дорожку (выход не срывается и костей не тратит)
  const rs = ctx.rideStart;
  if (rs && canBreak(w, rs.esc)) {
    const e = w.cell.esc[rs.esc];
    const roll = rideRoll(w.dice);
    if (roll) {
      const s0 = ctx.ride && ctx.ride.esc === rs.esc ? ctx.ride.s : null;
      const dir = e.lanes[rs.lane]?.dir ?? 0;
      // путь до конца в сторону хода ленты (стоящая — до дальнего конца)
      const len = s0 === null ? e.run : dir > 0 ? e.run - s0 : dir < 0 ? s0 : Math.max(s0, e.run - s0);
      w.pend = { esc: rs.esc, lane: rs.lane, s0, len: Math.max(0.5, len), at: roll.at, t: 0 };
    }
  }
  // отложенный срыв: проехал долю пути — пошёл; сошёл — пропал
  const p = w.pend;
  if (p) {
    p.t += dt;
    let go = false;
    if (ctx.ride !== undefined && p.s0 !== null) {
      if (!ctx.ride || ctx.ride.esc !== p.esc) w.pend = null;
      else go = Math.abs(ctx.ride.s - p.s0) >= p.at * p.len;
    } else {
      go = p.t * ESC.speed * COS30 >= p.at * p.len;
    }
    if (go) {
      w.pend = null;
      startCollapse(w, p.esc, p.lane, false);
    }
  }
  // фоновый срыв — только зрелище: один из целых эскалаторов в кадре, кроме того, на котором едет игрок (как в метро —
  // rideKey; сцена и так не кладёт его в near, здесь — страховка)
  const riding = ctx.ride ? ctx.ride.esc : -1;
  let cand = 0;
  for (const i of ctx.near) if (i !== riding && canBreak(w, i)) cand++;
  if (bgDue(w.dice, dt, cand > 0)) {
    const R = makeRng(`${w.dice.seed}/bgpick/${w.dice.bgN}`);
    let k = Math.floor(R.next() * cand);
    for (const i of ctx.near) {
      if (i === riding || !canBreak(w, i)) continue;
      if (k-- === 0) {
        startCollapse(w, i, Math.floor(R.next() * w.cell.esc[i].lanes.length), true);
        break;
      }
    }
  }
  if (w.queue.length) out.push(...w.queue.splice(0));
  return out;
}

/** Поза ленты/наклона при срыве для сцены: сдвиг ленты по наклону (м, + вверх), падение всей конструкции вдоль −up
 *  (м, в стадии fall 0.5·g·τ²), тряска 0…1.5, яркость торшеров 0…1. null — срыва нет. */
export function collapsePose(w: FrEscWorld, esc: number): { belt: number; drop: number; shake: number; lamp: number } | null {
  const r = w.runs.get(esc);
  if (!r) return null;
  const tau = r.t - ESC.shudderS - ESC.runawayS;
  const drop = stageAt(r.t) === 'fall' && tau > 0 ? 0.5 * 9.8 * tau * tau : 0;
  return { belt: r.belt, drop, shake: collapseShake(r.t), lamp: lampFlicker(r.t, frEscKey(esc)) };
}
