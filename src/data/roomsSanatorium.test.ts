// Комнаты санатория (src/data/roomsSanatorium.ts, контракт tmp/sanatorium-wip/CONTRACT.md §2): состав, размеры, метки,
// высоты потолка, свет, пропы; проходы не уже 0.7 м. Общие инварианты пресетов — src/data/presets.test.ts, рост сети
// без 4D — src/gen4d/stream.sanatorium.test.ts.
import { describe, expect, it, vi } from 'vitest';

vi.mock('./textures', () => ({ makeTexture: () => null }));

import { cellKey, parseKey } from '../model/cells';
import type { Prop, Room } from '../model/types';
import { isFlatProp, walkCheck, walkMessage } from '../gen/walk';
import { buildProps, PROP_BY_ID } from './props';
import { TAG_LEN, TAG_OPEN_H } from './roomBuilder';
import { buildSanatoriumRooms } from './roomsSanatorium';

const rooms = buildSanatoriumRooms();
const byId = new Map(rooms.map((r) => [r.id, r]));
const props = new Map<string, Prop>(buildProps().map((p) => [p.id, p]));
const get = (id: string): Room => {
  const r = byId.get(id);
  if (!r) throw new Error(`нет комнаты ${id}`);
  return r;
};

/** Габарит комнаты, м. */
function size(r: Room): [number, number] {
  const pts = [...r.cells].map(parseKey);
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  return [(Math.max(...xs) - Math.min(...xs) + 1) / 10, (Math.max(...ys) - Math.min(...ys) + 1) / 10];
}
/** Метки комнаты «сторона:метка», по порядку сторон. */
const conns = (r: Room) => r.connectors.map((c) => `${c.side}:${c.tag}`).sort();
const count = (r: Room, propId: string) => r.decor.filter((d) => d.propId === propId).length;

// [id, x, y (м), вид (2-й тег), ceilM, метки]
const TABLE: [string, number, number, string, number, string[]][] = [
  ['san_cor_9', 3, 9, 'коридор', 3.3, ['E:sanat>proc', 'E:sanat>room', 'E:sanat>room', 'N:sanat', 'S:sanat']],
  ['san_cor_9g', 3, 9, 'коридор', 3.3, ['N:sanat', 'S:sanat']],
  ['san_cor_6', 3, 6, 'коридор', 3.3, ['E:sanat>room', 'E:sanat>room', 'N:sanat', 'S:sanat']],
  ['san_cor_6p', 3, 6, 'коридор', 3.3, ['E:sanat>proc', 'N:sanat', 'S:sanat', 'W:sanat>proc']],
  ['san_cor_3', 3, 3, 'коридор', 3.3, ['N:sanat', 'S:sanat']],
  ['san_cor_9r', 3, 9, 'ремонт', 3.3, ['E:sanat>room', 'E:sanat>room', 'N:sanat', 'S:sanat']],
  ['san_cor_glass', 3, 3, 'коридор', 3.3, ['N:sanat', 'S:sanat']],
  ['san_cor_turn', 3, 3, 'коридор', 3.3, ['E:sanat', 'S:sanat']],
  ['san_cor_T', 3, 3, 'коридор', 3.3, ['E:sanat', 'N:sanat', 'S:sanat']],
  ['san_hub_vest', 12, 9, 'вестибюль', 4.2, ['E:sanat', 'N:sanat', 'S:stair', 'W:sanat']],
  ['san_hub_pool', 18, 14, 'бассейн', 7, ['E:sanat', 'S:sanat', 'W:sanat']],
  ['san_ward_2', 3.6, 5.4, 'палата', 3, ['S:room>sanat']],
  ['san_ward_lux', 4.8, 5.4, 'палата', 3, ['S:room>sanat']],
  ['san_ward_empty', 3.6, 5.4, 'палата', 3, ['S:room>sanat']],
  ['san_reno', 4.8, 5.4, 'ремонт', 3, ['S:room>sanat']],
  ['san_hydro', 4.8, 6, 'водолечебница', 3, ['S:proc>sanat']],
  ['san_mud', 4.8, 6, 'грязелечебница', 3, ['S:proc>sanat']],
  ['san_massage', 3.6, 4.2, 'кабинет', 3, ['S:proc>sanat']],
  ['san_charcot', 3.6, 6, 'душ', 3, ['S:proc>sanat']],
  ['san_dining', 9, 7.2, 'столовая', 3.3, ['S:proc>sanat']],
  ['san_reno_proc', 4.8, 5.4, 'ремонт', 3, ['S:proc>sanat']],
];

describe('комнаты санатория', () => {
  it('состав: все куски контракта, id с префиксом san_, без лишних', () => {
    expect(rooms.map((r) => r.id).sort()).toEqual(TABLE.map((t) => t[0]).sort());
    expect(new Set(rooms.map((r) => r.id)).size).toBe(rooms.length);
  });

  it('метки: ширины и высоты проёмов', () => {
    expect(TAG_LEN.sanat).toBe(30);
    for (const t of ['sanat>room', 'room>sanat', 'sanat>proc', 'proc>sanat'] as const) expect(TAG_LEN[t], t).toBe(9);
    expect(TAG_OPEN_H.sanat).toBe(3.3);
    expect(TAG_OPEN_H['sanat>room']).toBeUndefined();
  });

  describe.each(TABLE)('%s', (id, w, h, kind, ceilM, tags) => {
    const r = get(id);
    it('размер, теги, высота потолка, метки', () => {
      expect(size(r)).toEqual([w, h]);
      expect(r.tags[0]).toBe('санаторий');
      expect(r.tags[1]).toBe(kind);
      expect(r.tags).toContain('только-биом');
      expect(r.ceilM).toBe(ceilM);
      expect(conns(r)).toEqual(tags);
      expect(r.gen.weight).toBeGreaterThan(0);
    });

    it('свет: плафон или люстра под потолком', () => {
      expect(r.decor.some((d) => d.propId === 'p_san_ceiling_lamp' || d.propId === 'p_san_chandelier')).toBe(true);
    });

    it('пропы есть в каталоге', () => {
      for (const d of r.decor) expect(PROP_BY_ID[d.propId], d.propId).toBeDefined();
    });

    it('проходы не уже 0.7 м: капсула 0.7 м проходит между всеми проёмами и встаёт в каждом', () => {
      const res = walkCheck(r, props, undefined, { cellM: 0.1, radiusM: 0.35 });
      expect(walkMessage(res), r.name).toBeNull();
      expect(res.openings.every((o) => o.stand)).toBe(true);
    });
  });

  it('куски сети: «ход» / «хаб», повороты и развилки помечены; хабам — «длинный»', () => {
    for (const r of rooms.filter((x) => x.id.startsWith('san_cor_'))) expect(r.tags, r.id).toContain('ход');
    expect(get('san_cor_turn').tags).toContain('поворот');
    expect(get('san_cor_T').tags).toContain('развилка');
    for (const id of ['san_hub_vest', 'san_hub_pool']) expect(get(id).tags).toEqual(expect.arrayContaining(['хаб', 'длинный']));
    // вестибюль — ещё и «холл» (проектное правило отделки), коридор в ремонте — «ремонт» вторым
    expect(get('san_hub_vest').tags).toContain('холл');
    expect(get('san_cor_9r').tags.slice(0, 3)).toEqual(['санаторий', 'ремонт', 'коридор']);
    for (const r of rooms.filter((x) => !x.tags.includes('ход') && !x.tags.includes('хаб'))) expect(r.connectors, r.id).toHaveLength(1);
  });

  it('длинные прямые важнее всего: у кусков 9 м самый большой вес среди прямых', () => {
    const straight = rooms.filter((r) => r.tags.includes('ход') && !r.tags.includes('поворот') && !r.tags.includes('развилка'));
    const top = Math.max(...straight.map((r) => r.gen.weight));
    expect(get('san_cor_9').gen.weight).toBe(top);
    const w9 = straight.filter((r) => size(r)[1] === 9).reduce((s, r) => s + r.gen.weight, 0);
    const rest = straight.filter((r) => size(r)[1] !== 9).reduce((s, r) => s + r.gen.weight, 0);
    expect(w9).toBeGreaterThan(rest);
    // хабы чередуются: вестибюль 1, бассейн 0.7
    expect(get('san_hub_vest').gen.weight).toBe(1);
    expect(get('san_hub_pool').gen.weight).toBe(0.7);
  });

  it('дорожка: от торца до торца куска, в ремонте — без дорожки', () => {
    for (const id of ['san_cor_9', 'san_cor_9g', 'san_cor_6', 'san_cor_6p', 'san_cor_3', 'san_cor_glass', 'san_cor_T']) {
      const r = get(id);
      expect(count(r, 'p_san_runner') * 3, id).toBe(size(r)[1]);
    }
    expect(count(get('san_cor_9r'), 'p_san_runner')).toBe(0);
  });

  it('вестибюль: 4 колонны 0.6×0.6, регистратура, диваны, люстра, доска и часы', () => {
    const r = get('san_hub_vest');
    expect(r.cells.size).toBe(120 * 90 - 4 * 36);
    for (const [p, n] of [['p_san_reception', 1], ['p_san_sofa', 2], ['p_san_chandelier', 1], ['p_san_noticeboard', 1], ['p_san_clock', 1]] as const)
      expect(count(r, p), p).toBe(n);
    expect(count(r, 'p_san_palm')).toBeGreaterThanOrEqual(2);
  });

  it('бассейн: чаша 12×7 посередине, 2 лесенки, 6 стульев, 4 арочных окна и 4 свода, ноги сводов', () => {
    const r = get('san_hub_pool');
    expect(r.decor.filter((d) => d.propId === 'p_san_pool').map((d) => [d.x, d.y])).toEqual([[90, 70]]);
    for (const [p, n] of [['p_san_pool_ladder', 2], ['p_san_plastic_chair', 6], ['p_san_arch_window', 4], ['p_san_vault', 4], ['p_san_vault_leg', 10]] as const)
      expect(count(r, p), p).toBe(n);
    // своды — над окнами, ноги — в простенках у северной и южной стен
    const wins = r.decor.filter((d) => d.propId === 'p_san_arch_window').map((d) => d.x).sort((a, b) => a - b);
    const vaults = r.decor.filter((d) => d.propId === 'p_san_vault').map((d) => d.x).sort((a, b) => a - b);
    expect(vaults).toEqual(wins);
    for (const d of r.decor.filter((x) => x.propId === 'p_san_vault_leg')) expect(wins.some((x) => Math.abs(x - d.x) < 15), d.id).toBe(false);
  });

  it('боковые помещения — обстановка по таблице контракта', () => {
    const need: [string, [string, number][]][] = [
      ['san_ward_2', [['p_san_bed', 2], ['p_san_nightstand', 2], ['p_san_wardrobe', 1], ['p_san_table', 1], ['p_san_chair', 2], ['p_san_window_curtain', 1], ['p_san_radiator', 1]]],
      ['san_ward_lux', [['p_san_bed', 1], ['p_san_armchair', 2], ['p_san_rug', 1], ['p_san_table', 1], ['p_san_wardrobe', 1], ['p_san_window_curtain', 1]]],
      ['san_ward_empty', [['p_san_bed_frame', 1], ['p_san_debris', 1], ['p_san_nightstand', 1]]],
      ['san_reno', [['p_san_floor_gap', 2], ['p_san_lino_roll', 1], ['p_san_shovel', 1], ['p_san_wire_coil', 1], ['p_san_hanging_wire', 1], ['p_san_cement_bag', 2]]],
      ['san_reno_proc', [['p_san_floor_gap', 2], ['p_san_lino_roll', 1], ['p_san_shovel', 1], ['p_san_wire_coil', 1], ['p_san_hanging_wire', 1], ['p_san_cement_bag', 2]]],
      ['san_hydro', [['p_san_hydro_bath', 1], ['p_san_tile_wall', 1], ['p_san_tile_mural', 1], ['p_san_pipes_gauge', 1], ['p_san_sink', 1], ['p_san_slogan', 1], ['p_san_bench', 1]]],
      ['san_mud', [['p_san_couch', 3], ['p_san_mud_tank', 1], ['p_san_sink', 1]]],
      ['san_massage', [['p_san_couch', 1], ['p_san_desk', 1], ['p_san_chair', 1], ['p_san_med_cabinet', 1], ['p_san_scale', 1]]],
      ['san_charcot', [['p_san_charcot_desk', 1]]],
      ['san_dining', [['p_san_dining_table', 6], ['p_san_chair', 24], ['p_san_window_curtain', 3], ['p_san_buffet', 1]]],
    ];
    for (const [id, list] of need) for (const [p, n] of list) expect(count(get(id), p), `${id}: ${p}`).toBe(n);
  });

  it('настенное — к стене вплотную (окна, батареи, доски, часы, кафель, трубы, лозунг)', () => {
    const WALL = ['p_san_window_curtain', 'p_san_radiator', 'p_san_noticeboard', 'p_san_clock', 'p_san_arch_window', 'p_san_tile_wall', 'p_san_tile_mural', 'p_san_pipes_gauge', 'p_san_slogan', 'p_san_shovel', 'p_san_wire_coil'];
    for (const r of rooms)
      for (const d of r.decor.filter((x) => WALL.includes(x.propId))) {
        const p = PROP_BY_ID[d.propId];
        // задняя грань — в пределах полуклетки от стены (wall() округляет «от стены»)
        const back = d.rot === 0 ? [d.x, d.y - p.h * 5 - 0.5] : d.rot === 180 ? [d.x, d.y + p.h * 5 + 0.5] : d.rot === 270 ? [d.x - p.h * 5 - 0.5, d.y] : [d.x + p.h * 5 + 0.5, d.y];
        expect(r.cells.has(cellKey(Math.floor(back[0]), Math.floor(back[1]))), `${r.id}: ${d.id} ${d.propId}`).toBe(false);
      }
  });

  it('мебель не плоская там, где по ней ходить нельзя; дорожка, ковёр, вскрытый пол, мусор — плоские', () => {
    for (const id of ['p_san_runner', 'p_san_rug', 'p_san_floor_gap', 'p_san_debris']) expect(isFlatProp(props.get(id)!), id).toBe(true);
    for (const id of ['p_san_bed', 'p_san_pool', 'p_san_hydro_bath', 'p_san_dining_table', 'p_san_glass_screen', 'p_san_vault_leg']) expect(isFlatProp(props.get(id)!), id).toBe(false);
  });
});
