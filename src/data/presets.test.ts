// Самодостаточная проверка стартового проекта (не зависит от функций ядра, кроме cellKey/parseKey).
import { describe, expect, it, vi } from 'vitest';

vi.mock('./textures', () => ({ makeTexture: () => null }));

import type { LiftSpec, Project, Room, Segment, StairwellSpec } from '../model/types';
import { cellKey, parseKey, SIDE_DELTA } from '../model/cells';
import { tagsCompatible } from '../model/segments';
import { finishChances, finishRuleFor } from '../model/ops';
import { createDefaultProject } from './presets';
import { TAG_LEN } from './roomBuilder';
import { isFlatProp, variantFloorProps, walkCheck, walkMessage } from '../gen/walk';
import { DEFAULT_STAIRWELL } from '../locations/stairwell';
import { DEFAULT_LIFT, LIFT_SHAFT_X, LIFT_SHAFT_Z } from '../locations/lift';
import { DEFAULT_LAIR } from '../locations/lair';

const p: Project = createDefaultProject();
const M = p.settings.cellM;
const propById = new Map(p.props.map((x) => [x.id, x]));
const itemIds = new Set(p.items.map((x) => x.id));

function segCells(s: Segment): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i < s.len; i++)
    out.push(s.side === 'N' || s.side === 'S' ? [s.cx + i, s.cy] : [s.cx, s.cy + i]);
  return out;
}

/** Прямоугольник декора в клетках с учётом поворота. */
function decorRect(r: { x: number; y: number; rot: number }, w: number, h: number) {
  const rot = ((r.rot % 360) + 360) % 360;
  const [ex, ey] = rot === 90 || rot === 270 ? [h, w] : [w, h];
  const hx = ex / M / 2;
  const hy = ey / M / 2;
  return { x0: r.x - hx, x1: r.x + hx, y0: r.y - hy, y1: r.y + hy };
}

/** Клетки, которые покрывает прямоугольник, ужатый на shrink клеток с каждой стороны. */
function coveredCells(rc: { x0: number; x1: number; y0: number; y1: number }, shrink: number): [number, number][] {
  const out: [number, number][] = [];
  const x0 = Math.floor(rc.x0 + shrink), x1 = Math.ceil(rc.x1 - shrink);
  const y0 = Math.floor(rc.y0 + shrink), y1 = Math.ceil(rc.y1 - shrink);
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) out.push([x, y]);
  return out;
}

const GROUPS = ['лестница', 'коридор', 'лифт', 'подвал', 'сарай', 'снег', 'завод', 'служебное', 'общежитие', 'прихожая', 'кухня', 'санузел', 'жилая', 'балкон', 'кладовка'];
// на полу (ковёр, лужа, доска) и под потолком (лампа, труба): проёмы и проход не загораживают
const isFloorProp = (propId: string) => propById.get(propId)!.tags.includes('пол') || isFlatProp(propById.get(propId)!);

describe('стартовый проект', () => {
  it('базовые настройки', () => {
    expect(p.settings.cellM).toBe(0.1);
    expect(p.props.length).toBeGreaterThanOrEqual(35);
    expect(p.rooms.length).toBeGreaterThanOrEqual(80);
    expect(p.generator).toMatchObject({ seed: 'hrush-001', count: 30, gap: 1, match: 'exact', passId: null, sightM: 9 });
    const start = p.rooms.find((r) => r.id === p.generator.startRoomId);
    expect(start).toBeDefined();
    expect(start!.tags).toContain('start');
  });

  it('все id уникальны в проекте', () => {
    const ids: string[] = [];
    ids.push(...p.props.map((x) => x.id), ...p.items.map((x) => x.id));
    for (const r of p.rooms) {
      ids.push(r.id);
      ids.push(...r.doors.map((x) => x.id), ...r.connectors.map((x) => x.id));
      ids.push(...r.decor.map((x) => x.id), ...r.spots.map((x) => x.id), ...r.loot.map((x) => x.id));
      for (const g of r.spotGroups) ids.push(g.id, ...g.variants.map((v) => v.id));
    }
    for (const t of p.economy.tiers) ids.push(t.id, ...t.loot.map((x) => x.id));
    for (const s of p.economy.shops) ids.push(s.id, ...s.offers.map((x) => x.id));
    ids.push(...p.economy.passes.map((x) => x.id));
    ids.push(...p.finishes.map((x) => x.id));
    const dup = ids.filter((id, i) => ids.indexOf(id) !== i);
    expect(dup).toEqual([]);
  });

  describe.each(p.rooms.map((r) => [r.id, r] as [string, Room]))('комната %s', (_id, r) => {
    const has = (x: number, y: number) => r.cells.has(cellKey(x, y));

    it('двери и метки валидны по семантике Segment', () => {
      for (const s of [...r.doors, ...r.connectors]) {
        const [dx, dy] = SIDE_DELTA[s.side];
        for (const [x, y] of segCells(s)) {
          expect(has(x, y), `${s.id}: клетка ${x},${y} вне комнаты`).toBe(true);
          expect(has(x + dx, y + dy), `${s.id}: сосед ${x + dx},${y + dy} внутри`).toBe(false);
        }
      }
    });

    it('у каждой метки есть дверь той же геометрии, длина по таблице', () => {
      expect(r.connectors.length).toBeGreaterThan(0);
      for (const c of r.connectors) {
        const d = r.doors.find((d) => d.cx === c.cx && d.cy === c.cy && d.side === c.side && d.len === c.len);
        expect(d, `${c.id} без двери`).toBeDefined();
        expect(c.len).toBe(TAG_LEN[c.tag as keyof typeof TAG_LEN]);
      }
    });

    it('центры декора и спотов на полу', () => {
      for (const o of [...r.decor, ...r.spots]) {
        expect(has(Math.floor(o.x), Math.floor(o.y)), `${o.id} (${o.x},${o.y})`).toBe(true);
      }
    });

    it('декор не выходит за пол больше чем на 0.05 м', () => {
      for (const d of r.decor) {
        const pr = propById.get(d.propId)!;
        for (const [x, y] of coveredCells(decorRect(d, pr.w, pr.h), 0.05 / M))
          expect(has(x, y), `${d.id} (${pr.name}) вылезает в клетку ${x},${y}`).toBe(true);
      }
    });

    it('мебель не перекрывает проёмы (0.3 м перед дверью) и не пересекается', () => {
      const solid = r.decor.filter((d) => !isFloorProp(d.propId));
      const occ = new Map<string, string>();
      for (const d of solid) {
        const pr = propById.get(d.propId)!;
        for (const [x, y] of coveredCells(decorRect(d, pr.w, pr.h), 0.02 / M)) {
          const k = cellKey(x, y);
          expect(occ.get(k), `${d.id} пересекается с ${occ.get(k)}`).toBeUndefined();
          occ.set(k, d.id);
        }
      }
      for (const door of r.doors) {
        const [dx, dy] = SIDE_DELTA[door.side];
        for (const [x, y] of segCells(door))
          for (let k = 0; k < 3; k++) {
            const key = cellKey(x - dx * k, y - dy * k);
            expect(occ.get(key), `${occ.get(key)} загораживает ${door.id}`).toBeUndefined();
          }
      }
    });

    it('проходимость: капсула игрока (r 0.3 м) проходит между всеми проёмами мимо декора', () => {
      const res = walkCheck(r, propById, undefined, { cellM: M });
      expect(walkMessage(res), r.name).toBeNull();
      expect(res.ok).toBe(true);
    });

    it('проходимость: ни один вариант спотов сам по себе не перегораживает проход (вещи — у стен)', () => {
      for (const g of r.spotGroups)
        g.variants.forEach((v, vi) => {
          const own = variantFloorProps(r, g, v, propById);
          if (!own.length) return;
          const res = walkCheck(r, propById, own, { cellM: M });
          expect(walkMessage(res), `${g.name} В${vi + 1}`).toBeNull();
        });
    });

    it('нет прямых отрезков пола длиннее 9 м (кроме тега «длинный»)', () => {
      if (r.tags.includes('длинный')) return;
      const LIM = Math.round(9 / M);
      const pts = [...r.cells].map(parseKey);
      for (const [x, y] of pts) {
        // начало отрезка — клетка, у которой нет соседа слева / сверху
        if (!has(x - 1, y)) {
          let n = 0;
          while (has(x + n, y)) n++;
          expect(n, `${r.id}: строка y=${y} от x=${x}`).toBeLessThanOrEqual(LIM);
        }
        if (!has(x, y - 1)) {
          let n = 0;
          while (has(x, y + n)) n++;
          expect(n, `${r.id}: столбец x=${x} от y=${y}`).toBeLessThanOrEqual(LIM);
        }
      }
    });

    it('нет анфилад: проёмы на противоположных стенах не стоят друг напротив друга (кроме марша)', () => {
      if (r.id === 'stair_flight') return; // марш по определению сквозной
      // подвал: ходы и хабы — длинные сквозные пространства по замыслу (docs/GENERATOR-4D.md §17)
      if (r.tags.includes('ход') || r.tags.includes('хаб')) return;
      for (const a of r.doors)
        for (const b of r.doors) {
          if (a.id >= b.id || SIDE_DELTA[a.side][0] !== -SIDE_DELTA[b.side][0] || SIDE_DELTA[a.side][1] !== -SIDE_DELTA[b.side][1]) continue;
          const horiz = a.side === 'N' || a.side === 'S';
          const [a0, a1] = horiz ? [a.cx, a.cx + a.len] : [a.cy, a.cy + a.len];
          const [b0, b1] = horiz ? [b.cx, b.cx + b.len] : [b.cy, b.cy + b.len];
          // перекрытие по оси вдоль стены и прямая видимость между ними через пол комнаты
          for (let t = Math.max(a0, b0); t < Math.min(a1, b1); t++) {
            const [dx, dy] = SIDE_DELTA[b.side];
            let x = horiz ? t : a.cx, y = horiz ? a.cy : t;
            let hit = false;
            while (has(x, y)) {
              if (horiz ? y === b.cy : x === b.cx) { hit = true; break; }
              x += dx; y += dy;
            }
            expect(hit, `${a.id} ↔ ${b.id} видны насквозь (${t})`).toBe(false);
          }
        }
    });

    it('первый тег — одна из групп страницы спавна', () => {
      expect(GROUPS).toContain(r.tags[0]);
    });

    it('ссылки валидны', () => {
      for (const d of r.decor) expect(propById.has(d.propId), d.propId).toBe(true);
      const groupIds = new Set(r.spotGroups.map((g) => g.id));
      const spotIds = new Set(r.spots.map((s) => s.id));
      for (const s of r.spots) if (s.groupId !== null) expect(groupIds.has(s.groupId), s.id).toBe(true);
      for (const g of r.spotGroups) {
        expect(g.variants.length).toBeGreaterThan(0);
        for (const v of g.variants) {
          expect(v.weight).toBeGreaterThan(0);
          for (const [sid, a] of Object.entries(v.assign)) {
            expect(spotIds.has(sid), `${v.id}: спот ${sid}`).toBe(true);
            expect(r.spots.find((s) => s.id === sid)!.groupId).toBe(g.id);
            if (a.kind === 'prop') expect(propById.has(a.id), a.id).toBe(true);
            else expect(itemIds.has(a.id), a.id).toBe(true);
          }
        }
      }
      for (const l of r.loot) {
        expect(itemIds.has(l.itemId), l.itemId).toBe(true);
        expect(l.chance).toBeGreaterThan(0);
        expect(l.chance).toBeLessThanOrEqual(1);
        expect(l.min).toBeLessThanOrEqual(l.max);
      }
      const tierIds = new Set(p.economy.tiers.map((t) => t.id));
      for (const e of r.elite) expect(tierIds.has(e.tierId), e.tierId).toBe(true);
      expect(r.gen.min).toBeLessThanOrEqual(r.gen.max);
      if (r.unique) expect(r.gen.max).toBe(1);
      expect(r.note.length).toBeGreaterThan(20);
    });

    it('площадь соответствует типу помещения', () => {
      const a = r.cells.size * M * M;
      if (r.tags.includes('кухня')) expect(a).toBeGreaterThanOrEqual(4.5), expect(a).toBeLessThanOrEqual(7.6);
      if (r.tags.includes('санузел')) expect(a).toBeGreaterThanOrEqual(1.0), expect(a).toBeLessThanOrEqual(4.0);
      if (r.tags.includes('жилая')) expect(a).toBeGreaterThanOrEqual(6), expect(a).toBeLessThanOrEqual(19);
      if (r.tags.includes('прихожая')) expect(a).toBeGreaterThanOrEqual(2), expect(a).toBeLessThanOrEqual(7);
    });
  });

  it('таблица TAG_LEN: у каждой направленной метки есть зеркальная той же длины', () => {
    const tags = Object.keys(TAG_LEN) as (keyof typeof TAG_LEN)[];
    for (const t of tags) {
      const mates = tags.filter((u) => tagsCompatible(t, u));
      expect(mates.length, t).toBe(1);
      expect(TAG_LEN[mates[0]], t).toBe(TAG_LEN[t]);
    }
  });

  it('у каждого тега одна длина и есть совместимая метка той же длины у другой комнаты', () => {
    const lens = new Map<string, Set<number>>();
    for (const r of p.rooms)
      for (const c of r.connectors) {
        if (!lens.has(c.tag)) lens.set(c.tag, new Set());
        lens.get(c.tag)!.add(c.len);
      }
    for (const [tag, ls] of lens) expect(ls.size, tag).toBe(1);
    for (const r of p.rooms)
      for (const c of r.connectors) {
        const ok = p.rooms.some(
          (o) => o.id !== r.id && o.connectors.some((d) => tagsCompatible(c.tag, d.tag) && d.len === c.len),
        );
        expect(ok, `${c.id} (${c.tag}) не с чем стыковать`).toBe(true);
      }
  });

  it('входные двери прихожих стыкуются и с площадками, и с коридорами малосемейки', () => {
    const owners = p.rooms.filter((r) => r.connectors.some((c) => c.tag === 'landing>apt')).map((r) => r.id);
    expect(owners).toEqual(expect.arrayContaining(['landing_1464', 'corr_malosem_long', 'tambour_3']));
    for (const r of p.rooms.filter((r) => r.tags.includes('прихожая')))
      expect(r.connectors.some((c) => c.tag === 'apt>landing'), r.id).toBe(true);
  });

  it('спец-локация «Бесконечная лестница»: модуль 2.9×5.5 м, одна дверь квартиры по центру передней стены, без декора', () => {
    const r = p.rooms.find((x) => x.id === 'stair_loop')!;
    expect(r).toBeDefined();
    expect(r.location).toEqual(DEFAULT_STAIRWELL);
    expect((r.location as StairwellSpec).sounds).not.toBe(DEFAULT_STAIRWELL.sounds); // своя копия
    expect(r.tags).toEqual(expect.arrayContaining(['спец', 'лестница-петля']));
    expect(r.cells.size).toBe(29 * 55);
    expect(r.decor).toEqual([]);
    expect(r.spots).toEqual([]);
    expect(r.connectors).toHaveLength(1);
    const c = r.connectors[0];
    expect(c).toMatchObject({ tag: 'apt>landing', len: 10, side: 'S', cy: 54 });
    expect(Math.abs(c.cx + c.len / 2 - 29 / 2)).toBeLessThanOrEqual(0.5); // по центру (±0.05 м)
    expect(r.gen.weight).toBeLessThan(1);
    expect(r.gen.max).toBe(1);
    expect(p.economy.tiers.filter((t) => r.elite.some((e) => e.tierId === t.id)).every((t) => t.level >= 8)).toBe(true);
    // кроме спец-локаций «Бесконечная лестница», «Ржавый лифт», «Логово босса», «Ангар» (подтаявшая берлога снежных
    // ходов) и «Болото на крыше» (финал, завод) в пресетах их нет
    expect(p.rooms.filter((x) => x.location).map((x) => x.id)).toEqual(['snow_thaw', 'fac_swamp_roof', 'stair_loop', 'lift_rusty', 'lift_carriage', 'boss_lair']);
  });

  const levels = (r: Room) => p.economy.tiers.filter((t) => r.elite.some((e) => e.tierId === t.id)).map((t) => t.level);

  it('спец-локации «Ржавый лифт А — клетка» и «Б — каретка»: шахта 3.6×4.4 м (ассет rusted_lift_v2), один вход 1.0 м (apt>landing) по центру стороны S, без декора', () => {
    let weight = 0;
    for (const [id, cageChance, tag] of [['lift_rusty', 1, 'лифт-клетка'], ['lift_carriage', 0, 'лифт-каретка']] as const) {
      const r = p.rooms.find((x) => x.id === id)!;
      expect(r).toBeDefined();
      expect(r.location).toEqual({ ...DEFAULT_LIFT, cageChance });
      expect((r.location as LiftSpec).floorsUp).not.toBe(DEFAULT_LIFT.floorsUp); // своя копия
      expect(r.tags[0]).toBe('лифт');
      expect(r.tags).toEqual(expect.arrayContaining(['спец', 'лифт-шахта', tag]));
      const n = Math.round(LIFT_SHAFT_X / M), d = Math.round(LIFT_SHAFT_Z / M);
      expect(r.cells.size).toBe(n * d);
      expect(r.decor).toEqual([]);
      expect(r.spots).toEqual([]);
      expect(r.connectors).toHaveLength(1);
      const c = r.connectors[0];
      expect(c).toMatchObject({ tag: 'apt>landing', len: 10, side: 'S', cy: d - 1 });
      expect(Math.abs(c.cx + c.len / 2 - n / 2)).toBeLessThanOrEqual(0.5); // по центру (±0.05 м)
      expect(r.gen.weight).toBeGreaterThan(0);
      expect(r.gen.max).toBe(1);
      weight += r.gen.weight;
      // умеренно элитный: тиры 3…8
      expect(levels(r).every((l) => l >= 3 && l <= 8)).toBe(true);
    }
    // вместе — как откалиброванный вес лифта (docs/LOCATIONS.md §8.1)
    expect(weight).toBeLessThanOrEqual(3);
  });

  it('спец-локация «Логово босса»: заглушка 6.0×4.8 м, проём 1.3 м (corridor), вес 0 — только через лифт, богаче лифта', () => {
    const r = p.rooms.find((x) => x.id === 'boss_lair')!;
    expect(r).toBeDefined();
    expect(r.location).toEqual(DEFAULT_LAIR);
    expect(r.tags[0]).toBe('служебное');
    expect(r.tags).toEqual(expect.arrayContaining(['спец', 'логово']));
    expect(r.cells.size).toBe(60 * 48);
    expect(r.decor).toEqual([]);
    expect(r.connectors).toHaveLength(1);
    expect(r.connectors[0]).toMatchObject({ tag: 'corridor', len: 13 });
    expect(r.gen.weight).toBe(0);
    const lift = p.rooms.find((x) => x.id === 'lift_rusty')!;
    expect(Math.min(...levels(r))).toBeGreaterThan(Math.max(...levels(lift)));
  });


  it('все ключи клеток корректны', () => {
    // одна проверка на все клетки: expect на каждую из сотен тысяч клеток — секунды
    const bad: string[] = [];
    for (const r of p.rooms)
      for (const k of r.cells) {
        const [x, y] = parseKey(k);
        if (!Number.isInteger(x) || !Number.isInteger(y)) bad.push(`${r.id}: ${k}`);
      }
    expect(bad).toEqual([]);
  });

  it('экономика ссылается на существующие предметы и магазины', () => {
    const shopIds = new Set(p.economy.shops.map((s) => s.id));
    for (const t of p.economy.tiers) {
      expect(t.note.length).toBeGreaterThan(10);
      for (const row of t.loot) {
        if (row.source.kind === 'item') expect(itemIds.has(row.source.id), row.source.id).toBe(true);
        else expect(shopIds.has(row.source.id), row.source.id).toBe(true);
        for (const s of row.steps) expect(s.chance).toBeGreaterThan(0), expect(s.upTo).toBeGreaterThanOrEqual(1);
        // where должен совпадать с тегом какого-нибудь декора
        if (row.where) expect(p.props.some((pr) => pr.tags.includes(row.where)), row.where).toBe(true);
      }
    }
    for (const s of p.economy.shops) {
      expect(itemIds.has(s.currencyItemId)).toBe(true);
      expect(p.items.find((i) => i.id === s.currencyItemId)!.tags).toContain('currency');
      for (const o of s.offers) expect(itemIds.has(o.itemId), o.itemId).toBe(true);
    }
    for (const ps of p.economy.passes) {
      expect(itemIds.has(ps.priceItemId)).toBe(true);
      for (const id of Object.keys(ps.itemBoost)) expect(itemIds.has(id), id).toBe(true);
    }
    expect(p.economy.dangerLimit).toBe(100);
    const t1 = p.economy.tiers.find((t) => t.id === 'tier_1')!;
    expect(t1).toMatchObject({ level: 1, danger: 2 });
    const t15 = p.economy.tiers.find((t) => t.id === 'tier_15')!;
    expect(t15).toMatchObject({ level: 15, danger: 50 });
    expect(t15.loot.some((r) => r.source.id === 'it_samogon')).toBe(false);
  });

  describe('отделка', () => {
    const fin = new Map(p.finishes.map((f) => [f.id, f]));

    it('советский набор: ≥ 14 стеновых и ≥ 7 напольных, размеры повтора реальные', () => {
      expect(p.finishes.filter((f) => f.surface === 'wall').length).toBeGreaterThanOrEqual(14);
      expect(p.finishes.filter((f) => f.surface === 'floor').length).toBeGreaterThanOrEqual(7);
      for (const f of p.finishes) {
        expect(f.tileW, f.id).toBeGreaterThan(0.1);
        expect(f.tileH, f.id).toBeGreaterThan(0.1);
        expect(f.tileW, f.id).toBeLessThanOrEqual(1.5);
        expect(f.color, f.id).toMatch(/^#[0-9a-f]{6}$/);
        expect(f.name.length, f.id).toBeGreaterThan(3);
      }
      // кафель 15×15: 4 плитки на повтор
      expect(fin.get('f_tile_white')).toMatchObject({ tileW: 0.6, tileH: 0.6 });
      // обои пользователя: текстура вшита (data:URI JPEG), вертикальный раппорт 0.2 м — 3 на плитку
      const dm = fin.get('f_wp_damask')!;
      expect(dm.tex).toMatch(/^data:image\/jpeg;base64,/);
      expect(dm.tileH).toBe(0.6);
      expect(dm.tileW / dm.tileH).toBeCloseTo(467 / 451, 2);
    });

    it('dado — только у стен, на существующую стеновую отделку, высота 1–1.6 м', () => {
      const two = p.finishes.filter((f) => f.dado);
      expect(two.map((f) => f.id).sort()).toEqual(['f_two_bath', 'f_two_entrance', 'f_two_kitchen']);
      for (const f of two) {
        expect(f.surface).toBe('wall');
        expect(fin.get(f.dado!.finishId)?.surface, f.id).toBe('wall');
        expect(fin.get(f.dado!.finishId)!.dado, f.id).toBeNull();
        expect(f.dado!.heightM).toBeGreaterThanOrEqual(1);
        expect(f.dado!.heightM).toBeLessThanOrEqual(1.6);
      }
      expect(fin.get('f_two_entrance')!.dado).toEqual({ finishId: 'f_paint_green', heightM: 1.5 });
      expect(fin.get('f_two_bath')!.dado).toEqual({ finishId: 'f_tile_white', heightM: 1.5 });
    });

    it('правила: у каждой группы есть, ссылки валидны, поверхность совпадает, веса > 0', () => {
      const tags = p.finishRules.map((r) => r.tag);
      expect(new Set(tags).size).toBe(tags.length);
      // у группы — своё правило; у завода — по ступени влажности (сухо, сыро, течь, топь): правило 'завод' победило бы
      // их (правило — по первому тегу комнаты, у которого оно есть), поэтому его нет — у каждой комнаты группы правило
      // по другому её тегу
      for (const g of GROUPS) {
        if (tags.includes(g)) continue;
        const rooms = p.rooms.filter((r) => r.tags[0] === g);
        expect(rooms.length, g).toBeGreaterThan(0);
        for (const r of rooms) expect(finishRuleFor(p, r)?.tag, `${g}: ${r.id}`).toBeTruthy();
      }
      for (const r of p.finishRules) {
        expect(r.wall.length, r.tag).toBeGreaterThan(0);
        expect(r.floor.length, r.tag).toBeGreaterThan(0);
        for (const s of ['wall', 'floor'] as const)
          for (const x of r[s]) {
            expect(fin.get(x.finishId)?.surface, `${r.tag}: ${x.finishId}`).toBe(s);
            expect(x.weight).toBeGreaterThan(0);
          }
      }
      // у жилых — 4–5 обоев, дамаск — самый частый
      const liv = p.finishRules.find((r) => r.tag === 'жилая')!;
      expect(liv.wall.length).toBeGreaterThanOrEqual(4);
      const top = Math.max(...liv.wall.map((x) => x.weight));
      expect(liv.wall.find((x) => x.finishId === 'f_wp_damask')!.weight).toBe(top);
      // советская логика: санузел — кафель, подъезд — зелёная панель, подвал — бетон
      expect(p.finishRules.find((r) => r.tag === 'санузел')!.wall[0].finishId).toBe('f_two_bath');
      expect(p.finishRules.find((r) => r.tag === 'лестница')!.wall[0].finishId).toBe('f_two_entrance');
      expect(p.finishRules.find((r) => r.tag === 'подвал')!.floor).toEqual([{ finishId: 'f_concrete_floor', weight: 1 }]);
    });

    it('каждая отделка где-то используется; у каждой комнаты пресетов есть стены и пол', () => {
      const used = new Set<string>();
      for (const r of p.finishRules) for (const x of [...r.wall, ...r.floor]) used.add(x.finishId);
      // отделка подвалов — в правилах биомов бесконечного мира
      for (const b of p.world.biomes) for (const r of b.finishRules ?? []) for (const x of [...r.wall, ...r.floor]) used.add(x.finishId);
      for (const f of p.finishes) if (f.dado) used.add(f.dado.finishId);
      for (const f of p.finishes) expect(used.has(f.id), f.id).toBe(true);
      for (const r of p.rooms) {
        expect(r.finish, r.id).toEqual({ wall: null, floor: null });
        expect(finishRuleFor(p, r), r.id).not.toBeNull();
        const w = finishChances(p, r, 'wall'), fl = finishChances(p, r, 'floor');
        expect(w.reduce((s, x) => s + x.p, 0), r.id).toBeCloseTo(1);
        expect(fl.reduce((s, x) => s + x.p, 0), r.id).toBeCloseTo(1);
      }
    });
  });

  it('проект создаётся заново при каждом вызове (без общих ссылок)', () => {
    const a = createDefaultProject();
    const b = createDefaultProject();
    expect(a.rooms[0].cells).not.toBe(b.rooms[0].cells);
    a.rooms[0].decor.push({ id: 'x', propId: 'p_stool', x: 0, y: 0, rot: 0 });
    expect(b.rooms[0].decor.find((d) => d.id === 'x')).toBeUndefined();
    a.finishRules[0].wall[0].weight = 99;
    a.finishes[0].tags.push('x');
    expect(b.finishRules[0].wall[0].weight).not.toBe(99);
    expect(b.finishes[0].tags).not.toContain('x');
  });
});
