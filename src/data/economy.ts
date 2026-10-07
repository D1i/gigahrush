// Экономика: тиры элитности, магазины валютных веток, проходка.
// Лестница тиров: чем выше элитность — тем больше копеек и схем, тем быстрее растёт опасность.
import type { Economy, LootStep, Tier, TierLootRow, TierLootSource } from '../model/types';

const row = (id: string, source: TierLootSource, steps: LootStep[], where = ''): TierLootRow => ({ id, source, steps, where });
const item = (id: string): TierLootSource => ({ kind: 'item', id });
const shop = (id: string): TierLootSource => ({ kind: 'shop', id });

function buildTiers(): Tier[] {
  return [
    {
      id: 'tier_1',
      name: 'Элитность 1 — Обычная квартира',
      level: 1,
      danger: 2,
      color: '#9aa0a6',
      note: 'Обычная квартира. Немного мелочи по карманам; изредка в серванте стоит бутылка самогонки (5%). Опасность +2.',
      loot: [
        row('tier_1_r1', item('it_kopeyki'), [{ upTo: 6, chance: 0.5 }, { upTo: 4, chance: 0.7 }]),
        row('tier_1_r2', item('it_samogon'), [{ upTo: 1, chance: 0.05 }], 'сервант'),
      ],
    },
    {
      id: 'tier_3',
      name: 'Элитность 3 — Зажиточная квартира',
      level: 3,
      danger: 5,
      color: '#6aa84f',
      note: 'Жильцы жили неплохо: копеек больше, попадаются первые электронные компоненты, в серванте чаще самогонка (10%). Опасность +5.',
      loot: [
        row('tier_3_r1', item('it_kopeyki'), [{ upTo: 10, chance: 0.5 }, { upTo: 6, chance: 0.8 }]),
        row('tier_3_r2', item('it_components'), [{ upTo: 1, chance: 0.15 }]),
        row('tier_3_r3', item('it_samogon'), [{ upTo: 1, chance: 0.1 }], 'сервант'),
        row('tier_3_r4', shop('shop_kiosk'), [{ upTo: 1, chance: 0.05 }]),
      ],
    },
    {
      id: 'tier_5',
      name: 'Элитность 5 — Номенклатурная квартира',
      level: 5,
      danger: 10,
      color: '#3c78d8',
      note: 'Квартира начальника: копейки горстями, схемы уже почти в каждой второй, иногда готовый товар из ларька. Опасность +10.',
      loot: [
        row('tier_5_r1', item('it_kopeyki'), [{ upTo: 15, chance: 0.5 }, { upTo: 8, chance: 0.8 }]),
        row('tier_5_r2', item('it_components'), [{ upTo: 2, chance: 0.25 }, { upTo: 1, chance: 0.4 }]),
        row('tier_5_r3', item('it_samogon'), [{ upTo: 2, chance: 0.1 }, { upTo: 1, chance: 0.2 }], 'сервант'),
        row('tier_5_r4', shop('shop_kiosk'), [{ upTo: 1, chance: 0.1 }]),
      ],
    },
    {
      id: 'tier_8',
      name: 'Элитность 8 — Закрома',
      level: 8,
      danger: 20,
      color: '#e69138',
      note:
        'Здесь явно что-то копили: самогонка в серванте и в ящиках с бутылками, много схем, изредка — готовый товар ' +
        'электрика в шкафчике инструментов или барыжный товар. Опасность +20.',
      loot: [
        row('tier_8_r1', item('it_kopeyki'), [{ upTo: 20, chance: 0.5 }, { upTo: 12, chance: 0.8 }]),
        row('tier_8_r2', item('it_components'), [{ upTo: 4, chance: 0.25 }, { upTo: 2, chance: 0.6 }]),
        row('tier_8_r3', item('it_samogon'), [{ upTo: 2, chance: 0.3 }], 'сервант'),
        row('tier_8_r4', item('it_samogon'), [{ upTo: 3, chance: 0.5 }, { upTo: 1, chance: 0.9 }], 'бутылки'),
        row('tier_8_r5', shop('shop_electric'), [{ upTo: 1, chance: 0.03 }], 'шкаф-инструменты'),
        row('tier_8_r6', shop('shop_bootleg'), [{ upTo: 1, chance: 0.03 }]),
      ],
    },
    {
      id: 'tier_12',
      name: 'Элитность 12 — Тайник спекулянта',
      level: 12,
      danger: 35,
      color: '#cc0000',
      note: 'Схрон фарцовщика: копейки пачками, схемы почти наверняка, самогонка в серванте, шанс на готовый товар любой ветки. Опасность +35.',
      loot: [
        row('tier_12_r1', item('it_kopeyki'), [{ upTo: 25, chance: 0.5 }, { upTo: 15, chance: 0.8 }]),
        row('tier_12_r2', item('it_components'), [{ upTo: 6, chance: 0.3 }, { upTo: 3, chance: 0.7 }]),
        row('tier_12_r3', item('it_samogon'), [{ upTo: 3, chance: 0.25 }, { upTo: 2, chance: 0.5 }], 'сервант'),
        row('tier_12_r4', shop('shop_electric'), [{ upTo: 1, chance: 0.05 }]),
        row('tier_12_r5', shop('shop_bootleg'), [{ upTo: 1, chance: 0.05 }]),
        row('tier_12_r6', shop('shop_kiosk'), [{ upTo: 1, chance: 0.15 }]),
      ],
    },
    {
      id: 'tier_15',
      name: 'Элитность 15 — Спец. квартира радиолюбителя',
      level: 15,
      danger: 50,
      color: '#9b30ff',
      note:
        'Мастерская радиолюбителя: схемы почти гарантированы, копеек много, самогонки 0% — хозяин не пил. ' +
        'В шкафчике инструментов изредка (2%) лежит готовый товар электрика. Опасность +50 — долго тут не задерживайся.',
      loot: [
        row('tier_15_r1', item('it_components'), [{ upTo: 8, chance: 0.35 }, { upTo: 5, chance: 0.9 }]),
        row('tier_15_r2', item('it_kopeyki'), [{ upTo: 30, chance: 0.7 }, { upTo: 25, chance: 0.5 }]),
        row('tier_15_r3', shop('shop_electric'), [{ upTo: 1, chance: 0.02 }], 'шкаф-инструменты'),
      ],
    },
  ];
}

export function buildEconomy(): Economy {
  return {
    tiers: buildTiers(),
    shops: [
      {
        id: 'shop_kiosk',
        name: 'Ларёк',
        currencyItemId: 'it_kopeyki',
        offers: [
          { id: 'shop_kiosk_o1', itemId: 'it_matches', price: 2 },
          { id: 'shop_kiosk_o2', itemId: 'it_bandage', price: 5 },
          { id: 'shop_kiosk_o3', itemId: 'it_canned', price: 8 },
          { id: 'shop_kiosk_o4', itemId: 'it_medkit', price: 15 },
        ],
        note: 'Ветка копеек: выживание. Спички, бинты, консервы, аптечки.',
      },
      {
        id: 'shop_electric',
        name: 'Магазин электрика',
        currencyItemId: 'it_components',
        offers: [
          { id: 'shop_electric_o1', itemId: 'it_batteries', price: 1 },
          { id: 'shop_electric_o2', itemId: 'it_flashlight', price: 3 },
          { id: 'shop_electric_o3', itemId: 'it_key_panel', price: 4 },
          { id: 'shop_electric_o4', itemId: 'it_detector', price: 8 },
        ],
        note: 'Ветка схем: свет и разведка. Фонарики, детекторы самосбора, батарейки, ключ от щитка.',
      },
      {
        id: 'shop_bootleg',
        name: 'Барыга',
        currencyItemId: 'it_samogon',
        offers: [
          { id: 'shop_bootleg_o1', itemId: 'it_booster', price: 1 },
          { id: 'shop_bootleg_o2', itemId: 'it_gasmask', price: 2 },
          { id: 'shop_bootleg_o3', itemId: 'it_pass_elite', price: 3 },
        ],
        note: 'Ветка самогонки: доступ и усиления. Проходки на элитные этажи, временные усилители, противогаз.',
      },
    ],
    passes: [
      {
        id: 'pass_elite',
        name: 'Проходка на элитный этаж',
        priceItemId: 'it_samogon',
        price: 3,
        tierBoost: 3,
        itemBoost: { it_components: 1.5 },
        note: 'Стоит 3 самогонки. Элитные квартиры (элитность 2+) выпадают в 3 раза чаще, электронных компонентов — в 1.5 раза больше.',
      },
    ],
    dangerLimit: 100,
  };
}
