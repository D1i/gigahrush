// Хотбар игрока: положить (стеки, сумка, остаток) / вынуть / отделить штуку / выбрать / колесо / сумка на спине /
// переложить / посчитать / потратить / сохранение (v1 → v2, мусор → null). Модель неизменяемая.
import { describe, expect, it } from 'vitest';
import {
  add, bagSpeed, consume, count, cycle, fromBag, held, HOTBAR_SIZE, hotbarJSON, move, newHotbar, parseHotbar, patch,
  select, START_KIT, take, takeOne, toBag, unwear, wear, type Hotbar,
} from './hotbar';

const items = (h: Hotbar) => h.slots.map((s) => s?.item ?? null);
const bagItems = (h: Hotbar) => h.back?.slots.map((s) => (s ? `${s.item}${s.n ? '×' + s.n : ''}` : null));
/** хотбар с надетой сумкой item */
const withBag = (h: Hotbar, item = 'it_briefcase'): Hotbar => {
  const a = add(h, { item })!;
  return wear(a.h, a.at).h!;
};

describe('hotbar', () => {
  it('новый: набор старта — П-2 (вкл, свежий), 2 батарейки, 5 спичек; выбрана первая', () => {
    const h = newHotbar(START_KIT);
    expect(h.slots).toHaveLength(HOTBAR_SIZE);
    expect(h.sel).toBe(0);
    expect(held(h)).toEqual({ item: 'it_flashlight', on: true, q: 1 });
    expect(h.slots[1]).toEqual({ item: 'it_batteries', n: 2 });
    expect(h.slots[2]).toEqual({ item: 'it_matches', n: 5 });
    expect(items(h)).toEqual(['it_flashlight', 'it_batteries', 'it_matches', null, null]);
    expect(h.back).toBeUndefined();
    // набор не общий с хотбаром
    expect(h.slots[0]).not.toBe(START_KIT[0]);
    expect(newHotbar().slots.every((s) => s === null)).toBe(true);
    // лишнее сверх HOTBAR_SIZE и негодное — отброшено
    const many = newHotbar([...Array.from({ length: 7 }, (_, i) => ({ item: `it_${i}` })), { item: '' }]);
    expect(items(many)).toEqual(['it_0', 'it_1', 'it_2', 'it_3', 'it_4']);
  });

  it('ячейка: n целое 1…999 (1 не хранится), q/w обрезаны 0…1, u целое 0…255, прочее отброшено', () => {
    const h = newHotbar([
      { item: 'a', n: 1, q: 1.5, w: -2, u: 3 },
      { item: 'b', n: 5000, q: NaN, w: 0.25, u: 300 },
      { item: 'c', n: 2.7, u: 1.5 },
      { item: 'd', n: 0, q: 0.5 },
    ]);
    expect(h.slots.slice(0, 4)).toEqual([
      { item: 'a', q: 1, w: 0, u: 3 },
      { item: 'b', n: 999, w: 0.25 },
      { item: 'c', n: 2 },
      { item: 'd', q: 0.5 },
    ]);
  });

  it('add: в выбранную, если пуста, иначе в первую пустую; полно — null; старый не меняется', () => {
    const h0 = select(newHotbar([{ item: 'it_flashlight', on: true }]), 2);
    const a = add(h0, { item: 'it_bread' })!;
    expect(a).toMatchObject({ at: 2, bagAt: -1, left: 0 });
    expect(items(a.h)).toEqual(['it_flashlight', null, 'it_bread', null, null]);
    expect(items(h0)).toEqual(['it_flashlight', null, null, null, null]);
    // выбранная занята — первая пустая
    const b = add(a.h, { item: 'it_knife' })!;
    expect(b.at).toBe(1);
    expect(b.h.sel).toBe(2);
    let h = b.h;
    for (const it of ['it_a', 'it_b']) h = add(h, { item: it })!.h;
    expect(items(h)).toEqual(['it_flashlight', 'it_knife', 'it_bread', 'it_a', 'it_b']);
    expect(add(h, { item: 'it_c' })).toBeNull();
    expect(add(newHotbar(), { item: '' })).toBeNull();
  });

  it('add: стеки — долить тот же предмет с тем же состоянием до предела, остаток — в пустую, не влезло — left', () => {
    const h0 = newHotbar(START_KIT);
    // батарейки (стек 6): 2 + 3 → одна ячейка ×5
    const a = add(h0, { item: 'it_batteries', n: 3 })!;
    expect(a).toMatchObject({ at: 1, left: 0 });
    expect(a.h.slots[1]).toEqual({ item: 'it_batteries', n: 5 });
    // ещё 4: до 6 в ячейке 1, 3 — в пустую (выбрана 0 — занята → первая пустая 3)
    const b = add(a.h, { item: 'it_batteries', n: 4 })!;
    expect(b.h.slots[1]).toEqual({ item: 'it_batteries', n: 6 });
    expect(b.h.slots[3]).toEqual({ item: 'it_batteries', n: 3 });
    expect(count(b.h, 'it_batteries')).toBe(9);
    // другое состояние (q) — не складывается
    const c = add(b.h, { item: 'it_batteries', q: 0.5 })!;
    expect(c.at).toBe(4);
    // копейки: стек 999 — 1200 штук в две ячейки… а места нет: всё полно, кроме доливки
    const full = add(c.h, { item: 'it_kopeyki', n: 1200 });
    expect(full).toBeNull();
    // хлеб — стек 1: три штуки в три ячейки, не влезли две — left
    const d = add(newHotbar([{ item: 'x1' }, { item: 'x2' }, { item: 'x3' }, { item: 'x4' }]), { item: 'it_bread', n: 3 })!;
    expect(d).toMatchObject({ at: 4, left: 2 });
    expect(d.h.slots[4]).toEqual({ item: 'it_bread' });
    // не из каталога — не складывается
    const e = add(newHotbar([{ item: 'zz' }]), { item: 'zz' })!;
    expect(items(e.h)).toEqual(['zz', 'zz', null, null, null]);
  });

  it('add: хотбар полон — в сумку; стеки в сумке тоже доливаются', () => {
    const h = withBag(newHotbar([{ item: 'x1' }, { item: 'x2' }, { item: 'x3' }, { item: 'x4' }]));
    expect(h.back?.item).toBe('it_briefcase');
    expect(h.back?.slots).toHaveLength(5);
    const full = add(h, { item: 'x5' })!.h;
    const a = add(full, { item: 'it_matches', n: 30 })!;
    expect(a).toMatchObject({ at: -1, bagAt: 0, left: 0 });
    expect(bagItems(a.h)).toEqual(['it_matches×30', null, null, null, null]);
    const b = add(a.h, { item: 'it_matches', n: 15 })!;
    expect(bagItems(b.h)).toEqual(['it_matches×40', 'it_matches×5', null, null, null]);
    expect(count(b.h, 'it_matches')).toBe(45);
  });

  it('take: весь стек; takeOne — одну штуку, ячейка пустеет на последней', () => {
    const h0 = newHotbar(START_KIT);
    const t = take(h0);
    expect(t.slot).toEqual({ item: 'it_flashlight', on: true, q: 1 });
    expect(held(t.h)).toBeNull();
    expect(held(h0)).not.toBeNull();
    const e = take(t.h);
    expect(e.slot).toBeNull();
    expect(e.h).toBe(t.h);
    expect(take(h0, 7)).toEqual({ h: h0, slot: null });
    expect(take(h0, -1).slot).toBeNull();
    expect(take(h0, 1).slot).toEqual({ item: 'it_batteries', n: 2 });
    const o1 = takeOne(h0, 1);
    expect(o1.slot).toEqual({ item: 'it_batteries' });
    expect(o1.h.slots[1]).toEqual({ item: 'it_batteries' });
    const o2 = takeOne(o1.h, 1);
    expect(o2.h.slots[1]).toBeNull();
    expect(takeOne(o2.h, 1)).toEqual({ h: o2.h, slot: null });
    // из сумки
    const b = add(withBag(newHotbar([{ item: 'x1' }, { item: 'x2' }, { item: 'x3' }, { item: 'x4' }])), { item: 'x5' })!.h;
    const c = add(b, { item: 'it_wick', n: 3 })!.h;
    const o3 = takeOne(c, 0, true);
    expect(o3.slot).toEqual({ item: 'it_wick' });
    expect(bagItems(o3.h)![0]).toBe('it_wick×2');
  });

  it('select и cycle: выбор в диапазоне, колесо по кругу, сумка остаётся', () => {
    const h = newHotbar(START_KIT);
    expect(select(h, 4).sel).toBe(4);
    expect(select(h, 5)).toBe(h);
    expect(select(h, -1)).toBe(h);
    expect(select(h, 1.5)).toBe(h);
    expect(select(h, 0)).toBe(h);
    expect(cycle(h, 1).sel).toBe(1);
    expect(cycle(h, -1).sel).toBe(HOTBAR_SIZE - 1);
    expect(cycle(select(h, HOTBAR_SIZE - 1), 1).sel).toBe(0);
    let c = h;
    for (let i = 0; i < HOTBAR_SIZE; i++) c = cycle(c, 1);
    expect(c.sel).toBe(0);
    expect(h.sel).toBe(0);
    const b = withBag(h);
    expect(select(b, 3).back).toBe(b.back);
    expect(cycle(b, 1).back).toBe(b.back);
  });

  it('patch: переключить фонарь, заряд; пустая ячейка / негодное — без изменений', () => {
    const h = newHotbar(START_KIT);
    const off = patch(h, 0, { on: false });
    expect(held(off)).toEqual({ item: 'it_flashlight', on: false, q: 1 });
    expect(held(h)?.on).toBe(true);
    expect(held(patch(h, 0, { on: undefined, q: undefined }))).toEqual({ item: 'it_flashlight' });
    expect(held(patch(h, 0, { q: 0.3, w: 2 }))).toEqual({ item: 'it_flashlight', on: true, q: 0.3, w: 1 });
    expect(patch(h, 3, { on: true })).toBe(h);
    expect(patch(h, 9, { on: true })).toBe(h);
    expect(patch(h, 0, { item: '' })).toBe(h);
  });

  it('сумка: надеть (только на пустую спину), снять — только пустую, скорость мешка', () => {
    const h0 = add(newHotbar(START_KIT), { item: 'it_sack' })!.h;
    expect(wear(h0, 0)).toEqual({ h: null, msg: 'Это не сумка' });
    expect(wear(h0, 4).h).toBeNull();
    const w = wear(h0, 3);
    expect(w.h).not.toBeNull();
    const h = w.h!;
    expect(h.slots[3]).toBeNull();
    expect(h.back).toEqual({ item: 'it_sack', slots: [null, null, null] });
    expect(bagSpeed(h)).toBe(0.85);
    expect(bagSpeed(h0)).toBe(1);
    // вторая сумка — нельзя
    const two = add(h, { item: 'it_backpack' })!;
    expect(wear(two.h, two.at)).toEqual({ h: null, msg: 'На спине уже есть сумка' });
    // непустую — не снять
    const filled = toBag(h, 2).h!;
    expect(unwear(filled)).toEqual({ h: null, msg: 'Сначала выложи вещи' });
    // пустую — в хотбар (выбранная занята → первая пустая)
    const off = unwear(h);
    expect(off.h?.back).toBeUndefined();
    expect(off.h?.slots[3]).toEqual({ item: 'it_sack' });
    expect(unwear(newHotbar()).h).toBeNull();
    // хотбар полон — некуда
    const fullBar = withBag(newHotbar([{ item: 'x1' }, { item: 'x2' }, { item: 'x3' }, { item: 'x4' }]), 'it_sack');
    expect(unwear(add(fullBar, { item: 'x5' })!.h).msg).toBe('Некуда положить сумку');
  });

  it('toBag / fromBag / move: переложить, обмен, долить стек; нет сумки / полна — msg', () => {
    expect(toBag(newHotbar(START_KIT), 0)).toEqual({ h: null, msg: 'Нет сумки' });
    const h = withBag(newHotbar(START_KIT), 'it_sack');
    expect(toBag(h, 4).msg).toBe('Пусто');
    const a = toBag(h, 2).h!; // спички → сумка[0]
    expect(a.slots[2]).toBeNull();
    expect(bagItems(a)).toEqual(['it_matches×5', null, null]);
    // add доливает стек в сумке
    const b0 = add(a, { item: 'it_matches', n: 2 })!;
    expect(b0).toMatchObject({ at: -1, bagAt: 0, left: 0 });
    expect(bagItems(b0.h)).toEqual(['it_matches×7', null, null]);
    // toBag без j доливает стек сумки
    const sack = (bag: Hotbar['slots'], bar: Hotbar['slots']): Hotbar => ({ slots: bar, sel: 0, back: { item: 'it_sack', slots: bag } });
    const b = toBag(sack([{ item: 'it_matches', n: 5 }, null, null], [null, { item: 'it_batteries', n: 2 }, { item: 'it_matches', n: 3 }, null, null]), 2).h!;
    expect(b.slots[2]).toBeNull();
    expect(bagItems(b)).toEqual(['it_matches×8', null, null]);
    // обмен: батарейки (хотбар 1) ↔ спички (сумка 0)
    const c = toBag(b, 1, 0).h!;
    expect(c.slots[1]).toEqual({ item: 'it_matches', n: 8 });
    expect(bagItems(c)).toEqual(['it_batteries×2', null, null]);
    // fromBag без i: выбранная (0) пуста — туда
    const d = fromBag(c, 0).h!;
    expect(d.slots[0]).toEqual({ item: 'it_batteries', n: 2 });
    expect(bagItems(d)).toEqual([null, null, null]);
    expect(fromBag(d, 0).msg).toBe('Пусто');
    // fromBag в ячейку i с тем же стеком — долить до предела (6), остаток — в сумке; дальше — «Стопка полна»
    const e = fromBag(sack([{ item: 'it_batteries', n: 3 }, null, null], [null, null, { item: 'it_batteries', n: 4 }, null, null]), 0, 2).h!;
    expect(e.slots[2]).toEqual({ item: 'it_batteries', n: 6 });
    expect(bagItems(e)).toEqual(['it_batteries', null, null]);
    expect(fromBag(e, 0, 2).msg).toBe('Стопка полна');
    // сумка полна
    let f = withBag(newHotbar([{ item: 'q1' }, { item: 'q2' }, { item: 'q3' }, { item: 'q4' }]), 'it_sack');
    for (let i = 0; i < 3; i++) f = toBag(f, i).h!;
    expect(toBag(f, 3).msg).toBe('Сумка полна');
    // руки полны
    let g = f;
    for (const it of ['z', 'y', 'v', 'u']) g = add(g, { item: it })!.h;
    expect(items(g).every(Boolean)).toBe(true);
    expect(fromBag(g, 0).msg).toBe('Руки полны');
    // move внутри хотбара — переложить / обмен
    const m = move(newHotbar(START_KIT), { bag: false, i: 0 }, { bag: false, i: 4 }).h!;
    expect(items(m)).toEqual([null, 'it_batteries', 'it_matches', null, 'it_flashlight']);
    expect(items(move(m, { bag: false, i: 1 }, { bag: false, i: 2 }).h!)).toEqual([null, 'it_matches', 'it_batteries', null, 'it_flashlight']);
    expect(move(m, { bag: false, i: 0 }, { bag: false, i: 1 }).msg).toBe('Пусто');
    expect(move(m, { bag: false, i: 1 }, { bag: true, i: 0 }).msg).toBe('Нет сумки');
  });

  it('count / consume: по хотбару и сумке, сперва мелкие стеки, при равных — из сумки; не хватает — null', () => {
    let h = withBag(newHotbar(START_KIT), 'it_backpack');
    h = add(h, { item: 'it_batteries', n: 6 })!.h; // хотбар 1: 2+4=6, хотбар 3: 2
    expect(h.slots[1]).toEqual({ item: 'it_batteries', n: 6 });
    expect(h.slots[3]).toEqual({ item: 'it_batteries', n: 2 });
    h = toBag(h, 3).h!; // сумка 0: 2
    h = add(h, { item: 'it_batteries', n: 2 })!.h; // в хотбар? нет — стеки: хотбар 1 полон, сумка 0: 2 → 4
    expect(bagItems(h)![0]).toBe('it_batteries×4');
    expect(count(h, 'it_batteries')).toBe(10);
    expect(count(h, 'it_matches')).toBe(5);
    expect(count(h, 'nothing')).toBe(0);
    expect(consume(h, 'it_batteries', 11)).toBeNull();
    expect(consume(h, 'it_batteries', 0)).toBeNull();
    const c = consume(h, 'it_batteries', 5)!;
    // мелкий стек (сумка ×4) — весь, потом 1 из хотбара
    expect(bagItems(c)![0]).toBeNull();
    expect(c.slots[1]).toEqual({ item: 'it_batteries', n: 5 });
    expect(count(c, 'it_batteries')).toBe(5);
    expect(count(h, 'it_batteries')).toBe(10);
    // равные стеки: сперва сумка
    const eq = toBag(add(withBag(newHotbar([{ item: 'it_wick', n: 2 }])), { item: 'it_wick', n: 2, q: 0.5 })!.h, 1).h!;
    expect(eq.slots[0]).toEqual({ item: 'it_wick', n: 2 });
    const e2 = consume(eq, 'it_wick', 1)!;
    expect(e2.slots[0]).toEqual({ item: 'it_wick', n: 2 });
    expect(e2.back?.slots[0]).toEqual({ item: 'it_wick', q: 0.5 });
  });

  it('JSON v2: туда и обратно (n/q/w/u и сумка)', () => {
    const h0 = add(select(patch(newHotbar(START_KIT), 0, { on: false, w: 0.4, u: 1 }), 3), { item: 'it_kerosene', q: 0.75 })!.h;
    const h = add(withBag(h0, 'it_sack'), { item: 'zz' })!.h;
    const g = toBag(h, 1).h!;
    const back = parseHotbar(hotbarJSON(g))!;
    expect(back).toEqual(g);
    expect(JSON.parse(hotbarJSON(g)).v).toBe(2);
    expect(back.back).toEqual({ item: 'it_sack', slots: [{ item: 'it_batteries', n: 2 }, null, null] });
    const plain = newHotbar(START_KIT);
    expect(parseHotbar(hotbarJSON(plain))).toEqual(plain);
    expect('back' in parseHotbar(hotbarJSON(plain))!).toBe(false);
  });

  it('JSON v1 (старое сохранение) читается; сумка в v1 и негодная сумка — без сумки', () => {
    const v1 = JSON.stringify({ format: 'room-forge-hotbar', v: 1, sel: 1, slots: [{ item: 'it_flashlight', on: true }, { item: 'it_kerolamp' }] });
    expect(parseHotbar(v1)).toEqual({ slots: [{ item: 'it_flashlight', on: true }, { item: 'it_kerolamp' }, null, null, null], sel: 1 });
    const v1bag = JSON.stringify({ format: 'room-forge-hotbar', v: 1, slots: [], back: { item: 'it_sack', slots: [] } });
    expect(parseHotbar(v1bag)!.back).toBeUndefined();
    const notBag = JSON.stringify({ format: 'room-forge-hotbar', v: 2, slots: [], back: { item: 'it_bread', slots: [] } });
    expect(parseHotbar(notBag)!.back).toBeUndefined();
    // сумка: ячеек по вместимости (лишние отброшены, недостающие пусты)
    const long = JSON.stringify({ format: 'room-forge-hotbar', v: 2, slots: [], back: { item: 'it_sack', slots: [{ item: 'a' }, 5, { item: 'b', n: 3 }, { item: 'c' }] } });
    expect(parseHotbar(long)!.back).toEqual({ item: 'it_sack', slots: [{ item: 'a' }, null, { item: 'b', n: 3 }] });
  });

  it('parseHotbar: мусор → null, негодные ячейки — пустые, выбор вне диапазона — первая', () => {
    for (const t of [null, '', 'не json', '{', '42', '"str"', 'null', '[]', '{}', '{"slots":[]}', '{"format":"room-forge-hotbar","v":3,"slots":[]}',
      '{"format":"room-forge-hotbar","v":1,"slots":"x"}', '{"format":"other","v":1,"slots":[]}']) {
      expect(parseHotbar(t), String(t)).toBeNull();
    }
    const h = parseHotbar(JSON.stringify({
      format: 'room-forge-hotbar', v: 1, sel: 99,
      slots: [{ item: 'it_flashlight', on: 'да' }, 5, { item: 'x'.repeat(65) }, { item: 'it_batteries', on: true, junk: 1 }, null, { item: 'it_extra' }],
    }))!;
    expect(h.sel).toBe(0);
    expect(h.slots).toEqual([{ item: 'it_flashlight' }, null, null, { item: 'it_batteries', on: true }, null]);
    expect(parseHotbar(JSON.stringify({ format: 'room-forge-hotbar', v: 1, sel: 2, slots: [{ item: 'a' }] }))).toEqual({
      slots: [{ item: 'a' }, null, null, null, null], sel: 2,
    });
  });
});
