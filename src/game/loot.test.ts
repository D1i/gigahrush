// Лут комнат (src/game/loot.ts): детерминизм (те же входы — тот же список, порядок вызовов не важен), таблицы по зонам
// биомов, элитность сдвигает редкость и прибавляет предметов, хуки комнат (force, tier) и свои записи таблиц, плотность,
// уникальное случайно не выпадает, заявленное комнатой — только из каталога.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LOOT_DEFS, lootDef, rarityInfo, ZONE_BIOMES } from '../data/itemsLoot';
import {
  classWeight, ITEM_SPOT, LOOT_DENSITY, lootExpect, lootRoomSeed, lootTable, registerLootEntry, registerLootRoom, rollRoomLoot,
  type LootRoll, type LootRoomInfo, type LootRoomSpec,
} from './loot';

const spec = (o: Partial<LootRoomSpec> = {}): LootRoomSpec => ({ seed: 'лут', inst: 'i3', addr: 'a1b2c3d4e5f60718', biome: 'khrush', tier: 0, areaM2: 12, ...o });
const addr = (i: number) => (i * 2654435761 >>> 0).toString(16).padStart(8, '0') + 'feedbeef';
/** много комнат: адреса по счётчику */
const many = (n: number, o: Partial<LootRoomSpec> = {}): LootRoll[][] => Array.from({ length: n }, (_, i) => rollRoomLoot(spec({ addr: addr(i), inst: `i${i}`, ...o })));
const allowed = (biome: string | null): Set<string> =>
  new Set(LOOT_DEFS.filter((d) => d.rarity !== 'unique' && d.zone !== 'obshaga' && (d.zone === 'any' || ZONE_BIOMES[d.zone].includes(biome ?? ''))).map((d) => d.id));

const off: (() => void)[] = [];
afterEach(() => {
  while (off.length) off.pop()!();
  vi.restoreAllMocks();
});

describe('лут комнат: розыгрыш', { timeout: 60000 }, () => {
  it('детерминизм: те же входы — тот же список; другие комнаты между вызовами ничего не меняют; inst — не в ГСЧ', () => {
    const a = rollRoomLoot(spec());
    many(50);
    expect(rollRoomLoot(spec())).toEqual(a);
    // id экземпляра зависит от порядка обхода — лут от него не зависит (только от адреса)
    expect(rollRoomLoot(spec({ inst: 'i999' }))).toEqual(a);
    // порядок перебора комнат не важен
    const fwd = many(40), back = Array.from({ length: 40 }, (_, k) => 39 - k).map((i) => rollRoomLoot(spec({ addr: addr(i), inst: `i${i}` }))).reverse();
    expect(back).toEqual(fwd);
    // другой сид мира или адрес — другой лут (на 40 комнатах хоть где-то отличие)
    expect(many(40, { seed: 'другой' })).not.toEqual(fwd);
  });

  it('таблицы по зонам: хрущёвка, подвалы, общага, вне квартир; уникальное и зона общаги — никогда', () => {
    const ids = (b: string | null) => new Set(lootTable(b).flatMap((c) => c.items.map((e) => e.item)));
    expect(ids('khrush')).toEqual(allowed('khrush'));
    for (const b of ['basement', 'basement_blue', 'basement_wet']) expect(ids(b)).toEqual(allowed(b));
    expect(ids('khrush').has('it_flashlight')).toBe(true);
    expect(ids('khrush').has('it_preserves')).toBe(false);
    expect(ids('basement_wet').has('it_yuzgram')).toBe(true);
    expect(ids('basement_wet').has('it_zippo')).toBe(false);
    for (const b of ['obshaga', 'barn', null, '']) expect(ids(b)).toEqual(allowed(null));
    for (const b of ['khrush', 'basement', 'obshaga', null]) expect(ids(b).has('it_kerolamp')).toBe(false);
    // классы — по возрастанию ранга, веса из каталога редкостей
    for (const c of lootTable('khrush')) expect(c.weight).toBe(rarityInfo(c.rarity).weight);
    expect(lootTable('khrush').map((c) => c.rank)).toEqual([0, 1, 2, 3, 4]);
    // и в розыгрыше: только разрешённое биому
    for (const b of ['khrush', 'basement_blue', 'obshaga', null]) {
      const ok = allowed(b);
      const bad = many(400, { biome: b, tier: 4, areaM2: 30 }).flat().filter((r) => !ok.has(r.item));
      expect(bad, String(b)).toEqual([]);
    }
  });

  it('элитность: вес класса × (1 + 0.5·tier)^rank — редкое чаще; предметов больше на ~0.4·tier', () => {
    expect(classWeight({ weight: 9, rank: 2 }, 2)).toBeCloseTo(9 * 4);
    const stat = (tier: number) => {
      let n = 0, rank = 0, top = 0;
      for (const room of many(1500, { tier })) {
        for (const r of room) {
          const rk = rarityInfo(lootDef(r.item)!.rarity).rank;
          n++;
          rank += rk;
          if (rk >= 3) top++;
        }
      }
      return { per: n / 1500, rank: rank / n, top: top / n };
    };
    const t0 = stat(0), t4 = stat(4);
    expect(t4.rank).toBeGreaterThan(t0.rank + 0.3);
    expect(t4.top).toBeGreaterThan(t0.top * 3);
    expect(t4.per - t0.per).toBeGreaterThan(1.3);
    expect(t4.per - t0.per).toBeLessThan(1.9);
    expect(lootExpect(12, false, 4) - lootExpect(12, false, 0)).toBeCloseTo(4 * LOOT_DENSITY.tierAdd);
    // мусор в элитности — как 0
    expect(rollRoomLoot(spec({ tier: NaN }))).toEqual(rollRoomLoot(spec({ tier: 0 })));
  });

  it('плотность: квартиры ~0.6–1.2 на комнату, ходы сетей ~0.3–0.6; штук — по drop, керосин q 0.5…1', () => {
    // площади комнат хрущёвки: санузел, прихожая, кухня, жилые, площадка
    const apt = [3, 4, 6, 6.5, 9, 12, 14, 17, 10];
    const mean = (areas: number[], tunnels: boolean) => {
      let n = 0;
      for (let i = 0; i < 2000; i++) n += rollRoomLoot(spec({ addr: addr(i), areaM2: areas[i % areas.length], tunnels, biome: tunnels ? 'basement' : 'khrush' })).length;
      return n / 2000;
    };
    const a = mean(apt, false), t = mean([3, 4, 6, 12, 18, 30], true);
    expect(a).toBeGreaterThan(0.6);
    expect(a).toBeLessThan(1.2);
    expect(t).toBeGreaterThan(0.3);
    expect(t).toBeLessThan(0.6);
    const bad = many(800, { tier: 2, areaM2: 20 }).flat().filter((r) => {
      const d = lootDef(r.item)!;
      const n = r.n ?? 1;
      const nOk = n >= (d.drop ? d.drop[0] : 1) && n <= Math.min(d.stack, d.drop ? d.drop[1] : 1) && (r.n === undefined || r.n > 1);
      const qOk = d.kind === 'fuel' ? r.q! >= 0.5 && r.q! <= 1 : r.q === undefined;
      return !nOk || !qOk || r.src !== 'random';
    });
    expect(bad).toEqual([]);
  });

  it('заявленное комнатой: только из каталога и не уникальное; валюта — count штук, одно место — одной кучкой', () => {
    const r = rollRoomLoot(spec({
      areaM2: 0, biome: 'nowhere',
      declared: [
        { item: 'it_samogon', count: 2 }, // не из каталога — нет модели
        { item: 'it_kerolamp', count: 1, at: ITEM_SPOT + 's1' }, // уникальное — только своим механизмом
        { item: 'it_kopeyki', count: 4 },
        { item: 'it_kopeyki', count: 3 },
        { item: 'it_kopeyki', count: 5, at: 'd7' },
        { item: 'it_matches', count: 1, at: ITEM_SPOT + 's2' },
        { item: 'it_flashlight', count: 5 },
        { item: 'it_kerosene', count: 1 },
      ],
    })).filter((x) => x.src === 'room');
    expect(r.map((x) => [x.item, x.at ?? null])).toEqual([
      ['it_kopeyki', null], ['it_kopeyki', 'd7'], ['it_matches', ITEM_SPOT + 's2'],
      ['it_flashlight', null], ['it_flashlight', null], ['it_flashlight', null], ['it_kerosene', null],
    ]);
    expect(r[0].n).toBe(7);
    expect(r[1].n).toBe(5);
    expect(r[2].n).toBeGreaterThanOrEqual(3);
    expect(r[2].n).toBeLessThanOrEqual(10);
    expect(r[6].q).toBeGreaterThanOrEqual(0.5);
  });
});

describe('лут комнат: хуки и свои записи', { timeout: 60000 }, () => {
  it('registerLootRoom: обязательное — первым, элитность хука вместо своей; сведения о комнате; снять — как не было', () => {
    const seen: LootRoomInfo[] = [];
    const base = rollRoomLoot(spec({ biome: 'hookland', tags: ['комната'], roomId: 'r1', kind: 'storage' }));
    off.push(registerLootRoom('hookland', (r) => {
      seen.push(r);
      return { tier: 4, force: [{ item: 'it_key', n: 2 }, { item: 'it_bread' }, { item: '' }, { item: 'x'.repeat(65) }, { item: 'it_kerosene', n: 5000 }, { item: 'it_quest', n: 5000 }] };
    }));
    const a = rollRoomLoot(spec({ biome: 'hookland', tags: ['комната'], roomId: 'r1', kind: 'storage' }));
    expect(a.slice(0, 3).map((x) => [x.item, x.n ?? 1, x.src])).toEqual([['it_key', 2, 'force'], ['it_bread', 1, 'force'], ['it_kerosene', 1, 'force']]);
    expect(a[2].q).toBeGreaterThanOrEqual(0.5);
    // не из каталога — стек не известен: до 999
    expect(a[3]).toMatchObject({ item: 'it_quest', n: 999, src: 'force' });
    expect(seen[0]).toEqual({ inst: 'i3', addr: 'a1b2c3d4e5f60718', biome: 'hookland', seed: lootRoomSeed('лут', 'a1b2c3d4e5f60718'), kind: 'storage', roomId: 'r1', tags: ['комната'], rx: null });
    // детерминизм с хуком
    expect(rollRoomLoot(spec({ biome: 'hookland', tags: ['комната'], roomId: 'r1', kind: 'storage' }))).toEqual(a);
    // элитность 4 от хука: случайного в среднем больше, чем без хука (тот же адрес — тот же поток счёта)
    let plain = 0, hooked = 0;
    for (let i = 0; i < 300; i++) {
      hooked += rollRoomLoot(spec({ addr: addr(i), biome: 'hookland' })).filter((x) => x.src === 'random').length;
    }
    off.pop()!();
    for (let i = 0; i < 300; i++) plain += rollRoomLoot(spec({ addr: addr(i), biome: 'hookland' })).length;
    expect(hooked).toBeGreaterThan(plain + 300);
    expect(rollRoomLoot(spec({ biome: 'hookland', tags: ['комната'], roomId: 'r1', kind: 'storage' }))).toEqual(base);
  });

  it('хук другого биома не зовётся; null — ничего; ошибка хука — пропуск (как не было)', () => {
    const calls: string[] = [];
    off.push(registerLootRoom('other', () => (calls.push('other'), { force: [{ item: 'it_bread' }] })));
    off.push(registerLootRoom('khrush', () => (calls.push('null'), null)));
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    off.push(registerLootRoom('khrush', () => {
      throw new Error('хук упал');
    }));
    const a = rollRoomLoot(spec());
    expect(calls).toEqual(['null']);
    expect(err).toHaveBeenCalledTimes(1);
    while (off.length) off.pop()!();
    expect(rollRoomLoot(spec())).toEqual(a);
  });

  it('registerLootEntry: свой предмет в таблице биома (не из каталога), с drop и весом; unique — никогда', () => {
    const before = lootTable('obshaga');
    off.push(registerLootEntry('obshaga', { item: 'it_key', rarity: 'rare', drop: [1, 2], weight: 1000 }));
    off.push(registerLootEntry('obshaga', { item: 'it_ghost', rarity: 'unique' }));
    const rare = lootTable('obshaga').find((c) => c.rarity === 'rare')!;
    expect(rare.items.map((e) => e.item)).toContain('it_key');
    expect(lootTable('obshaga').flatMap((c) => c.items.map((e) => e.item))).not.toContain('it_ghost');
    const all = many(600, { biome: 'obshaga', areaM2: 20, tunnels: true }).flat();
    expect(all.filter((r) => r.item === 'it_ghost' || (r.item === 'it_key' && (r.n ?? 1) > 2))).toEqual([]);
    const keys = all.filter((r) => r.item === 'it_key').length;
    const other = all.filter((r) => lootDef(r.item)?.rarity === 'rare').length;
    // вес 1000 внутри редких: почти все редкие — ключи
    expect(keys).toBeGreaterThan(20);
    expect(other).toBeLessThan(keys / 20);
    // чужой биом не задет; снять — таблица прежняя
    expect(lootTable('khrush').flatMap((c) => c.items.map((e) => e.item))).not.toContain('it_key');
    while (off.length) off.pop()!();
    expect(lootTable('obshaga')).toEqual(before);
  });
});
