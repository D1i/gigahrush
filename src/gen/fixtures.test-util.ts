// Ручные фикстуры для тестов генератора (строятся через rectCells, без TODO(core)-функций).
import { expect } from 'vitest';
import { cellKey, OPPOSITE, parseKey, rectCells } from '../model/cells';
import type { Connector, Project, Room, Run, Side } from '../model/types';
import { tagsCompatible } from '../model/segments';
import { runWorld, type InstanceWorld } from './world';

export interface RoomOpts {
  tags?: string[];
  weight?: number;
  min?: number;
  max?: number;
  unique?: boolean;
  /** метки: [сторона, длина, tag] — ставятся по центру стены */
  conns?: [Side, number, string?][];
}

let seq = 0;

export function rectRoom(id: string, w: number, h: number, o: RoomOpts = {}): Room {
  const conns: Connector[] = (o.conns ?? []).map(([side, len, tag], i) => {
    const horiz = side === 'N' || side === 'S';
    const cx = horiz ? Math.floor((w - len) / 2) : side === 'W' ? 0 : w - 1;
    const cy = horiz ? (side === 'N' ? 0 : h - 1) : Math.floor((h - len) / 2);
    return { id: `${id}_c${i}`, name: `м${i}`, tag: tag ?? 'door', cx, cy, side, len };
  });
  return {
    id,
    name: `Комната ${id}`,
    tags: o.tags ?? [],
    unique: o.unique ?? false,
    gen: { weight: o.weight ?? 1, min: o.min ?? 0, max: o.max ?? 99 },
    cells: rectCells(0, 0, w, h),
    doors: [],
    connectors: conns,
    decor: [],
    spots: [],
    spotGroups: [],
    loot: [],
    elite: [],
    note: `fixture ${seq++}`,
    finish: { wall: null, floor: null },
  };
}

export const ALL4 = (len: number, tag = 'door'): [Side, number, string][] => [
  ['N', len, tag],
  ['E', len, tag],
  ['S', len, tag],
  ['W', len, tag],
];

export function project(rooms: Room[], extra: Partial<Project> = {}): Project {
  return {
    settings: { cellM: 0.1 },
    props: [],
    items: [],
    rooms,
    generator: { seed: 'test', count: 20, gap: 1, match: 'exact', startRoomId: null, passId: null, sightM: 0, fill: false },
    economy: { tiers: [], shops: [], passes: [], dangerLimit: 100 },
    finishes: [],
    finishRules: [],
    ...extra,
  };
}

/** L-образная комната (несимметричная — ловит ошибки поворота). */
export function lRoom(id: string, conns: Connector[]): Room {
  const r = rectRoom(id, 1, 1);
  r.cells = new Set([...rectCells(0, 0, 30, 12), ...rectCells(0, 12, 12, 18)]);
  r.connectors = conns;
  return r;
}

export function lProject(): Project {
  const lr = lRoom('L', [
    { id: 'Ln', name: 'n', tag: 'door', cx: 11, cy: 0, side: 'N', len: 8 },
    { id: 'Le', name: 'e', tag: 'door', cx: 29, cy: 2, side: 'E', len: 8 },
    { id: 'Ls', name: 's', tag: 'door', cx: 2, cy: 29, side: 'S', len: 8 },
    { id: 'Li', name: 'inner', tag: 'door', cx: 11, cy: 16, side: 'E', len: 8 }, // внутренний угол
  ]);
  return project([rectRoom('box', 20, 16, { tags: ['start'], conns: ALL4(8) }), lr]);
}

/** Комната с группой спотов (веса 1:2:7), декором, лутом и элитностью; экономика с магазином и проходкой. */
export function contentProject(): Project {
  const r = rectRoom('room', 20, 20, { tags: ['start'] });
  r.spots = [
    { id: 's1', name: 'a', x: 2.5, y: 3.5, rot: 90, groupId: 'g' },
    { id: 's2', name: 'b', x: 5.5, y: 3.5, rot: 0, groupId: 'g' },
    { id: 's3', name: 'free', x: 8.5, y: 8.5, rot: 0, groupId: null },
  ];
  r.spotGroups = [{
    id: 'g', name: 'G', color: '#fff', variants: [
      { id: 'v1', weight: 1, assign: { s1: { kind: 'prop', id: 'sideboard', rot: 0 } } },
      { id: 'v2', weight: 2, assign: { s1: { kind: 'item', id: 'kop', rot: 90 }, s2: { kind: 'item', id: 'kop', rot: 0 } } },
      { id: 'v3', weight: 7, assign: {} },
    ],
  }];
  r.decor = [{ id: 'd1', propId: 'wardrobe', x: 10, y: 1, rot: 0 }];
  r.loot = [{ id: 'l1', itemId: 'kop', chance: 0.5, min: 2, max: 4 }];
  r.elite = [{ tierId: 't1', weight: 3 }, { tierId: 't2', weight: 1 }];
  return project([r], {
    props: [
      { id: 'sideboard', name: 'Сервант', w: 1, h: 0.4, color: '#a00', tex: 'data:image/png;base64,AAAA', tags: ['сервант'] },
      { id: 'wardrobe', name: 'Шкаф', w: 1, h: 0.6, color: '#0a0', tex: null, tags: ['шкаф-инструменты'] },
    ],
    items: [
      { id: 'kop', name: 'Копейки', color: '#ff0', tags: ['currency'], note: '' },
      { id: 'sam', name: 'Самогонка', color: '#0ff', tags: [], note: '' },
      { id: 'drill', name: 'Дрель', color: '#888', tags: [], note: '' },
      { id: 'tape', name: 'Изолента', color: '#888', tags: [], note: '' },
    ],
    economy: {
      dangerLimit: 100,
      tiers: [
        { id: 't1', name: 'Обычная', level: 1, danger: 5, color: '#ccc', note: '', loot: [] },
        {
          id: 't2', name: 'Элитная', level: 2, danger: 50, color: '#f00', note: '', loot: [
            { id: 'r1', source: { kind: 'item', id: 'kop' }, steps: [{ upTo: 5, chance: 0.3 }, { upTo: 30, chance: 0.4 }], where: '' },
            { id: 'r2', source: { kind: 'item', id: 'sam' }, steps: [{ upTo: 1, chance: 0.5 }], where: 'сервант' },
            { id: 'r3', source: { kind: 'shop', id: 'el' }, steps: [{ upTo: 1, chance: 0.5 }], where: 'шкаф-инструменты' },
            { id: 'r4', source: { kind: 'item', id: 'sam' }, steps: [{ upTo: 1, chance: 1 }], where: 'холодильник' },
          ],
        },
      ],
      shops: [{ id: 'el', name: 'Магазин электрика', currencyItemId: 'kop', note: '', offers: [
        { id: 'o1', itemId: 'drill', price: 10 }, { id: 'o2', itemId: 'tape', price: 2 },
      ] }],
      passes: [{ id: 'pass', name: 'Проходка', priceItemId: 'sam', price: 1, tierBoost: 3, itemBoost: { sam: 2 }, note: '' }],
    },
  });
}

// ───────── проверки инвариантов раскладки ─────────

export function checkNoOverlap(worlds: InstanceWorld[], gap: number): void {
  const owner = new Map<string, number>();
  worlds.forEach((w, i) => {
    for (const k of w.cells) {
      if (owner.has(k)) throw new Error(`клетка ${k} занята дважды`);
      owner.set(k, i);
    }
  });
  worlds.forEach((w, i) => {
    for (const k of w.cells) {
      const [x, y] = parseKey(k);
      for (let oy = -gap; oy <= gap; oy++) for (let ox = -gap; ox <= gap; ox++) {
        const o = owner.get(cellKey(x + ox, y + oy));
        if (o !== undefined && o !== i) {
          throw new Error(`экземпляры ${w.inst.id} и ${worlds[o].inst.id} ближе gap=${gap} у клетки ${k}`);
        }
      }
    }
  });
}

/** Линия отрезка по нормали и отрезок вдоль стены — независимая от генератора реализация. */
function lineOf(c: Connector): { n: number; a0: number; a1: number } {
  switch (c.side) {
    case 'N': return { n: c.cy, a0: c.cx, a1: c.cx + c.len };
    case 'S': return { n: c.cy + 1, a0: c.cx, a1: c.cx + c.len };
    case 'W': return { n: c.cx, a0: c.cy, a1: c.cy + c.len };
    case 'E': return { n: c.cx + 1, a0: c.cy, a1: c.cy + c.len };
  }
}

export function checkLinks(p: Project, run: Run): void {
  const worlds = runWorld(p, run);
  const byId = new Map(worlds.map((w) => [w.inst.id, w]));
  const used = new Set<string>();
  const gap = run.settings.gap;
  for (const l of run.links) {
    const A = byId.get(l.a.inst)!.connectors.find((c) => c.id === l.a.connector)!;
    const B = byId.get(l.b.inst)!.connectors.find((c) => c.id === l.b.connector)!;
    expect(A && B).toBeTruthy();
    expect(l.a.inst).not.toBe(l.b.inst);
    for (const key of [`${l.a.inst}/${l.a.connector}`, `${l.b.inst}/${l.b.connector}`]) {
      expect(used.has(key), `метка ${key} связана дважды`).toBe(false);
      used.add(key);
    }
    // лицом к лицу
    expect(B.side).toBe(OPPOSITE[A.side]);
    const la = lineOf(A), lb = lineOf(B);
    const sign = A.side === 'S' || A.side === 'E' ? 1 : -1;
    expect(lb.n - la.n === sign * gap).toBe(true);
    // вдоль стены: центры совпадают с точностью до округления
    expect(Math.abs((la.a0 + la.a1) / 2 - (lb.a0 + lb.a1) / 2)).toBeLessThanOrEqual(0.5);
    if (A.len === B.len) expect(la.a0).toBe(lb.a0);
    // совместимость
    const m = run.settings.match;
    if (m !== 'len') expect(tagsCompatible(A.tag, B.tag), `теги ${A.tag} / ${B.tag}`).toBe(true);
    if (m !== 'tag') expect(A.len).toBe(B.len);
  }
  // каждая метка — либо в связи, либо в тупиках
  const open = new Set(run.openConnectors.map((o) => `${o.inst}/${o.connector}`));
  for (const k of open) expect(used.has(k)).toBe(false);
  for (const w of worlds) for (const c of w.connectors) {
    const k = `${w.inst.id}/${c.id}`;
    expect(used.has(k) || open.has(k), `метка ${k} потеряна`).toBe(true);
  }
}

export function countBy(run: Run): Map<string, number> {
  const m = new Map<string, number>();
  for (const i of run.instances) m.set(i.roomId, (m.get(i.roomId) ?? 0) + 1);
  return m;
}

export const strip = (r: Run) => ({ ...r, ms: 0 });

/** Дешёвая проверка для горячих циклов (expect в vitest заметно медленнее). */
export function ok(cond: unknown, msg: string): void {
  if (!cond) throw new Error(msg);
}

const c = (id: string, side: Side, len: number, tag: string, cx: number, cy: number): Connector =>
  ({ id, name: id, tag, cx, cy, side, len });

/** Модель пресетов: лестничные площадки/марши растят мир, квартиры — листья. */
export function hrushLike(): Project {
  const landing = rectRoom('landing', 24, 15, { tags: ['start'], max: 10 });
  landing.connectors = [
    c('st1', 'N', 11, 'stair', 0, 0), c('st2', 'N', 11, 'stair', 13, 0),
    c('a1', 'S', 10, 'landing>apt', 1, 14), c('a2', 'S', 10, 'landing>apt', 13, 14),
    c('a3', 'W', 10, 'landing>apt', 0, 3), c('a4', 'E', 10, 'landing>apt', 23, 3),
  ];
  const mid = rectRoom('mid', 24, 13, { weight: 2, max: 10 });
  mid.connectors = [c('m1', 'S', 11, 'stair', 0, 12), c('m2', 'S', 11, 'stair', 13, 12)];
  const flight = rectRoom('flight', 11, 27, { weight: 2, max: 15 });
  flight.connectors = [c('f1', 'N', 11, 'stair', 0, 0), c('f2', 'S', 11, 'stair', 0, 26)];
  const foyer = rectRoom('foyer', 13, 24, { weight: 3, max: 30 });
  foyer.connectors = [c('h0', 'S', 10, 'apt>landing', 2, 23), c('h1', 'N', 9, 'hall>room', 2, 0), c('h2', 'E', 8, 'hall>kitchen', 12, 2)];
  const room = rectRoom('room', 30, 40, { weight: 3, max: 30 });
  room.connectors = [c('r0', 'S', 9, 'room>hall', 2, 39)];
  const kitchen = rectRoom('kitchen', 20, 20, { weight: 3, max: 30 });
  kitchen.connectors = [c('k0', 'W', 8, 'kitchen>hall', 0, 1)];
  return project([landing, mid, flight, foyer, room, kitchen]);
}
