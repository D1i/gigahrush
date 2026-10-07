// Операции над проектом: создание, дублирование, каскадное удаление, счётчики, комбинации.
// Все функции мутируют переданный проект на месте (вызывать внутри mutate()).
import type { Assign, Finish, FinishRule, FinishSurface, Item, Project, Prop, Room, SpotGroup, Variant } from './types';
import { areaM2, rectCells } from './cells';
import { cloneLocation } from '../locations/stairwell';

let uidCounter = 0;

/** Уникальный строковый id: `${prefix}_${base36}`; уникален в пределах сессии и проекта.
 *  Состав: время (6 знаков) + счётчик сессии + 3 случайных знака. Счётчик гарантирует
 *  уникальность в сессии, время и случайность — между сессиями. */
export function uid(prefix: string): string {
  const t = Date.now().toString(36).slice(-6);
  const c = (uidCounter++).toString(36);
  const r = Math.floor(Math.random() * 46656).toString(36).padStart(3, '0');
  return `${prefix}_${t}${c}${r}`;
}

/** Новая комната: прямоугольник wM×hM метров с углом в (0,0), gen {1,0,99}, пустое содержимое. */
export function createRoom(p: Project, name: string, wM = 3, hM = 3): Room {
  const cellM = p.settings.cellM || 0.1;
  const w = Math.max(1, Math.round(wM / cellM));
  const h = Math.max(1, Math.round(hM / cellM));
  const room: Room = {
    id: uid('room'),
    name,
    tags: [],
    unique: false,
    gen: { weight: 1, min: 0, max: 99 },
    cells: rectCells(0, 0, w, h),
    doors: [],
    connectors: [],
    decor: [],
    spots: [],
    spotGroups: [],
    loot: [],
    elite: [],
    note: '',
    finish: { wall: null, floor: null },
  };
  p.rooms.push(room);
  return room;
}

/** Дублирование (ТЗ §4): все внутренние id выдаются заново, assign перевешиваются на новые споты,
 *  spot.groupId — на новые группы. Копия вставляется сразу после оригинала. Возвращает копию. */
export function duplicateRoom(p: Project, roomId: string): Room {
  const i = p.rooms.findIndex((r) => r.id === roomId);
  if (i < 0) throw new Error(`Комната «${roomId}» не найдена`);
  const r = p.rooms[i];
  const spotMap = new Map<string, string>();
  const groupMap = new Map<string, string>();
  for (const s of r.spots) spotMap.set(s.id, uid('spot'));
  for (const g of r.spotGroups) groupMap.set(g.id, uid('grp'));
  const copy: Room = {
    id: uid('room'),
    name: `${r.name} (копия)`,
    tags: [...r.tags],
    unique: r.unique,
    gen: { ...r.gen },
    cells: new Set(r.cells),
    doors: r.doors.map((d) => ({ ...d, id: uid('door') })),
    connectors: r.connectors.map((c) => ({ ...c, id: uid('con') })),
    decor: r.decor.map((d) => ({ ...d, id: uid('dec') })),
    spots: r.spots.map((s) => ({
      ...s,
      id: spotMap.get(s.id)!,
      groupId: s.groupId !== null ? groupMap.get(s.groupId) ?? null : null,
    })),
    spotGroups: r.spotGroups.map((g) => ({
      ...g,
      id: groupMap.get(g.id)!,
      variants: g.variants.map((v) => {
        const assign: Record<string, Assign> = {};
        for (const [sid, a] of Object.entries(v.assign)) {
          const nid = spotMap.get(sid);
          if (nid) assign[nid] = { ...a };
        }
        return { ...v, id: uid('var'), assign };
      }),
    })),
    loot: r.loot.map((l) => ({ ...l, id: uid('loot') })),
    elite: r.elite.map((e) => ({ ...e })),
    note: r.note,
    finish: { wall: r.finish?.wall ?? null, floor: r.finish?.floor ?? null },
    ...(r.location !== undefined ? { location: cloneLocation(r.location) } : {}),
  };
  p.rooms.splice(i + 1, 0, copy);
  return copy;
}

export function deleteRoom(p: Project, roomId: string): void {
  p.rooms = p.rooms.filter((r) => r.id !== roomId);
  if (p.generator.startRoomId === roomId) p.generator.startRoomId = null;
}

export function createProp(p: Project, partial?: Partial<Prop>): Prop {
  const prop: Prop = {
    id: '',
    name: 'Новый декор',
    w: 1,
    h: 0.5,
    color: '#8a7a5c',
    tex: null,
    tags: [],
    ...partial,
  };
  // занятый или пустой id не переиспользуется
  if (!prop.id || p.props.some((x) => x.id === prop.id)) prop.id = uid('prop');
  p.props.push(prop);
  return prop;
}

export function createItem(p: Project, partial?: Partial<Item>): Item {
  const item: Item = {
    id: '',
    name: 'Новый предмет',
    color: '#c9a227',
    tags: [],
    note: '',
    ...partial,
  };
  if (!item.id || p.items.some((x) => x.id === item.id)) item.id = uid('item');
  p.items.push(item);
  return item;
}

/** Удалить из всех вариантов комнаты назначения, подходящие под pred. Возвращает число. */
function dropAssigns(room: Room, pred: (a: Assign) => boolean): number {
  let n = 0;
  for (const g of room.spotGroups) {
    for (const v of g.variants) {
      for (const k of Object.keys(v.assign)) {
        if (pred(v.assign[k])) {
          delete v.assign[k];
          n++;
        }
      }
    }
  }
  return n;
}

function countAssigns(room: Room, pred: (a: Assign) => boolean): number {
  let n = 0;
  for (const g of room.spotGroups) for (const v of g.variants) for (const a of Object.values(v.assign)) if (pred(a)) n++;
  return n;
}

/** Каскад (ТЗ §6): экземпляры декора в комнатах + назначения в вариантах. */
export function deleteProp(p: Project, propId: string): { decor: number; assigns: number } {
  let decor = 0, assigns = 0;
  p.props = p.props.filter((x) => x.id !== propId);
  for (const r of p.rooms) {
    const before = r.decor.length;
    r.decor = r.decor.filter((d) => d.propId !== propId);
    decor += before - r.decor.length;
    assigns += dropAssigns(r, (a) => a.kind === 'prop' && a.id === propId);
  }
  return { decor, assigns };
}

/** Каскад (ТЗ §6): строки лута + назначения на спотах; плюс экономика: строки тиров,
 *  товары магазинов, itemBoost проходок; магазины с этой валютой удаляются. */
export function deleteItem(p: Project, itemId: string): { loot: number; assigns: number; economy: number } {
  let loot = 0, assigns = 0, economy = 0;
  p.items = p.items.filter((x) => x.id !== itemId);
  for (const r of p.rooms) {
    const before = r.loot.length;
    r.loot = r.loot.filter((l) => l.itemId !== itemId);
    loot += before - r.loot.length;
    assigns += dropAssigns(r, (a) => a.kind === 'item' && a.id === itemId);
  }
  const eco = p.economy;
  // магазины с этой валютой — целиком; остальные теряют товар
  const deadShops = new Set(eco.shops.filter((s) => s.currencyItemId === itemId).map((s) => s.id));
  economy += deadShops.size;
  eco.shops = eco.shops.filter((s) => !deadShops.has(s.id));
  for (const s of eco.shops) {
    const before = s.offers.length;
    s.offers = s.offers.filter((o) => o.itemId !== itemId);
    economy += before - s.offers.length;
  }
  // строки тиров: сам предмет или удалённый магазин
  for (const t of eco.tiers) {
    const before = t.loot.length;
    t.loot = t.loot.filter((row) =>
      row.source.kind === 'item' ? row.source.id !== itemId : !deadShops.has(row.source.id),
    );
    economy += before - t.loot.length;
  }
  // проходки: оплачиваемые этим предметом — удаляются, в остальных чистится itemBoost
  const deadPasses = new Set(eco.passes.filter((x) => x.priceItemId === itemId).map((x) => x.id));
  economy += deadPasses.size;
  eco.passes = eco.passes.filter((x) => !deadPasses.has(x.id));
  for (const x of eco.passes) {
    if (itemId in x.itemBoost) {
      delete x.itemBoost[itemId];
      economy++;
    }
  }
  if (p.generator.passId && deadPasses.has(p.generator.passId)) p.generator.passId = null;
  return { loot, assigns, economy };
}

/** Удалить спот: из вариантов его группы тоже. */
export function deleteSpot(room: Room, spotId: string): void {
  room.spots = room.spots.filter((s) => s.id !== spotId);
  for (const g of room.spotGroups) for (const v of g.variants) delete v.assign[spotId];
}

/** Удалить группу: споты группы становятся без группы (groupId = null). */
export function deleteSpotGroup(room: Room, groupId: string): void {
  room.spotGroups = room.spotGroups.filter((g) => g.id !== groupId);
  for (const s of room.spots) if (s.groupId === groupId) s.groupId = null;
}

/** Перевод спота в другую группу (или null): удалить его ключи из вариантов старой группы. */
export function setSpotGroup(room: Room, spotId: string, groupId: string | null): void {
  const spot = room.spots.find((s) => s.id === spotId);
  if (!spot) return;
  const target = groupId !== null && room.spotGroups.some((g) => g.id === groupId) ? groupId : null;
  if (spot.groupId === target) return;
  const old = room.spotGroups.find((g) => g.id === spot.groupId);
  if (old) for (const v of old.variants) delete v.assign[spotId];
  spot.groupId = target;
}

export interface Usage {
  rooms: number;
  decor: number;
  loot: number;
  assigns: number;
  economy: number;
  total: number;
}

export function propUsage(p: Project, propId: string): Usage {
  const u: Usage = { rooms: 0, decor: 0, loot: 0, assigns: 0, economy: 0, total: 0 };
  for (const r of p.rooms) {
    const d = r.decor.filter((x) => x.propId === propId).length;
    const a = countAssigns(r, (x) => x.kind === 'prop' && x.id === propId);
    u.decor += d;
    u.assigns += a;
    if (d + a > 0) u.rooms++;
  }
  u.total = u.decor + u.assigns;
  return u;
}

export function itemUsage(p: Project, itemId: string): Usage {
  const u: Usage = { rooms: 0, decor: 0, loot: 0, assigns: 0, economy: 0, total: 0 };
  for (const r of p.rooms) {
    const l = r.loot.filter((x) => x.itemId === itemId).length;
    const a = countAssigns(r, (x) => x.kind === 'item' && x.id === itemId);
    u.loot += l;
    u.assigns += a;
    if (l + a > 0) u.rooms++;
  }
  const eco = p.economy;
  for (const t of eco.tiers) for (const row of t.loot) if (row.source.kind === 'item' && row.source.id === itemId) u.economy++;
  for (const s of eco.shops) {
    if (s.currencyItemId === itemId) u.economy++;
    for (const o of s.offers) if (o.itemId === itemId) u.economy++;
  }
  for (const x of eco.passes) if (x.priceItemId === itemId || itemId in x.itemBoost) u.economy++;
  u.total = u.loot + u.assigns + u.economy;
  return u;
}

/**
 * «Все комбинации» (ТЗ §7): для группы из n ≤ 6 спотов создаёт 2ⁿ вариантов с весом 1.
 * Вариант k заполняет спот i (i — индекс в порядке room.spots), если бит i установлен.
 * Содержимое спота — шаблон: первое назначение этого спота среди существующих вариантов,
 * иначе fallback; если нет и его — спот пропускается. Старые варианты заменяются.
 * Бросает Error при n > 6.
 */
export function allCombinations(room: Room, groupId: string, fallback: Assign | null): Variant[] {
  const group = room.spotGroups.find((g) => g.id === groupId);
  if (!group) throw new Error(`Группа «${groupId}» не найдена`);
  const spots = room.spots.filter((s) => s.groupId === groupId);
  const n = spots.length;
  if (n > 6) throw new Error('Больше 6 спотов — «все комбинации» заблокированы');
  const templates = spots.map((s): Assign | null => {
    for (const v of group.variants) if (v.assign[s.id]) return v.assign[s.id];
    return fallback;
  });
  const variants: Variant[] = [];
  for (let k = 0; k < 1 << n; k++) {
    const assign: Record<string, Assign> = {};
    for (let i = 0; i < n; i++) {
      const t = templates[i];
      if (k & (1 << i) && t) assign[spots[i].id] = { ...t };
    }
    variants.push({ id: uid('var'), weight: 1, assign });
  }
  group.variants = variants;
  return variants;
}

/** Шанс варианта: w / Σw (0, если Σw = 0). */
export function variantChance(group: SpotGroup, variantId: string): number {
  let sum = 0;
  let w = 0;
  for (const v of group.variants) {
    const vw = Math.max(0, v.weight);
    sum += vw;
    if (v.id === variantId) w = vw;
  }
  return sum > 0 ? w / sum : 0;
}

/** Площадь комнаты, м². */
export function roomArea(p: Project, room: Room): number {
  return areaM2(room.cells, p.settings.cellM);
}

// ───────────── Отделка ─────────────

/** Новая отделка (добавляется в p.finishes). Поверхность — из аргумента (partial.surface игнорируется). */
export function createFinish(p: Project, surface: FinishSurface, partial?: Partial<Finish>): Finish {
  const f: Finish = {
    id: '',
    name: surface === 'wall' ? 'Новая отделка стен' : 'Новое покрытие пола',
    surface,
    color: surface === 'wall' ? '#b9b29c' : '#8c7a62',
    tex: null,
    tileW: 0.5,
    tileH: 0.5,
    dado: null,
    tags: [],
    ...partial,
  };
  f.surface = surface;
  f.tags = [...f.tags];
  if (f.dado) f.dado = { ...f.dado };
  if (!f.id || p.finishes.some((x) => x.id === f.id)) f.id = uid('fin');
  if (!(f.tileW > 0)) f.tileW = 0.5;
  if (!(f.tileH > 0)) f.tileH = 0.5;
  // нижняя панель — только у стен и только на существующую стеновую отделку (не на себя)
  if (f.dado && (surface !== 'wall' || f.dado.finishId === f.id || !p.finishes.some((x) => x.id === f.dado!.finishId && x.surface === 'wall'))) f.dado = null;
  p.finishes.push(f);
  return f;
}

/** Каскад: явные назначения комнат → null, строки правил с этой отделкой удаляются,
 *  dado других отделок, ссылающиеся на неё, → null. Возвращает число затронутых ссылок. */
export function deleteFinish(p: Project, finishId: string): number {
  let n = 0;
  p.finishes = p.finishes.filter((f) => f.id !== finishId);
  for (const r of p.rooms) {
    if (!r.finish) continue;
    if (r.finish.wall === finishId) { r.finish.wall = null; n++; }
    if (r.finish.floor === finishId) { r.finish.floor = null; n++; }
  }
  for (const rule of p.finishRules) {
    const w = rule.wall.length, fl = rule.floor.length;
    rule.wall = rule.wall.filter((x) => x.finishId !== finishId);
    rule.floor = rule.floor.filter((x) => x.finishId !== finishId);
    n += w - rule.wall.length + fl - rule.floor.length;
  }
  for (const f of p.finishes) {
    if (f.dado?.finishId === finishId) { f.dado = null; n++; }
  }
  return n;
}

/** Где используется: комнаты с явным назначением, правила, dado. */
export function finishUsage(p: Project, finishId: string): { rooms: number; rules: number; dado: number; total: number } {
  let rooms = 0, rules = 0, dado = 0;
  for (const r of p.rooms) if (r.finish && (r.finish.wall === finishId || r.finish.floor === finishId)) rooms++;
  for (const rule of p.finishRules) {
    for (const x of rule.wall) if (x.finishId === finishId) rules++;
    for (const x of rule.floor) if (x.finishId === finishId) rules++;
  }
  for (const f of p.finishes) if (f.dado?.finishId === finishId) dado++;
  return { rooms, rules, dado, total: rooms + rules + dado };
}

/** Правило для комнаты: первое правило по порядку тегов комнаты (room.tags[0], затем [1]…), или null. */
export function finishRuleFor(p: Project, room: Room): FinishRule | null {
  for (const tag of room.tags) {
    const rule = (p.finishRules ?? []).find((r) => r.tag === tag);
    if (rule) return rule;
  }
  return null;
}

/** Отделка с этим id есть и годится для поверхности. */
const finishOk = (p: Project, id: string | null | undefined, surface: FinishSurface): id is string =>
  !!id && (p.finishes ?? []).some((f) => f.id === id && f.surface === surface);

/** Веса строк правила для розыгрыша: строки на несуществующую или не ту отделку весят 0.
 *  Тот же список и порядок использует генератор (rollFinish в gen/generate.ts). */
export function finishRuleWeights(p: Project, rule: FinishRule | null, surface: FinishSurface): { finishId: string; w: number }[] {
  if (!rule) return [];
  return rule[surface].map((x) => ({ finishId: x.finishId, w: finishOk(p, x.finishId, surface) ? Math.max(0, x.weight) : 0 }));
}

/** Что может выпасть комнате на поверхности: явное назначение → [{id, p: 1}],
 *  иначе варианты правила с вероятностями w/Σw; пусто — отделки нет.
 *  Повторы одной отделки в правиле складываются; варианты с p = 0 не выдаются. */
export function finishChances(p: Project, room: Room, surface: FinishSurface): { finishId: string; p: number }[] {
  const own = room.finish?.[surface];
  if (finishOk(p, own, surface)) return [{ finishId: own, p: 1 }];
  const rows = finishRuleWeights(p, finishRuleFor(p, room), surface);
  const sum = rows.reduce((s, x) => s + x.w, 0);
  if (!(sum > 0)) return [];
  const out: { finishId: string; p: number }[] = [];
  for (const x of rows) {
    if (x.w <= 0) continue;
    const hit = out.find((o) => o.finishId === x.finishId);
    if (hit) hit.p += x.w / sum;
    else out.push({ finishId: x.finishId, p: x.w / sum });
  }
  return out;
}
