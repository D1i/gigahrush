// Руки игрока «Прогулки»: хотбар и сумка (src/game/hotbar.ts), поведение предметов (src/game/itemUse.ts), эффекты еды
// (src/game/effects.ts), предмет в руке (./flashlight.ts, лампа общаги) и предметы на полу (./worldItems.ts) — одним
// контроллером (Babylon + DOM-события, без React; HUD — через onHud, только когда изменился).
//  • Хотбар: HOTBAR_SIZE ячеек (стеки, заряд q, износ w, апгрейды u), в руке — выбранная; на спине — сумка (back, Tab).
//    Сохраняется в localStorage `${walk.key}/hotbar` (v: 2; у каждого мира и лобби — свой); нет или мусор — START_KIT
//    (П-2 в первой ячейке, батарейки, спички).
//  • Клавиши (от первого лица, без спец-локации поверх, не в поле ввода, не на паузе): 1…5 — ячейка, колесо (мышь
//    захвачена) — по кругу; F — свет (П-2 / зиппа / керосинка — вкл/выкл, «Жучок» — качнуть: стамина и шум, спички —
//    чиркнуть / задуть); R — перезарядить / заправить; ЛКМ (мышь захвачена) — использовать: еда — эффект и лечение
//    (host.heal, стамина до полной), карты — дурак с напарником, сумка — надеть, тубус — на П-2; Tab — панель сумки
//    (мышь отпускается; Tab — закрыть и захватить снова, Esc — закрыть); G — выбросить выбранную ячейку целиком (зиппа
//    захлопывается — onDrop); E — подобрать подсвеченный предмет или точку лута.
//  • Кадр: stepHand (заряд, износ, спичка гаснет на бегу / в воде) — события вспышкой; stepFx (таймеры еды); скорость —
//    Sprint.extraMul = эффекты × сумка; «лежит» (обморок юзграма 10 с, пьяное падение 15 с) — камера на полу (DownCam,
//    ./inventoryFx.ts), пелена, ход 0; пьяное падение — стоны. Свет в руке — itemUse.lightOf: П-2 — Flashlight
//    (яркость по заряду), керосинка — HeldLantern, остальное (спичка, зиппа, «Жучок») — пока свой точечный / луч у камеры
//    без модели (модели рук — heldItem.ts агента C1).
//  • Мир меняется только операциями (кооп-журнал): выбросить — request({k:'drop'}) (ячейка пустеет сразу, не легло —
//    вернуть), подобрать — request({k:'pick'}), точка лута комнаты (id «<inst>:L<k>», host.loot) — request({k:'loot'})
//    (кто первый — того и предмет). Место проверяется заранее (не влезет — операция не уходит, «Руки заняты»). Сумка с
//    пола при пустой спине — сразу на спину.
//  • E у подсвеченного предмета — раньше всех: слушатель окна в фазе захвата, stopImmediatePropagation (двери, лампа
//    общаги, раскопка напарника не срабатывают). Нечего подбирать — E не трогается.
//  • Без дюпа и потерь: хотбар пишется сразу при каждом изменении по действию игрока; горящий П-2 / зиппа меняют заряд
//    каждый кадр — эти правки пишутся не чаще раза в SAVE_MS (и сразу — при событии: перегорела, кончился керосин); мир
//    после удачного drop / pick / loot — тоже сразу (saveWorld); на pagehide — оба ещё раз.
//  • Наружу: fx (FxView: скорость, неуязвим, меченый, пьян, лежит, шум, collapseMul — зиппа удваивает обвалы), torchOn
//    (горит П-2 или «Жучок» — у аватара луч), lampHeld (керосинка в руке и горит — поле лампы общаги), sawCreature(kind)
//    (пьяный ругается на тварь: субтитр и рык).
//  • Дурак (карты, ЛКМ): напарник ближе DURAK_M (host.partner) — ему кооп-действие 'durak' (host.durak), у обоих
//    «Партия в дурака…» DURAK_S с (сдвинулся — сорвалась), потом +DURAK_HEAL здоровья каждому; раз в DURAK_COOL_MS.
//  • Старое сохранение общаги (`${key}/obsh-lamp` = '1' — лампа была в руке до хотбара): лампа — в хотбар и в руку,
//    ключ стирается (один раз, в конструкторе).
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { PointLight } from '@babylonjs/core/Lights/pointLight';
import { SpotLight } from '@babylonjs/core/Lights/spotLight';
import type { Observer } from '@babylonjs/core/Misc/observable';
import type { Scene } from '@babylonjs/core/scene';
import type { WorldDrop } from '../gen4d/stream';
import { buildItems } from '../data/items';
import { lootDef, rarityInfo } from '../data/itemsLoot';
import {
  HOTBAR_SIZE, START_KIT, add, bagSlotsOf, bagSpeed, count, cycle, findAll, fromBag, held, hotbarJSON, move, newHotbar, nOf,
  parseHotbar, select, setAt, slotAt, toBag, unwear, type Hotbar, type Loc, type Slot,
} from '../game/hotbar';
import { addNoise, applyFood, fxView, newFx, stepFx, type Fx, type FxView } from '../game/effects';
import {
  BUG, KEROLAMP, KEROLAMP_INTENSITY, KEROSENE, MATCH_DEFS, P2, TUBE, UP_TUBE, ZIPPO, collapseMul, isLit,
  lightLeftS, lightOf, newHandTr, onDrop, pressF, reload, stepHand, useHeld, type HandTr, type Light, type UseCtx,
  type UseEvent,
} from '../game/itemUse';
import { KEROLAMP_ITEM } from '../locations/obshaga';
import { FLASH_ANGLE, Flashlight, flashIntensity, sceneLitness } from './flashlight';
import { DownCam, VoiceAudio, type DownPose } from './inventoryFx';
import { HeldLantern } from './obshagaScene';
import type { PortalRenderer } from './portal';
import { RUN_MUL } from './sprint';
import type { BlockoutViewer } from './viewer';
import type { WorldOp } from './walk';
import { FLASHLIGHT_ITEM, WorldItems, dropPose } from './worldItems';

/** Подобрать — не дальше, м (по горизонтали, от глаза). */
const PICK_M = 1.6;
/** Как часто искать предмет под взглядом, мс. */
const AIM_MS = 100;
/** Колесо: шагов на «щелчок» — по накопленной прокрутке, px; пауза дольше — копить заново, мс. */
const WHEEL_STEP = 40;
const WHEEL_IDLE = 220;
/** Сдвиг камеры за кадр больше — перенос (шов, телепорт), не ход, м. */
const TELEPORT = 1.5;
/** «Идёт» — быстрее, м/с. */
const MOVE_MIN = 0.4;
/** Правки хотбара без действия игрока (заряд горящего П-2) — в localStorage не чаще, мс. */
export const SAVE_MS = 2000;
/** Дурак: напарник ближе, м; партия, с; лечение каждому, HP; снова сыграть — через, мс; сдвинулся дальше — сорвалась, м. */
export const DURAK_M = 2.5;
export const DURAK_S = 8;
export const DURAK_HEAL = 30;
export const DURAK_COOL_MS = 180_000;
const DURAK_MOVE_M = 0.6;
/** Пьяный ругается на тварь — не чаще, мс; реплика висит, мс. */
const SWEAR_COOL_MS = 6000;
const SWEAR_MS = 2600;
/** Реплики пьяного игрока, увидевшего тварь. */
export const SWEARS: readonly string[] = ['Пошёл нахуй!', 'Иди нахуй отсюда!', 'Чё вылупился, урод?!', 'Да пошёл ты!', 'Отвали, тварь!'];
/** Стоны пьяного на полу: пауза между, мс. */
const GROAN_MS = 2300;

const C_WARN = '#e0563f';
const C_GOOD = '#9fe0a0';
const C_INFO = '#cfd8e6';

// ───────────────────────── чистое (тесты — inventory.test.ts) ─────────────────────────

/** Ключ хотбара в localStorage: рядом с сохранением мира / лобби. */
export const hotbarKey = (walkKey: string): string => walkKey + '/hotbar';

/** Хотбар из сохранения; нет или мусор — набор новой игры. */
export function loadHotbar(text: string | null): Hotbar {
  return parseHotbar(text) ?? newHotbar(START_KIT);
}

/** Клавиша → ячейка 0…HOTBAR_SIZE − 1 (цифры над буквами и на цифровом блоке) или null. */
export function slotOfKey(code: string): number | null {
  const m = /^(?:Digit|Numpad)([1-9])$/.exec(code);
  if (!m) return null;
  const i = Number(m[1]) - 1;
  return i < HOTBAR_SIZE ? i : null;
}

/** id выброшенного предмета: игрок, время, случайный хвост (≤ 64 символов — предел WorldDrop). */
export function dropId(player: string | null | undefined, now: number, rnd: number): string {
  const p = (player || 'p').replace(/[^\w-]/g, '').slice(0, 12) || 'p';
  return `${p}-${Math.max(0, Math.floor(now)).toString(36)}-${Math.floor(Math.min(0.999999, Math.max(0, rnd)) * 36 ** 4).toString(36)}`;
}

/** Точка лута комнаты (src/gen4d/streamLoot.ts: «<inst>:L<k>») — не выброшенный предмет (у них id без двоеточия). */
export const isLootId = (id: string): boolean => /:L\d+$/.test(id);

/** Ячейка предмета, лежащего в мире (состояние — из WorldDrop). */
export function slotOfDrop(d: WorldDrop): Slot {
  const s: Slot = { item: d.item };
  if (d.on !== undefined) s.on = d.on;
  if (d.n !== undefined && d.n >= 2) s.n = d.n;
  if (d.q !== undefined) s.q = d.q;
  if (d.w !== undefined) s.w = d.w;
  if (d.u !== undefined) s.u = d.u;
  return s;
}

/** Поля состояния ячейки для WorldDrop (только заданные: стек, заряд, износ, апгрейды, вкл). */
export function dropFields(s: Slot): Pick<WorldDrop, 'on' | 'n' | 'q' | 'w' | 'u'> {
  const o: Pick<WorldDrop, 'on' | 'n' | 'q' | 'w' | 'u'> = {};
  if (s.on !== undefined) o.on = s.on;
  if (nOf(s) >= 2) o.n = nOf(s);
  if (s.q !== undefined) o.q = s.q;
  if (s.w !== undefined) o.w = s.w;
  if (s.u !== undefined) o.u = s.u;
  return o;
}

/** Положить предмет в ячейку i (пуста) — иначе как add. Не влезло — null. */
export function putBack(h: Hotbar, i: number, s: Slot): Hotbar | null {
  if (i >= 0 && i < HOTBAR_SIZE && !h.slots[i]) return setAt(h, { bag: false, i }, s);
  return add(h, s)?.h ?? null;
}

/** Вернуть ячейку по адресу (пуста) — иначе как add. Не влезло — null. */
export function putBackAt(h: Hotbar, at: Loc, s: Slot): Hotbar | null {
  if (!slotAt(h, at) && (at.bag ? !!h.back && at.i < h.back.slots.length : at.i < HOTBAR_SIZE)) {
    const r = setAt(h, at, s);
    if (r !== h) return r;
  }
  return add(h, s)?.h ?? null;
}

/** Подобрать s: сумка при пустой спине — сразу на спину (wore), иначе как add (at — ячейка хотбара, −1 — в сумку;
 *  left — не влезло). Ничего не влезло — null. */
export function pickInto(h: Hotbar, s: Slot): { h: Hotbar; at: number; left: number; wore: boolean } | null {
  const cap = bagSlotsOf(s.item);
  if (cap > 0 && !h.back) {
    return { h: { slots: h.slots, sel: h.sel, back: { item: s.item, slots: new Array(cap).fill(null) } }, at: -1, left: nOf(s) - 1, wore: true };
  }
  const a = add(h, s);
  return a ? { h: a.h, at: a.at, left: a.left, wore: false } : null;
}

/** Предмет в руку: уже есть в хотбаре — выбрать его ячейку, нет — положить (как add) и выбрать. Места нет — null. */
export function holdItem(h: Hotbar, item: string): Hotbar | null {
  const i = h.slots.findIndex((s) => s?.item === item);
  if (i >= 0) return select(h, i);
  const a = add(h, { item });
  return a && a.at >= 0 ? select(a.h, a.at) : null;
}

/** Старый ключ общаги (до хотбара): '1' — керосиновая лампа была в руке. */
export const obshLampKey = (walkKey: string): string => walkKey + '/obsh-lamp';

/** Старое сохранение общаги: лампа была в руке ('1') — в хотбар и в руку (уже есть — выбрать её); иначе или места нет —
 *  хотбар как был. */
export function migrateObshLamp(h: Hotbar, legacy: string | null): Hotbar {
  return legacy === '1' ? (holdItem(h, KEROLAMP_ITEM) ?? h) : h;
}

/** Ячейка для HUD. glyph — рисунок, если нет значка (лут — src/view3d/lootAssets.ts). */
export interface InvSlotHud {
  item: string;
  name: string;
  color: string;
  /** горит (свет предмета) */
  on: boolean;
  glyph: 'flash' | 'lamp' | 'box';
  /** штук в стеке (бейдж ×N, если > 1) */
  n: number;
  /** заряд / керосин / остаток 0…1 (шаг 2 %) или null — не мерится */
  bar: number | null;
  /** износ лампочки / фитиля 0…1 (шаг 2 %) или null */
  wear: number | null;
  /** мёртв: лампочка перегорела */
  dead: boolean;
  /** цвет редкости (уголок) или null — не из набора лута */
  rarity: string | null;
}

/** Таймер эффекта (строка над экраном). */
export interface FxChip {
  k: 'speed' | 'bubble' | 'faint' | 'collapse' | 'durak';
  label: string;
  /** секунд осталось */
  s: number;
  tone: 'good' | 'warn' | 'bad';
}

/** Подпись предмета в руке: имя, редкость, клавиши, сколько осталось. */
export interface HeldTip {
  name: string;
  rarity: string | null;
  color: string | null;
  keys: string;
  left: string | null;
}

/** HUD рук: ячейки, выбранная, подсказка «E — подобрать», что в руке; seq растёт при смене предмета в руке (подпись
 *  над хотбаром проигрывается заново); сумка и её панель (Tab), таймеры эффектов, пелена (лежит), реплика. */
export interface InventoryHud {
  slots: (InvSlotHud | null)[];
  sel: number;
  prompt: string | null;
  held: string | null;
  seq: number;
  /** надетая сумка (нет — null) */
  back: { item: string; name: string; slots: (InvSlotHud | null)[] } | null;
  /** открыта панель сумки (Tab) */
  bagOpen: boolean;
  tip: HeldTip | null;
  fx: FxChip[];
  /** пелена (лежит): чернота 0…1, размытие px */
  veil: { black: number; blur: number } | null;
  /** реплика / событие (субтитр) */
  sub: string | null;
}

export interface ItemInfo {
  name: string;
  color: string;
  note?: string;
}

let table: Map<string, ItemInfo> | null = null;
/** Имя, цвет и заметка предмета (src/data/items.ts); неизвестный — id и серый. */
export function itemInfo(item: string): ItemInfo {
  table ??= new Map(buildItems().map((i) => [i.id, { name: i.name, color: i.color, note: i.note }]));
  return table.get(item) ?? { name: item, color: '#9a9a9a' };
}

/** Подсказка предмета (панель сумки): имя, редкость, заметка, цена у торговца. */
export interface ItemTip {
  name: string;
  rarity: string | null;
  color: string | null;
  note: string;
  price: string | null;
}

/** Цена в копейках — «1 р. 50 к.» / «40 коп.». */
export function priceText(kop: number): string {
  const r = Math.floor(kop / 100), k = kop % 100;
  return r ? (k ? `${r} р. ${k} коп.` : `${r} р.`) : `${k} коп.`;
}

export function itemTip(item: string): ItemTip {
  const i = itemInfo(item);
  const d = lootDef(item);
  const r = d ? rarityInfo(d.rarity) : null;
  return {
    name: i.name,
    rarity: r?.name ?? null,
    color: r?.color ?? null,
    note: d?.note ?? i.note ?? '',
    price: d ? (d.price === null ? 'не продаётся' : priceText(d.price)) : null,
  };
}

const r50 = (v: number): number => Math.round(v * 50) / 50;

/** Ячейка → HUD; lit — горит ли (свет в руке этой ячейки). */
export function slotHud(s: Slot, lit: boolean, info: (item: string) => ItemInfo = itemInfo): InvSlotHud {
  const i = info(s.item);
  const d = lootDef(s.item);
  const lamp = s.item === P2 || s.item === ZIPPO || s.item === KEROLAMP;
  const worn = lamp || s.item === BUG;
  const w = s.w ?? 0;
  return {
    item: s.item,
    name: i.name,
    color: i.color,
    on: lit || (lamp ? isLit(s) : !!s.on),
    glyph: s.item === FLASHLIGHT_ITEM ? 'flash' : s.item === KEROLAMP_ITEM ? 'lamp' : 'box',
    n: nOf(s),
    bar: lamp || s.item === KEROSENE ? r50(s.q ?? 1) : null,
    wear: worn ? r50(w) : null,
    dead: (s.item === P2 || s.item === BUG) && w >= 1,
    rarity: d ? rarityInfo(d.rarity).color : null,
  };
}

/** Секунды → «1:05» / «42». */
export function secText(s: number): string {
  const t = Math.max(0, Math.ceil(s));
  return t >= 60 ? `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}` : String(t);
}

/** Клавиши для предмета в руке. */
export function keysOf(s: Slot, h: Hotbar): string {
  const d = lootDef(s.item);
  if (s.item === P2) {
    const tube = count(h, TUBE) > 0 && !((s.u ?? 0) & UP_TUBE) ? ' · ЛКМ — удлинить тубус' : '';
    return `F — свет · R — ${(s.w ?? 0) >= 1 ? 'лампочка' : 'батарейки'}${tube}`;
  }
  if (s.item === BUG) return 'F — качать (силы, шум)';
  if (s.item === ZIPPO || s.item === KEROLAMP) return 'F — зажечь / погасить · R — заправить';
  if (MATCH_DEFS[s.item]) return 'F — чиркнуть';
  switch (d?.kind) {
    case 'food':
      return `ЛКМ — ${s.item === 'it_bubble' ? 'выпить' : s.item === 'it_yuzgram' ? 'принять' : 'съесть'}`;
    case 'bag':
      return 'ЛКМ — надеть';
    case 'cards':
      return 'ЛКМ — сыграть в дурака';
    case 'battery':
      return 'в П-2: R с фонариком в руке';
    case 'part':
      return s.item === TUBE ? 'ЛКМ с П-2 в руке' : 'в П-2: R с фонариком в руке';
    case 'fuel':
    case 'wick':
      return 'для зиппы и керосинки: R';
  }
  return 'G — выбросить';
}

/** Подпись предмета в руке (null — рука пуста). */
export function heldTip(h: Hotbar): HeldTip | null {
  const s = held(h);
  if (!s) return null;
  const d = lootDef(s.item);
  const r = d ? rarityInfo(d.rarity) : null;
  const ls = lightLeftS(s);
  const n = nOf(s);
  const left =
    ls !== null
      ? (s.item === P2 || s.item === BUG) && (s.w ?? 0) >= 1
        ? 'лампочка перегорела'
        : `света ≈ ${ls >= 60 ? Math.round(ls / 60) + ' мин' : Math.ceil(ls) + ' с'}`
      : n > 1
        ? `×${n}`
        : null;
  return { name: itemInfo(s.item).name, rarity: r?.name ?? null, color: r?.color ?? null, keys: keysOf(s, h), left };
}

/** Таймеры эффектов для HUD. */
export function fxChips(fx: Fx): FxChip[] {
  const out: FxChip[] = [];
  if (fx.faintT > 0) out.push({ k: 'faint', label: 'Обморок · неуязвим', s: Math.ceil(fx.faintT), tone: 'bad' });
  if (fx.collapseT > 0) out.push({ k: 'collapse', label: 'Валяешься пьяный', s: Math.ceil(fx.collapseT), tone: 'bad' });
  if (fx.bubbleT > 0) out.push({ k: 'bubble', label: 'Пузырь ×2 · меченый', s: Math.ceil(fx.bubbleT), tone: 'warn' });
  if (fx.speedT > 0) out.push({ k: 'speed', label: 'Закрутка ×1.3', s: Math.ceil(fx.speedT), tone: 'good' });
  return out;
}

/** События руки (itemUse.stepHand) → вспышка (null — молчать); item — что было в руке. */
export function eventText(events: readonly UseEvent[], item: string | null): string | null {
  if (!events.length) return null;
  if (events.includes('match_out')) {
    if (events.includes('drowned')) return 'Спичка погасла в воде';
    if (events.includes('blown')) return 'Спичку задуло на бегу';
    return 'Спичка погасла';
  }
  if (events.includes('burnout')) return item === BUG ? '«Жучок» перегорел — он мёртв' : 'Лампочка перегорела — нужна запасная (R)';
  if (events.includes('empty')) return 'Батарейки сели — нужны батарейки D (R)';
  if (events.includes('out_fuel')) return 'Кончился керосин (R — заправить)';
  if (events.includes('out_wick')) return 'Фитиль прогорел — нужна шпонная верёвка (R)';
  if (events.includes('blown')) return 'Зиппу задуло на бегу';
  return null;
}

/** Что сделала перезарядка — вспышкой. */
const RELOADED: Record<string, string> = { bulb: 'лампочка вкручена', batteries: 'батарейки заменены', fuel: 'заправлено керосином', wick: 'фитиль заменён' };

/** Еда съедена — вспышкой (второй пузырь — падение). */
function foodText(id: string, collapsed: boolean): string {
  switch (id) {
    case 'it_bread':
      return 'Хлеб: +35 здоровья, силы вернулись';
    case 'it_preserves':
      return 'Закрутка: +50 здоровья, ноги несут быстрее';
    case 'it_bubble':
      return collapsed ? 'Перебрал… ноги не держат' : 'Пузырь: +40 здоровья, ×2 скорость — но твари чуют тебя';
    case 'it_yuzgram':
      return 'Юзграм… в глазах темнеет';
  }
  return itemInfo(id).name;
}

/** Дополнения HUD (кроме ячеек). */
export interface HudExtra {
  bagOpen?: boolean;
  /** свет в руке горит (ячейка в руке — «горит»: спичка, «Жучок») */
  lit?: boolean;
  fx?: Fx;
  veil?: DownPose | null;
  sub?: string | null;
  durak?: number | null;
}

/** HUD по хотбару. */
export function inventoryHud(h: Hotbar, prompt: string | null, seq: number, x: HudExtra = {}, info: (item: string) => ItemInfo = itemInfo): InventoryHud {
  const slots = h.slots.map((s, i): InvSlotHud | null => (s ? slotHud(s, i === h.sel && !!x.lit, info) : null));
  const back = h.back ? { item: h.back.item, name: info(h.back.item).name, slots: h.back.slots.map((s) => (s ? slotHud(s, false, info) : null)) } : null;
  const fx = x.fx ? fxChips(x.fx) : [];
  if (x.durak != null) fx.unshift({ k: 'durak', label: 'Дурак', s: Math.ceil(x.durak), tone: 'good' });
  const v = x.veil;
  const veil = v && (v.black > 0.01 || v.blur > 0.1) ? { black: Math.round(v.black * 40) / 40, blur: Math.round(v.blur * 4) / 4 } : null;
  return {
    slots,
    sel: h.sel,
    prompt,
    held: slots[h.sel]?.name ?? null,
    seq,
    back,
    bagOpen: !!x.bagOpen,
    tip: heldTip(h),
    fx,
    veil,
    sub: x.sub ?? null,
  };
}

/** Не подобранные точки лута показанных комнат — одним массивом для WorldItems (новый — только когда изменился:
 *  WorldItems.sync сверяет по массиву). Ключ — прогон мира, набор комнат и номер версии флагов мира. */
export class LootFeed {
  private key: { rx: unknown; rooms: unknown; rev: number } | null = null;
  private arr: readonly WorldDrop[] = [];

  get(rx: object, rooms: Iterable<string> & object, rev: number, of: (inst: string) => readonly WorldDrop[], taken: (id: string) => boolean): readonly WorldDrop[] {
    const k = this.key;
    if (k && k.rx === rx && k.rooms === rooms && k.rev === rev) return this.arr;
    this.key = { rx, rooms, rev };
    const out: WorldDrop[] = [];
    for (const inst of rooms) for (const d of of(inst)) if (!taken(d.id)) out.push(d);
    const old = this.arr;
    if (out.length !== old.length || out.some((d, i) => d !== old[i])) this.arr = out;
    return this.arr;
  }
}

// ───────────────────────── контроллер ─────────────────────────

export interface InventoryHost {
  /** ключ мира прогулки (WalkSession.key): хотбар — `${key}/hotbar` */
  key: string;
  /** id игрока (кооп) — в id выброшенных предметов */
  playerId?: string | null;
  /** портальный рендер (FoldDriver.portal) */
  portal(): PortalRenderer | null;
  /** комната под ногами (портальный рендер — portal.current, иначе центр набора) */
  room(): string | null;
  /** без портального рендера: видна ли комната (набор PVS) */
  roomShown?(inst: string): boolean;
  /** лежащие предметы (WalkSession.drops: массив новый на каждое изменение) */
  drops(): readonly WorldDrop[];
  /** не подобранные точки лута показанных комнат (LootFeed: массив новый только на изменение); нет — без лута */
  loot?(): readonly WorldDrop[];
  /** операция мира (WalkSession.request) */
  request(op: WorldOp): Promise<string | null>;
  /** сохранить мир сейчас (WalkSession.saveNow; кооп-мир — на сервере, ничего) */
  saveWorld?(): void;
  /** лампу в руке не показывать (общага: погиб — чёрный экран) */
  handsDown?(): boolean;
  /** в воде (спичка гаснет): катакомбы */
  inWater?(): boolean;
  /** лечение (еда, дурак): слой биома со здоровьем (общага, катакомбы) */
  heal?(hp: number): void;
  /** кооп: ближайший живой напарник ближе r м (та же комната / сосед), null — нет */
  partner?(r: number): { id: string; name: string } | null;
  /** кооп: позвать напарника в дурака (действие 'durak') */
  durak?(to: string): void;
  /** вспышка-сообщение по центру */
  flash?(text: string, color?: string): void;
  onHud?(h: InventoryHud): void;
}

const typing = (e: Event): boolean => {
  const t = e.target as HTMLElement | null;
  return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
};
const hasDoc = typeof document !== 'undefined';
const locked = (): boolean => hasDoc && !!document.pointerLockElement;

export class Inventory {
  readonly flashlight: Flashlight;
  /** керосиновая лампа общаги в руке (модель у камеры и тёплый свет) */
  readonly lantern: HeldLantern;
  readonly items: WorldItems;
  private h: Hotbar;
  /** мгновенное состояние руки (спичка, «Жучок») — не сохраняется */
  private tr: HandTr = newHandTr();
  /** эффекты еды — не сохраняются (как стамина) */
  private fxs: Fx = newFx();
  private fxv: FxView = fxView(newFx(), 1);
  private readonly down: DownCam;
  private readonly voice = new VoiceAudio();
  /** свет предметов без модели (спичка, зиппа, «Жучок») — пока нет heldItem.ts */
  private handPoint: PointLight | null = null;
  private handSpot: SpotLight | null = null;
  /** свет в руке в этом кадре */
  private light: Light | null = null;
  private readonly scene: Scene;
  private readonly storeKey: string;
  private obs: Observer<Scene> | null;
  /** предмет под взглядом (подсвечен) */
  private target: WorldDrop | null = null;
  private aimAt = 0;
  /** подбираются / выбрасываются сейчас (ответ операции ещё не пришёл) */
  private picking = new Set<string>();
  /** выброшенное + точки лута (одним массивом для WorldItems) и id точек лута в нём */
  private seen: { drops: readonly WorldDrop[]; loot: readonly WorldDrop[]; all: readonly WorldDrop[] } | null = null;
  private lootIds = new Set<string>();
  private lastX: number | null = null;
  private lastZ = 0;
  /** скорость хода, сглаженная (покачивание лампы в руке), м/с */
  private speed = 0;
  private wheelAcc = 0;
  private wheelAt = 0;
  private seq = 0;
  private heldKey = '';
  private hudKey = '';
  private bag = false;
  /** хотбар изменился без действия игрока — записать по таймеру */
  private dirty = false;
  private savedAt = 0;
  /** реплика (субтитр) до момента until (мс) */
  private sub: { text: string; until: number } | null = null;
  private swearAt = 0;
  private groanAt = 0;
  /** партия в дурака: осталось с, с кем, сколько прошёл */
  private durak: { left: number; with: string; moved: number } | null = null;
  private durakCool = 0;
  private disposed = false;
  /** часы (мс): тесты подменяют */
  clock: () => number = () => performance.now();

  constructor(
    private readonly v: BlockoutViewer,
    private readonly host: InventoryHost,
  ) {
    this.scene = v.scene;
    this.storeKey = hotbarKey(host.key);
    let saved: string | null = null;
    try {
      saved = localStorage.getItem(this.storeKey);
    } catch {}
    this.h = loadHotbar(saved);
    // старое сохранение общаги: лампа была в руке до хотбара — в хотбар и в руку (один раз: ключ стирается)
    try {
      const lk = obshLampKey(host.key);
      const legacy = localStorage.getItem(lk);
      if (legacy !== null) {
        this.h = migrateObshLamp(this.h, legacy);
        this.persist();
        localStorage.removeItem(lk);
      }
    } catch {}
    this.flashlight = new Flashlight(v.scene, v.fps);
    this.lantern = new HeldLantern(v.scene, v.fps, () => v.props?.get('p_obsh_lantern') ?? null);
    this.down = new DownCam(v.scene, v.fps, v.posture);
    const live = () => this.live;
    this.items = new WorldItems(v.scene, {
      portal: host.portal,
      roomShown: host.roomShown,
      shown: live,
      camera: () => v.fps,
      // лампа общаги на полу — её модель (фонарик — своя)
      itemModel: (item) => (item === KEROLAMP_ITEM ? (v.props?.get('p_obsh_lantern') ?? null) : null),
    });
    this.obs = v.scene.onBeforeRenderObservable.add(() => this.frame());
    window.addEventListener('pagehide', this.onHide);
    window.addEventListener('keydown', this.onPickKey, true);
    window.addEventListener('keydown', this.onKey);
    window.addEventListener('wheel', this.onWheel, { passive: true });
    window.addEventListener('pointerdown', this.onMouse);
    if (hasDoc) document.addEventListener('pointerlockchange', this.onLock);
    this.emit(true);
  }

  /** От первого лица, без спец-локации поверх. */
  get live(): boolean {
    return this.v.mode === 'fps' && !this.v.hasOverlay;
  }

  /** Хотбар (только чтение). */
  get hotbar(): Hotbar {
    return this.h;
  }

  /** Предмет в руке. */
  get held(): Slot | null {
    return held(this.h);
  }

  /** Эффекты предметов (катакомбы — invuln, общага — fx, кооп — marked, тоннели — collapseMul). */
  get fx(): FxView {
    return this.fxv;
  }

  /** Лежит (обморок, пьяное падение). */
  get isDown(): boolean {
    return this.fxv.down;
  }

  /** Открыта панель сумки (Tab). */
  get bagOpen(): boolean {
    return this.bag;
  }

  /** Светит в руке луч — П-2 или «Жучок» (кооп: PlayerState.torch). */
  get torchOn(): boolean {
    const s = held(this.h);
    return this.live && !this.fxv.down && (s?.item === P2 || s?.item === BUG) && this.light?.kind === 'spot';
  }

  /** В руке керосинка, и она горит: поле лампы общаги, кооп — PlayerState.lamp. */
  get lampHeld(): boolean {
    const s = held(this.h);
    return s?.item === KEROLAMP_ITEM && isLit(s);
  }

  /** Свободных ячеек хотбара и сумки (за вычетом подбираемых сейчас). */
  get free(): number {
    const empty = this.h.slots.filter((x) => !x).length + (this.h.back?.slots.filter((x) => !x).length ?? 0);
    return empty - this.picking.size;
  }

  /** Предмет, который подберёт E (подсвечен), или null. */
  get aimed(): WorldDrop | null {
    return this.target && this.items.highlighted === this.target.id ? this.target : null;
  }

  // ───────────────────────── действия ─────────────────────────

  /** Новый хотбар; structural — по действию игрока (в localStorage сразу), иначе — по таймеру SAVE_MS; HUD — сразу
   *  (кадр — сам, в конце). */
  private set(h: Hotbar, structural = true, hud = true) {
    if (h === this.h) return;
    this.h = h;
    if (structural) this.persist();
    else this.dirty = true;
    this.refreshFx();
    if (hud) this.emit();
  }

  private persist() {
    this.dirty = false;
    this.savedAt = this.clock();
    try {
      localStorage.setItem(this.storeKey, hotbarJSON(this.h));
    } catch {}
  }

  private refreshFx() {
    this.fxv = fxView(this.fxs, collapseMul(this.h));
  }

  private say(text: string, color = C_INFO) {
    this.host.flash?.(text, color);
  }

  /** Вкладку закрывают / уходят: хотбар и мир — сейчас. */
  private onHide = () => {
    if (this.disposed) return;
    this.persist();
    this.host.saveWorld?.();
  };

  /** Можно действовать руками: от первого лица, не лежит, не на паузе. */
  private get able(): boolean {
    return this.live && !this.fxv.down && !this.v.paused && !this.disposed;
  }

  private ctx(): UseCtx {
    return { sprinting: !!this.v.sprint?.state.sprinting, moving: this.speed > MOVE_MIN, inWater: !!this.host.inWater?.() };
  }

  select(i: number) {
    if (this.fxv.down) return;
    this.set(select(this.h, i));
  }

  cycle(dir: 1 | -1) {
    if (this.fxv.down) return;
    this.set(cycle(this.h, dir));
  }

  /** F: свет предмета в руке (вкл/выкл, качнуть «Жучка», чиркнуть спичкой). false — в руке нечему светить. */
  pressF(): boolean {
    if (this.disposed || this.fxv.down) return false;
    const s = held(this.h);
    if (!s && !this.tr.match) return false;
    const r = pressF(this.h, this.ctx(), this.tr);
    const acted = r.h !== this.h || r.tr !== this.tr || r.staminaCost > 0;
    this.tr = r.tr;
    if (r.staminaCost > 0) this.v.sprint?.spend(r.staminaCost);
    if (r.noise > 0) {
      this.fxs = addNoise(this.fxs, r.noise);
      this.refreshFx();
    }
    this.set(r.h);
    if (r.msg) this.say(r.msg, C_WARN);
    this.emit();
    return acted;
  }

  /** Старое имя (F): свет в руке. */
  toggleLight(): boolean {
    return this.pressF();
  }

  /** R: перезарядить / заправить предмет в руке (запчасти — из хотбара и сумки). */
  reload(): boolean {
    if (this.disposed || this.fxv.down) return false;
    const r = reload(this.h);
    this.set(r.h);
    if (r.done.length) {
      const t = r.done.map((d) => RELOADED[d]).join(', ');
      this.say(t[0].toUpperCase() + t.slice(1) + (r.msg ? ` · ${r.msg}` : ''), C_GOOD);
    } else if (r.msg) this.say(r.msg, C_WARN);
    return r.done.length > 0;
  }

  /** ЛКМ: использовать предмет в руке (съесть, сыграть, надеть, поставить тубус). */
  use(): boolean {
    if (this.disposed || this.fxv.down) return false;
    const u = useHeld(this.h);
    if (u.needPartner) {
      this.playCards();
      return true;
    }
    this.set(u.h);
    if (u.fx) {
      const was = this.fxs.collapseT;
      const e = applyFood(this.fxs, u.fx);
      if (e) {
        this.fxs = e.fx;
        this.refreshFx();
        if (e.heal > 0) this.host.heal?.(e.heal);
        if (e.staminaFull) this.v.sprint?.refill();
        // свалился (юзграм, второй пузырь) — сразу: ход 0 и камера к полу с этого кадра
        if (this.fxv.down && this.live && !this.down.active) {
          this.down.start(this.fxs.faintT > 0 ? 'faint' : 'collapse');
          if (this.v.sprint) this.v.sprint.extraMul = 0;
          this.groanAt = this.clock() + 900;
        }
        this.say(foodText(u.fx, e.fx.collapseT > was), u.fx === 'it_yuzgram' || e.fx.collapseT > was ? C_WARN : C_GOOD);
        this.emit();
      }
      return true;
    }
    if (u.wear) {
      const b = this.h.back;
      if (b) this.say(`Надел: ${itemInfo(b.item).name} — ${b.slots.length} ячеек (Tab)`, C_GOOD);
      return true;
    }
    if (u.msg) this.say(u.msg, u.h !== this.h ? C_GOOD : C_INFO);
    return u.h !== this.h;
  }

  // ───────────────────────── дурак ─────────────────────────

  private playCards() {
    if (this.durak) {
      this.say('Партия уже идёт');
      return;
    }
    const now = this.clock();
    if (now < this.durakCool) {
      this.say(`Карты пока надоели — ещё ${secText((this.durakCool - now) / 1000)}`, C_WARN);
      return;
    }
    const mate = this.host.partner?.(DURAK_M) ?? null;
    if (!mate) {
      this.say('Не с кем сыграть в дурака', C_WARN);
      return;
    }
    this.host.durak?.(mate.id);
    this.startDurak(mate.name);
  }

  /** Напарник позвал в дурака (кооп-действие 'durak'). */
  durakFrom(name: string) {
    if (this.disposed || !this.live || this.fxv.down || this.durak) return;
    this.startDurak(name);
  }

  private startDurak(name: string) {
    this.durak = { left: DURAK_S, with: name, moved: 0 };
    this.durakCool = this.clock() + DURAK_COOL_MS;
    this.emit();
  }

  private stepDurak(dt: number, step: number) {
    const d = this.durak;
    if (!d) return;
    d.moved += step;
    if (d.moved > DURAK_MOVE_M || this.fxv.down || !this.live) {
      this.durak = null;
      this.say('Партия в дурака сорвалась', C_WARN);
      return;
    }
    d.left -= dt;
    if (d.left <= 0) {
      this.durak = null;
      this.host.heal?.(DURAK_HEAL);
      this.say(`Сыграли в дурака с ${d.with}: +${DURAK_HEAL} здоровья`, C_GOOD);
    }
  }

  // ───────────────────────── твари ─────────────────────────

  /** Свой игрок увидел тварь (общага: 'hand'): пьяный — ругается (субтитр и рык). */
  sawCreature(kind: string) {
    void kind;
    if (this.disposed || !this.fxv.drunk || this.fxv.down) return;
    const now = this.clock();
    if (now < this.swearAt) return;
    this.swearAt = now + SWEAR_COOL_MS;
    this.sub = { text: SWEARS[Math.floor(Math.random() * SWEARS.length)], until: now + SWEAR_MS };
    this.voice.grunt();
    this.emit();
  }

  // ───────────────────────── мир ─────────────────────────

  /** Предмет s, положенный перед игроком (куда ляжет выброшенный), или null — некуда. */
  private dropOf(s: Slot): WorldDrop | null {
    const inst = this.host.room();
    const p = inst ? dropPose(this.scene, this.v.fps, { inst, portal: this.host.portal(), eye: this.v.posture.eye, item: s.item }) : null;
    if (!p) return null;
    const id = dropId(this.host.playerId, Date.now(), Math.random());
    return { id, item: s.item, inst: p.inst, x: p.x, y: p.y, z: p.z, yaw: p.yaw, ...dropFields(s) };
  }

  /** G: выбросить выбранную ячейку целиком перед собой. */
  dropHeld(): Promise<boolean> {
    return this.dropAt({ bag: false, i: this.h.sel });
  }

  /** Выбросить ячейку at (хотбар или сумка) целиком. Ячейка пустеет сразу; не легло — предмет обратно. */
  async dropAt(at: Loc): Promise<boolean> {
    const s0 = slotAt(this.h, at);
    if (!s0 || this.disposed || this.fxv.down) return false;
    const s = onDrop(s0);
    const d = this.dropOf(s);
    if (!d) {
      this.say('Некуда положить', C_WARN);
      return false;
    }
    this.set(setAt(this.h, at, null));
    const r = await this.host.request({ k: 'drop', d }).catch(() => null);
    if (r) {
      // мир — сразу вслед за хотбаром (иначе закрыл вкладку в эти 0.4 с — предмет пропал)
      this.host.saveWorld?.();
      return true;
    }
    if (this.disposed) return false;
    const back = putBackAt(this.h, at, s);
    if (back) this.set(back);
    this.say('Не положить', C_WARN);
    return false;
  }

  /** E: подобрать подсвеченный предмет или точку лута. Не влезет — «Руки заняты», операция не уходит. */
  async pickUp(): Promise<boolean> {
    const d = this.aimed;
    if (!d || this.disposed || this.picking.has(d.id) || this.fxv.down) return false;
    const s = slotOfDrop(d);
    if (!pickInto(this.h, s)) {
      this.say('Руки заняты', C_WARN);
      return false;
    }
    const loot = this.lootIds.has(d.id) || isLootId(d.id);
    this.picking.add(d.id);
    const r = await this.host.request(loot ? { k: 'loot', id: d.id } : { k: 'pick', id: d.id }).catch(() => null);
    this.picking.delete(d.id);
    if (!r || this.disposed) return false;
    const p = pickInto(this.h, s);
    if (p) {
      this.set(p.h);
      if (p.wore) this.say(`Надел: ${itemInfo(s.item).name} — ${bagSlotsOf(s.item)} ячеек (Tab)`, C_GOOD);
      // не всё влезло (стек) — остаток там же, где лежал
      if (p.left > 0) void this.host.request({ k: 'drop', d: { ...d, id: dropId(this.host.playerId, Date.now(), Math.random()), n: p.left } });
      // мир — сразу вслед за хотбаром (иначе закрыл вкладку в эти 0.4 с — предмет задвоился)
      this.host.saveWorld?.();
      return true;
    }
    // руки заняли, пока шёл ответ — положить обратно, где лежал
    void this.host.request({ k: 'drop', d: loot ? { ...d, id: dropId(this.host.playerId, Date.now(), Math.random()) } : d });
    this.say('Руки заняты', C_WARN);
    return false;
  }

  /** Предмет со стороны (лампа со спота общаги: операция мира уже прошла) — в хотбар и в руку; мир — сразу (закрыл
   *  вкладку — не задвоился). Руки заняли, пока шёл ответ (место проверяют заранее — free), — на пол перед собой. */
  receive(s: Slot): boolean {
    if (this.disposed) return false;
    const a = add(this.h, s);
    if (a) {
      this.set(a.at >= 0 ? select(a.h, a.at) : a.h);
      this.host.saveWorld?.();
      return true;
    }
    const d = this.dropOf(s);
    if (d) void this.host.request({ k: 'drop', d }).then((r) => r && this.host.saveWorld?.(), () => null);
    this.say('Руки заняты', C_WARN);
    return false;
  }

  /** QA (общага giveLantern): on — предмет в руку (есть в хотбаре — выбрать, нет — положить), off — убрать отовсюду. */
  qaHold(item: string, on: boolean): boolean {
    if (on) {
      const h = holdItem(this.h, item);
      if (h) this.set(h);
      return !!h;
    }
    let h = this.h;
    for (const l of findAll(h, item)) h = setAt(h, l, null);
    this.set(h);
    return true;
  }

  // ───────────────────────── сумка (панель Tab, BagHud.tsx) ─────────────────────────

  /** Открыть / закрыть панель сумки. Открыть — мышь отпускается; закрыть с relock — захватить снова. */
  toggleBag(relock = true) {
    if (this.bag) this.closeBag(relock);
    else this.openBag();
  }

  openBag() {
    if (this.bag || this.disposed || !this.live || this.fxv.down) return;
    this.bag = true;
    if (locked()) document.exitPointerLock();
    this.emit();
  }

  closeBag(relock = false) {
    if (!this.bag) return;
    this.bag = false;
    this.emit();
    if (relock && this.live && hasDoc && !locked()) {
      this.v.engine.getRenderingCanvas()?.focus();
      this.v.engine.enterPointerlock();
    }
  }

  /** Перенести ячейку from в to (обмен / долить стек). */
  moveSlot(from: Loc, to: Loc): boolean {
    const r = move(this.h, from, to);
    if (!r.h) {
      this.say(r.msg, C_WARN);
      return false;
    }
    this.set(r.h);
    return true;
  }

  /** Клик по ячейке панели: из сумки — в хотбар, из хотбара — в сумку. */
  autoMove(at: Loc): boolean {
    const r = at.bag ? fromBag(this.h, at.i) : toBag(this.h, at.i);
    if (!r.h) {
      this.say(r.msg, C_WARN);
      return false;
    }
    this.set(r.h);
    return true;
  }

  /** «Снять сумку» — в хотбар (только пустую). */
  takeOffBag(): boolean {
    const r = unwear(this.h);
    if (!r.h) {
      this.say(r.msg, C_WARN);
      return false;
    }
    this.set(r.h);
    return true;
  }

  // ───────────────────────── ввод ─────────────────────────

  /** E — раньше всех (фаза захвата): есть что подобрать — подобрать, остальным E не достаётся. */
  private onPickKey = (e: KeyboardEvent) => {
    if (e.code !== 'KeyE' || this.disposed || !this.live || this.bag || typing(e) || e.ctrlKey || e.metaKey || e.altKey) return;
    if (!this.aimed || this.fxv.down || this.v.paused) return;
    e.stopImmediatePropagation();
    e.preventDefault();
    if (!e.repeat) void this.pickUp();
  };

  private onKey = (e: KeyboardEvent) => {
    if (this.disposed || !this.live || typing(e) || e.ctrlKey || e.metaKey || e.altKey) return;
    const i = slotOfKey(e.code);
    if (i !== null) {
      if (!e.repeat) this.select(i);
      return;
    }
    if (e.code === 'Tab') {
      e.preventDefault();
      if (!e.repeat && (this.bag || !this.v.paused)) this.toggleBag(true);
      return;
    }
    if (e.code === 'Escape' && this.bag) {
      this.closeBag(false);
      return;
    }
    if (e.repeat || this.bag || !this.able) return;
    if (e.code === 'KeyF') this.pressF();
    else if (e.code === 'KeyR') this.reload();
    else if (e.code === 'KeyG') void this.dropHeld();
  };

  /** ЛКМ (мышь захвачена: клик захвата — не «использовать») — использовать предмет в руке. */
  private onMouse = (e: MouseEvent) => {
    if (e.button !== 0 || !locked() || this.bag || !this.able) return;
    this.use();
  };

  /** Мышь снова захвачена (клик по сцене) — панель сумки закрыть. */
  private onLock = () => {
    if (locked() && this.bag) this.closeBag(false);
  };

  /** Колесо — по кругу, пока мышь захвачена (от первого лица колесо больше ничего не делает). */
  private onWheel = (e: WheelEvent) => {
    if (this.disposed || !this.live || !locked()) return;
    const now = performance.now();
    if (now - this.wheelAt > WHEEL_IDLE) this.wheelAcc = 0;
    this.wheelAt = now;
    this.wheelAcc += e.deltaMode === 1 ? e.deltaY * 33 : e.deltaMode === 2 ? e.deltaY * 400 : e.deltaY;
    if (Math.abs(this.wheelAcc) < WHEEL_STEP) return;
    this.cycle(this.wheelAcc > 0 ? 1 : -1);
    this.wheelAcc = 0;
  };

  // ───────────────────────── кадр ─────────────────────────

  /** Выброшенное + точки лута — один массив (новый, только когда изменился один из них). */
  private worldItems(): readonly WorldDrop[] {
    const drops = this.host.drops();
    const loot = this.host.loot?.() ?? [];
    const s = this.seen;
    if (s && s.drops === drops && s.loot === loot) return s.all;
    const all = loot.length ? [...drops, ...loot] : drops;
    this.lootIds = new Set(loot.map((d) => d.id));
    this.seen = { drops, loot, all };
    return all;
  }

  private frame() {
    if (this.disposed) return;
    const v = this.v;
    const live = this.live;
    const dt = Math.min(0.1, v.engine.getDeltaTime() / 1000 || 1 / 60);
    const now = this.clock();
    // ход: сдвиг камеры за кадр (переносы — не ход)
    const c = v.fps.position;
    let step = 0;
    if (live && this.lastX !== null) {
      const d = Math.hypot(c.x - this.lastX, c.z - this.lastZ);
      if (d < TELEPORT) step = d;
    }
    this.lastX = live ? c.x : null;
    this.lastZ = c.z;
    this.speed += (step / dt - this.speed) * Math.min(1, dt * 6);
    if (!live && this.bag) this.closeBag(false);
    // рука: заряд, износ, спичка; события — вспышкой (и хотбар — в localStorage сразу)
    const ctx = this.ctx();
    if (live) {
      const before = held(this.h)?.item ?? null;
      const r = stepHand(this.h, dt, ctx, this.tr);
      this.tr = r.tr;
      this.set(r.h, r.events.length > 0, false);
      const msg = eventText(r.events, before);
      if (msg) this.say(msg, C_WARN);
    }
    // эффекты: таймеры, скорость (× сумка), лежит
    this.fxs = stepFx(this.fxs, dt);
    this.refreshFx();
    if (v.sprint) v.sprint.extraMul = this.fxv.speedMul * bagSpeed(this.h);
    const left = Math.max(this.fxs.faintT, this.fxs.collapseT);
    if (left > 0 && live && !this.down.active) {
      this.down.start(this.fxs.faintT > 0 ? 'faint' : 'collapse');
      if (this.bag) this.closeBag(false);
      this.groanAt = now + 900;
    }
    const pose = this.down.step(dt, live ? left : 0);
    if (pose && this.down.kind === 'collapse' && now >= this.groanAt) {
      this.voice.groan();
      this.groanAt = now + GROAN_MS + Math.random() * 1400;
    }
    this.stepDurak(dt, step);
    if (this.sub && now > this.sub.until) this.sub = null;
    // свет и модель в руке
    const s = held(this.h);
    const hands = live && !this.down.active;
    const light = hands ? lightOf(s, ctx, this.tr) : null;
    this.light = light;
    const flash = hands && s?.item === P2;
    const f = this.flashlight;
    if (flash) f.setOn(isLit(s));
    f.setHeld(flash);
    f.update(dt, { speed: step / dt, sprint: (v.sprint.state.mul - 1) / (RUN_MUL - 1), crawl: v.posture.pose === 'crawl' ? 1 : v.posture.side ? 0.45 : 0 }); // side — боком в щели погреба: фонарь ниже
    if (flash && light) {
      // П-2: яркость и дальность — по заряду (ниже 12 % мигает)
      f.light.intensity *= light.intensity;
      f.light.range = light.range;
    }
    this.lantern.show(hands && s?.item === KEROLAMP_ITEM && !this.host.handsDown?.());
    this.lantern.update(dt, this.speed);
    if (this.lantern.shown) this.lantern.light.intensity *= light ? light.intensity / KEROLAMP_INTENSITY : 0;
    this.handLight(hands && s?.item !== P2 && s?.item !== KEROLAMP ? light : null);
    // предметы на полу и точки лута; под взглядом — подсветка и подсказка
    // по массиву, не по номеру версии: у пересобранной копии мира (кооп) dropsRev снова с 0
    const changed = this.items.sync(this.worldItems());
    if (!live || this.down.active) {
      if (this.target) {
        this.target = null;
        this.items.highlight(null);
      }
    } else if (now - this.aimAt > AIM_MS) {
      this.aimAt = now;
      const t = this.items.nearest(c, v.fps.getDirection(Vector3.Forward()), PICK_M);
      this.target = t;
      this.items.highlight(t?.id ?? null);
    }
    // выбросили / подобрали: построенные видны со следующего кадра — тогда и искать заново
    if (changed) this.aimAt = 0;
    if (this.dirty && now - this.savedAt >= SAVE_MS) this.persist();
    this.emit();
  }

  /** Свет предмета без модели (спичка, зиппа — круговой у руки, «Жучок» — луч); null — погасить. */
  private handLight(l: Light | null) {
    const pt = l?.kind === 'point' ? l : null;
    const sp = l?.kind === 'spot' ? l : null;
    if (pt && !this.handPoint) {
      const p = (this.handPoint = new PointLight('inv:handPoint', new Vector3(0.16, -0.18, 0.42), this.scene));
      p.parent = this.v.fps;
      p.specular = Color3.Black();
    }
    if (sp && !this.handSpot) {
      const p = (this.handSpot = new SpotLight('inv:handSpot', new Vector3(0.2, -0.2, 0.2), new Vector3(0, 0.02, 1), FLASH_ANGLE * 0.85, 18, this.scene));
      p.parent = this.v.fps;
    }
    const apply = (light: PointLight | SpotLight | null, x: Light | null, base: number) => {
      if (!light) return;
      if (!x) {
        if (light.isEnabled()) light.setEnabled(false);
        return;
      }
      if (!light.isEnabled()) light.setEnabled(true);
      light.diffuse = Color3.FromHexString(x.color);
      light.intensity = x.intensity * base;
      light.range = x.range;
    };
    apply(this.handPoint, pt, 1.6);
    apply(this.handSpot, sp, flashIntensity(sceneLitness(this.scene)));
  }

  /** HUD — только когда изменился (onHud зовёт setState страницы). */
  private emit(force = false) {
    const d = this.aimed;
    const name = d ? itemInfo(d.item).name + (d.n && d.n > 1 ? ` ×${d.n}` : '') : '';
    const prompt = d && this.live && !this.fxv.down ? `E — подобрать: ${name}` : null;
    const s = held(this.h);
    const hk = `${this.h.sel}|${s?.item ?? ''}`;
    if (hk !== this.heldKey) {
      this.heldKey = hk;
      this.seq++;
    }
    const sub = this.sub?.text ?? (this.durak ? `Партия в дурака с ${this.durak.with}… не уходи` : null);
    const hud = inventoryHud(this.h, prompt, this.seq, {
      bagOpen: this.bag,
      lit: !!this.light,
      fx: this.fxs,
      veil: this.down.now,
      sub,
      durak: this.durak?.left ?? null,
    });
    const key = JSON.stringify(hud);
    if (!force && key === this.hudKey) return;
    this.hudKey = key;
    this.host.onHud?.(hud);
  }

  /** Для QA-скриптов (window.__rfInv). */
  qa() {
    return {
      inv: this,
      hotbar: () => this.h,
      hud: () => JSON.parse(this.hudKey || 'null') as InventoryHud | null,
      flash: () => ({ held: this.flashlight.held, on: this.flashlight.on, hand: this.flashlight.handSide, intensity: this.flashlight.light.intensity }),
      lamp: () => ({ held: this.lampHeld, shown: this.lantern.shown, light: this.lantern.light.isEnabled(), intensity: this.lantern.light.intensity }),
      aimed: () => this.aimed,
      fx: () => ({ ...this.fxv, timers: { ...this.fxs }, down: this.down.active, pose: this.down.now }),
      light: () => this.light,
      tr: () => this.tr,
      /** QA: положить предмет (как подобрал) */
      give: (s: Slot) => {
        const p = pickInto(this.h, s);
        if (p) this.set(p.h);
        return !!p;
      },
      /** QA: хотбар целиком */
      setHotbar: (h: Hotbar) => this.set(h),
      items: this.items,
    };
  }

  dispose() {
    if (this.disposed) return;
    if (this.dirty) this.persist();
    this.disposed = true;
    if (this.obs) this.scene.onBeforeRenderObservable.remove(this.obs);
    this.obs = null;
    if (this.v.sprint) this.v.sprint.extraMul = 1;
    window.removeEventListener('pagehide', this.onHide);
    window.removeEventListener('keydown', this.onPickKey, true);
    window.removeEventListener('keydown', this.onKey);
    window.removeEventListener('wheel', this.onWheel);
    window.removeEventListener('pointerdown', this.onMouse);
    if (hasDoc) document.removeEventListener('pointerlockchange', this.onLock);
    this.down.dispose();
    this.voice.dispose();
    this.handPoint?.dispose();
    this.handSpot?.dispose();
    this.items.dispose();
    this.flashlight.dispose();
    this.lantern.dispose();
  }
}
