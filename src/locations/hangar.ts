// Спец-локация «Ангар» (переходная, промкомплекс под снегом; docs/LOCATIONS.md §12) — механика без движка.
//
// Замысел заказчика: из снежных ходов выход один — найти подтаявший снег и пробить; от первого лица игрок
// вываливается из снега в отверстие в крыше промышленного ангара и падает в кучу мусора посреди промкомплекса. Часть
// переходная: здесь будет мини-босс (пока заглушка, как «Логово»).
//
//  • В мире ангар — комната снежных ходов «Подтаявшая берлога» (Room.location.kind 'hangar'): растёт по правилу хабов
//    (через 60–150 м ползком, GENERATOR-4D.md §20). Сцена ангара открывается не при входе в берлогу, а когда пятно
//    пробито: strikeThaw — удар (E), roll.hits ударов — break.
//  • Падение — сценарий от первого лица (fallPose: провал сквозь снег, полёт с крыши, удар о кучу, встаёшь).
//  • Выход из ангара — ворота в конце цеха: StreamWorld.descend(id) — комната на roll.floorsDown этажей ниже
//    (ангар под снегом), вход в квартиру другого биома (позже — завод).
import { hashSeed, makeRng } from '../model/rng';
import type { HangarSpec } from '../model/types';

export type { HangarSpec };

export const DEFAULT_HANGAR: HangarSpec = { kind: 'hangar', hits: [3, 5], floorsDown: [2, 3], boss: '', darkness: 0.55 };

export interface HangarRoll {
  hits: number;
  floorsDown: number;
  seed: string;
}

const fin = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
function range(v: unknown, d: readonly [number, number], lo: number, hi: number): [number, number] {
  if (!Array.isArray(v) || v.length < 2 || !fin(v[0]) || !fin(v[1])) return [d[0], d[1]];
  const a = clamp(Math.round(v[0]), lo, hi), b = clamp(Math.round(v[1]), lo, hi);
  return a <= b ? [a, b] : [b, a];
}

export function newHangar(): HangarSpec {
  return { ...DEFAULT_HANGAR, hits: [...DEFAULT_HANGAR.hits], floorsDown: [...DEFAULT_HANGAR.floorsDown] };
}

/** Толерантный разбор: не объект или kind ≠ 'hangar' — null; мусор — по умолчанию, диапазоны упорядочены. */
export function normHangar(v: unknown): HangarSpec | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  if (o.kind !== 'hangar') return null;
  const D = DEFAULT_HANGAR;
  return {
    kind: 'hangar',
    hits: range(o.hits, D.hits, 1, 30),
    floorsDown: range(o.floorsDown, D.floorsDown, 1, 50),
    boss: typeof o.boss === 'string' ? o.boss.trim().slice(0, 64) : D.boss,
    darkness: fin(o.darkness) ? clamp(o.darkness, 0, 1) : D.darkness,
  };
}

/** Розыгрыш экземпляра по ключу (бесконечный мир: locationSeedKey(seedKey, адрес); тот же — у StreamWorld.descend). */
export function rollHangar(spec: HangarSpec, key: string): HangarRoll {
  const R = makeRng(`hangar:${key}`);
  const s = normHangar(spec) ?? DEFAULT_HANGAR;
  return { hits: R.int(s.hits[0], s.hits[1]), floorsDown: R.int(s.floorsDown[0], s.floorsDown[1]), seed: String(hashSeed(`hangar:${key}`)) };
}

// ───────────────────────── подтаявший снег ─────────────────────────

export interface ThawState {
  need: number;
  hits: number;
  broken: boolean;
}

export type ThawEvent = { type: 'strike'; hits: number; need: number; stage: number } | { type: 'break' };

export function createThaw(roll: HangarRoll): ThawState {
  return { need: Math.max(1, roll.hits), hits: 0, broken: false };
}

/** Удар по пятну (E): трещины растут (stage 0…1), последний удар — пятно проваливается. */
export function strikeThaw(s: ThawState): ThawEvent[] {
  if (s.broken) return [];
  s.hits++;
  const out: ThawEvent[] = [{ type: 'strike', hits: s.hits, need: s.need, stage: Math.min(1, s.hits / s.need) }];
  if (s.hits >= s.need) {
    s.broken = true;
    out.push({ type: 'break' });
  }
  return out;
}

// ───────────────────────── падение ─────────────────────────

/** Высота падения от крыши до верха кучи, м; длительности фаз, с. */
export const FALL_ROOF_M = 7.2;
export const FALL_BREAK_S = 0.3;
export const FALL_LAND_S = FALL_BREAK_S + Math.sqrt((2 * FALL_ROOF_M) / 9.81);
export const FALL_LIE_S = 1.1;
export const FALL_RISE_S = 1.0;
export const FALL_TOTAL_S = FALL_LAND_S + FALL_LIE_S + FALL_RISE_S;

/** Глаз лёжа на куче, м. */
export const FALL_LIE_EYE = 0.35;
/** Сквозь сколько снега проваливается глаз до крыши, м. */
export const FALL_SNOW_M = 0.6;

export interface FallPose {
  /** высота глаза над верхом кучи, м: от FALL_SNOW_M + FALL_ROOF_M + FALL_LIE_EYE (в берлоге) — непрерывно — до роста */
  y: number;
  /** тангаж (рад, + вверх), крен (рад) */
  pitch: number;
  roll: number;
  /** белая пелена (снег в лицо) 0…1, тряска 0…1 */
  white: number;
  shake: number;
  phase: 'break' | 'fall' | 'lie' | 'rise' | 'done';
}

const smooth = (t: number) => {
  const x = clamp(t, 0, 1);
  return x * x * (3 - 2 * x);
};

/**
 * Поза камеры падения в момент t (с от удара, который пробил пятно). y — высота глаза над верхом кучи.
 * Ломается сквозь снег (пелена, глаз уходит на 0.6 м), свободное падение FALL_ROOF_M (смотрит вниз, на кучу),
 * удар (тряска), лежит на спине (смотрит в дыру в крыше, крен), встаёт.
 */
export function fallPose(t: number, eyeStand = 1.6): FallPose {
  const top = FALL_SNOW_M + FALL_ROOF_M + FALL_LIE_EYE;
  if (t < FALL_BREAK_S) {
    const k = t / FALL_BREAK_S;
    return { y: top - FALL_SNOW_M * k * k, pitch: -0.5 - 0.6 * k, roll: 0.08 * k, white: smooth(k * 1.5), shake: 0.5, phase: 'break' };
  }
  if (t < FALL_LAND_S) {
    const tf = t - FALL_BREAK_S;
    const d = Math.min(FALL_ROOF_M, 0.5 * 9.81 * tf * tf);
    const k = d / FALL_ROOF_M;
    return { y: top - FALL_SNOW_M - d, pitch: -1.1 - 0.3 * smooth(k), roll: 0.08 + 0.25 * k, white: 1 - smooth(tf / 0.35), shake: 0.15, phase: 'fall' };
  }
  if (t < FALL_LAND_S + FALL_LIE_S) {
    const k = (t - FALL_LAND_S) / FALL_LIE_S;
    // удар — лежит на спине: глаз низко, взгляд уходит вверх, в дыру
    return { y: FALL_LIE_EYE, pitch: -1.4 + 2.6 * smooth(k * 1.4), roll: 0.33 * (1 - smooth(k)), white: 0, shake: Math.max(0, 1 - k * 2.5), phase: 'lie' };
  }
  if (t < FALL_TOTAL_S) {
    const k = smooth((t - FALL_LAND_S - FALL_LIE_S) / FALL_RISE_S);
    return { y: FALL_LIE_EYE + (eyeStand - FALL_LIE_EYE) * k, pitch: 1.2 * (1 - k) - 0.1 * k, roll: 0, white: 0, shake: 0, phase: 'rise' };
  }
  return { y: eyeStand, pitch: -0.1, roll: 0, white: 0, shake: 0, phase: 'done' };
}

/** Табличка в зоне мини-босса. */
export function hangarBossSign(spec: HangarSpec): string {
  return spec.boss ? `Мини-босс: ${spec.boss}` : 'Здесь будет мини-босс';
}

/** Правило для игрока с числами настроек. */
export function hangarRule(spec: HangarSpec = DEFAULT_HANGAR): string {
  const r = (a: [number, number]) => (a[0] === a[1] ? `${a[0]}` : `${a[0]}–${a[1]}`);
  return `Из снежных ходов выход один — подтаявший снег: мокрое тёмное пятно в полу берлоги, снизу пробивается тёплый свет и капает. ` +
    `Бей его (E, ${r(spec.hits)} удара) — провалишься в ангар промкомплекса. Назад дороги нет: из ангара — ворота в конце цеха.`;
}
