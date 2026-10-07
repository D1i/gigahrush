// Игровой цикл прогулки (без движка). Контракт зафиксирован оркестратором; реализацию пишет агент
// игровой логики. Работает поверх экспорта прогона (RunExport) — того же JSON, что получает движок.
// Правила — docs/GAMEPLAY.md.
import type { RunExport, RunInstance } from '../blockout/types';
import { placePickups } from './place';
import type { GameEvent, GameState, Pickup } from './types';

export function newGame(worldKey: string): GameState {
  return {
    format: 'room-forge-game',
    version: 1,
    worldKey,
    inventory: {},
    taken: [],
    visited: [],
    danger: 0,
    overLimit: false,
    minFloor: 0,
  };
}

const pickCache = new WeakMap<RunInstance, { props: unknown; cellM: number; list: Pickup[] }>();

/**
 * Находки экземпляра: предметы на спотах (kind 'item') — в точке спота; лут комнаты и тира — в
 * декоре с тегом where (если есть) или на свободном проходимом полу (детерминированно по id
 * экземпляра, не на проходе между дверями — см. src/gen/walk.ts). Уже подобранные не исключаются —
 * фильтруй по state.taken.
 *
 * Порядок: споты (в порядке inst.spots), затем лут (в порядке inst.loot). id: `${inst}:spot:${spotId}`,
 * `${inst}:loot:${index}`. Точка на полу — центр клетки, где может стоять центр капсулы игрока (0.3 м) и
 * откуда достижимы двери; не ближе 0.8 м к проёму и 0.6 м к пути между проёмами, в первую очередь у стен и
 * мебели, находки разнесены на 0.7 м (если хватает места). Точка зависит от места экземпляра (комната,
 * поворот, сдвиг, слой, этаж) и номера находки, а не от id — в бесконечном мире одинаково при любом порядке
 * обхода. Результат кэшируется по объекту экземпляра.
 */
export function pickupsOf(run: RunExport, inst: RunInstance): Pickup[] {
  const cellM = run.cellM > 0 ? run.cellM : 0.1;
  let hit = pickCache.get(inst);
  if (!hit || hit.props !== run.props || hit.cellM !== cellM) {
    hit = { props: run.props, cellM, list: placePickups(run, inst) };
    pickCache.set(inst, hit);
  }
  return hit.list.map((p) => ({ ...p }));
}

/** Ещё не подобранные находки экземпляра. */
export function pickupsLeft(state: GameState, run: RunExport, inst: RunInstance): Pickup[] {
  const taken = new Set(state.taken);
  return pickupsOf(run, inst).filter((p) => !taken.has(p.id));
}

/**
 * Игрок вошёл в экземпляр (вызывать при смене текущей комнаты).
 * Первый заход: опасность += instance.danger (тир комнаты), комната в visited. Повторный — опасность не растёт.
 * Событие 'enter' — всегда; 'danger-limit' — один раз за игру, когда опасность впервые стала больше
 * dangerLimit (как в редакторе: «уровень горит, когда опасность больше»; 0 — порога нет).
 */
export function enterRoom(state: GameState, run: RunExport, instId: string, dangerLimit: number): GameEvent[] {
  const inst = run.instances.find((i) => i.id === instId);
  if (!inst) return [];
  const first = !state.visited.includes(instId);
  const add = first && Number.isFinite(inst.danger) ? inst.danger : 0;
  if (first) {
    state.visited.push(instId);
    state.danger += add;
  }
  const floor = Number.isFinite(inst.floor) ? (inst.floor as number) : 0;
  if (floor < state.minFloor) state.minFloor = floor;
  const events: GameEvent[] = [{ type: 'enter', inst: instId, tierId: inst.tier ?? null, dangerAdd: add, danger: state.danger, first }];
  if (!state.overLimit && dangerLimit > 0 && state.danger > dangerLimit) {
    state.overLimit = true;
    events.push({ type: 'danger-limit', danger: state.danger, limit: dangerLimit });
  }
  return events;
}

/** Подобрать находку (если ещё не подобрана). */
export function takePickup(state: GameState, p: Pickup): GameEvent[] {
  if (state.taken.includes(p.id)) return [];
  const count = Number.isFinite(p.count) && p.count > 0 ? p.count : 0;
  state.taken.push(p.id);
  if (count > 0) state.inventory[p.itemId] = (state.inventory[p.itemId] ?? 0) + count;
  return [{ type: 'pickup', pickupId: p.id, itemId: p.itemId, count }];
}

export function saveGame(state: GameState): string {
  return JSON.stringify(state);
}

/**
 * Разбор сохранения: битый JSON, чужой формат/версия или другой мир — null. Поля чистятся поштучно:
 * мусор в инвентаре и списках отбрасывается, числа вне смысла — по умолчанию.
 */
export function loadGame(json: string, worldKey: string): GameState | null {
  let o: unknown;
  try {
    o = JSON.parse(json);
  } catch {
    return null;
  }
  if (!o || typeof o !== 'object' || Array.isArray(o)) return null;
  const r = o as Record<string, unknown>;
  if (r.format !== 'room-forge-game' || r.version !== 1) return null;
  if (r.worldKey !== undefined && r.worldKey !== worldKey) return null;
  const s = newGame(worldKey);
  if (r.inventory && typeof r.inventory === 'object' && !Array.isArray(r.inventory)) {
    for (const [k, v] of Object.entries(r.inventory as Record<string, unknown>)) {
      if (typeof v === 'number' && Number.isFinite(v) && v > 0) s.inventory[k] = v;
    }
  }
  const strs = (v: unknown): string[] => (Array.isArray(v) ? [...new Set(v.filter((x): x is string => typeof x === 'string'))] : []);
  s.taken = strs(r.taken);
  s.visited = strs(r.visited);
  if (typeof r.danger === 'number' && Number.isFinite(r.danger)) s.danger = r.danger;
  s.overLimit = r.overLimit === true;
  if (typeof r.minFloor === 'number' && Number.isFinite(r.minFloor)) s.minFloor = Math.min(0, Math.round(r.minFloor));
  return s;
}

/** Ключ сохранения игры в localStorage для мира. */
export function gameKey(worldKey: string): string {
  return `room-forge/game/${worldKey}`;
}

/** Игра мира из localStorage (нет / битое сохранение — новая). */
export function readGame(worldKey: string): GameState {
  try {
    const s = localStorage.getItem(gameKey(worldKey));
    return (s && loadGame(s, worldKey)) || newGame(worldKey);
  } catch {
    return newGame(worldKey);
  }
}

/** Сохранить игру в localStorage; false — не удалось (нет места / нет localStorage). */
export function writeGame(state: GameState): boolean {
  try {
    localStorage.setItem(gameKey(state.worldKey), saveGame(state));
    return true;
  } catch {
    return false;
  }
}
