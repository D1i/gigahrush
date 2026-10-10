// Хотбар игрока «Прогулки»: HOTBAR_SIZE ячеек, предмет в руке — выбранная ячейка (клавиши 1…5, колесо мыши), на спине —
// надетая сумка (back: ячейки не быстрого доступа, Tab). Чистая модель — без Babylon, DOM и localStorage: все функции
// возвращают новый Hotbar (старый не меняется; ничего не изменилось — тот же объект). Сохраняет слой вида: hotbarJSON →
// строка (формат v: 2), parseHotbar ← строка (v: 1 и v: 2; мусор → null).
//  • ячейка: предмет + состояние — on (горит), n (штук в стеке; нет — 1, хранится только ≥ 2), q (заряд/топливо 0…1;
//    нет — 1), w (износ 0…1; нет — 0), u (биты апгрейдов 0…255; нет — 0);
//  • стек: одинаковые предметы с одинаковыми on/q/w/u складываются в ячейку до stackOf(item) (каталог лута
//    src/data/itemsLoot.ts; не из каталога — 1, не складывается);
//  • add: сперва дополнить стеки (хотбар, потом сумка), затем пустая ячейка хотбара (выбранная — первой), затем пустая
//    ячейка сумки; не влезло — остаток left;
//  • сумка (kind 'bag' каталога): wear — с ячейки на спину (спина пуста), unwear — со спины в хотбар (только пустую:
//    «Сначала выложи вещи»); toBag / fromBag / move — между ячейками (занято — обмен, тот же стек — долить);
//  • count / consume — по хотбару и сумке; takeOne — отделить одну штуку от стека (выбросить, съесть).
// Модель игры src/game/types.ts (GameState.inventory) — счётная, не по ячейкам; здесь — только то, что при себе.
// Поведение предметов (свет, еда, заправка) — src/game/itemUse.ts.
import { lootDef, stackOf } from '../data/itemsLoot';

export const HOTBAR_SIZE = 5;

/** предмет в ячейке и его состояние */
export interface Slot {
  /** id предмета (src/data/items.ts: it_flashlight…) */
  item: string;
  /** горит / включён (керосинка: нет — горит, см. itemUse.isLit) */
  on?: boolean;
  /** штук в стеке 2…999 (нет — 1); у спичек — спичек в коробке */
  n?: number;
  /** заряд / топливо 0…1 (П-2 — батарейки, зиппа/керосинка — керосин, канистра — остаток); нет — 1 */
  q?: number;
  /** износ 0…1 (П-2/жучок — лампочка, 1 = перегорела; зиппа/керосинка — фитиль); нет — 0 */
  w?: number;
  /** биты апгрейдов 0…255: 1 — удлинение тубуса П-2; нет — 0 */
  u?: number;
}

/** Надетая сумка: id предмета-сумки и её ячейки (их столько, сколько вмещает сумка — bagSlotsOf). */
export interface Bag {
  item: string;
  slots: (Slot | null)[];
}

/** Ячейки (null — пусто; всегда HOTBAR_SIZE штук), выбранная — 0…HOTBAR_SIZE − 1, сумка на спине (нет — нет поля). */
export interface Hotbar {
  slots: (Slot | null)[];
  sel: number;
  back?: Bag | null;
}

/** Где ячейка: в хотбаре (bag false) или в сумке на спине (bag true); i — индекс. */
export interface Loc {
  bag: boolean;
  i: number;
}

/** Итог действия, которое может не выйти: h — новый хотбар; не вышло — h null и msg для игрока. */
export type Move = { h: Hotbar; msg?: undefined } | { h: null; msg: string };

/** Набор новой игры: включённый П-2 со свежими батарейками в первой ячейке (на F-фонарь в первой ячейке опираются
 *  катакомбы), пара запасных батареек и коробок на 5 спичек. */
export const START_KIT: Slot[] = [
  { item: 'it_flashlight', on: true, q: 1 },
  { item: 'it_batteries', n: 2 },
  { item: 'it_matches', n: 5 },
];

/** Предел длины id предмета (сохранение и сеть). */
const ITEM_MAX = 64;
/** Предел стека в ячейке при разборе (сверх — обрезается; предел конкретного предмета — stackOf). */
export const STACK_MAX = 999;
const FORMAT = 'room-forge-hotbar';
/** Версия формата hotbarJSON (1 — без n/q/w/u и сумки — тоже читается). */
const VERSION = 2;

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

/** Ячейка как есть (копия только своих полей, n/q/w/u — проверены и обрезаны) или null — не ячейка. */
function normSlot(s: unknown): Slot | null {
  if (!s || typeof s !== 'object') return null;
  const o = s as Record<string, unknown>;
  if (typeof o.item !== 'string' || !o.item || o.item.length > ITEM_MAX) return null;
  const r: Slot = { item: o.item };
  if (typeof o.on === 'boolean') r.on = o.on;
  if (typeof o.n === 'number' && Number.isFinite(o.n)) {
    const n = Math.min(STACK_MAX, Math.max(1, Math.floor(o.n)));
    if (n >= 2) r.n = n;
  }
  if (typeof o.q === 'number' && Number.isFinite(o.q)) r.q = clamp01(o.q);
  if (typeof o.w === 'number' && Number.isFinite(o.w)) r.w = clamp01(o.w);
  if (typeof o.u === 'number' && Number.isInteger(o.u) && o.u >= 0 && o.u <= 255) r.u = o.u;
  return r;
}

/** Штук в ячейке (нет n — 1; пусто — 0). */
export const nOf = (s: Slot | null | undefined): number => (s ? s.n ?? 1 : 0);

/** Ячейка с n штук (n ≥ 2 — в поле, 1 — поля нет). */
function withN(s: Slot, n: number): Slot {
  const r: Slot = { ...s };
  if (n >= 2) r.n = n;
  else delete r.n;
  return r;
}

/** Складываются ли две ячейки в один стек: тот же предмет, то же состояние (on/q/w/u по смыслу, «нет» = по умолчанию). */
export function sameStack(a: Slot, b: Slot): boolean {
  return (
    a.item === b.item &&
    !!a.on === !!b.on &&
    (a.q ?? 1) === (b.q ?? 1) &&
    (a.w ?? 0) === (b.w ?? 0) &&
    (a.u ?? 0) === (b.u ?? 0)
  );
}

/** Вместимость сумки (ячеек) по каталогу лута; не сумка — 0. */
export function bagSlotsOf(item: string): number {
  const d = lootDef(item);
  return d?.kind === 'bag' ? d.bagSlots ?? 0 : 0;
}

/** Множитель скорости от надетой сумки (мешок — 0.85); нет сумки — 1. Эффекты еды — отдельно (src/game/effects.ts). */
export function bagSpeed(h: Hotbar): number {
  return h.back ? lootDef(h.back.item)?.bagSpeed ?? 1 : 1;
}

const okIndex = (i: number): boolean => Number.isInteger(i) && i >= 0 && i < HOTBAR_SIZE;

/** Новый хотбар из ячеек и сумки (поле back — только если сумка есть). */
function make(slots: (Slot | null)[], sel: number, back: Bag | null | undefined): Hotbar {
  return back ? { slots, sel, back } : { slots, sel };
}

/** Рабочие копии ячеек хотбара и сумки (для правки) и сборка обратно. */
function work(h: Hotbar): { bar: (Slot | null)[]; bag: (Slot | null)[] | null } {
  return { bar: h.slots.slice(), bag: h.back ? h.back.slots.slice() : null };
}
function done(h: Hotbar, bar: (Slot | null)[], bag: (Slot | null)[] | null): Hotbar {
  return make(bar, h.sel, h.back && bag ? { item: h.back.item, slots: bag } : h.back);
}

/** Хотбар с предметами start по порядку (лишние сверх HOTBAR_SIZE и негодные — отбрасываются), выбрана первая. */
export function newHotbar(start: Slot[] = []): Hotbar {
  const slots: (Slot | null)[] = new Array(HOTBAR_SIZE).fill(null);
  let k = 0;
  for (const s of start) {
    const n = normSlot(s);
    if (!n) continue;
    if (k >= HOTBAR_SIZE) break;
    slots[k++] = n;
  }
  return { slots, sel: 0 };
}

/** Предмет в руке = выбранная ячейка (null — рука пуста). */
export function held(h: Hotbar): Slot | null {
  return h.slots[h.sel] ?? null;
}

/** Выбрать ячейку i (0…HOTBAR_SIZE − 1); вне диапазона — без изменений. */
export function select(h: Hotbar, i: number): Hotbar {
  return okIndex(i) && i !== h.sel ? make(h.slots, i, h.back) : h;
}

/** Колесо мыши: соседняя ячейка по кругу (dir +1 — следующая, −1 — предыдущая). */
export function cycle(h: Hotbar, dir: 1 | -1): Hotbar {
  return make(h.slots, (((h.sel + (dir < 0 ? -1 : 1)) % HOTBAR_SIZE) + HOTBAR_SIZE) % HOTBAR_SIZE, h.back);
}

/** Ячейка по адресу (пусто / нет сумки / вне диапазона — null). */
export function slotAt(h: Hotbar, at: Loc): Slot | null {
  const arr = at.bag ? h.back?.slots : h.slots;
  return arr && Number.isInteger(at.i) && at.i >= 0 && at.i < arr.length ? arr[at.i] ?? null : null;
}

/** Положить ячейку s (null — очистить) по адресу; адреса нет / s негодна — без изменений. */
export function setAt(h: Hotbar, at: Loc, s: Slot | null): Hotbar {
  const arr = at.bag ? h.back?.slots : h.slots;
  if (!arr || !Number.isInteger(at.i) || at.i < 0 || at.i >= arr.length) return h;
  const n = s ? normSlot(s) : null;
  if (s && !n) return h;
  const { bar, bag } = work(h);
  (at.bag ? bag! : bar)[at.i] = n;
  return done(h, bar, bag);
}

/** Все ячейки с предметом item: сперва хотбар (по порядку), потом сумка. */
export function findAll(h: Hotbar, item: string): Loc[] {
  const out: Loc[] = [];
  h.slots.forEach((s, i) => s?.item === item && out.push({ bag: false, i }));
  h.back?.slots.forEach((s, i) => s?.item === item && out.push({ bag: true, i }));
  return out;
}

/** Сколько штук item при себе (хотбар + сумка). */
export function count(h: Hotbar, item: string): number {
  let c = 0;
  for (const s of h.slots) if (s?.item === item) c += nOf(s);
  for (const s of h.back?.slots ?? []) if (s?.item === item) c += nOf(s);
  return c;
}

/** Результат add: at — ячейка хотбара, куда легло первым (−1 — всё в сумку), bagAt — первая ячейка сумки (−1 — нет),
 *  left — сколько штук не влезло (0 — всё). */
export interface Added {
  h: Hotbar;
  at: number;
  bagAt: number;
  left: number;
}

/** Положить предмет (стек s.n штук). По порядку: дополнить стеки того же предмета и состояния (хотбар, потом сумка) до
 *  stackOf(item); пустая ячейка хотбара — выбранная, если пуста, иначе первая пустая; пустая ячейка сумки. Не влезло ни
 *  одной штуки (или s не предмет) — null; влезло часть — left > 0 (остаток остаётся у вызывающего, напр. на полу). */
export function add(h: Hotbar, s: Slot): Added | null {
  const src = normSlot(s);
  if (!src) return null;
  const cap = Math.max(1, stackOf(src.item));
  let left = nOf(src);
  const { bar, bag } = work(h);
  let at = -1;
  let bagAt = -1;
  const mark = (inBag: boolean, i: number) => {
    if (inBag) bagAt = bagAt < 0 ? i : bagAt;
    else at = at < 0 ? i : at;
  };
  // 1) дополнить стеки
  if (cap > 1) {
    const fill = (arr: (Slot | null)[], inBag: boolean) => {
      for (let i = 0; i < arr.length && left > 0; i++) {
        const x = arr[i];
        if (!x || !sameStack(x, src) || nOf(x) >= cap) continue;
        const put = Math.min(left, cap - nOf(x));
        arr[i] = withN(x, nOf(x) + put);
        left -= put;
        mark(inBag, i);
      }
    };
    fill(bar, false);
    if (bag) fill(bag, true);
  }
  // 2) пустые ячейки: выбранная, остальные хотбара, сумка
  const empties: Loc[] = [];
  if (!bar[h.sel]) empties.push({ bag: false, i: h.sel });
  bar.forEach((x, i) => !x && i !== h.sel && empties.push({ bag: false, i }));
  bag?.forEach((x, i) => !x && empties.push({ bag: true, i }));
  for (const e of empties) {
    if (left <= 0) break;
    const put = Math.min(left, cap);
    (e.bag ? bag! : bar)[e.i] = withN(src, put);
    left -= put;
    mark(e.bag, e.i);
  }
  if (left === nOf(src)) return null;
  return { h: done(h, bar, bag), at, bagAt, left };
}

/** Вынуть предмет из ячейки i (по умолчанию — выбранной) целиком (весь стек): ячейка пустеет. Пусто / вне диапазона —
 *  slot null, h тот же. */
export function take(h: Hotbar, i: number = h.sel): { h: Hotbar; slot: Slot | null } {
  const slot = okIndex(i) ? h.slots[i] ?? null : null;
  if (!slot) return { h, slot: null };
  const slots = h.slots.slice();
  slots[i] = null;
  return { h: make(slots, h.sel, h.back), slot };
}

/** Отделить одну штуку от стека в ячейке i хотбара (по умолчанию — выбранной; inBag — ячейки сумки): slot — одна штука
 *  (без n), в ячейке остаётся n − 1 (последняя — ячейка пустеет). Пусто / вне диапазона — slot null, h тот же. */
export function takeOne(h: Hotbar, i: number = h.sel, inBag = false): { h: Hotbar; slot: Slot | null } {
  const at: Loc = { bag: inBag, i };
  const s = slotAt(h, at);
  if (!s) return { h, slot: null };
  const n = nOf(s);
  return { h: setAt(h, at, n > 1 ? withN(s, n - 1) : null), slot: withN(s, 1) };
}

/** Поменять поля предмета в ячейке i (напр. переключить on, заряд q); пусто / вне диапазона / негодный итог — без
 *  изменений. Поле со значением undefined — снять (on: undefined — без состояния, n: undefined — одна штука). */
export function patch(h: Hotbar, i: number, s: Partial<Slot>): Hotbar {
  const old = okIndex(i) ? h.slots[i] : null;
  const n = old ? normSlot({ ...old, ...s }) : null;
  if (!n) return h;
  const slots = h.slots.slice();
  slots[i] = n;
  return make(slots, h.sel, h.back);
}

/** Забрать n штук item (хотбар + сумка): сперва из самых маленьких стеков (остатки не плодятся), при равных — сначала
 *  из сумки (хотбар — быстрый доступ, его бережём), потом по порядку ячеек. Не хватает (или n < 1) — null, ничего не
 *  забрано. */
export function consume(h: Hotbar, item: string, n = 1): Hotbar | null {
  if (!Number.isInteger(n) || n < 1 || count(h, item) < n) return null;
  const locs = findAll(h, item).sort(
    (a, b) => nOf(slotAt(h, a)) - nOf(slotAt(h, b)) || Number(b.bag) - Number(a.bag) || a.i - b.i,
  );
  const { bar, bag } = work(h);
  let need = n;
  for (const l of locs) {
    if (need <= 0) break;
    const arr = l.bag ? bag! : bar;
    const s = arr[l.i]!;
    const k = Math.min(need, nOf(s));
    arr[l.i] = nOf(s) - k > 0 ? withN(s, nOf(s) - k) : null;
    need -= k;
  }
  return done(h, bar, bag);
}

/** Перенести ячейку from в ячейку to (хотбар ↔ хотбар ↔ сумка): to пуста — переложить; тот же стек — долить до
 *  stackOf (остаток остаётся в from); иначе — обмен. from пуста / адреса нет — h null и msg. */
export function move(h: Hotbar, from: Loc, to: Loc): Move {
  const a = slotAt(h, from);
  if (!a) return { h: null, msg: 'Пусто' };
  const toArr = to.bag ? h.back?.slots : h.slots;
  if (!toArr || !Number.isInteger(to.i) || to.i < 0 || to.i >= toArr.length) return { h: null, msg: to.bag ? 'Нет сумки' : 'Нет такой ячейки' };
  if (from.bag === to.bag && from.i === to.i) return { h };
  const b = slotAt(h, to);
  const { bar, bag } = work(h);
  const arrOf = (l: Loc) => (l.bag ? bag! : bar);
  const cap = stackOf(a.item);
  if (b && cap > 1 && sameStack(a, b)) {
    const put = Math.min(nOf(a), cap - nOf(b));
    if (put <= 0) return { h: null, msg: 'Стопка полна' };
    arrOf(to)[to.i] = withN(b, nOf(b) + put);
    arrOf(from)[from.i] = nOf(a) - put > 0 ? withN(a, nOf(a) - put) : null;
  } else {
    arrOf(to)[to.i] = a;
    arrOf(from)[from.i] = b;
  }
  return { h: done(h, bar, bag) };
}

/** Ячейку i хотбара — в сумку: в ячейку j (занята — обмен / долить стек), без j — долить стеки того же предмета в сумке,
 *  остаток — в первую пустую. Нет сумки / пусто / сумка полна — h null и msg. */
export function toBag(h: Hotbar, i: number, j?: number): Move {
  if (!h.back) return { h: null, msg: 'Нет сумки' };
  if (!okIndex(i) || !h.slots[i]) return { h: null, msg: 'Пусто' };
  if (j !== undefined) return move(h, { bag: false, i }, { bag: true, i: j });
  return autoMove(h, { bag: false, i }, true);
}

/** Ячейку j сумки — в хотбар: в ячейку i (занята — обмен / долить стек), без i — долить стеки в хотбаре, остаток — в
 *  выбранную (если пуста), иначе в первую пустую. Нет сумки / пусто / руки полны — h null и msg. */
export function fromBag(h: Hotbar, j: number, i?: number): Move {
  if (!h.back) return { h: null, msg: 'Нет сумки' };
  if (!slotAt(h, { bag: true, i: j })) return { h: null, msg: 'Пусто' };
  if (i !== undefined) return move(h, { bag: true, i: j }, { bag: false, i });
  return autoMove(h, { bag: true, i: j }, false);
}

/** Переложить ячейку from в другой отсек (toBag — в сумку, иначе в хотбар): долить стеки, остаток — в пустые ячейки
 *  (в хотбаре выбранная — первой). Не сдвинулось ни штуки — msg; часть — остаток остаётся в from. */
function autoMove(h: Hotbar, from: Loc, intoBag: boolean): Move {
  const a = slotAt(h, from)!;
  const cap = Math.max(1, stackOf(a.item));
  const { bar, bag } = work(h);
  const dst = intoBag ? bag! : bar;
  let left = nOf(a);
  if (cap > 1) {
    for (let k = 0; k < dst.length && left > 0; k++) {
      const x = dst[k];
      if (!x || !sameStack(x, a) || nOf(x) >= cap) continue;
      const put = Math.min(left, cap - nOf(x));
      dst[k] = withN(x, nOf(x) + put);
      left -= put;
    }
  }
  const order = dst.map((_, k) => k);
  if (!intoBag) order.sort((x, y) => Number(y === h.sel) - Number(x === h.sel));
  for (const k of order) {
    if (left <= 0) break;
    if (dst[k]) continue;
    const put = Math.min(left, cap);
    dst[k] = withN(a, put);
    left -= put;
  }
  if (left === nOf(a)) return { h: null, msg: intoBag ? 'Сумка полна' : 'Руки полны' };
  (from.bag ? bag! : bar)[from.i] = left > 0 ? withN(a, left) : null;
  return { h: done(h, bar, bag) };
}

/** Надеть сумку из ячейки i хотбара (по умолчанию — выбранной) на спину: ячейка пустеет, сумка — пустые ячейки по
 *  вместимости. Не сумка / на спине уже сумка — h null и msg. */
export function wear(h: Hotbar, i: number = h.sel): Move {
  const s = okIndex(i) ? h.slots[i] : null;
  if (!s) return { h: null, msg: 'Пусто' };
  const cap = bagSlotsOf(s.item);
  if (cap <= 0) return { h: null, msg: 'Это не сумка' };
  if (h.back) return { h: null, msg: 'На спине уже есть сумка' };
  const slots = h.slots.slice();
  slots[i] = nOf(s) > 1 ? withN(s, nOf(s) - 1) : null;
  return { h: make(slots, h.sel, { item: s.item, slots: new Array(cap).fill(null) }) };
}

/** Снять сумку со спины в хотбар (как add: выбранная ячейка, если пуста, иначе первая пустая). Нет сумки / в ней вещи /
 *  хотбар полон — h null и msg («Сначала выложи вещи»). */
export function unwear(h: Hotbar): Move {
  if (!h.back) return { h: null, msg: 'Сумки нет' };
  if (h.back.slots.some((s) => s)) return { h: null, msg: 'Сначала выложи вещи' };
  const slots = h.slots.slice();
  const at = slots[h.sel] ? slots.findIndex((x) => !x) : h.sel;
  if (at < 0) return { h: null, msg: 'Некуда положить сумку' };
  slots[at] = { item: h.back.item };
  return { h: { slots, sel: h.sel } };
}

/** Сумка из сохранения: предмет-сумка и ячейки по её вместимости (лишние отброшены, недостающие — пустые); не сумка —
 *  null. */
function normBag(b: unknown): Bag | null {
  if (!b || typeof b !== 'object') return null;
  const o = b as Record<string, unknown>;
  if (typeof o.item !== 'string' || !Array.isArray(o.slots)) return null;
  const cap = bagSlotsOf(o.item);
  if (cap <= 0) return null;
  const slots: (Slot | null)[] = new Array(cap).fill(null);
  for (let i = 0; i < cap && i < o.slots.length; i++) slots[i] = normSlot(o.slots[i]);
  return { item: o.item, slots };
}

/** Хотбар в строку (для localStorage / сохранения игрока), формат v: 2. */
export function hotbarJSON(h: Hotbar): string {
  const o: Record<string, unknown> = { format: FORMAT, v: VERSION, slots: h.slots.map((s) => (s ? normSlot(s) : null)), sel: h.sel };
  if (h.back) o.back = { item: h.back.item, slots: h.back.slots.map((s) => (s ? normSlot(s) : null)) };
  return JSON.stringify(o);
}

/** Хотбар из строки hotbarJSON (v: 1 и v: 2). Не JSON / не тот формат или версия / нет ячеек — null; негодная ячейка —
 *  пустая; ячеек больше HOTBAR_SIZE — лишние отбрасываются, меньше — пустые; выбор вне диапазона — первая; негодная
 *  сумка — нет сумки. */
export function parseHotbar(text: string | null): Hotbar | null {
  if (typeof text !== 'string' || !text) return null;
  let o: unknown;
  try {
    o = JSON.parse(text);
  } catch {
    return null;
  }
  if (!o || typeof o !== 'object' || Array.isArray(o)) return null;
  const r = o as Record<string, unknown>;
  if (r.format !== FORMAT || (r.v !== 1 && r.v !== VERSION) || !Array.isArray(r.slots)) return null;
  const slots: (Slot | null)[] = new Array(HOTBAR_SIZE).fill(null);
  for (let i = 0; i < HOTBAR_SIZE && i < r.slots.length; i++) slots[i] = normSlot(r.slots[i]);
  const sel = typeof r.sel === 'number' && okIndex(r.sel) ? r.sel : 0;
  return make(slots, sel, r.v === VERSION ? normBag(r.back) : null);
}
