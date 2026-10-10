// Предметы в руке: П-2 (заряд, яркость, мигание, лампочка, R, удлинение тубуса), «Жучок» (качание: свет, частота,
// стамина, шум, затухание, износ), спички (обычные — гаснут на бегу и в воде, охотничьи — нет; смена ячейки гасит),
// зиппа (ход тусклее, бег гасит, обвалы ×2, керосин/фитиль), керосинка (горит, пока on !== false), свет на полу, ЛКМ.
import { describe, expect, it } from 'vitest';
import { newHotbar, select, type Hotbar, type Slot } from './hotbar';
import {
  BUG_BANK_S, BUG_I0, BUG_STAMINA, BUG_STAMINA_RATE, collapseMul, isLit, lightLeftS, lightOf, lightOnFloor, newHandTr,
  onDrop, p2Brightness, pressF, pump, reload, stepHand, stepHeld, strike, toggleLight, useHeld, ZIPPO_INTENSITY,
  ZIPPO_MOVE_MUL, type HandTr, type UseCtx, type UseEvent,
} from './itemUse';

const STILL: UseCtx = { sprinting: false, moving: false, inWater: false };
const WALK: UseCtx = { sprinting: false, moving: true, inWater: false };
const RUN: UseCtx = { sprinting: true, moving: true, inWater: false };
const WET: UseCtx = { sprinting: false, moving: true, inWater: true };

/** держать ячейку s секунд (шаги по 0.5 с): ячейка, события, часы */
function hold(slot: Slot | null, s: number, ctx: UseCtx = STILL, tr: HandTr = newHandTr()) {
  const events: UseEvent[] = [];
  for (let t = 0; t < s - 1e-9; t += 0.5) {
    const r = stepHeld(slot, Math.min(0.5, s - t), ctx, tr);
    slot = r.slot;
    tr = r.tr;
    events.push(...r.events);
  }
  return { slot, tr, events };
}
/** то же для всей руки */
function hand(h: Hotbar, s: number, ctx: UseCtx = STILL, tr: HandTr = newHandTr(), step = 0.5) {
  const events: UseEvent[] = [];
  for (let t = 0; t < s - 1e-9; t += step) {
    const r = stepHand(h, Math.min(step, s - t), ctx, tr);
    h = r.h;
    tr = r.tr;
    events.push(...r.events);
  }
  return { h, tr, events };
}

describe('П-2', () => {
  const p2: Slot = { item: 'it_flashlight', on: true, q: 1 };

  it('полный заряд — 10 минут света (с тубусом — 15), лампочка изнашивается', () => {
    const half = hold(p2, 300);
    expect(half.slot!.q).toBeCloseTo(0.5, 5);
    expect(half.slot!.w).toBeCloseTo(300 / 900, 5);
    expect(half.events).toEqual([]);
    const dead = hold(p2, 601);
    expect(dead.slot!.q).toBe(0);
    expect(dead.events).toEqual(['empty']);
    expect(isLit(dead.slot)).toBe(false);
    expect(lightOf(dead.slot, STILL)).toBeNull();
    const tube = hold({ ...p2, u: 1 }, 600);
    expect(tube.slot!.q).toBeCloseTo(1 / 3, 5);
    // выключенный не тратится; отсутствующие q/w — свежий
    expect(hold({ item: 'it_flashlight', on: false }, 60).slot).toEqual({ item: 'it_flashlight', on: false });
    expect(lightLeftS({ item: 'it_flashlight' })).toBe(600);
    expect(lightLeftS({ item: 'it_flashlight', u: 1 })).toBe(900);
  });

  it('яркость по заряду, ниже 12 % мигает; луч', () => {
    const full = lightOf(p2, STILL)!;
    expect(full.kind).toBe('spot');
    expect(full.intensity).toBe(1);
    const mid = lightOf({ ...p2, q: 0.5 }, STILL)!;
    expect(mid.intensity).toBeCloseTo(p2Brightness(0.5));
    expect(mid.intensity).toBeLessThan(1);
    expect(mid.range).toBeLessThan(full.range);
    const seen = new Set<number>();
    for (let t = 0; t < 3; t += 0.07) seen.add(Math.round(lightOf({ ...p2, q: 0.05 }, STILL, { ...newHandTr(), t })!.intensity * 1000));
    expect(seen.size).toBeGreaterThan(3);
    expect(Math.max(...seen) / 1000).toBeLessThanOrEqual(p2Brightness(0.05) + 1e-9);
  });

  it('лампочка перегорает (w ≥ 1): событие burnout, свет выключен', () => {
    const r = hold({ ...p2, w: 0.999 }, 1);
    expect(r.events).toEqual(['burnout']);
    expect(r.slot).toMatchObject({ on: false, w: 1 });
    expect(lightOf(r.slot, STILL)).toBeNull();
    expect(toggleLight(newHotbar([r.slot!])).msg).toMatch(/Лампочка перегорела/);
  });

  it('R: перегорела и есть лампочка — вкрутить; иначе батарейки (2, с тубусом 3); чего нет — msg', () => {
    const burnt = newHotbar([{ ...p2, on: false, w: 1, q: 0.3 }, { item: 'it_bulb', n: 2 }, { item: 'it_batteries', n: 2 }]);
    const a = reload(burnt);
    expect(a.done).toEqual(['bulb']);
    expect(a.h.slots[0]).toMatchObject({ w: 0, q: 0.3 });
    expect(a.h.slots[1]).toEqual({ item: 'it_bulb' });
    const b = reload(a.h);
    expect(b.done).toEqual(['batteries']);
    expect(b.h.slots[0]).toMatchObject({ w: 0, q: 1 });
    expect(b.h.slots[2]).toBeNull();
    expect(reload(b.h)).toEqual({ h: b.h, done: [], msg: 'Батарейки свежие' });
    // мало батареек
    const one = newHotbar([{ ...p2, q: 0.2 }, { item: 'it_batteries' }]);
    expect(reload(one)).toEqual({ h: one, done: [], msg: 'Нужно 2 батарейки D' });
    const tube = newHotbar([{ ...p2, q: 0.2, u: 1 }, { item: 'it_batteries', n: 2 }]);
    expect(reload(tube).msg).toBe('Нужно 3 батарейки D');
    expect(reload(newHotbar([{ ...p2, q: 0.2, u: 1 }, { item: 'it_batteries', n: 4 }])).h.slots[1]).toEqual({ item: 'it_batteries' });
    // перегорела, лампочки нет, заряд полон
    expect(reload(newHotbar([{ ...p2, w: 1 }])).msg).toMatch(/Лампочка перегорела/);
  });

  it('вкл/выкл: села батарея — msg; ЛКМ с удлинением тубуса — апгрейд (заряд × 2/3), второй раз — msg', () => {
    const h = newHotbar([{ ...p2, on: false }]);
    expect(toggleLight(h).h.slots[0]?.on).toBe(true);
    expect(toggleLight(toggleLight(h).h).h.slots[0]?.on).toBe(false);
    expect(toggleLight(newHotbar([{ ...p2, on: false, q: 0 }])).msg).toMatch(/Батарейки сели/);
    const up = useHeld(newHotbar([p2, { item: 'it_tube_ext' }, { item: 'it_tube_ext' }]));
    expect(up.h.slots[0]).toMatchObject({ u: 1 });
    expect(up.h.slots[0]!.q).toBeCloseTo(2 / 3);
    expect(up.h.slots[1]).toBeNull();
    expect(up.msg).toMatch(/Тубус удлинён/);
    const again = useHeld(up.h);
    expect(again.msg).toBe('Тубус уже удлинён');
    expect(again.h).toBe(up.h);
    // без детали — подсказка
    expect(useHeld(newHotbar([p2])).msg).toMatch(/F — свет/);
  });

  it('на полу горящий П-2 светит, выключенный — нет; на полу не тратится', () => {
    expect(lightOnFloor(p2)?.kind).toBe('spot');
    expect(lightOnFloor({ ...p2, on: false })).toBeNull();
    expect(onDrop(p2)).toBe(p2);
  });
});

describe('«Жучок»', () => {
  const bug: Slot = { item: 'it_bug_flash' };

  it('нажатие: +2 с света, базовая яркость, стамина и шум; потом гаснет за 2 с', () => {
    const p = pump(bug, newHandTr());
    expect(p.staminaCost).toBeCloseTo(BUG_STAMINA);
    expect(p.noise).toBe(0.8);
    expect(lightOf(bug, STILL, p.tr)).toMatchObject({ kind: 'spot', intensity: BUG_I0 });
    const lit = hold(bug, 1.5, STILL, p.tr);
    expect(lightOf(lit.slot, STILL, lit.tr)!.intensity).toBeCloseTo(BUG_I0);
    const fading = hold(lit.slot, 1.5, STILL, lit.tr); // t = 3: 1 с затухания
    expect(lightOf(fading.slot, STILL, fading.tr)!.intensity).toBeCloseTo(BUG_I0 / 2);
    const out = hold(fading.slot, 1.5, STILL, fading.tr);
    expect(lightOf(out.slot, STILL, out.tr)).toBeNull();
    // не «Жучок» — ничего
    expect(pump({ item: 'it_flashlight' }, newHandTr()).staminaCost).toBe(0);
  });

  it('частые нажатия — ярче и дороже по стамине; запас света ограничен', () => {
    let tr = newHandTr();
    const costs: number[] = [];
    for (let k = 0; k < 6; k++) {
      const p = pump(bug, tr);
      costs.push(p.staminaCost);
      tr = stepHeld(bug, 0.3, STILL, p.tr).tr;
    }
    costs.forEach((c, k) => expect(c).toBeCloseTo(BUG_STAMINA + BUG_STAMINA_RATE * k));
    expect(lightOf(bug, STILL, tr)!.intensity).toBeCloseTo(1);
    expect(tr.bug!.until - tr.t).toBeLessThanOrEqual(BUG_BANK_S);
    // перестал качать — частота падает, яркость — к базовой
    const later = hold(bug, 3.5, STILL, tr);
    expect(lightOf(later.slot, STILL, later.tr)!.intensity).toBeCloseTo(BUG_I0);
  });

  it('лампочка изнашивается только пока светит; 15 мин — мёртв навсегда', () => {
    const p = pump(bug, newHandTr());
    const r = hold(bug, 10, STILL, p.tr);
    expect(r.slot!.w).toBeCloseTo(2 / 900, 6);
    const dying = pump({ item: 'it_bug_flash', w: 0.9999 }, newHandTr());
    const d = hold({ item: 'it_bug_flash', w: 0.9999 }, 1, STILL, dying.tr);
    expect(d.events).toEqual(['burnout']);
    expect(d.slot!.w).toBe(1);
    const dead = pump(d.slot, d.tr);
    expect(dead).toMatchObject({ staminaCost: 0, noise: 0 });
    expect(dead.msg).toMatch(/перегорела/);
    expect(lightOf(d.slot, STILL, dead.tr)).toBeNull();
    expect(reload(newHotbar([d.slot!, { item: 'it_bulb' }])).done).toEqual([]);
  });

  it('F качает (через pressF); сменил ячейку — гаснет', () => {
    const h = newHotbar([bug, { item: 'it_bread' }]);
    const f = pressF(h, STILL, newHandTr());
    expect(f.staminaCost).toBeCloseTo(BUG_STAMINA);
    expect(f.noise).toBe(0.8);
    expect(f.h).toBe(h);
    const away = stepHand(select(h, 1), 0.1, STILL, f.tr);
    expect(away.tr.bug).toBeNull();
  });
});

describe('спички', () => {
  it('чиркнуть: одна из коробка, 6 с слабого света, догорела — match_out', () => {
    const h = newHotbar([{ item: 'it_matches', n: 5 }]);
    const s = strike(h, newHandTr(), STILL);
    expect(s.h.slots[0]).toEqual({ item: 'it_matches', n: 4 });
    const l = lightOf(s.h.slots[0], STILL, s.tr)!;
    expect(l.kind).toBe('point');
    expect(l.range).toBe(3.5);
    expect(l.intensity).toBeGreaterThan(0.4);
    expect(l.intensity).toBeLessThanOrEqual(0.5);
    const r = hand(s.h, 5.5, WALK, s.tr);
    expect(r.events).toEqual([]);
    expect(lightOf(r.h.slots[0], WALK, r.tr)).not.toBeNull();
    const end = hand(r.h, 1, WALK, r.tr);
    expect(end.events).toEqual(['match_out']);
    expect(lightOf(end.h.slots[0], WALK, end.tr)).toBeNull();
  });

  it('обычная гаснет на бегу и в воде, не зажигается там же (спичка не тратится)', () => {
    const h = newHotbar([{ item: 'it_matches', n: 2 }]);
    const s = strike(h, newHandTr(), STILL);
    expect(hand(s.h, 0.5, RUN, s.tr).events).toEqual(['blown', 'match_out']);
    expect(hand(s.h, 0.5, WET, s.tr).events).toEqual(['drowned', 'match_out']);
    expect(strike(h, newHandTr(), WET)).toMatchObject({ h, msg: 'В воде спичку не зажечь' });
    expect(strike(h, newHandTr(), RUN).h).toBe(h);
  });

  it('охотничья: 15 с, совсем тускло, не гаснет ни на бегу, ни в воде', () => {
    const h = newHotbar([{ item: 'it_hunt_matches' }]);
    const s = strike(h, newHandTr(), WET);
    expect(s.h.slots[0]).toBeNull(); // последняя — коробок пуст, спичка в руке горит
    const l = lightOf(null, RUN, s.tr)!;
    expect(l.range).toBe(2.5);
    expect(l.intensity).toBeLessThanOrEqual(0.3);
    const r = hand(s.h, 14.5, RUN, s.tr);
    expect(r.events).toEqual([]);
    expect(hand(r.h, 1, WET, r.tr).events).toEqual(['match_out']);
  });

  it('сменил ячейку — спичка гаснет; F по горящей — задуть', () => {
    const h = newHotbar([{ item: 'it_matches', n: 3 }, { item: 'it_bread' }]);
    const s = pressF(h, STILL, newHandTr());
    expect(s.tr.match).not.toBeNull();
    expect(stepHand(select(s.h, 1), 0.1, STILL, s.tr).events).toEqual(['match_out']);
    const off = pressF(s.h, STILL, s.tr);
    expect(off.tr.match).toBeNull();
    expect(off.h).toBe(s.h);
  });
});

describe('зиппа и керосинка', () => {
  const zippo: Slot = { item: 'it_zippo', on: true };

  it('зиппа: тусклая, на ходу ×0.6, бег гасит; обвалы ×2, пока горит', () => {
    const still = lightOf(zippo, STILL)!;
    expect(still.kind).toBe('point');
    expect(still.range).toBe(4);
    expect(still.intensity).toBeLessThanOrEqual(ZIPPO_INTENSITY);
    expect(lightOf(zippo, WALK)!.intensity).toBeCloseTo(still.intensity * ZIPPO_MOVE_MUL);
    expect(collapseMul(newHotbar([zippo]))).toBe(2);
    expect(collapseMul(newHotbar([{ ...zippo, on: false }]))).toBe(1);
    expect(collapseMul(select(newHotbar([zippo]), 1))).toBe(1);
    const r = hold(zippo, 0.5, RUN);
    expect(r.events).toEqual(['blown']);
    expect(r.slot?.on).toBe(false);
    expect(toggleLight(newHotbar([r.slot!]), 0, RUN).msg).toBe('На бегу не зажечь');
    expect(toggleLight(newHotbar([r.slot!]), 0, WALK).h.slots[0]?.on).toBe(true);
  });

  it('зиппа: керосин на 6 мин, фитиль на 10 мин; кончилось — гаснет с событием', () => {
    const fuel = hold(zippo, 361, WALK);
    expect(fuel.events).toEqual(['out_fuel']);
    expect(fuel.slot).toMatchObject({ on: false, q: 0 });
    expect(fuel.slot!.w).toBeCloseTo(0.6, 2);
    expect(toggleLight(newHotbar([fuel.slot!])).msg).toMatch(/Нет керосина/);
    const wick = hold({ ...zippo, w: 0.99 }, 6.5);
    expect(wick.events).toEqual(['out_wick']);
    expect(toggleLight(newHotbar([wick.slot!])).msg).toMatch(/Фитиль выгорел/);
  });

  it('керосинка: без on — горит (как в общаге), хороший круговой свет 12 мин; на полу светит', () => {
    const lamp: Slot = { item: 'it_kerolamp' };
    expect(isLit(lamp)).toBe(true);
    const l = lightOf(lamp, RUN)!;
    expect(l).toMatchObject({ kind: 'point', range: 6 });
    expect(l.intensity).toBeGreaterThan(0.7);
    expect(lightOnFloor(lamp)).toMatchObject({ kind: 'point', range: 6 });
    expect(hold(lamp, 10, RUN).events).toEqual([]);
    const out = hold(lamp, 721);
    expect(out.events).toEqual(['out_fuel']);
    expect(out.slot?.on).toBe(false);
    expect(lightOnFloor(out.slot)).toBeNull();
    // F: горит → выкл, выкл → вкл
    expect(toggleLight(newHotbar([lamp])).h.slots[0]?.on).toBe(false);
    expect(toggleLight(newHotbar([{ ...lamp, on: false }])).h.slots[0]?.on).toBe(true);
  });

  it('на пол: зиппа гаснет и не светит; спички — не светят', () => {
    expect(onDrop(zippo)).toEqual({ item: 'it_zippo', on: false });
    expect(lightOnFloor(zippo)).toBeNull();
    expect(lightOnFloor({ item: 'it_matches', n: 3 })).toBeNull();
  });

  it('R: керосин из канистры (−0.25, пустая исчезает) и фитиль из верёвки (если выгорел ≥ 50 %); чего нет — msg', () => {
    const h = newHotbar([{ item: 'it_zippo', q: 0.2, w: 0.6 }, { item: 'it_kerosene' }, { item: 'it_wick', n: 2 }]);
    const a = reload(h);
    expect(a.done).toEqual(['fuel', 'wick']);
    expect(a.msg).toBeUndefined();
    expect(a.h.slots[0]).toMatchObject({ q: 1, w: 0 });
    expect(a.h.slots[1]).toEqual({ item: 'it_kerosene', q: 0.75 });
    expect(a.h.slots[2]).toEqual({ item: 'it_wick' });
    expect(reload(a.h)).toEqual({ h: a.h, done: [], msg: 'Заправлено' });
    // самая пустая канистра, последняя четверть — канистра исчезает
    const last = reload(newHotbar([{ item: 'it_kerolamp', q: 0.5 }, { item: 'it_kerosene', q: 0.25 }, { item: 'it_kerosene' }]));
    expect(last.h.slots[1]).toBeNull();
    expect(last.h.slots[2]).toEqual({ item: 'it_kerosene' });
    // фитиль чуть обгорел — верёвку не тратим
    const light = newHotbar([{ item: 'it_zippo', w: 0.3 }, { item: 'it_wick' }]);
    expect(reload(light)).toEqual({ h: light, done: [], msg: 'Заправлено' });
    const none = newHotbar([{ item: 'it_zippo', q: 0, w: 1 }]);
    expect(reload(none).msg).toBe('Нужны керосин и шпонная верёвка');
    expect(reload(newHotbar([{ item: 'it_zippo', q: 0 }])).msg).toBe('Нужен керосин');
    expect(reload(newHotbar([{ item: 'it_zippo', w: 1 }])).msg).toBe('Нужна шпонная верёвка');
  });
});

describe('ЛКМ и рука', () => {
  it('еда — съесть одну (fx), карты — нужен напарник, сумка — надеть, прочее — подсказка', () => {
    const food = useHeld(newHotbar([{ item: 'it_bubble' }]));
    expect(food.fx).toBe('it_bubble');
    expect(food.h.slots[0]).toBeNull();
    const cards = useHeld(newHotbar([{ item: 'it_cards' }]));
    expect(cards).toMatchObject({ needPartner: true });
    expect(cards.h.slots[0]).toEqual({ item: 'it_cards' });
    const bag = useHeld(newHotbar([{ item: 'it_backpack' }, { item: 'it_sack' }]));
    expect(bag.wear).toBe(true);
    expect(bag.h.back?.slots).toHaveLength(10);
    expect(useHeld(select(bag.h, 1)).msg).toBe('На спине уже есть сумка');
    expect(useHeld(newHotbar([{ item: 'it_kopeyki', n: 7 }])).msg).toMatch(/валюта/);
    expect(useHeld(newHotbar([{ item: 'it_sticker' }])).msg).toMatch(/продажу/);
    expect(useHeld(newHotbar([{ item: 'it_batteries' }])).msg).toMatch(/П-2/);
    const empty = newHotbar();
    expect(useHeld(empty)).toEqual({ h: empty });
    expect(useHeld(newHotbar([{ item: 'it_detector' }])).msg).toBeUndefined();
  });

  it('stepHand: ничего не горит — тот же хотбар; горящий П-2 правит выбранную ячейку', () => {
    const idle = newHotbar([{ item: 'it_bread' }, { item: 'it_flashlight', on: true }]);
    const r = stepHand(idle, 0.5, STILL, newHandTr());
    expect(r.h).toBe(idle);
    expect(r.tr.t).toBe(0.5);
    const lit = hand(select(idle, 1), 30);
    expect(lit.h.slots[1]!.q).toBeCloseTo(1 - 30 / 600, 5);
    expect(lit.h.slots[0]).toBe(idle.slots[0]);
  });
});
