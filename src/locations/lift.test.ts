// Механика «Ржавого лифта» без движка (lift.ts): разбор, розыгрыш, доски, поездка, раскачка (боты), клетка,
// выходы. Числа ботов — те же, что в подборе констант (lift.tune.perf.test.ts).
import { describe, expect, it } from 'vitest';
import type { LiftSpec } from '../model/types';
import {
  boardAhead, callLift, createLift, DEFAULT_LIFT, isLair, liftBoard, liftExits, liftExitsAt, liftFloorLabel, liftRule, normLift, rollLift, stepLift,
  LIFT_CABLE, LIFT_FLOOR_M, LIFT_FREE_AMP, LIFT_HALF_X, LIFT_HALF_Z, LIFT_KICK_DELAY, LIFT_RUN, LIFT_SLIP,
  type LiftAxis, type LiftEvent, type LiftRoll, type LiftState,
} from './lift';

const spec = (o: Partial<LiftSpec> = {}): LiftSpec => ({ ...DEFAULT_LIFT, ...o });
const roll = (variant: LiftRoll['variant'], floors = 3, seed = 's', down = 0): LiftRoll => ({ variant, floors, down, lair: null, seed });
const DT = 1 / 60;

/** Бот: целевое положение по оси качания (доли полуразмера) по крену и скорости крена (с опозданием react). */
type Bot = (phi: number, vel: number) => number;
const BOTS: Record<string, Bot> = {
  idle: () => 0,
  // у края с доской (+ось): от удара доски эта сторона первой идёт вверх; у дальнего края — вниз
  edge: () => 0.9,
  edgeFar: () => -0.9,
  downhill: (phi) => Math.sign(phi) * 0.9,
  uphill: (phi) => -Math.sign(phi) * 0.9,
  uphillHalf: (phi) => -Math.sign(phi) * 0.5,
};

/** Подъём на этаж 1 с доской на пролёте 0 (первая попытка, где она есть); бот гасит раскачку (kickAt ≥ 0 — стоит в
 *  центре и через kickAt с после удара доски бежит к ней, на край +оси). Итог поездки; at — время событий с удара доски. */
function ride(sp: LiftSpec, variant: LiftRoll['variant'], seed: string, bot: Bot, react: number, kickAt = -1) {
  const r = roll(variant, 1, seed);
  let a = 0;
  while (!liftBoard(sp, r, a, 0)) a++;
  const s = createLift(r, a);
  callLift(s, 1);
  let p = 0;
  let axis: LiftAxis | null = null;
  const hp: number[] = [], hv: number[] = [];
  const ev: LiftEvent[] = [];
  const at: Partial<Record<LiftEvent['type'], number>> = {};
  let t0 = -1;
  for (let t = 0; t < 90; t += DT) {
    const sw = s.swing;
    if (sw) {
      if (t0 < 0) t0 = t;
      axis = sw.axis;
      hp.push(sw.phi);
      hv.push(sw.vel);
      const lag = Math.max(0, hp.length - 1 - Math.round(react / DT));
      const half = sw.axis === 'x' ? LIFT_HALF_X : LIFT_HALF_Z;
      const tgt = kickAt >= 0 ? (t - t0 >= kickAt ? 1 : 0) : bot(hp[lag], hv[lag]);
      p += Math.max(-LIFT_RUN * DT, Math.min(LIFT_RUN * DT, (tgt - p) * half)) / half + (LIFT_SLIP * sw.phi * DT) / half;
      p = Math.max(-1, Math.min(1, p));
    }
    const pos = axis === 'x' ? { x: p * LIFT_HALF_X, z: 0 } : { x: 0, z: p * LIFT_HALF_Z };
    for (const e of stepLift(sp, s, DT, pos)) {
      ev.push(e);
      if (t0 >= 0) at[e.type] ??= t - t0;
    }
    if (s.phase === 'thrown' || s.phase === 'snapped' || (s.phase === 'idle' && s.floor === 1)) break;
  }
  return { s, ev, at, axis: axis!, thrown: s.phase === 'thrown', snapped: s.phase === 'snapped' };
}

const SEEDS = Array.from({ length: 60 }, (_, i) => 'bot' + i);

describe('«Ржавый лифт»: механика без движка', () => {
  it('normLift: чужое — null; мусор — по умолчанию; диапазоны упорядочены и зажаты, этажи — целые', () => {
    for (const bad of [null, 5, 'lift', [], { kind: 'stairwell' }, { kind: 'elevator' }]) expect(normLift(bad)).toBeNull();
    expect(normLift({ kind: 'lift' })).toEqual(DEFAULT_LIFT);
    const n = normLift({ kind: 'lift', floorsUp: [9.6, 2.2], floorsDown: [-3, 1.4], boardFirst: 'да', cageChance: 7, speed: -1, boardPumpS: [10, 3], swingPeriod: 'x', darkness: 0.3 })!;
    expect(n.floorsUp).toEqual([2, 10]);
    expect(n.floorsDown).toEqual([0, 1]);
    expect(n.boardFirst).toBe(true);
    expect(normLift({ kind: 'lift', boardFirst: false })!.boardFirst).toBe(false);
    expect(n.cageChance).toBe(1);
    expect(n.speed).toBe(0.1);
    expect(n.boardPumpS).toEqual([3, 10]);
    expect(n.swingPeriod).toBe(DEFAULT_LIFT.swingPeriod);
    expect(n.darkness).toBe(0.3);
    // старые значения по умолчанию (период 5 с, толчок 0.5, доска 4–6 с) — к новому периоду; свои — как есть
    expect(normLift({ kind: 'lift', swingPeriod: 5, boardKick: 0.5, boardPumpS: [4, 6] })!.swingPeriod).toBe(DEFAULT_LIFT.swingPeriod);
    expect(normLift({ kind: 'lift', swingPeriod: 5, boardKick: 0.6, boardPumpS: [4, 6] })!.swingPeriod).toBe(5);
    expect(DEFAULT_LIFT.swingPeriod).toBe(7);
  });

  it('rollLift: детерминирован; вид — по cageChance; этажи вверх и вниз в диапазоне; логово — на любом этаже, кроме входа', () => {
    expect(rollLift(DEFAULT_LIFT, 'k')).toEqual(rollLift(DEFAULT_LIFT, 'k'));
    const keys = Array.from({ length: 400 }, (_, i) => 'key' + i);
    expect(keys.every((k) => rollLift(spec({ cageChance: 0 }), k).variant === 'carriage')).toBe(true);
    expect(keys.every((k) => rollLift(spec({ cageChance: 1 }), k).variant === 'cage')).toBe(true);
    const half = keys.filter((k) => rollLift(DEFAULT_LIFT, k).variant === 'cage').length / keys.length;
    expect(half).toBeGreaterThan(0.4);
    expect(half).toBeLessThan(0.6);
    const sides = new Set<string>();
    let below = 0;
    for (const k of keys) {
      const r = rollLift(DEFAULT_LIFT, k);
      expect(r.floors).toBeGreaterThanOrEqual(3);
      expect(r.floors).toBeLessThanOrEqual(6);
      expect(r.down).toBeGreaterThanOrEqual(1);
      expect(r.down).toBeLessThanOrEqual(2);
      expect(r.lair).not.toBeNull();
      expect(r.lair!.floor).not.toBe(0);
      expect(r.lair!.floor).toBeGreaterThanOrEqual(-r.down);
      expect(r.lair!.floor).toBeLessThanOrEqual(r.floors);
      if (r.lair!.floor < 0) below++;
      sides.add(r.lair!.side);
    }
    expect([...sides].sort()).toEqual(['right', 'straight']);
    // логово ниже входа — примерно по доле этажей вниз (в среднем 1.5 из 6)
    expect(below / keys.length).toBeGreaterThan(0.15);
    expect(below / keys.length).toBeLessThan(0.4);
    expect(keys.every((k) => rollLift(spec({ floorsDown: [0, 0] }), k).down === 0)).toBe(true);
    expect(keys.every((k) => rollLift(spec({ lairChance: 0 }), k).lair === null)).toBe(true);
  });

  it('liftBoard: детерминирована; только на пролётах 0…floors−1; частота ≈ boardChance; доля пролёта и время качания — в рамках', () => {
    const r = roll('cage', 4, 'b');
    expect(liftBoard(DEFAULT_LIFT, r, 0, 1)).toEqual(liftBoard(DEFAULT_LIFT, r, 0, 1));
    expect(liftBoard(spec({ boardChance: 1 }), r, 0, -1)).toBeNull();
    expect(liftBoard(spec({ boardChance: 1 }), r, 0, 4)).toBeNull();
    // ниже входа пролёты −down…−1
    const rd = roll('cage', 4, 'b', 2);
    expect(liftBoard(spec({ boardChance: 1 }), rd, 0, -2)).not.toBeNull();
    expect(liftBoard(spec({ boardChance: 1 }), rd, 0, -3)).toBeNull();
    let n = 0, all = 0;
    for (let a = 0; a < 200; a++) {
      for (let g = 0; g < 4; g++) {
        all++;
        const b = liftBoard(DEFAULT_LIFT, r, a, g);
        if (!b) continue;
        n++;
        expect(b.frac).toBeGreaterThanOrEqual(0.3);
        expect(b.frac).toBeLessThanOrEqual(0.7);
        expect(b.pumpS).toBeGreaterThanOrEqual(DEFAULT_LIFT.boardPumpS[0]);
        expect(b.pumpS).toBeLessThanOrEqual(DEFAULT_LIFT.boardPumpS[1]);
      }
    }
    expect(Math.abs(n / all - DEFAULT_LIFT.boardChance)).toBeLessThan(0.06);
    expect(liftBoard(spec({ boardChance: 0 }), r, 0, 0)).toBeNull();
  });

  it('callLift: тот же этаж и вне диапазона — ничего; на ходу можно развернуть; в раскачке — нет', () => {
    const s = createLift(roll('cage', 3));
    expect(callLift(s, 0)).toEqual([]);
    expect(callLift(s, 4)).toEqual([]);
    expect(callLift(s, 1.5)).toEqual([]);
    expect(callLift(s, 2)).toEqual([{ type: 'depart', from: 0, to: 2 }]);
    expect(s.phase).toBe('moving');
    stepLift(spec({ boardChance: 0 }), s, 1, { x: 0, z: 0 });
    expect(callLift(s, 0)[0]).toMatchObject({ type: 'depart', to: 0 });
    expect(s.target).toBe(0);
    s.phase = 'jammed';
    expect(callLift(s, 3)).toEqual([]);
  });

  it('поездка без досок: проехал этажи (pass), доехал (arrive) за путь / скорость; вниз — так же', () => {
    const sp = spec({ boardChance: 0, boardFirst: false });
    const s = createLift(roll('cage', 3));
    callLift(s, 3);
    const ev: LiftEvent[] = [];
    let t = 0;
    while (s.phase !== 'idle' && t < 60) {
      ev.push(...stepLift(sp, s, DT, { x: 0, z: 0 }));
      t += DT;
    }
    expect(ev.map((e) => e.type)).toEqual(['pass', 'pass', 'arrive']);
    expect(s.floor).toBe(3);
    expect(s.y).toBeCloseTo(3 * LIFT_FLOOR_M, 9);
    expect(t).toBeCloseTo((3 * LIFT_FLOOR_M) / sp.speed, 1);
    callLift(s, 0);
    const down: LiftEvent[] = [];
    for (let k = 0; k < 6000 && s.phase !== 'idle'; k++) down.push(...stepLift(spec({ boardChance: 1 }), s, DT, { x: 0, z: 0 }));
    // вниз досок нет, даже если на каждом пролёте вверх они падают
    expect(down.map((e) => e.type)).toEqual(['pass', 'pass', 'arrive']);
    expect(s.floor).toBe(0);
  });

  it('этажи ниже входа: вниз до −down (подписи −1, −2), выходы там, выше −down — нельзя; вверх оттуда — с доской', () => {
    const sp = spec({ boardChance: 0, boardFirst: false });
    const r = roll('cage', 2, 'dn', 2);
    const s = createLift(r);
    expect(callLift(s, -3)).toEqual([]);
    expect(callLift(s, -2)).toEqual([{ type: 'depart', from: 0, to: -2 }]);
    const ev: LiftEvent[] = [];
    for (let k = 0; k < 6000 && s.phase !== 'idle'; k++) ev.push(...stepLift(sp, s, DT, { x: 0, z: 0 }));
    expect(ev).toEqual([{ type: 'pass', floor: -1 }, { type: 'arrive', floor: -2 }]);
    expect(s.y).toBeCloseTo(-2 * LIFT_FLOOR_M, 9);
    expect(liftExits(s).map((e) => e.side)).toEqual(['straight', 'right']);
    expect(liftExitsAt(r, -3)).toEqual([]);
    expect(createLift(r, 0, -2).floor).toBe(-2);
    expect(createLift(r, 0, -3).floor).toBe(0);
    expect([-2, -1, 0, 1, 2].map(liftFloorLabel)).toEqual(['−2', '−1', '1', '2', '3']);
    // вверх с −2: первый подъём попытки — доска на первом же пролёте (−2), при boardFirst
    callLift(s, 2);
    const up: LiftEvent[] = [];
    for (let k = 0; k < 6000 && s.phase === 'moving'; k++) up.push(...stepLift(spec({ boardChance: 0 }), s, DT, { x: 0, z: 0 }));
    expect(up.find((e) => e.type === 'board')).toMatchObject({ segment: -2 });
  });

  it('первый подъём — доска всегда (boardFirst), один раз за попытку; без boardFirst и с нулевым шансом — ни одной', () => {
    for (const seed of SEEDS) {
      const r = roll('cage', 4, seed);
      const s = createLift(r);
      expect(boardAhead(spec({ boardChance: 0 }), s, 0)).not.toBeNull();
      expect(boardAhead(spec({ boardChance: 0, boardFirst: false }), s, 0)).toBeNull();
      callLift(s, 4);
      const types: string[] = [];
      for (let k = 0; k < 60 * 200 && !(s.phase === 'idle' && s.floor === 4); k++) types.push(...stepLift(spec({ boardChance: 0 }), s, DT, { x: 0, z: 0 }).map((e) => e.type));
      expect(types.filter((t) => t === 'board')).toHaveLength(1);
      expect(s.boards).toEqual([0]);
      expect(boardAhead(spec({ boardChance: 0 }), s, 1)).toBeNull();
      // новая попытка — снова первый подъём с доской
      expect(boardAhead(spec({ boardChance: 0 }), createLift(r, 1), 0)).not.toBeNull();
    }
  });

  it('доска: на подъёме в точке (пролёт + frac)·этаж — кабина стоит и качается; ось — по стороне; пролёт отработан', () => {
    const sp = spec({ boardChance: 1 });
    const r = roll('cage', 2, 'board');
    const b = liftBoard(sp, r, 0, 0)!;
    const s = createLift(r);
    callLift(s, 2);
    const ev: LiftEvent[] = [];
    for (let k = 0; k < 6000 && s.phase === 'moving'; k++) ev.push(...stepLift(sp, s, DT, { x: 0, z: 0 }));
    const e = ev.find((x) => x.type === 'board')!;
    expect(e).toEqual({ type: 'board', segment: 0, side: b.side, axis: b.side === 'straight' ? 'z' : 'x', pumpS: b.pumpS });
    expect(s.phase).toBe('jammed');
    expect(s.y).toBeCloseTo(b.frac * LIFT_FLOOR_M, 9);
    expect(s.boards).toEqual([0]);
    expect(s.swing!.amp).toBeCloseTo(sp.boardKick, 1);
    // стоит, пока качает
    const y = s.y;
    stepLift(sp, s, 1, { x: 0, z: 0 });
    expect(s.y).toBe(y);
  });

  it('новая попытка — своё расписание досок', () => {
    const r = roll('cage', 6, 'att');
    const sched = (a: number) => Array.from({ length: 6 }, (_, g) => JSON.stringify(liftBoard(DEFAULT_LIFT, r, a, g)));
    expect(sched(0)).not.toEqual(sched(1));
  });

  it('каретка: стоит в центре, у дальнего края или бежит на опустившуюся сторону — доска не выпадает, выбрасывает всегда', () => {
    for (const name of ['idle', 'edgeFar', 'downhill']) {
      for (const seed of SEEDS) {
        const r = ride(DEFAULT_LIFT, 'carriage', seed, BOTS[name], 0.3);
        expect(r.thrown, `${name} ${seed}`).toBe(true);
        expect(r.ev.find((e) => e.type === 'thrown')).toMatchObject({ type: 'thrown', axis: r.axis });
        // раскачку не погасили — доска держится до конца
        expect(r.at.freed).toBeUndefined();
        // терминально
        expect(stepLift(DEFAULT_LIFT, r.s, 1, { x: 0, z: 0 })).toEqual([]);
      }
    }
  });

  it('каретка: перебегая на поднявшуюся сторону — и с реакцией до 1.5 с — гасят по обеим осям; доска выпадает, когда погашено', () => {
    const axes = new Set<LiftAxis>();
    for (const [bot, react] of [['uphill', 0.3], ['uphill', 1], ['uphill', 1.5], ['uphillHalf', 0.5], ['edge', 0]] as const) {
      for (const seed of SEEDS) {
        const r = ride(DEFAULT_LIFT, 'carriage', seed, BOTS[bot], react);
        axes.add(r.axis);
        expect(r.thrown, `${bot} ${react} ${seed}`).toBe(false);
        const types = r.ev.map((e) => e.type);
        // доска — не раньше pumpS и только при погашенной раскачке; потом стихло — едет
        const b = r.ev.find((e) => e.type === 'board') as { pumpS: number };
        expect(r.at.freed!).toBeGreaterThanOrEqual(b.pumpS - 0.05);
        expect(types).not.toContain('kick');
        expect(types.indexOf('steady')).toBeGreaterThan(types.indexOf('freed'));
        expect(types.at(-1)).toBe('arrive');
      }
    }
    expect([...axes].sort()).toEqual(['x', 'z']);
  });

  it('каретка: доска выпадает только при амплитуде ниже LIFT_FREE_AMP; трос не изнашивается', () => {
    const r = ride(DEFAULT_LIFT, 'carriage', 'bot0', BOTS.uphill, 0.3);
    const i = r.ev.findIndex((e) => e.type === 'freed');
    const before = r.ev.slice(0, i).filter((e) => e.type === 'sway') as { amp: number }[];
    expect(before.at(-1)!.amp).toBeLessThan(LIFT_FREE_AMP + 0.05);
    expect(r.s.wear).toBe(0);
    expect(r.ev.some((e) => e.type === 'fray' || e.type === 'snap')).toBe(false);
  });

  it('клетка: стоит в центре или у дальнего края — трос натягивается, трещит и рвётся через ~8 с (кто бегает по клетке — заденет доску)', () => {
    for (const name of ['idle', 'edgeFar']) {
      for (const seed of SEEDS) {
        const r = ride(DEFAULT_LIFT, 'cage', seed, BOTS[name], 0.3);
        expect(r.snapped, `${name} ${seed}`).toBe(true);
        // клетку не выбрасывает — она бьётся о стены; доска сидит
        expect(r.thrown).toBe(false);
        expect(r.at.freed).toBeUndefined();
        // трос трещит дважды, потом рвётся — не раньше 7 с
        expect(r.ev.filter((e) => e.type === 'fray').map((e) => (e as { wear: number }).wear)).toEqual([1 / 3, 2 / 3]);
        expect(r.ev.at(-1)).toEqual({ type: 'snap' });
        expect(r.at.snap!).toBeGreaterThan(7);
        expect(r.s.wear).toBeGreaterThanOrEqual(LIFT_CABLE);
        // терминально; новая попытка — новый трос
        expect(stepLift(DEFAULT_LIFT, r.s, 1, { x: 0, z: 0 })).toEqual([]);
        expect(createLift(r.s.roll, r.s.attempt + 1).wear).toBe(0);
      }
    }
  });

  it('клетка: подбежал к доске (край +оси) и спихнул — доска выпала, трос больше не изнашивается, стихло, доехал; хоть через 6 с', () => {
    for (const kickAt of [0, 1, 3, 6]) {
      for (const seed of SEEDS) {
        const r = ride(DEFAULT_LIFT, 'cage', seed, BOTS.idle, 0, kickAt);
        expect(r.snapped, `${kickAt} ${seed}`).toBe(false);
        const types = r.ev.map((e) => e.type);
        expect(types.indexOf('freed')).toBe(types.indexOf('kick') + 1);
        // спихнуть — не раньше, чем доска села
        expect(r.at.kick!).toBeGreaterThanOrEqual(Math.max(kickAt, LIFT_KICK_DELAY) - 0.05);
        expect(r.s.wear).toBeLessThan(LIFT_CABLE * 0.85);
        expect(types.at(-1)).toBe('arrive');
      }
    }
  });

  it('каретку не спихнуть: у края с доской доска держится, пока раскачка не погашена', () => {
    const r = ride(DEFAULT_LIFT, 'carriage', 'bot1', BOTS.idle, 0, 0);
    expect(r.ev.some((e) => e.type === 'kick')).toBe(false);
  });

  it('большой шаг времени — без NaN, тот же итог, что мелкими шагами (поездка без досок)', () => {
    const sp = spec({ boardChance: 0, boardFirst: false });
    const a = createLift(roll('cage', 3)), b = createLift(roll('cage', 3));
    callLift(a, 2);
    callLift(b, 2);
    const ea = stepLift(sp, a, 30, { x: 0, z: 0 });
    for (let k = 0; k < 30 * 60; k++) stepLift(sp, b, DT, { x: 0, z: 0 });
    // шаг ограничен 5 с: за один вызов — 5 с пути (3 м — ещё до этажа 1)
    expect(a.y).toBeCloseTo(5 * sp.speed, 6);
    expect(ea).toEqual([]);
    for (let k = 0; k < 10; k++) stepLift(sp, a, 30, { x: 0, z: 0 });
    expect(a.floor).toBe(b.floor);
    expect(a.phase).toBe('idle');
    expect(stepLift(sp, a, NaN, { x: NaN, z: 0 })).toEqual([]);
  });

  it('выходы: этаж 0 — вход; выше — прямо и направо (логово отмечено); стоя у этажа — liftExits', () => {
    const r: LiftRoll = { variant: 'cage', floors: 3, down: 0, lair: { floor: 2, side: 'right' }, seed: 'x' };
    expect(liftExitsAt(r, 0)).toEqual([{ floor: 0, side: 'entry', lair: false }]);
    expect(liftExitsAt(r, 2)).toEqual([
      { floor: 2, side: 'straight', lair: false },
      { floor: 2, side: 'right', lair: true },
    ]);
    expect(liftExitsAt(r, 4)).toEqual([]);
    expect(liftExitsAt(r, 1.5)).toEqual([]);
    expect(isLair(r, 2, 'right')).toBe(true);
    expect(isLair(r, 2, 'entry')).toBe(false);
    const s: LiftState = createLift(r, 0, 2);
    expect(s.y).toBeCloseTo(2 * LIFT_FLOOR_M, 9);
    expect(liftExits(s)).toHaveLength(2);
    callLift(s, 3);
    expect(liftExits(s)).toEqual([]);
    expect(createLift(r, 0, 9).floor).toBe(0);
  });

  it('правило для игрока — с числами спецификации и логовом', () => {
    expect(liftRule(DEFAULT_LIFT)).toMatch(/3–6 эт\. над входом и 1–2 под ним/);
    expect(liftRule(spec({ floorsDown: [0, 0] }))).not.toMatch(/под ним/);
    expect(liftRule(DEFAULT_LIFT)).toMatch(/поднявшуюся сторону/);
    expect(liftRule(DEFAULT_LIFT)).toMatch(/спихнёшь/);
    expect(liftRule(DEFAULT_LIFT)).toMatch(/логово/);
    expect(liftRule(spec({ lairChance: 0 }))).not.toMatch(/логово/);
  });
});
