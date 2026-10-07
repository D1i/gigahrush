import { describe, expect, it } from 'vitest';
import {
  allCombinations,
  createItem,
  createProp,
  createRoom,
  deleteItem,
  deleteProp,
  deleteRoom,
  deleteSpot,
  deleteSpotGroup,
  duplicateRoom,
  itemUsage,
  propUsage,
  roomArea,
  setSpotGroup,
  uid,
  variantChance,
} from './ops';
import { emptyProject, parseProject, serializeProject } from './serialize';
import type { Project, Room } from './types';

function setup(): { p: Project; r: Room } {
  const p = emptyProject();
  createProp(p, { id: 'sofa' });
  createProp(p, { id: 'tv' });
  createItem(p, { id: 'samogon', tags: ['currency'] });
  createItem(p, { id: 'can' });
  const r = createRoom(p, 'Зал');
  r.doors.push({ id: 'd1', cx: 0, cy: 0, side: 'N', len: 8 });
  r.connectors.push({ id: 'c1', cx: 0, cy: 0, side: 'N', len: 8, name: '', tag: 'door' });
  r.decor.push({ id: 'de1', propId: 'sofa', x: 5, y: 5, rot: 0 }, { id: 'de2', propId: 'sofa', x: 9, y: 5, rot: 0 });
  r.spots.push(
    { id: 's1', name: '', x: 1, y: 1, rot: 0, groupId: 'g1' },
    { id: 's2', name: '', x: 2, y: 1, rot: 0, groupId: 'g1' },
    { id: 's3', name: '', x: 3, y: 1, rot: 0, groupId: null },
  );
  r.spotGroups.push({
    id: 'g1',
    name: 'Г',
    color: '#fff',
    variants: [
      { id: 'v1', weight: 3, assign: { s1: { kind: 'prop', id: 'sofa', rot: 0 }, s2: { kind: 'item', id: 'can', rot: 0 } } },
      { id: 'v2', weight: 1, assign: { s2: { kind: 'prop', id: 'tv', rot: 90 } } },
    ],
  });
  r.loot.push({ id: 'l1', itemId: 'can', chance: 1, min: 1, max: 1 });
  p.economy.shops.push(
    { id: 'shA', name: 'A', currencyItemId: 'samogon', offers: [{ id: 'o1', itemId: 'can', price: 1 }], note: '' },
    { id: 'shB', name: 'B', currencyItemId: 'can', offers: [], note: '' },
  );
  p.economy.tiers.push({
    id: 't1', name: 'T', level: 2, danger: 1, color: '', note: '',
    loot: [
      { id: 'tl1', source: { kind: 'item', id: 'can' }, steps: [], where: '' },
      { id: 'tl2', source: { kind: 'shop', id: 'shB' }, steps: [], where: '' },
      { id: 'tl3', source: { kind: 'shop', id: 'shA' }, steps: [], where: '' },
    ],
  });
  p.economy.passes.push(
    { id: 'pA', name: '', priceItemId: 'samogon', price: 1, tierBoost: 1, itemBoost: { can: 2 }, note: '' },
    { id: 'pB', name: '', priceItemId: 'can', price: 1, tierBoost: 1, itemBoost: {}, note: '' },
  );
  p.generator.passId = 'pB';
  return { p, r };
}

describe('uid / create', () => {
  it('uid уникален и с префиксом', () => {
    const ids = new Set<string>();
    for (let i = 0; i < 10000; i++) ids.add(uid('x'));
    expect(ids.size).toBe(10000);
    expect(uid('room')).toMatch(/^room_[0-9a-z]+$/);
  });

  it('createRoom / createProp / createItem по умолчанию', () => {
    const p = emptyProject();
    const r = createRoom(p, 'Кухня');
    expect(p.rooms).toContain(r);
    expect(r.cells.size).toBe(900);
    expect(roomArea(p, r)).toBe(9);
    expect(r.gen).toEqual({ weight: 1, min: 0, max: 99 });
    expect(r.elite).toEqual([]);
    expect(r.note).toBe('');
    const pr = createProp(p);
    expect(pr).toMatchObject({ name: 'Новый декор', w: 1, h: 0.5, color: '#8a7a5c', tex: null, tags: [] });
    const it = createItem(p, { name: 'Бутылка' });
    expect(it).toMatchObject({ name: 'Бутылка', color: '#c9a227', tags: [], note: '' });
    expect(p.props).toContain(pr);
    expect(p.items).toContain(it);
    // занятый id не переиспользуется
    expect(createItem(p, { id: it.id }).id).not.toBe(it.id);
  });
});

describe('duplicateRoom', () => {
  it('новые id, assign перевешены, вставка после оригинала', () => {
    const { p, r } = setup();
    createRoom(p, 'Хвост');
    const c = duplicateRoom(p, r.id);
    expect(p.rooms[1]).toBe(c);
    expect(c.name).toBe('Зал (копия)');
    expect(c.id).not.toBe(r.id);
    const collect = (x: Room) => [
      x.id,
      ...x.doors.map((d) => d.id),
      ...x.connectors.map((d) => d.id),
      ...x.decor.map((d) => d.id),
      ...x.spots.map((d) => d.id),
      ...x.spotGroups.map((d) => d.id),
      ...x.spotGroups.flatMap((g) => g.variants.map((v) => v.id)),
      ...x.loot.map((d) => d.id),
    ];
    const orig = new Set(collect(r));
    const copy = collect(c);
    expect(new Set(copy).size).toBe(copy.length);
    for (const id of copy) expect(orig.has(id)).toBe(false);
    const g = c.spotGroups[0];
    const spotIds = new Set(c.spots.map((s) => s.id));
    for (const v of g.variants) for (const k of Object.keys(v.assign)) expect(spotIds.has(k)).toBe(true);
    expect(c.spots[0].groupId).toBe(g.id);
    expect(c.spots[2].groupId).toBeNull();
    expect(g.variants[0].assign[c.spots[0].id]).toEqual({ kind: 'prop', id: 'sofa', rot: 0 });
    // глубокая копия
    c.cells.clear();
    c.doors[0].cx = 50;
    g.variants[0].assign[c.spots[0].id].rot = 180;
    expect(r.cells.size).toBe(900);
    expect(r.doors[0].cx).toBe(0);
    expect(r.spotGroups[0].variants[0].assign.s1.rot).toBe(0);
    // копия переживает parse (ссылки целы)
    expect(parseProject(serializeProject(p)).rooms[1]).toEqual(c);
  });
});

describe('каскадное удаление', () => {
  it('deleteProp', () => {
    const { p, r } = setup();
    expect(propUsage(p, 'sofa')).toEqual({ rooms: 1, decor: 2, loot: 0, assigns: 1, economy: 0, total: 3 });
    expect(deleteProp(p, 'sofa')).toEqual({ decor: 2, assigns: 1 });
    expect(p.props.map((x) => x.id)).toEqual(['tv']);
    expect(r.decor).toEqual([]);
    expect(r.spotGroups[0].variants[0].assign).toEqual({ s2: { kind: 'item', id: 'can', rot: 0 } });
    expect(propUsage(p, 'sofa').total).toBe(0);
  });

  it('deleteItem чистит комнаты и экономику', () => {
    const { p, r } = setup();
    const u = itemUsage(p, 'can');
    // лут 1, assign 1; экономика: tl1 + оффер o1 + валюта shB + проходка pB (цена) + pA (itemBoost)
    expect(u).toEqual({ rooms: 1, decor: 0, loot: 1, assigns: 1, economy: 5, total: 7 });
    const res = deleteItem(p, 'can');
    expect(res.loot).toBe(1);
    expect(res.assigns).toBe(1);
    // shB, o1, tl1, tl2 (магазин shB), pB, itemBoost pA
    expect(res.economy).toBe(6);
    expect(r.loot).toEqual([]);
    expect(p.economy.shops.map((s) => s.id)).toEqual(['shA']);
    expect(p.economy.shops[0].offers).toEqual([]);
    expect(p.economy.tiers[0].loot.map((x) => x.id)).toEqual(['tl3']);
    expect(p.economy.passes.map((x) => x.id)).toEqual(['pA']);
    expect(p.economy.passes[0].itemBoost).toEqual({});
    expect(p.generator.passId).toBeNull();
    expect(itemUsage(p, 'can').total).toBe(0);
  });

  it('deleteRoom сбрасывает startRoomId', () => {
    const { p, r } = setup();
    p.generator.startRoomId = r.id;
    deleteRoom(p, r.id);
    expect(p.rooms).toEqual([]);
    expect(p.generator.startRoomId).toBeNull();
  });

  it('споты и группы', () => {
    const { r } = setup();
    deleteSpot(r, 's1');
    expect(r.spots.map((s) => s.id)).toEqual(['s2', 's3']);
    expect(r.spotGroups[0].variants[0].assign.s1).toBeUndefined();
    setSpotGroup(r, 's2', null);
    expect(r.spots[0].groupId).toBeNull();
    expect(r.spotGroups[0].variants[1].assign).toEqual({});
    setSpotGroup(r, 's3', 'g1');
    expect(r.spots[1].groupId).toBe('g1');
    deleteSpotGroup(r, 'g1');
    expect(r.spotGroups).toEqual([]);
    expect(r.spots.every((s) => s.groupId === null)).toBe(true);
  });
});

describe('allCombinations', () => {
  it('2^n вариантов по битам спотов', () => {
    const { r } = setup();
    const vs = allCombinations(r, 'g1', { kind: 'item', id: 'samogon', rot: 0 });
    expect(vs).toHaveLength(4);
    expect(r.spotGroups[0].variants).toBe(vs);
    expect(vs.every((v) => v.weight === 1)).toBe(true);
    expect(vs[0].assign).toEqual({});
    // шаблоны: s1 — первое назначение (sofa), s2 — первое назначение (can из v1)
    expect(vs[1].assign).toEqual({ s1: { kind: 'prop', id: 'sofa', rot: 0 } });
    expect(vs[2].assign).toEqual({ s2: { kind: 'item', id: 'can', rot: 0 } });
    expect(Object.keys(vs[3].assign).sort()).toEqual(['s1', 's2']);
    expect(new Set(vs.map((v) => v.id)).size).toBe(4);
    expect(variantChance(r.spotGroups[0], vs[2].id)).toBeCloseTo(0.25);
  });

  it('fallback и пропуск спота без шаблона', () => {
    const { r } = setup();
    r.spotGroups[0].variants = [];
    for (let i = 0; i < 4; i++) r.spots.push({ id: `n${i}`, name: '', x: 0, y: 0, rot: 0, groupId: 'g1' });
    expect(allCombinations(r, 'g1', { kind: 'prop', id: 'tv', rot: 0 })).toHaveLength(64);
    r.spotGroups[0].variants = [];
    expect(allCombinations(r, 'g1', null).every((v) => Object.keys(v.assign).length === 0)).toBe(true);
    r.spots.push({ id: 'n9', name: '', x: 0, y: 0, rot: 0, groupId: 'g1' });
    expect(() => allCombinations(r, 'g1', null)).toThrow('Больше 6 спотов — «все комбинации» заблокированы');
  });

  it('variantChance', () => {
    const { r } = setup();
    const g = r.spotGroups[0];
    expect(variantChance(g, 'v1')).toBeCloseTo(0.75);
    expect(variantChance(g, 'нет')).toBe(0);
    g.variants.forEach((v) => (v.weight = 0));
    expect(variantChance(g, 'v1')).toBe(0);
  });
});
