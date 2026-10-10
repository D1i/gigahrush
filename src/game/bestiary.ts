// Бестиарий (вкладка «Бестиарий», tmp/smile-wip/CONTRACT.md §7): реестр существ, явлений и мест мира с ручками — числами
// их конфигов (SMILE, OBSHAGA, CATACOMBS, ESC, DORM…), которые геймдизайнер крутит из редактора. Без React и Babylon.
//  • defineBeast запоминает дефолты ручек (копия чисел) при регистрации — «сбросить» возвращает к ним.
//  • Правки живут в проекте (Project.bestiary: только изменённые, id существа → ключ ручки → число): сохраняются,
//    отменяются (undo) и уходят в кооп вместе с проектом. applyBestiary пишет их в конфиги (чего нет — дефолт).
//  • Ключ ручки — путь в конфиге: 'stareS', 'heart.tear', 'peek1DistM.0' (.N — индекс массива).
//  • Чей набор правок действует: свой проект (стор, src/bestiary/sync.ts) или, пока идёт кооп, проект лобби
//    (setLobbyBestiary из src/coop/session.ts) — у всех игроков лобби числа одни (детерминизм копий мира).
// Конфиги — обычные изменяемые объекты; их модули читают значения в момент использования (не копируют на загрузке).

/** Ручка — одно число конфига. */
export interface BeastKnob {
  /** путь в config: 'stareS' | 'heart.tear' | 'peek1DistM.0' (.N — индекс массива) */
  key: string;
  label: string;
  min: number;
  max: number;
  step: number;
  unit?: string;
  hint?: string;
  /** группа (секция на странице существа) */
  group?: string;
  /** общая подпись пары [от, до]: у обеих ручек пары ('x.0', 'x.1') — одна и та же; страница рисует их одной строкой */
  range?: string;
  /** доля 0…1, показывается в процентах (хранится как есть) */
  pct?: boolean;
}

export interface Beast {
  id: string;
  name: string;
  aka?: string;
  /** биом / где встречается (подпись) */
  biome: string;
  kind: 'монстр' | 'явление' | 'место';
  danger: 0 | 1 | 2 | 3 | 4 | 5;
  summary: string;
  /** поведение по стадиям (по порядку); в тексте {ключ} — текущее значение ручки или числа конфига */
  behaviour: { title: string; text: string }[];
  /** как выжить */
  counters?: string[];
  knobs: BeastKnob[];
  config: Record<string, unknown> | null;
  /** где ещё настраивается (например «в редакторе комнаты → Спец-локация») */
  note?: string;
  /** спец-локация комнаты, которой настраивается существо (кнопка «открыть комнату» на странице) */
  roomKind?: string;
}

/** Только изменённые: id существа → ключ ручки → число. */
export type BestiaryOverrides = Record<string, Record<string, number>>;

interface Entry {
  beast: Beast;
  /** дефолты ручек на момент регистрации */
  defs: Record<string, number>;
}

const reg = new Map<string, Entry>();

const fin = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
/** Сравнение с дефолтом — с допуском плавающей точки (ползунок 0.1 + 0.2). */
const same = (a: number, b: number) => Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b));

// ───────────────────────── пути ─────────────────────────

/** Число по пути 'a.b.0' в объекте (нет или не число — undefined). */
export function readPath(obj: unknown, key: string): number | undefined {
  let o: unknown = obj;
  for (const part of key.split('.')) {
    if (!o || typeof o !== 'object') return undefined;
    o = (o as Record<string, unknown>)[part];
  }
  return fin(o) ? o : undefined;
}

/** Записать число по пути (последнее звено должно уже быть числом — новых полей ручка не заводит). */
export function writePath(obj: unknown, key: string, v: number): boolean {
  const parts = key.split('.');
  let o: unknown = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    if (!o || typeof o !== 'object') return false;
    o = (o as Record<string, unknown>)[parts[i]];
  }
  const last = parts[parts.length - 1];
  if (!o || typeof o !== 'object' || !fin((o as Record<string, unknown>)[last])) return false;
  (o as Record<string, unknown>)[last] = v;
  return true;
}

// ───────────────────────── реестр ─────────────────────────

/**
 * Зарегистрировать существо: дефолты ручек — текущие числа конфига. Ручка, чей путь не ведёт к числу (конфиг
 * переименовали), отбрасывается с предупреждением. Повторная регистрация того же id (горячая перезагрузка) дефолты
 * не перечитывает — конфиг к этому времени мог быть уже изменён правками.
 */
export function defineBeast(b: Beast): void {
  const prev = reg.get(b.id);
  const defs: Record<string, number> = {};
  const knobs: BeastKnob[] = [];
  for (const k of b.knobs) {
    const v = prev && k.key in prev.defs ? prev.defs[k.key] : b.config ? readPath(b.config, k.key) : undefined;
    if (!fin(v)) {
      console.warn(`Бестиарий: у «${b.name}» нет числа ${k.key} в конфиге — ручка пропущена`);
      continue;
    }
    defs[k.key] = v;
    knobs.push(k);
  }
  reg.set(b.id, { beast: { ...b, knobs }, defs });
}

/** Все существа в порядке регистрации. */
export function beasts(): Beast[] {
  return [...reg.values()].map((e) => e.beast);
}

export function beastById(id: string): Beast | undefined {
  return reg.get(id)?.beast;
}

export function knobOf(id: string, key: string): BeastKnob | undefined {
  return reg.get(id)?.beast.knobs.find((k) => k.key === key);
}

/** Текущее значение ручки (из конфига); неизвестная — NaN. */
export function knobValue(id: string, key: string): number {
  const e = reg.get(id);
  if (!e || !(key in e.defs)) return NaN;
  return readPath(e.beast.config, key) ?? e.defs[key];
}

/** Значение ручки по умолчанию (на момент регистрации); неизвестная — NaN. */
export function knobDefault(id: string, key: string): number {
  const e = reg.get(id);
  return e && key in e.defs ? e.defs[key] : NaN;
}

/** Целочисленная ручка: шаг — целое ≥ 1. */
export const knobInt = (k: BeastKnob): boolean => Number.isInteger(k.step) && k.step >= 1;

/** Число годится для ручки: конечное, в [min, max] (с допуском); у целочисленной — округляется. null — не годится. */
export function knobAccept(k: BeastKnob, v: unknown): number | null {
  if (!fin(v)) return null;
  const eps = 1e-9 * Math.max(1, Math.abs(k.min), Math.abs(k.max));
  if (v < k.min - eps || v > k.max + eps) return null;
  const x = Math.min(k.max, Math.max(k.min, v));
  return knobInt(k) ? Math.round(x) : x;
}

// ───────────────────────── применение ─────────────────────────

/** Записать правки в конфиги: у каждой ручки — правка (если годится) или дефолт. undefined — всё к дефолтам. */
export function applyBestiary(o: BestiaryOverrides | undefined): void {
  for (const [id, e] of reg) {
    if (!e.beast.config) continue;
    const mine = o && isObj(o[id]) ? o[id] : undefined;
    for (const k of e.beast.knobs) {
      const v = mine ? knobAccept(k, mine[k.key]) : null;
      writePath(e.beast.config, k.key, v ?? e.defs[k.key]);
    }
  }
}

// чей набор действует: свой проект или проект лобби (кооп)
let localOv: BestiaryOverrides | undefined;
let lobbyOwner: object | null = null;
let lobbyOv: BestiaryOverrides | undefined;
let appliedKey: string | null = null;

function refresh() {
  const o = lobbyOwner ? lobbyOv : localOv;
  const key = JSON.stringify(o ?? {});
  if (key === appliedKey) return;
  appliedKey = key;
  applyBestiary(o);
}

/** Правки своего проекта (стор зовёт на загрузке и после каждого изменения). Пока идёт кооп — ждут конца лобби. */
export function setLocalBestiary(o: BestiaryOverrides | undefined): void {
  localOv = o;
  refresh();
}

/**
 * Правки проекта лобби (кооп): owner — сессия; o — бестиарий её проекта (нет правок — undefined). null — лобби
 * кончилось (только у той же сессии): снова действуют правки своего проекта.
 */
export function setLobbyBestiary(owner: object, o: BestiaryOverrides | undefined | null): void {
  if (o === null) {
    if (lobbyOwner !== owner) return;
    lobbyOwner = null;
    lobbyOv = undefined;
  } else {
    lobbyOwner = owner;
    lobbyOv = o;
  }
  refresh();
}

/** Действует ли сейчас набор правок лобби (кооп), а не своего проекта. */
export function lobbyBestiaryActive(): boolean {
  return lobbyOwner !== null;
}

// ───────────────────────── правки в проекте ─────────────────────────

/**
 * Разбор Project.bestiary (загрузка, импорт, кооп): только известные существа и ручки, конечные числа в [min, max]
 * (целочисленные — округляются), равные дефолту — не храним. Пусто — undefined.
 */
export function parseBestiary(json: unknown): BestiaryOverrides | undefined {
  if (!isObj(json)) return undefined;
  const out: BestiaryOverrides = {};
  for (const [id, raw] of Object.entries(json)) {
    const e = reg.get(id);
    if (!e || !isObj(raw)) continue;
    const m: Record<string, number> = {};
    for (const k of e.beast.knobs) {
      const v = knobAccept(k, raw[k.key]);
      if (v !== null && !same(v, e.defs[k.key])) m[k.key] = v;
    }
    if (Object.keys(m).length) out[id] = m;
  }
  return Object.keys(out).length ? out : undefined;
}

/** Копия для сериализации (порядок — как у ручек в реестре); пусто — undefined (поле не пишется). */
export function cloneBestiary(o: BestiaryOverrides | undefined): BestiaryOverrides | undefined {
  if (!o) return undefined;
  const out: BestiaryOverrides = {};
  for (const [id, m] of Object.entries(o)) {
    if (!isObj(m)) continue;
    const c: Record<string, number> = {};
    for (const [k, v] of Object.entries(m)) if (fin(v)) c[k] = v;
    if (Object.keys(c).length) out[id] = c;
  }
  return Object.keys(out).length ? out : undefined;
}

/** Правка ручки → новый набор (не мутирует o): зажать в рамки, равное дефолту — убрать; пусто — undefined. */
export function withKnob(o: BestiaryOverrides | undefined, id: string, key: string, v: number): BestiaryOverrides | undefined {
  const k = knobOf(id, key);
  if (!k) return o;
  const x = knobAccept(k, Math.min(k.max, Math.max(k.min, v)));
  const next: BestiaryOverrides = { ...(o ?? {}) };
  const m: Record<string, number> = { ...(next[id] ?? {}) };
  if (x === null || same(x, knobDefault(id, key))) delete m[key];
  else m[key] = x;
  if (Object.keys(m).length) next[id] = m;
  else delete next[id];
  return Object.keys(next).length ? next : undefined;
}

/** Сбросить существо целиком (или только ключи keys) → новый набор; пусто — undefined. */
export function withoutBeast(o: BestiaryOverrides | undefined, id: string, keys?: readonly string[]): BestiaryOverrides | undefined {
  if (!o?.[id]) return o;
  const next: BestiaryOverrides = { ...o };
  if (keys) {
    const m = { ...next[id] };
    for (const k of keys) delete m[k];
    if (Object.keys(m).length) next[id] = m;
    else delete next[id];
  } else delete next[id];
  return Object.keys(next).length ? next : undefined;
}

/** Сколько ручек существа изменено в наборе. */
export function changedCount(o: BestiaryOverrides | undefined, id: string): number {
  const m = o?.[id];
  return m ? Object.keys(m).length : 0;
}

// ───────────────────────── показ ─────────────────────────

/** Знаков после запятой по шагу ручки (0.05 → 2, 0.001 → 3, 1 → 0). */
export function stepDigits(step: number): number {
  if (!fin(step) || step <= 0) return 2;
  let d = 0;
  while (d < 6 && Math.abs(Math.round(step * 10 ** d) - step * 10 ** d) > 1e-9) d++;
  return d;
}

/** Как ручку показывать: множитель (доли — ×100), шаг и знаки после запятой в показанных единицах. */
export function knobScale(k: Pick<BeastKnob, 'step' | 'pct'>): { mul: number; step: number; digits: number } {
  const mul = k.pct ? 100 : 1;
  const step = +(k.step * mul).toPrecision(12);
  return { mul, step, digits: stepDigits(step) };
}

/** Число ручки строкой (в показанных единицах): по шагу, без хвостовых нулей, десятичная запятая. */
export function fmtKnob(k: Pick<BeastKnob, 'step' | 'pct'>, v: number): string {
  if (!fin(v)) return '—';
  const { mul, digits } = knobScale(k);
  return String(+(v * mul).toFixed(digits)).replace('.', ',');
}

/**
 * Текст досье с подстановкой: {путь} — текущее значение ручки (по её шагу) или числа конфига (до сотых). Путь не
 * ведёт к числу — остаётся как есть (видно в тесте и на странице).
 */
export function fillText(b: Pick<Beast, 'id' | 'config'>, text: string): string {
  return text.replace(/\{([\w.]+)\}/g, (all, key: string) => {
    const k = knobOf(b.id, key);
    if (k) return fmtKnob(k, knobValue(b.id, key));
    const v = readPath(b.config, key);
    return v === undefined ? all : String(+v.toFixed(2)).replace('.', ',');
  });
}
