// Тексты для игрока: карточка тира (как в редакторе), инвентарь, опасность.
import { describe, expect, it } from 'vitest';
import type { RunExport } from '../blockout/types';
import { generateRun } from '../gen/generate';
import { tierRuleLines } from '../gen/rules';
import { exportRunJSON } from '../gen/world';
import { presets } from './runs.test-util';
import { dangerLimitOf, dangerText, inventoryView, NO_TIER_TITLE, tierCard, tierCardInfo } from './rules';

const p = presets();
const rx = exportRunJSON(p, generateRun(p, { seed: 'game-rules', count: 60 })) as RunExport;

describe('tierCard', () => {
  it('строки — те же, что правило тира в редакторе (tierRuleLines), заголовок — имя тира', () => {
    const used = new Set(rx.instances.map((i) => i.tier).filter((t): t is string => !!t));
    expect(used.size).toBeGreaterThan(1);
    for (const id of used) {
      const t = p.economy.tiers.find((x) => x.id === id)!;
      expect(tierCard(rx, id)).toEqual([t.name, ...tierRuleLines(p, t)]);
      expect(tierCardInfo(rx, id)).toMatchObject({ tierId: id, title: t.name, level: t.level, color: t.color, danger: t.danger, note: t.note });
    }
  });

  it('пример заказчика: элитность 1 — опасность +2, копейки до 6 / до 4, самогонка в серванте 5%', () => {
    const card = tierCard(rx, 'tier_1');
    expect(card[0]).toBe('Элитность 1 — Обычная квартира');
    expect(card).toContain('Проход: опасность +2');
    expect(card).toContain('Копейки: до 6 — 50%, иначе до 4 — 70% (в среднем 2.6)');
    expect(card).toContain('Самогонка в «сервант»: 5%');
  });

  it('готовый предмет из магазина — по имени магазина из экспорта', () => {
    const lines = tierCard(rx, 'tier_3');
    expect(lines.some((l) => l.startsWith('Готовый предмет из «Ларёк»'))).toBe(true);
  });

  it('без тира и неизвестный тир — «Обычная комната»', () => {
    expect(tierCard(rx, null)).toEqual([NO_TIER_TITLE, 'Проход: опасность не растёт']);
    expect(tierCard(rx, 'нет-такого')).toEqual([NO_TIER_TITLE, 'Проход: опасность не растёт']);
    expect(tierCardInfo(rx, null).level).toBe(0);
  });

  it('урезанные таблицы (тиры без loot, без shops — как в прогулке) — только опасность, без исключений', () => {
    const lean = {
      ...rx,
      tiers: p.economy.tiers.map((t) => ({ id: t.id, name: t.name, level: t.level, color: t.color, danger: t.danger })),
      shops: undefined,
    } as RunExport;
    expect(tierCard(lean, 'tier_5')).toEqual(['Элитность 5 — Номенклатурная квартира', 'Проход: опасность +10']);
    // мусор в строках лута отбрасывается
    const junk = { ...rx, tiers: [{ id: 'x', name: 'X', level: 1, color: '#fff', danger: 1, loot: [null, { source: 5 }, { source: { kind: 'item', id: 'it_kopeyki' }, steps: [{ upTo: 3, chance: 1 }] }] }] } as unknown as RunExport;
    expect(tierCard(junk, 'x')).toEqual(['X', 'Проход: опасность +1', 'Копейки: до 3 — 100% (в среднем 2)']);
  });
});

describe('inventoryView', () => {
  const inv = { it_matches: 3, it_samogon: 1, it_kopeyki: 12, mystery: 2, it_components: 0, it_medkit: 1 };

  it('валюты первыми (в порядке таблицы), затем товары, неизвестные — в конце; нули не показываются', () => {
    const rows = inventoryView(p.items, { inventory: inv });
    expect(rows.map((r) => r.itemId)).toEqual(['it_kopeyki', 'it_samogon', 'it_matches', 'it_medkit', 'mystery']);
    expect(rows.map((r) => r.currency)).toEqual([true, true, false, false, false]);
    expect(rows[0]).toEqual({ itemId: 'it_kopeyki', name: 'Копейки', count: 12, color: '#d4a017', currency: true, tags: ['currency', 'деньги'] });
    expect(rows[4]).toMatchObject({ name: 'mystery', color: '#888888', tags: [] });
  });

  it('принимает и экспорт прогона', () => {
    const rows = inventoryView(rx, { inventory: { it_kopeyki: 1 } });
    expect(rows).toEqual([expect.objectContaining({ itemId: 'it_kopeyki', name: 'Копейки', currency: true })]);
  });
});

describe('опасность', () => {
  it('dangerText и порог из экспорта', () => {
    expect(dangerLimitOf(rx)).toBe(100);
    expect(dangerLimitOf({ ...rx, dangerLimit: undefined } as RunExport, 50)).toBe(50);
    expect(dangerText({ danger: 34 }, 100)).toBe('Опасность 34 из 100');
    expect(dangerText({ danger: 100 }, 100)).toBe('Опасность 100 из 100');
    expect(dangerText({ danger: 112.25 }, 100)).toBe('Опасность 112.3 из 100 — уровень горит');
    expect(dangerText({ danger: 7 }, 0)).toBe('Опасность 7');
  });
});
