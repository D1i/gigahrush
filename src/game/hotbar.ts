// Хотбар игрока «Прогулки»: HOTBAR_SIZE ячеек, предмет в руке — выбранная ячейка (клавиши 1…5, колесо мыши).
// Чистая модель — без Babylon, DOM и localStorage: все функции возвращают новый Hotbar (старый не меняется; ничего не
// изменилось — тот же объект). Сохраняет слой вида: hotbarJSON → строка, parseHotbar ← строка (мусор → null).
// Модель игры src/game/types.ts (GameState.inventory) — счётная, не по ячейкам; здесь — только то, что в руках.

export const HOTBAR_SIZE = 5;

/** предмет в ячейке; on — состояние предмета (фонарь включён) */
export interface Slot {
  /** id предмета (src/data/items.ts: it_flashlight…) */
  item: string;
  on?: boolean;
}

/** Ячейки (null — пусто; всегда HOTBAR_SIZE штук) и выбранная — 0…HOTBAR_SIZE − 1. */
export interface Hotbar {
  slots: (Slot | null)[];
  sel: number;
}

/** Набор новой игры: включённый фонарик в первой ячейке. */
export const START_KIT: Slot[] = [{ item: 'it_flashlight', on: true }];

/** Предел длины id предмета (сохранение и сеть). */
const ITEM_MAX = 64;
const FORMAT = 'room-forge-hotbar';

/** Ячейка как есть (копия только своих полей) или null — не ячейка. */
function normSlot(s: unknown): Slot | null {
  if (!s || typeof s !== 'object') return null;
  const o = s as Record<string, unknown>;
  if (typeof o.item !== 'string' || !o.item || o.item.length > ITEM_MAX) return null;
  return typeof o.on === 'boolean' ? { item: o.item, on: o.on } : { item: o.item };
}

const okIndex = (i: number): boolean => Number.isInteger(i) && i >= 0 && i < HOTBAR_SIZE;

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
  return okIndex(i) && i !== h.sel ? { slots: h.slots, sel: i } : h;
}

/** Колесо мыши: соседняя ячейка по кругу (dir +1 — следующая, −1 — предыдущая). */
export function cycle(h: Hotbar, dir: 1 | -1): Hotbar {
  return { slots: h.slots, sel: (((h.sel + (dir < 0 ? -1 : 1)) % HOTBAR_SIZE) + HOTBAR_SIZE) % HOTBAR_SIZE };
}

/** Положить предмет: в выбранную ячейку, если пуста, иначе в первую пустую; at — куда. Полно (или s не предмет) — null. */
export function add(h: Hotbar, s: Slot): { h: Hotbar; at: number } | null {
  const n = normSlot(s);
  if (!n) return null;
  const at = h.slots[h.sel] ? h.slots.findIndex((x) => !x) : h.sel;
  if (at < 0) return null;
  const slots = h.slots.slice();
  slots[at] = n;
  return { h: { slots, sel: h.sel }, at };
}

/** Вынуть предмет из ячейки i (по умолчанию — выбранной): ячейка пустеет. Пусто / вне диапазона — slot null, h тот же. */
export function take(h: Hotbar, i: number = h.sel): { h: Hotbar; slot: Slot | null } {
  const slot = okIndex(i) ? h.slots[i] ?? null : null;
  if (!slot) return { h, slot: null };
  const slots = h.slots.slice();
  slots[i] = null;
  return { h: { slots, sel: h.sel }, slot };
}

/** Поменять поля предмета в ячейке i (напр. переключить on); пусто / вне диапазона / негодный итог — без изменений.
 *  on: undefined — снять состояние. */
export function patch(h: Hotbar, i: number, s: Partial<Slot>): Hotbar {
  const old = okIndex(i) ? h.slots[i] : null;
  const n = old ? normSlot({ ...old, ...s }) : null;
  if (!n) return h;
  const slots = h.slots.slice();
  slots[i] = n;
  return { slots, sel: h.sel };
}

/** Хотбар в строку (для localStorage / сохранения игрока). */
export function hotbarJSON(h: Hotbar): string {
  return JSON.stringify({ format: FORMAT, v: 1, slots: h.slots.map((s) => (s ? normSlot(s) : null)), sel: h.sel });
}

/** Хотбар из строки hotbarJSON. Не JSON / не тот формат / нет ячеек — null; негодная ячейка — пустая; ячеек больше
 *  HOTBAR_SIZE — лишние отбрасываются, меньше — пустые; выбор вне диапазона — первая. */
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
  if (r.format !== FORMAT || r.v !== 1 || !Array.isArray(r.slots)) return null;
  const slots: (Slot | null)[] = new Array(HOTBAR_SIZE).fill(null);
  for (let i = 0; i < HOTBAR_SIZE && i < r.slots.length; i++) slots[i] = normSlot(r.slots[i]);
  const sel = typeof r.sel === 'number' && okIndex(r.sel) ? r.sel : 0;
  return { slots, sel };
}
