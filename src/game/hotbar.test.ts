// Хотбар игрока: положить / вынуть / выбрать / колесо / сохранение (мусор → null). Модель неизменяемая.
import { describe, expect, it } from 'vitest';
import { add, cycle, held, HOTBAR_SIZE, hotbarJSON, newHotbar, parseHotbar, patch, select, START_KIT, take, type Hotbar } from './hotbar';

const items = (h: Hotbar) => h.slots.map((s) => s?.item ?? null);

describe('hotbar', () => {
  it('новый: набор старта в первой ячейке, выбрана первая, остальные пусты', () => {
    const h = newHotbar(START_KIT);
    expect(h.slots).toHaveLength(HOTBAR_SIZE);
    expect(h.sel).toBe(0);
    expect(held(h)).toEqual({ item: 'it_flashlight', on: true });
    expect(items(h)).toEqual(['it_flashlight', null, null, null, null]);
    // набор не общий с хотбаром
    expect(h.slots[0]).not.toBe(START_KIT[0]);
    expect(newHotbar().slots.every((s) => s === null)).toBe(true);
    // лишнее сверх HOTBAR_SIZE и негодное — отброшено
    const many = newHotbar([...Array.from({ length: 7 }, (_, i) => ({ item: `it_${i}` })), { item: '' }]);
    expect(items(many)).toEqual(['it_0', 'it_1', 'it_2', 'it_3', 'it_4']);
  });

  it('add: в выбранную, если пуста, иначе в первую пустую; полно — null; старый не меняется', () => {
    const h0 = select(newHotbar(START_KIT), 2);
    const a = add(h0, { item: 'it_batteries' })!;
    expect(a.at).toBe(2);
    expect(items(a.h)).toEqual(['it_flashlight', null, 'it_batteries', null, null]);
    expect(items(h0)).toEqual(['it_flashlight', null, null, null, null]);
    // выбранная занята — первая пустая
    const b = add(a.h, { item: 'it_knife' })!;
    expect(b.at).toBe(1);
    expect(b.h.sel).toBe(2);
    let h = b.h;
    for (const it of ['it_a', 'it_b']) h = add(h, { item: it })!.h;
    expect(items(h)).toEqual(['it_flashlight', 'it_knife', 'it_batteries', 'it_a', 'it_b']);
    expect(add(h, { item: 'it_c' })).toBeNull();
    expect(add(newHotbar(), { item: '' })).toBeNull();
  });

  it('take: по умолчанию выбранная, ячейка пустеет; пусто / вне диапазона — slot null и тот же хотбар', () => {
    const h0 = newHotbar(START_KIT);
    const t = take(h0);
    expect(t.slot).toEqual({ item: 'it_flashlight', on: true });
    expect(held(t.h)).toBeNull();
    expect(held(h0)).not.toBeNull();
    const e = take(t.h);
    expect(e.slot).toBeNull();
    expect(e.h).toBe(t.h);
    expect(take(h0, 7)).toEqual({ h: h0, slot: null });
    expect(take(h0, -1).slot).toBeNull();
    const two = add(select(h0, 3), { item: 'it_batteries' })!.h;
    const t3 = take(two, 3);
    expect(t3.slot?.item).toBe('it_batteries');
    expect(items(t3.h)).toEqual(['it_flashlight', null, null, null, null]);
  });

  it('select и cycle: выбор в диапазоне, колесо по кругу', () => {
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
  });

  it('patch: переключить фонарь; пустая ячейка / негодное — без изменений', () => {
    const h = newHotbar(START_KIT);
    const off = patch(h, 0, { on: false });
    expect(held(off)).toEqual({ item: 'it_flashlight', on: false });
    expect(held(h)?.on).toBe(true);
    expect(held(patch(h, 0, { on: undefined }))).toEqual({ item: 'it_flashlight' });
    expect(patch(h, 1, { on: true })).toBe(h);
    expect(patch(h, 9, { on: true })).toBe(h);
    expect(patch(h, 0, { item: '' })).toBe(h);
  });

  it('JSON: туда и обратно', () => {
    const h = add(select(patch(newHotbar(START_KIT), 0, { on: false }), 3), { item: 'it_batteries' })!.h;
    const back = parseHotbar(hotbarJSON(h))!;
    expect(back).toEqual(h);
    expect(held(back)).toEqual({ item: 'it_batteries' });
  });

  it('parseHotbar: мусор → null, негодные ячейки — пустые, выбор вне диапазона — первая', () => {
    for (const t of [null, '', 'не json', '{', '42', '"str"', 'null', '[]', '{}', '{"slots":[]}', '{"format":"room-forge-hotbar","v":2,"slots":[]}',
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
