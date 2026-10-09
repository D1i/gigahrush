// Спец-локации переходов сюжета (src/game/story.ts, режим «Запустить без отладки») — данные мира без движка:
//  • «Люк в погреб» (HatchSpec) — переход из сарая: люк в полу ровно в центре комнаты, E — открыть и спуститься;
//  • «Дверь в снег» (SnowDoorSpec) — переход из погреба и из общаги: закрытая дверь на стене (метка SNOWDOOR_CONN), за
//    ней снег — обвал засыпает игрока, откапываться digs нажатий E — выбирается в снежных тоннелях.
// Здесь — спецификации по умолчанию, толерантный разбор (сохранение проекта, parseLocation) и розыгрыш экземпляра по
// ключу (бесконечный мир: locationSeedKey(seedKey, адрес) — тот же у StreamWorld.locationOf и descend). Сцену и механику
// ведёт вид (src/locations/hatch.ts, snowDoor.ts).
import { makeRng } from '../model/rng';
import type { HatchSpec, SnowDoorSpec } from '../model/types';

export type { HatchSpec, SnowDoorSpec };

/** Id метки комнаты «Дверь в снег», за которой снег: закрытая дверь-тупик — никогда не связывается и не растёт (мир
 *  делает её глухой, как только комната встала); вид находит по нему место двери («E — открыть дверь»). */
export const SNOWDOOR_CONN = 'snowdoor';

export const DEFAULT_HATCH: HatchSpec = { kind: 'hatch', floorsDown: [1, 1] };
export const DEFAULT_SNOWDOOR: SnowDoorSpec = { kind: 'snowdoor', digs: [4, 6], floorsDown: [0, 1] };

/** Розыгрыш люка: на сколько этажей ниже выводит. */
export interface HatchRoll {
  floorsDown: number;
}

/** Розыгрыш двери в снег: сколько нажатий E откапываться и на сколько этажей ниже выводит (0 — тот же этаж). */
export interface SnowDoorRoll {
  digs: number;
  floorsDown: number;
}

const fin = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
function range(v: unknown, d: readonly [number, number], lo: number, hi: number): [number, number] {
  if (!Array.isArray(v) || v.length < 2 || !fin(v[0]) || !fin(v[1])) return [d[0], d[1]];
  const a = clamp(Math.round(v[0]), lo, hi), b = clamp(Math.round(v[1]), lo, hi);
  return a <= b ? [a, b] : [b, a];
}

export function newHatch(): HatchSpec {
  return { kind: 'hatch', floorsDown: [...DEFAULT_HATCH.floorsDown] };
}

export function newSnowDoor(): SnowDoorSpec {
  return { kind: 'snowdoor', digs: [...DEFAULT_SNOWDOOR.digs], floorsDown: [...DEFAULT_SNOWDOOR.floorsDown] };
}

/** Толерантный разбор люка: не объект или kind ≠ 'hatch' — null; этажи — целые 1…50, упорядочены. */
export function normHatch(v: unknown): HatchSpec | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  if (o.kind !== 'hatch') return null;
  return { kind: 'hatch', floorsDown: range(o.floorsDown, DEFAULT_HATCH.floorsDown, 1, 50) };
}

/** Толерантный разбор двери в снег: не объект или kind ≠ 'snowdoor' — null; нажатия — 1…50, этажи — 0…50 (0 — тот же
 *  этаж), целые, упорядочены. */
export function normSnowDoor(v: unknown): SnowDoorSpec | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  if (o.kind !== 'snowdoor') return null;
  const D = DEFAULT_SNOWDOOR;
  return { kind: 'snowdoor', digs: range(o.digs, D.digs, 1, 50), floorsDown: range(o.floorsDown, D.floorsDown, 0, 50) };
}

/** Розыгрыш люка экземпляра по ключу (тот же — у StreamWorld.descend). */
export function rollHatch(spec: HatchSpec, key: string): HatchRoll {
  const s = normHatch(spec) ?? DEFAULT_HATCH;
  const R = makeRng(`hatch:${key}`);
  return { floorsDown: R.int(s.floorsDown[0], s.floorsDown[1]) };
}

/** Розыгрыш двери в снег экземпляра по ключу (тот же — у StreamWorld.descend). */
export function rollSnowDoor(spec: SnowDoorSpec, key: string): SnowDoorRoll {
  const s = normSnowDoor(spec) ?? DEFAULT_SNOWDOOR;
  const R = makeRng(`snowdoor:${key}`);
  const digs = R.int(s.digs[0], s.digs[1]);
  return { digs, floorsDown: R.int(s.floorsDown[0], s.floorsDown[1]) };
}
