// Жилые комнаты общаги: номера на дверях, замки, ключи и записки — чистая логика без движка (интеграция — WALK:
// src/view3d/obshagaRoomsView.ts рисует таблички и замки, кладёт ключ и записку; лут по tier / dormValue).
//
// Замысел заказчика:
//  • Комнаты общаги рандомно открыты и закрыты. Для открытия запертых нужны ключи.
//  • Чем выше номер комнаты, тем дороже в ней лут. 75% комнат — без номеров.
//  • В некоторых комнатах лежат записки об особо элитных номерах: нашёл в номерной комнате записку «741213» — значит,
//    у комнаты 741213 элитный лут.
//  • Самые элитные — «∞ + (любое число)». Одна такая — наверняка на каждую локацию, как только игроки в неё зашли;
//    дальше по мере роста мира — с шансом 0.1%.
//  • Дальше — особо элитные, вторые по луту после бесконечной: с цифровым обозначением, например 741213.
//
// Трактовки:
//  • Локация — компонента связности экземпляров общаги по проёмам прогона (rx.links без переходов спец-локаций
//    descent/lift и без «исчезнувших» sealed; швы бесконечного хода wrap — тот же коридор, считаются). Лестницы общаги —
//    тоже общага: этажи одного здания — одна локация. Ключ локации — id её экземпляра с наименьшим order (первый
//    выросший — вход), k — порядковый номер жилой комнаты в локации по возрастанию order. Мир растёт дописыванием
//    экземпляров с большим order — k уже выросших комнат не меняются.
//  • Номера: номерные — лог-равномерно 1..999999 по разрядам (каждый разряд равновероятен, внутри — равномерно; без
//    Math.exp — одинаково на всех движках), так что шестизначные «пустышки» бывают и записка имеет смысл; элитные —
//    всегда шестизначные; ∞ — «∞+N», N 1..999.
//  • ∞ — ровно одна среди первых infEntryRooms жилых комнат локации (какая — hash(seed, loc) mod infEntryRooms), дальше —
//    с шансом infLaterChance на комнату.
//  • Записка — только в номерных и элитных (не в ∞) с noteChance; на ней — номер следующей элитной комнаты этой
//    локации (eliteAfter: скан до eliteScan вперёд). Не нашлось — записки нет.
//  • Ключ — только в незапертых комнатах (до ключа можно добраться), с keyChance; в первой незапертой комнате локации —
//    всегда (∞ заперта всегда и стоит в первых — без ключа рядом её не открыть).
//
// ГСЧ: у каждой комнаты свой поток makeRng(`${seed}/dorm/${loc}/${k}`) с жёсткой раскладкой бросков (каждый бросок —
// всегда, независимо от исхода прошлых): 0 — поздняя ∞, 1 — номерная, 2 — элитная, 3 — число, 4 — замок, 5 — записка,
// 6 — ключ. Вид и номер комнаты k не зависят от других комнат (лёгкий бросок dormKind — 4 числа), поэтому eliteAfter
// сканирует дёшево; ручки DORM (бестиарий) меняют исходы, но не сдвигают потоки. Всё — простой JSON, без Math.random.
import type { RunExport, RunInstance } from '../blockout/types';
import { hashSeed, makeRng, type Rng } from '../model/rng';

/** Ручки комнат общаги (бестиарий меняет их на ходу — читать в момент использования). */
export const DORM = {
  /** доля комнат с номером на двери (остальные 75% — без номера) */
  numberedChance: 0.25,
  /** доля элитных среди номерных (шестизначный номер, лут — второй после ∞) */
  eliteChance: 0.12,
  /** ∞ — ровно одна среди стольких первых жилых комнат локации */
  infEntryRooms: 3,
  /** дальше ∞ — с таким шансом на комнату */
  infLaterChance: 0.001,
  /** шанс, что дверь заперта, — по виду комнаты */
  locked: { plain: 0.35, numbered: 0.5, elite: 0.85, inf: 1 },
  /** записка в номерной / элитной комнате */
  noteChance: 0.4,
  /** ключ в незапертой комнате (в первой незапертой локации — всегда) */
  keyChance: 0.3,
  /** записка: искать следующую элитную не дальше стольких комнат вперёд */
  eliteScan: 400,
};

export type DormKind = 'plain' | 'numbered' | 'elite' | 'inf';

export interface DormMeta {
  /** экземпляр комнаты (rollDorm — пусто, заполняет dormIndex) */
  inst: string;
  /** локация (id первого экземпляра компоненты общаги) и порядковый № жилой комнаты в ней */
  loc: string;
  k: number;
  kind: DormKind;
  /** номер на двери; у ∞ — N из «∞+N»; без номера — null */
  number: number | null;
  /** табличка: '∞+417' | '741213' | '312' | null */
  plate: string | null;
  /** 0 — без номера; номер < 100 → 1; ≥ 100 → 2; элитная → 3; ∞ → 4 */
  tier: 0 | 1 | 2 | 3 | 4;
  locked: boolean;
  /** номер элитной комнаты на записке (6 цифр) или null — записки нет */
  note: number | null;
  /** в этой комнате лежит ключ */
  key: boolean;
}

/** Первая незапертая ищется не дальше стольких комнат (все заперты ручками — ключа-гарантии нет). */
const FIRST_OPEN_SCAN = 256;

const clamp01 = (v: number) => (v > 0 ? (v < 1 ? v : 1) : 0);
const roomRng = (seed: string, loc: string, k: number): Rng => makeRng(`${seed}/dorm/${loc}/${k}`);

/** Какая из первых infEntryRooms комнат локации — ∞ (−1 — ручка 0: гарантии нет). */
function infEntryK(seed: string, loc: string): number {
  const n = Math.floor(Number(DORM.infEntryRooms) || 0);
  return n > 0 ? hashSeed(`${seed}/dorm-inf/${loc}`) % n : -1;
}

/** Номер номерной комнаты по броску u ∈ [0, 1): разряд 1..6 равновероятен, внутри разряда — равномерно. */
function plainNumber(u: number): number {
  const v = u * 6;
  const d = Math.min(5, Math.floor(v));
  const lo = 10 ** d;
  const span = lo * 9;
  return Math.min(lo * 10 - 1, lo + Math.floor((v - d) * span));
}

/** Лёгкий бросок: вид и номер комнаты k (броски 0–3 её потока); rng — поток после них (для замка, записки, ключа). */
function rollKind(seed: string, loc: string, k: number): { kind: DormKind; number: number | null; rng: Rng } {
  const rng = roomRng(seed, loc, k);
  const rInf = rng.next();
  const rNum = rng.next();
  const rElite = rng.next();
  const rVal = rng.next();
  const entry = Math.floor(Number(DORM.infEntryRooms) || 0);
  const inf = k < entry ? k === infEntryK(seed, loc) : rInf < DORM.infLaterChance;
  if (inf) return { kind: 'inf', number: 1 + Math.min(998, Math.floor(rVal * 999)), rng };
  if (rNum >= DORM.numberedChance) return { kind: 'plain', number: null, rng };
  if (rElite < DORM.eliteChance) return { kind: 'elite', number: 100000 + Math.min(899999, Math.floor(rVal * 900000)), rng };
  return { kind: 'numbered', number: plainNumber(rVal), rng };
}

/** Вид и номер жилой комнаты k локации — без замка, записки и ключа (дёшево: для сканов). */
export function dormKind(seed: string, loc: string, k: number): { kind: DormKind; number: number | null } {
  const { kind, number } = rollKind(seed, loc, k);
  return { kind, number };
}

const lockP = (kind: DormKind): number => clamp01(Number(DORM.locked[kind]) || 0);

/** Первая незапертая жилая комната локации (k) или −1 — в первых FIRST_OPEN_SCAN все заперты. */
function firstOpenK(seed: string, loc: string): number {
  for (let k = 0; k < FIRST_OPEN_SCAN; k++) {
    const r = rollKind(seed, loc, k);
    if (!(r.rng.next() < lockP(r.kind))) return k;
  }
  return -1;
}

const tierOf = (kind: DormKind, number: number | null): DormMeta['tier'] =>
  kind === 'inf' ? 4 : kind === 'elite' ? 3 : kind === 'numbered' ? ((number ?? 0) < 100 ? 1 : 2) : 0;

/** Табличка на двери: '∞+417' | '741213' | '312' | null (без номера). */
export function plateText(meta: Pick<DormMeta, 'kind' | 'number'>): string | null {
  if (meta.kind === 'plain' || meta.number == null) return null;
  return meta.kind === 'inf' ? `∞+${meta.number}` : String(meta.number);
}

/** Следующая элитная комната после k в той же локации (скан до eliteScan вперёд) — номер для записки; нет — null. */
export function eliteAfter(seed: string, loc: string, k: number): { k: number; number: number } | null {
  const scan = Math.max(0, Math.floor(Number(DORM.eliteScan) || 0));
  for (let j = k + 1; j <= k + scan; j++) {
    const r = dormKind(seed, loc, j);
    if (r.kind === 'elite' && r.number != null) return { k: j, number: r.number };
  }
  return null;
}

/** Метаданные жилой комнаты k локации loc (inst — пусто: его заполняет dormIndex). Детерминированно по (seed, loc, k). */
export function rollDorm(seed: string, loc: string, k: number): DormMeta {
  const { kind, number, rng } = rollKind(seed, loc, k);
  const rLock = rng.next();
  const rNote = rng.next();
  const rKey = rng.next();
  const locked = rLock < lockP(kind);
  let note: number | null = null;
  if ((kind === 'numbered' || kind === 'elite') && rNote < DORM.noteChance) note = eliteAfter(seed, loc, k)?.number ?? null;
  // ключ — только за открытой дверью; в первой открытой комнате локации — всегда
  const key = !locked && (rKey < DORM.keyChance || k === firstOpenK(seed, loc));
  return { inst: '', loc, k, kind, number, plate: plateText({ kind, number }), tier: tierOf(kind, number), locked, note, key };
}

/**
 * Ценность лута комнаты 0..1, монотонно по номеру: без номера — 0; номерные — 0.1..0.6 (по разрядам номера, внутри
 * разряда — линейно); элитные — 0.7..0.9 (по номеру); ∞ — 1.
 */
export function dormValue(meta: Pick<DormMeta, 'kind' | 'number'>): number {
  const n = meta.number ?? 0;
  switch (meta.kind) {
    case 'inf':
      return 1;
    case 'elite':
      return 0.7 + 0.2 * clamp01((n - 100000) / 899999);
    case 'numbered': {
      let d = 0;
      let lo = 1;
      while (d < 5 && n >= lo * 10) (lo *= 10), d++;
      return 0.1 + (0.5 * (d + clamp01((n - lo) / (lo * 9)))) / 6;
    }
    default:
      return 0;
  }
}

/** Записки от руки: {n} — номер элитной комнаты. */
const NOTES: readonly string[] = [
  '…в {n} у коменданта заначка. Ключ на вахте. Не говори никому.',
  '{n}!!! Там всё, что списали со склада. Сын завхоза не дурак — под кроватью ящики.',
  'Если что — комната {n}. Стучать три раза. Не открывают — значит, никого. Бери сам.',
  'Валера из {n} уехал на практику и не вернулся. Вещи так и лежат. Дверь заперта.',
  '{n} — НЕ ТРОГАТЬ, это для комиссии. (ниже другой рукой:) комиссии не будет.',
  'Кто найдёт — иди в {n}. Я не дошёл. Там хватит на всех.',
  'Комендант всё конфискованное держит в {n}. Сама видела, как заносили ящики. Ночью.',
  'Долг отдам. Деньги в {n}, за батареей. Только не ходи туда, когда гаснет свет.',
];

/** Текст записки (номер элитной комнаты — на виду) или null — записки нет. Шаблон — по комнате и номеру. */
export function noteText(meta: Pick<DormMeta, 'loc' | 'k' | 'note'>): string | null {
  if (meta.note == null) return null;
  const t = NOTES[hashSeed(`${meta.loc}/${meta.k}/${meta.note}`) % NOTES.length];
  return t.replace('{n}', String(meta.note));
}

/** Экземпляр общаги: первый тег «общага» (как NavRoom.obsh в src/view3d/obshagaNav.ts) или комната obsh_*. */
export function isObshInstance(i: RunInstance): boolean {
  return (i.roomTags ?? [])[0] === 'общага' || (i.roomId ?? '').startsWith('obsh_');
}

/** Жилая комната общаги: общага с тегом «комната» (src/data/roomsObshaga.ts roomMeta) или obsh_room_*. */
export function isDormInstance(i: RunInstance): boolean {
  return isObshInstance(i) && ((i.roomTags ?? []).includes('комната') || (i.roomId ?? '').startsWith('obsh_room_'));
}

/** Порядок роста экземпляра: id 'i<order>' (src/gen4d/stream.ts, src/gen/generate.ts); иначе — индекс в прогоне. */
function orderOf(i: RunInstance, idx: number): number {
  const m = /^i(\d+)$/.exec(i.id);
  return m ? Number(m[1]) : idx;
}

interface DormCache {
  n: number;
  l: number;
  sig: string;
  isDorm: (i: RunInstance) => boolean;
  isObsh: (i: RunInstance) => boolean;
  map: Map<string, DormMeta>;
}
const dormCache = new WeakMap<RunExport, DormCache>();

/**
 * Все жилые комнаты общаги мира → метаданные (по id экземпляра, по возрастанию order). Локация — компонента связности
 * экземпляров общаги (isObsh или isDorm) по rx.links: без descent/lift и sealed, со швами wrap; ключ — id экземпляра
 * с наименьшим order; k — по возрастанию order среди жилых. Кэш — по объекту прогона + числу экземпляров и проёмов +
 * ручкам DORM (мир дописали в тот же объект или бестиарий покрутил ручки — пересчёт).
 */
export function dormIndex(
  rx: RunExport,
  isDorm: (i: RunInstance) => boolean = isDormInstance,
  isObsh: (i: RunInstance) => boolean = isObshInstance,
): Map<string, DormMeta> {
  const insts = rx.instances ?? [];
  const links = rx.links ?? [];
  const sig = JSON.stringify(DORM);
  const c = dormCache.get(rx);
  if (c && c.n === insts.length && c.l === links.length && c.sig === sig && c.isDorm === isDorm && c.isObsh === isObsh) return c.map;
  // узлы — экземпляры общаги; система непересекающихся множеств по проёмам между ними
  const idx = new Map<string, number>();
  const nodes: { i: RunInstance; order: number; dorm: boolean }[] = [];
  insts.forEach((i, n) => {
    const dorm = isDorm(i);
    if (!dorm && !isObsh(i)) return;
    idx.set(i.id, nodes.length);
    nodes.push({ i, order: orderOf(i, n), dorm });
  });
  const up = nodes.map((_, n) => n);
  const find = (a: number): number => {
    while (up[a] !== a) a = up[a] = up[up[a]];
    return a;
  };
  for (const l of links) {
    if (l.sealed || (l.kind && l.kind !== 'door')) continue;
    const a = idx.get(l.a.inst), b = idx.get(l.b.inst);
    if (a === undefined || b === undefined) continue;
    const ra = find(a), rb = find(b);
    if (ra === rb) continue;
    // корень — узел с меньшим order: он и есть ключ локации
    if (nodes[ra].order <= nodes[rb].order) up[rb] = ra;
    else up[ra] = rb;
  }
  const sorted = nodes.map((_, n) => n).sort((a, b) => nodes[a].order - nodes[b].order || a - b);
  const counts = new Map<number, number>();
  const map = new Map<string, DormMeta>();
  for (const n of sorted) {
    if (!nodes[n].dorm) continue;
    const root = find(n);
    const k = counts.get(root) ?? 0;
    counts.set(root, k + 1);
    const meta = rollDorm(rx.seed, nodes[root].i.id, k);
    meta.inst = nodes[n].i.id;
    map.set(meta.inst, meta);
  }
  dormCache.set(rx, { n: insts.length, l: links.length, sig, isDorm, isObsh, map });
  return map;
}
