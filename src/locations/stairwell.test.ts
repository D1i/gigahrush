import { describe, expect, it } from 'vitest';
import type { StairwellSpec } from '../model/types';
import {
  APPROACH_DT, approachMeter, cloneLocation, createStairwell, DEFAULT_STAIRWELL, grabTime, newStairwell, normStairwell,
  parseLocation, rollStairwell, soundDelay, STAIR_DESCENT_M, STAIR_FLOOR_M, stairwellRule, stepStairwell,
  type StairwellEvent, type StairwellRoll, type StairwellState,
} from './stairwell';

/** Шаг и скорости — двоичные дроби: высоты точны, сравнения в сдвинутой системе те же (тест «любая высота»). */
const DT = 1 / 64;
const DOWN = -0.625; // м/с — спокойный спуск
const UP = 0.8125; // м/с — бегом наверх

type Bot = (s: StairwellState, y: number) => number;

/** Игрок, который всё делает правильно: в тишине — вниз, после звука — бегом на этаж вверх. */
const good: Bot = (s) => (s.phase === 'threat' ? UP : DOWN);

interface Played { log: { t: number; e: StairwellEvent }[]; y: number; minY: number; s: StairwellState }

/** Прогон механики: бот задаёт вертикальную скорость, механика получает y. off — сдвиг системы высот
 *  (игрок «на самом деле» на off метров ниже; отметка входа сдвинута так же). */
function play(spec: StairwellSpec, s: StairwellState, bot: Bot, maxT = 900, off = 0, y0 = 0): Played {
  let y = y0;
  let minY = y;
  const log: Played['log'] = [];
  s.mark += off;
  for (let t = 0; t < maxT && s.phase !== 'grabbed' && s.phase !== 'open'; t += DT) {
    y += bot(s, y) * DT;
    minY = Math.min(minY, y);
    for (const e of stepStairwell(spec, s, DT, y + off)) log.push({ t: s.t, e });
  }
  return { log, y, minY, s };
}

const kinds = (p: Played) => p.log.map((x) => x.e.type).filter((k) => k !== 'approach');
const roll3: StairwellRoll = { sounds: 3, floorsDown: 2, seed: 'test-seed' };

describe('«Бесконечная лестница»: розыгрыш и спецификация', () => {
  it('rollStairwell детерминирован, в диапазонах, разные ключи — разные розыгрыши', () => {
    const spec = { ...newStairwell(), sounds: [2, 6] as [number, number], floorsDown: [1, 4] as [number, number] };
    expect(rollStairwell(spec, 'мир#a')).toEqual(rollStairwell(spec, 'мир#a'));
    const sounds = new Set<number>(), floors = new Set<number>(), seeds = new Set<string>();
    for (let k = 0; k < 300; k++) {
      const r = rollStairwell(spec, `мир#${k}`);
      expect(r.sounds).toBeGreaterThanOrEqual(2);
      expect(r.sounds).toBeLessThanOrEqual(6);
      expect(r.floorsDown).toBeGreaterThanOrEqual(1);
      expect(r.floorsDown).toBeLessThanOrEqual(4);
      sounds.add(r.sounds); floors.add(r.floorsDown); seeds.add(r.seed);
    }
    expect([...sounds].sort()).toEqual([2, 3, 4, 5, 6]);
    expect([...floors].sort()).toEqual([1, 2, 3, 4]);
    expect(seeds.size).toBe(300);
  });

  it('normStairwell: мусор → null, пропуски → по умолчанию, диапазоны упорядочены и зажаты', () => {
    expect(normStairwell(null)).toBeNull();
    expect(normStairwell('stairwell')).toBeNull();
    expect(normStairwell([1])).toBeNull();
    expect(normStairwell({ kind: 'elevator' })).toBeNull();
    expect(normStairwell({ kind: 'stairwell' })).toEqual(DEFAULT_STAIRWELL);
    expect(parseLocation({ kind: 'stairwell', sounds: [7, 2.6], interval: [90, 0], grabS: -5, accelS: 'x', floorsDown: [0, 999], darkness: 3 }))
      .toEqual({ kind: 'stairwell', sounds: [3, 7], interval: [1, 90], grabS: 1, accelS: 6, floorsDown: [1, 50], darkness: 1 });
    expect(normStairwell({ kind: 'stairwell', sounds: [1], interval: null, floorsDown: [2, NaN] })).toMatchObject({ sounds: [3, 5], interval: [18, 45], floorsDown: [1, 3] });
    // копии не делят массивы
    const a = newStairwell();
    a.sounds[0] = 9;
    expect(DEFAULT_STAIRWELL.sounds[0]).toBe(3);
    const b = cloneLocation(a);
    b.interval[1] = 1;
    expect(a.interval[1]).toBe(45);
    expect(cloneLocation(null)).toBeNull();
  });

  it('правило для игрока: время захвата по формуле', () => {
    expect(stairwellRule(DEFAULT_STAIRWELL)).toContain('~6.0 с');
    expect(stairwellRule(DEFAULT_STAIRWELL)).toContain('3–5 звуков');
    expect(stairwellRule({ ...newStairwell(), sounds: [2, 2], floorsDown: [1, 1] })).toMatch(/2 звука .* на 1 этаж ниже/);
  });
});

describe('«Бесконечная лестница»: механика', () => {
  const spec = newStairwell();

  it('детерминизм: та же попытка и тот же игрок — те же события; расписание звуков — в interval', () => {
    const a = play(spec, createStairwell(spec, roll3), good);
    const b = play(spec, createStairwell(spec, roll3), good);
    expect(a.log).toEqual(b.log);
    expect(a.s).toEqual(b.s);
    for (let i = 0; i < 20; i++) {
      const d = soundDelay(spec, roll3, 0, i);
      expect(d).toBeGreaterThanOrEqual(spec.interval[0]);
      expect(d).toBeLessThanOrEqual(spec.interval[1]);
    }
  });

  it('первый звук — только когда игрок спустился от входа хотя бы на этаж', () => {
    const s = createStairwell(spec, roll3);
    const wait = s.nextSoundIn;
    // у двери и на полпути вниз — тишина сколько угодно
    for (const y of [0, 1.5, -1.5, -2.5]) {
      for (let k = 0; k < 64 * 120; k++) expect(stepStairwell(spec, s, DT, y)).toEqual([]);
    }
    expect(s.phase).toBe('calm');
    expect(s.nextSoundIn).toBe(wait);
    // этаж ниже — отсчёт пошёл, звук ровно через nextSoundIn
    const t0 = s.t;
    let at = -1;
    for (let k = 0; k < 64 * 60 && at < 0; k++) {
      const ev = stepStairwell(spec, s, DT, -STAIR_FLOOR_M);
      if (ev.some((e) => e.type === 'sound')) at = s.t - t0 - (s.threat?.t ?? 0);
    }
    expect(at).toBeCloseTo(wait, 9);
    expect(s.phase).toBe('threat');
    expect(s.threat!.y0).toBe(-STAIR_FLOOR_M);
  });

  it('шаг вниз после звука — Хвататель утаскивает (descended); оступиться на пару ступеней можно', () => {
    const stumble: Bot = (s, y) => (s.phase === 'threat' ? (y > (s.threat!.y0 - 0.5) ? DOWN : 0) : DOWN);
    const st = play(spec, createStairwell(spec, roll3), stumble);
    // постоял на 0.5 м ниже точки звука — не «пошёл вниз», а не успел (slow)
    expect(st.s.grabbedBy).toBe('slow');
    const down = play(spec, createStairwell(spec, roll3), () => DOWN);
    expect(down.s.phase).toBe('grabbed');
    expect(down.s.grabbedBy).toBe('descended');
    expect(kinds(down)).toEqual(['sound', 'grabbed']);
    // схватил, как только ушёл ниже y0 − 0.75 м: ~1.2 с при 0.625 м/с
    expect(down.s.threat!.t).toBeCloseTo(STAIR_DESCENT_M / -DOWN, 1);
    // терминально: дальше шаги ничего не делают
    expect(stepStairwell(spec, down.s, 1, 100)).toEqual([]);
  });

  it('стоять на месте после звука — захват через t* = accelS·(√(1 + 2·grabS/accelS) − 1)', () => {
    const still: Bot = (s) => (s.phase === 'threat' ? 0 : DOWN);
    const cases: [Partial<StairwellSpec>, number][] = [
      [{}, 6], // по умолчанию: 6·(√(1 + 3) − 1) = 6 с
      [{ grabS: 4, accelS: 2 }, 2 * (Math.sqrt(5) - 1)],
      [{ grabS: 10, accelS: 600 }, 600 * (Math.sqrt(1 + 20 / 600) - 1)], // почти без ускорения — почти grabS
      [{ grabS: 30, accelS: 0.5 }, 0.5 * (Math.sqrt(121) - 1)], // сильное ускорение — ≈ √(2·grabS·accelS)
    ];
    for (const [o, tStar] of cases) {
      const sp = { ...newStairwell(), ...o };
      expect(grabTime(sp)).toBeCloseTo(tStar, 9);
      expect(approachMeter(sp, tStar)).toBeCloseTo(1, 9);
      const p = play(sp, createStairwell(sp, roll3), still);
      expect(p.s.grabbedBy).toBe('slow');
      expect(p.s.threat!.t).toBeGreaterThanOrEqual(tStar - 1e-9);
      expect(p.s.threat!.t).toBeLessThan(tStar + DT + 1e-9);
      // приближение: растёт, события не реже раза в APPROACH_DT
      const ap = p.log.filter((x) => x.e.type === 'approach').map((x) => [x.t, (x.e as { meter: number }).meter]);
      expect(ap.length).toBeGreaterThanOrEqual(Math.floor(tStar / APPROACH_DT) - 1);
      for (let i = 1; i < ap.length; i++) {
        expect(ap[i][1]).toBeGreaterThan(ap[i - 1][1]);
        expect(ap[i][0] - ap[i - 1][0]).toBeLessThanOrEqual(APPROACH_DT + 1e-9);
      }
      // темп растёт: вторая половина пути к игроку короче первой
      const half = ap.find(([, m]) => m >= 0.5)![0] - p.log.find((x) => x.e.type === 'sound')!.t;
      expect(half).toBeGreaterThan(tStar / 2 - DT);
    }
  });

  it('медленный подъём — не успел (slow); подъём вовремя — пережил, следующий звук — только после спуска', () => {
    const slow = play(spec, createStairwell(spec, roll3), (s) => (s.phase === 'threat' ? 0.375 : DOWN));
    expect(slow.s.grabbedBy).toBe('slow'); // 2.8 м за 7.5 с > 6 с
    // успел и стоит наверху: звуков больше нет, сколько ни жди
    const s = createStairwell(spec, roll3);
    const camp = play(spec, s, (st) => (st.survived > 0 ? 0 : good(st, 0)), 600);
    expect(kinds(camp)).toEqual(['sound', 'survived']);
    expect(camp.log.find((x) => x.e.type === 'survived')!.e).toEqual({ type: 'survived', count: 1, needed: 3 });
    expect(s.phase).toBe('calm');
    expect(s.mark - camp.y).toBeCloseTo(0.2, 1); // отметка — этаж, куда поднялся (y0 + 3 м)
    // пошёл вниз — отсчёт пошёл снова
    const more = play(spec, s, good, 600, 0, camp.y);
    expect(kinds(more)).toEqual(['sound', 'survived', 'sound', 'survived', 'opened']);
  });

  it('пережил K звуков подряд — петля разомкнута (opened), дальше механика молчит', () => {
    for (const sounds of [1, 3, 7]) {
      const roll = { ...roll3, sounds };
      const p = play(spec, createStairwell(spec, roll), good);
      expect(p.s.phase).toBe('open');
      const k = kinds(p);
      expect(k.filter((x) => x === 'sound').length).toBe(sounds);
      expect(k.filter((x) => x === 'survived').length).toBe(sounds);
      expect(k[k.length - 1]).toBe('opened');
      expect(p.s.survived).toBe(sounds);
      expect(stepStairwell(spec, p.s, 100, -1000)).toEqual([]);
    }
    // ноль звуков (рукописный розыгрыш) — открыта сразу
    const z = createStairwell(spec, { ...roll3, sounds: 0 });
    expect(stepStairwell(spec, z, DT, 0)).toEqual([{ type: 'opened' }]);
  });

  it('после смерти — новая попытка с другим расписанием; розыгрыш тот же', () => {
    const sched = (a: number) => [0, 1, 2, 3, 4].map((i) => soundDelay(spec, roll3, a, i));
    const all = [0, 1, 2, 3].map(sched);
    for (let a = 0; a < all.length; a++) for (let b = a + 1; b < all.length; b++) expect(all[a]).not.toEqual(all[b]);
    const dead = play(spec, createStairwell(spec, roll3, 0), () => DOWN);
    expect(dead.s.phase).toBe('grabbed');
    const again = createStairwell(spec, dead.s.roll, dead.s.attempt + 1);
    expect(again).toMatchObject({ phase: 'calm', attempt: 1, survived: 0, threat: null, grabbedBy: null, mark: 0, roll: roll3 });
    expect(again.nextSoundIn).toBe(soundDelay(spec, roll3, 1, 0));
    const ok = play(spec, again, good);
    expect(ok.s.phase).toBe('open');
    const t0 = (p: Played) => p.log.find((x) => x.e.type === 'sound')!.t;
    expect(t0(ok)).not.toBeCloseTo(t0(dead), 3);
  });

  it('высота любая: ничего не зависит от номера этажа и числа этажей вниз', () => {
    // та же попытка, но вся лестница на 1024 этажа ниже (y и отметка входа сдвинуты) — те же события
    const a = play(spec, createStairwell(spec, roll3), good);
    const b = play(spec, createStairwell(spec, roll3), good, 900, -1024 * STAIR_FLOOR_M);
    expect(b.log.map((x) => x.e)).toEqual(a.log.map((x) => x.e));
    expect(b.log.map((x) => x.t)).toEqual(a.log.map((x) => x.t));
    // floorsDown механику не меняет
    const c = play(spec, createStairwell(spec, { ...roll3, floorsDown: 50 }), good);
    expect(c.log).toEqual(a.log);
    // длинная петля: 15 звуков — десятки этажей вниз без пределов
    const sp = { ...newStairwell(), interval: [5, 10] as [number, number] };
    const long = play(sp, createStairwell(sp, { ...roll3, sounds: 15 }), good, 3600);
    expect(long.s.phase).toBe('open');
    expect(long.minY).toBeLessThan(-30);
  });

  it('большой dt: звук внутри шага, остаток — уже угроза', () => {
    const s = createStairwell(spec, roll3);
    const ev = stepStairwell(spec, s, s.nextSoundIn + 1, -10);
    expect(ev.map((e) => e.type)).toEqual(['sound', 'approach']);
    expect(ev[0]).toEqual({ type: 'sound', index: 1 });
    expect((ev[1] as { meter: number }).meter).toBeCloseTo(approachMeter(spec, 1), 9);
    expect(s.threat!.t).toBeCloseTo(1, 9);
    // мусор во входе — без изменений
    const t = s.t;
    expect(stepStairwell(spec, s, NaN, -10)).toEqual([]);
    expect(stepStairwell(spec, s, 1, NaN)).toEqual([]);
    expect(s.t).toBe(t);
  });
});
