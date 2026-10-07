import { describe, expect, it } from 'vitest';
import { applyShape, rectCells } from './cells';
import { createItem, createProp, createRoom, duplicateRoom } from './ops';
import { DEFAULT_STAIRWELL, newStairwell } from '../locations/stairwell';
import { emptyProject, parseProject, parseRoom, serializeProject, serializeRoom } from './serialize';
import type { Project, StairwellSpec } from './types';

/** Проект со всеми видами сущностей и перекрёстных ссылок. */
function sample(): Project {
  const p = emptyProject();
  const sofa = createProp(p, { id: 'sofa', name: 'Диван', tex: 'data:image/png;base64,AAAA', tags: ['мебель'] });
  const cab = createProp(p, { id: 'cab', name: 'Сервант', tags: ['сервант'] });
  const vodka = createItem(p, { id: 'samogon', name: 'Самогонка', tags: ['currency'] });
  const can = createItem(p, { id: 'can', name: 'Тушёнка' });
  p.economy.shops.push({ id: 'sh', name: 'Ларёк', currencyItemId: vodka.id, offers: [{ id: 'o1', itemId: can.id, price: 3 }], note: '' });
  p.economy.tiers.push({
    id: 't1',
    name: 'Элита',
    level: 2,
    danger: 5,
    color: '#f00',
    note: '',
    loot: [
      { id: 'tl1', source: { kind: 'item', id: can.id }, steps: [{ upTo: 3, chance: 0.5 }], where: 'сервант' },
      { id: 'tl2', source: { kind: 'shop', id: 'sh' }, steps: [], where: '' },
    ],
  });
  p.economy.passes.push({ id: 'pass', name: 'Проходка', priceItemId: vodka.id, price: 2, tierBoost: 2, itemBoost: { [can.id]: 3 }, note: '' });
  const r = createRoom(p, 'Кухня', 3, 2);
  r.id = 'kitchen';
  applyShape(r.cells, rectCells(-5, -3, 5, 2), 'add');
  applyShape(r.cells, rectCells(10, 5, 3, 3), 'sub');
  r.doors.push({ id: 'd1', cx: 2, cy: 0, side: 'N', len: 8 });
  r.connectors.push({ id: 'c1', cx: 2, cy: 0, side: 'N', len: 8, name: 'вход', tag: 'door' });
  r.decor.push({ id: 'de1', propId: sofa.id, x: 5, y: 5.5, rot: 90 });
  r.spotGroups.push({
    id: 'g1',
    name: 'Стол',
    color: '#0f0',
    variants: [
      { id: 'v1', weight: 2, assign: { s1: { kind: 'prop', id: cab.id, rot: 0 }, s2: { kind: 'item', id: can.id, rot: 90 } } },
      { id: 'v2', weight: 1, assign: {} },
    ],
  });
  r.spots.push({ id: 's1', name: 'a', x: 1.5, y: 1.5, rot: 0, groupId: 'g1' });
  r.spots.push({ id: 's2', name: 'b', x: 3.5, y: 1.5, rot: 0, groupId: 'g1' });
  r.spots.push({ id: 's3', name: 'c', x: 5.5, y: 1.5, rot: 0, groupId: null });
  r.loot.push({ id: 'l1', itemId: can.id, chance: 0.3, min: 1, max: 2 });
  r.elite.push({ tierId: 't1', weight: 1 });
  r.note = 'серия II-49';
  p.generator.startRoomId = r.id;
  p.generator.passId = 'pass';
  return p;
}

describe('serialize/parse', () => {
  it('emptyProject — значения по умолчанию', () => {
    const p = emptyProject();
    expect(p.settings.cellM).toBe(0.1);
    expect(p.generator).toEqual({ seed: 'hrush-001', count: 30, gap: 1, match: 'exact', startRoomId: null, passId: null, sightM: 0, fill: false, mode: 'euclid', fold: { shiftChance: 0.5, maxShift: 3, localRadius: 1, maxLayer: 12, seamless: false } });
    expect(p.economy).toEqual({ tiers: [], shops: [], passes: [], dangerLimit: 100 });
  });

  it('roundtrip через JSON.stringify без потерь', () => {
    const p = sample();
    const json = serializeProject(p);
    expect(json.format).toBe('room-forge');
    expect(json.rooms[0].areaM2).toBe(6.01); // 600 + 10 − 9 клеток
    const back = parseProject(JSON.parse(JSON.stringify(json)));
    expect(back).toEqual(p);
    // и повторная сериализация идентична
    expect(JSON.stringify(serializeProject(back))).toBe(JSON.stringify(json));
  });

  it('не мутирует и не делит объекты с проектом; текстура — та же строка', () => {
    const p = sample();
    const json = serializeProject(p);
    expect(p.rooms[0].cells).toBeInstanceOf(Set);
    expect(json.props[0].tex).toBe(p.props[0].tex);
    json.rooms[0].doors[0].cx = 99;
    json.props[0].tags.push('x');
    json.economy.tiers[0].loot.length = 0;
    expect(p.rooms[0].doors[0].cx).toBe(2);
    expect(p.props[0].tags).toEqual(['мебель']);
    expect(p.economy.tiers[0].loot).toHaveLength(2);
  });

  it('serializeRoom считает areaM2, parseRoom его игнорирует', () => {
    const r = createRoom(emptyProject(), 'R', 5, 4);
    const j = serializeRoom(r, 0.1);
    expect(j.cells).toHaveLength(40);
    expect(j.areaM2).toBe(20);
    const back = parseRoom({ ...j, areaM2: 999 });
    expect(back).toEqual(r);
    expect('areaM2' in back).toBe(false);
  });

  it('заполняет значения по умолчанию', () => {
    const p = parseProject({ rooms: [{ name: 'Голая', cells: ['0:0-2'] }] });
    expect(p.settings.cellM).toBe(0.1);
    expect(p.generator.seed).toBe('hrush-001');
    expect(p.economy.dangerLimit).toBe(100);
    const r = p.rooms[0];
    expect(r.id).toBeTruthy();
    expect(r.gen).toEqual({ weight: 1, min: 0, max: 99 });
    expect(r.elite).toEqual([]);
    expect(r.note).toBe('');
    expect(r.cells.size).toBe(3);
    expect(parseProject({ format: 'room-forge' }).rooms).toEqual([]);
  });

  it('вычищает висячие ссылки', () => {
    const json = JSON.parse(JSON.stringify(serializeProject(sample())));
    json.props = json.props.filter((x: any) => x.id !== 'sofa' && x.id !== 'cab');
    json.items = json.items.filter((x: any) => x.id !== 'can');
    const room = json.rooms[0];
    room.spots.push({ id: 's9', name: 'z', x: 0, y: 0, rot: 0, groupId: 'нет-такой' });
    room.spotGroups[0].variants.push({ id: 'v3', weight: 1, assign: { s3: { kind: 'item', id: 'samogon', rot: 0 }, ghost: { kind: 'item', id: 'samogon', rot: 0 } } });
    room.elite.push({ tierId: 'нет', weight: 1 });
    json.generator.startRoomId = 'нет';
    const p = parseProject(json);
    const r = p.rooms[0];
    expect(r.decor).toEqual([]); // диван удалён
    expect(r.loot).toEqual([]); // тушёнка удалена
    expect(r.spotGroups[0].variants[0].assign).toEqual({}); // cab и can удалены
    expect(r.spotGroups[0].variants[2].assign).toEqual({}); // s3 — не из группы, ghost — нет спота
    expect(r.spots.find((s) => s.id === 's9')!.groupId).toBeNull();
    expect(r.elite).toEqual([{ tierId: 't1', weight: 1 }]);
    const eco = p.economy;
    expect(eco.tiers[0].loot.map((x) => x.id)).toEqual(['tl2']); // строка с can ушла, магазин жив
    expect(eco.shops[0].offers).toEqual([]);
    expect(eco.passes[0].itemBoost).toEqual({});
    expect(p.generator.startRoomId).toBeNull();
    expect(p.generator.passId).toBe('pass');
  });

  it('магазин и проходка без валюты удаляются, за ними строки тиров и passId', () => {
    const json = JSON.parse(JSON.stringify(serializeProject(sample())));
    json.items = json.items.filter((x: any) => x.id !== 'samogon');
    const p = parseProject(json);
    expect(p.economy.shops).toEqual([]);
    expect(p.economy.passes).toEqual([]);
    expect(p.economy.tiers[0].loot.map((x) => x.id)).toEqual(['tl1']);
    expect(p.generator.passId).toBeNull();
  });

  it('чинит дубли id', () => {
    const json = JSON.parse(JSON.stringify(serializeProject(sample())));
    json.props.push({ ...json.props[0], name: 'Дубль' });
    json.rooms.push(JSON.parse(JSON.stringify(json.rooms[0])));
    json.rooms[0].doors.push({ ...json.rooms[0].doors[0] });
    const p = parseProject(json);
    expect(new Set(p.props.map((x) => x.id)).size).toBe(p.props.length);
    expect(p.props[0].id).toBe('sofa');
    expect(p.rooms[0].id).toBe('kitchen');
    expect(p.rooms[1].id).not.toBe('kitchen');
    expect(new Set(p.rooms[0].doors.map((x) => x.id)).size).toBe(2);
  });

  it('бросает понятную ошибку на не-проект', () => {
    expect(() => parseProject(null)).toThrow(/не проект/);
    expect(() => parseProject([1, 2])).toThrow(/не проект/);
    expect(() => parseProject({ foo: 1 })).toThrow(/не проект/);
    expect(() => parseProject({ format: 'tiled', rooms: [] })).toThrow(/формат/);
    expect(() => parseProject('строка')).toThrow(Error);
  });

  it('спец-локация комнаты: roundtrip, некорректное → null, диапазоны нормализуются, дубль не делит объект', () => {
    const p = sample();
    p.rooms[0].location = { ...newStairwell(), sounds: [2, 4], grabS: 7 };
    const json = JSON.parse(JSON.stringify(serializeProject(p)));
    expect(json.rooms[0].location).toEqual({ ...DEFAULT_STAIRWELL, sounds: [2, 4], grabS: 7 });
    const back = parseProject(json);
    expect(back).toEqual(p);
    expect(JSON.stringify(serializeProject(back))).toBe(JSON.stringify(serializeProject(p)));
    // без поля — обычная комната, поля нет и после разбора
    const plain = parseRoom({ name: 'R', cells: ['0:0-2'] });
    expect('location' in plain).toBe(false);
    // null сохраняется как null
    expect(parseRoom({ name: 'R', cells: ['0:0-2'], location: null }).location).toBeNull();
    // мусор и неизвестные виды — null
    for (const bad of [5, 'stairwell', [], { kind: 'elevator' }, { sounds: [1, 2] }]) {
      expect(parseRoom({ name: 'R', cells: ['0:0-2'], location: bad }).location).toBeNull();
    }
    // диапазоны: перевёрнутые — по порядку, за рамками — зажаты, дробные звуки/этажи — целые
    const n = parseRoom({ name: 'R', cells: ['0:0-2'], location: { kind: 'stairwell', sounds: [9.4, 2], interval: [-3, 5000], floorsDown: [2.6, 2.6], darkness: -1 } });
    expect(n.location).toEqual({ ...DEFAULT_STAIRWELL, sounds: [2, 9], interval: [1, 600], floorsDown: [3, 3], darkness: 0 });
    // дублирование комнаты — своя копия спецификации
    const c = duplicateRoom(back, back.rooms[0].id);
    expect(c.location).toEqual(back.rooms[0].location);
    (c.location as StairwellSpec).sounds[0] = 1;
    expect((back.rooms[0].location as StairwellSpec).sounds[0]).toBe(2);
  });
});
