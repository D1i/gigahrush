// Влажность сети ходов (биом «Завод», docs/GENERATOR-4D.md §21): «иди туда, где влажнее — там начнётся болото».
//
// У каждого куска сети — влажность w ∈ [0, 1] и направление dir (+1 — ход становится влажнее, −1 — суше):
//  • вход в сеть (кусок без родителя в этой сети, обычно хаб) — w = 0, dir = +1;
//  • у куска один выход дальше (прямой, поворот) — w ребёнка = w + dir · line, dir тот же;
//  • выходов дальше два и больше (развилка, хаб) — один из них (бросок по адресу куска) «мокрый»: w + fork, dir = +1;
//    остальные — «сухие»: w − dry, dir = −1;
//  • w обрезается в [0, 1]; ребёнок с w ≥ 1 — болото: вместо куска встаёт комната-финал (спец-локация «Болото на
//    крыше», src/locations/swampEnd.ts), не встала — кусок самой мокрой ступени.
// Ступень куска (набор комнат по тегу): сухо [0, 0.1), сыро [0.1, 0.4), течь [0.4, 0.7), топь [0.7, 1). Ширина
// ступени (0.3) меньше fork + dry (0.4): на любой развилке мокрый выход — на ступень мокрее сухого, видно сразу.
import type { WetSettings } from '../model/types';

/** Теги ступеней влажности комнат (по порядку: от сухой к болоту). */
export const WET_TAGS = ['сухо', 'сыро', 'течь', 'топь'] as const;
export type WetTag = (typeof WET_TAGS)[number];
/** Границы ступеней. */
export const WET_EDGES: readonly number[] = [0.1, 0.4, 0.7];

export const DEFAULT_WET: WetSettings = { line: 0.035, fork: 0.15, dry: 0.25 };

const fin = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Толерантный разбор: не объект — null; мусор в полях — по умолчанию. */
export function normWet(v: unknown): WetSettings | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  const D = DEFAULT_WET;
  return {
    line: fin(o.line) ? clamp(o.line, 0, 1) : D.line,
    fork: fin(o.fork) ? clamp(o.fork, 0, 1) : D.fork,
    dry: fin(o.dry) ? clamp(o.dry, 0, 1) : D.dry,
  };
}

/** Ступень влажности 0…3. */
export function wetLevel(w: number): number {
  let k = 0;
  while (k < WET_EDGES.length && w >= WET_EDGES[k]) k++;
  return k;
}

export const wetTag = (w: number): WetTag => WET_TAGS[wetLevel(w)];

export interface Wet {
  w: number;
  dir: 1 | -1;
}

export const WET_START: Wet = { w: 0, dir: 1 };

/**
 * Влажность ребёнка куска p за его дверью. wetter: дверь — «мокрый» выход развилки (true), «сухой» (false); null — у
 * куска один выход дальше (линия).
 */
export function wetNext(p: Wet, wetter: boolean | null, s: WetSettings): Wet {
  if (wetter === null) return { w: clamp(p.w + p.dir * s.line, 0, 1), dir: p.dir };
  return wetter ? { w: clamp(p.w + s.fork, 0, 1), dir: 1 } : { w: clamp(p.w - s.dry, 0, 1), dir: -1 };
}

/** Ребёнок — болото (комната-финал). */
export const isSwamp = (w: Wet): boolean => w.w >= 1 - 1e-9;

/** Сколько кусков по мокрому пути от сухого входа до болота, если развилка — каждый k-й кусок (оценка для правила). */
export function piecesToSwamp(s: WetSettings, forkEvery: number): number {
  let w: Wet = WET_START;
  for (let n = 1; n < 10000; n++) {
    w = wetNext(w, n % Math.max(1, Math.round(forkEvery)) === 0 ? true : null, s);
    if (isSwamp(w)) return n;
    if (w.w <= 0 && s.line <= 0 && s.fork <= 0) return Infinity;
  }
  return Infinity;
}

/** Правило для игрока. */
export function wetRule(s: WetSettings): string {
  return 'Из завода выход один — болото. Иди туда, где влажнее: на каждой развилке и в каждом цеху один проход ведёт ' +
    'к сырости (конденсат, течь с потолка, лужи, вода по полу), остальные — в сухие цеха. Сырее и сырее — начнётся ' +
    'топь, а с потолка свиснет болото вверх ногами; за ней — зал, где болото над головой, и шестерня, которая поднимет ' +
    `тебя в него. Свернул не туда — цеха сохнут (на ${Math.round(s.line * 100)}% за кусок).`;
}
