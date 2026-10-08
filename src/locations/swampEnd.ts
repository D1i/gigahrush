// Спец-локация «Болото на крыше» — финал игры (docs/LOCATIONS.md §13) — механика без движка.
//
// Замысел заказчика: на заводе идёшь туда, где влажнее, — начинается болото; встаёшь на шестерню, она зубом вдавливает
// тебя в грязь на крыше, и ты начинаешь вылезать из болота рядом с военной частью. Конец игры.
//
//  • В мире локация — комната завода «Лестница на крышу» (Room.location.kind 'swamp'): её ставит правило влажности
//    (src/gen4d/wet.ts), когда мокрый ход дошёл до болота. Вход в комнату — своя сцена (src/locations/sceneSwampEnd.ts).
//  • Крыша: плоская кровля цеха заросла болотом (вода, грязь, камыш, сухие деревья, настил), в тумане моросит; посреди
//    — огромная шестерня, наполовину ушедшая в грязь, медленно проворачивается — ближняя к игроку сторона уходит вниз.
//    Подойти и встать на зуб у самой грязи (зона у шестерни) — начинается сценарий (endPose). Назад — люк лестницы.
//  • Сценарий от первого лица: шестерня дёргается, сверху опускается следующий зуб и вдавливает в грязь; темнота,
//    сердце; свет сверху — выныриваешь в болоте (другое место: ночь, туман), отплёвываешься, ползёшь к берегу; за
//    камышом — бетонный забор с колючкой, ворота со звёздами, вышка с прожектором. Прожектор находит тебя — «Конец».
import { hashSeed, makeRng } from '../model/rng';

export interface SwampSpec {
  kind: 'swamp';
  /** за сколько секунд шестерня проворачивается на один зуб (на крыше, до сценария) */
  toothS: number;
  /** номер войсковой части на воротах: случайное целое в [min, max] */
  unit: [number, number];
  /** темнота крыши 0…1 */
  darkness: number;
}

export const DEFAULT_SWAMP: SwampSpec = { kind: 'swamp', toothS: 2.6, unit: [10000, 99999], darkness: 0.6 };

export interface SwampRoll {
  /** номер войсковой части */
  unit: number;
  seed: string;
}

const fin = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
function range(v: unknown, d: readonly [number, number], lo: number, hi: number): [number, number] {
  if (!Array.isArray(v) || v.length < 2 || !fin(v[0]) || !fin(v[1])) return [d[0], d[1]];
  const a = clamp(Math.round(v[0]), lo, hi), b = clamp(Math.round(v[1]), lo, hi);
  return a <= b ? [a, b] : [b, a];
}

export function newSwamp(): SwampSpec {
  return { ...DEFAULT_SWAMP, unit: [...DEFAULT_SWAMP.unit] };
}

/** Толерантный разбор: не объект или kind ≠ 'swamp' — null; мусор — по умолчанию, диапазон упорядочен. */
export function normSwamp(v: unknown): SwampSpec | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  if (o.kind !== 'swamp') return null;
  const D = DEFAULT_SWAMP;
  return {
    kind: 'swamp',
    toothS: fin(o.toothS) ? clamp(o.toothS, 0.5, 30) : D.toothS,
    unit: range(o.unit, D.unit, 1, 99999),
    darkness: fin(o.darkness) ? clamp(o.darkness, 0, 1) : D.darkness,
  };
}

/** Розыгрыш экземпляра (бесконечный мир: locationSeedKey(seedKey, адрес комнаты)). */
export function rollSwamp(spec: SwampSpec, key: string): SwampRoll {
  const s = normSwamp(spec) ?? DEFAULT_SWAMP;
  const R = makeRng(`swamp:${key}`);
  return { unit: R.int(s.unit[0], s.unit[1]), seed: String(hashSeed(`swamp:${key}`)) };
}

// ───────────────────────── сценарий финала ─────────────────────────

/** Границы фаз, с от шага на зуб. */
export const END_STEP_S = 0.8;
export const END_PRESS_S = 3.4;
export const END_UNDER_S = 6.6;
export const END_SWITCH_S = 5.4;
export const END_EMERGE_S = 9.2;
export const END_CRAWL_S = 14.2;
export const END_LOOK_S = 17.4;
export const END_TITLE_S = 20;

export type EndPhase = 'step' | 'press' | 'under' | 'emerge' | 'crawl' | 'look' | 'title' | 'done';

export interface EndPose {
  /** какая сцена видна: крыша (до провала) или болото у военной части */
  place: 'roof' | 'base';
  /** высота глаза над поверхностью грязи / воды, м (под ней — отрицательная) */
  y: number;
  /** сдвиг вперёд, м: на крыше — 0 (стоишь на зубе), у части — сколько прополз к берегу */
  z: number;
  /** тангаж (рад, + вверх), крен (рад), рысканье (рад, + влево) */
  pitch: number;
  roll: number;
  yaw: number;
  /** тряска 0…1 */
  shake: number;
  /** грязь на глазах (бурая муть) 0…1, темнота 0…1, капли на «объективе» 0…1, слепящий свет прожектора 0…1 */
  mud: number;
  dark: number;
  drip: number;
  glare: number;
  /** титры 0…1 */
  title: number;
  /** доля поворота шестерни на один зуб за сценарий (0 → 1, рывками) */
  gear: number;
  phase: EndPhase;
}

const smooth = (t: number) => {
  const x = clamp(t, 0, 1);
  return x * x * (3 - 2 * x);
};
const seg = (t: number, a: number, b: number) => clamp((t - a) / (b - a), 0, 1);

/**
 * Поза камеры и экранные эффекты финала в момент t (с от шага на зуб). eye — рост глаза стоя, м; tooth — высота верха
 * зуба над грязью в момент шага, м.
 */
export function endPose(t: number, eye = 1.6, tooth = 0.15): EndPose {
  const base: Omit<EndPose, 'phase'> = {
    place: 'roof', y: eye + tooth, z: 0, pitch: -0.35, roll: 0, yaw: 0, shake: 0, mud: 0, dark: 0, drip: 0, glare: 0, title: 0, gear: 0,
  };
  if (t < END_STEP_S) {
    // встал на зуб: шестерня дёргается, зуб проседает
    const k = seg(t, 0, END_STEP_S);
    return { ...base, y: eye + tooth - 0.12 * smooth(k * 2), pitch: -0.35 - 0.25 * smooth(k), shake: 0.35 * (1 - k), gear: 0.08 * smooth(k * 2), phase: 'step' };
  }
  if (t < END_PRESS_S) {
    // сверху опускается следующий зуб: взгляд вверх, на него; давит — глаз уходит под грязь
    const k = seg(t, END_STEP_S, END_PRESS_S);
    const down = smooth(seg(k, 0.25, 1));
    const y = eye + tooth - 0.12 - (eye + tooth + 0.5) * down;
    const look = smooth(seg(k, 0, 0.35));
    return {
      ...base,
      y,
      pitch: -0.6 + 1.55 * look - 0.5 * smooth(seg(k, 0.7, 1)),
      roll: 0.18 * smooth(seg(k, 0.3, 0.9)),
      shake: 0.25 + 0.6 * down,
      mud: smooth(seg(y, 0.35, -0.15)),
      dark: 0.6 * smooth(seg(k, 0.6, 1)),
      gear: 0.08 + 0.92 * smooth(seg(k, 0.15, 1)),
      phase: 'press',
    };
  }
  if (t < END_UNDER_S) {
    // под грязью: темно и глухо, сердце; посередине сцена тихо меняется на болото у части
    const k = seg(t, END_PRESS_S, END_UNDER_S);
    return {
      ...base,
      place: t < END_SWITCH_S ? 'roof' : 'base',
      y: t < END_SWITCH_S ? -0.6 - 0.4 * k : -0.9,
      pitch: t < END_SWITCH_S ? 0.45 - 0.85 * smooth(k * 2) : 0.9,
      shake: 0.15 * (1 - k),
      mud: 1,
      dark: 0.6 + 0.4 * smooth(k * 3),
      gear: 1,
      phase: 'under',
    };
  }
  if (t < END_EMERGE_S) {
    // свет сверху: всплываешь, голова над водой (полулёжа), отплёвываешься — грязь сходит с глаз, капли остаются
    const k = seg(t, END_UNDER_S, END_EMERGE_S);
    const up = smooth(seg(k, 0, 0.55));
    return {
      ...base,
      place: 'base',
      y: -0.9 + 1.25 * up,
      pitch: 0.9 - 1.05 * smooth(seg(k, 0.35, 1)),
      roll: 0.1 * Math.sin(k * 5),
      shake: 0.3 * Math.max(0, 1 - Math.abs(k - 0.5) * 4),
      mud: 1 - smooth(seg(k, 0.25, 0.75)),
      dark: 1 - smooth(seg(k, 0, 0.45)),
      drip: smooth(seg(k, 0.45, 0.7)),
      gear: 1,
      phase: 'emerge',
    };
  }
  if (t < END_CRAWL_S) {
    // ползёшь к берегу: качка в такт, капли высыхают; к концу привстаёшь на колени
    const k = seg(t, END_EMERGE_S, END_CRAWL_S);
    const cyc = (t - END_EMERGE_S) / 1.1;
    const kneel = smooth(seg(k, 0.75, 1));
    return {
      ...base,
      place: 'base',
      y: 0.35 + 0.1 * Math.abs(Math.sin(cyc * Math.PI)) * (1 - kneel) + 0.55 * kneel,
      z: 3.2 * smooth(k),
      pitch: -0.15 + 0.06 * Math.sin(cyc * Math.PI * 2) * (1 - kneel) + 0.12 * kneel,
      roll: 0.07 * Math.sin(cyc * Math.PI) * (1 - kneel),
      drip: 1 - smooth(seg(k, 0.3, 1)),
      gear: 1,
      phase: 'crawl',
    };
  }
  if (t < END_TITLE_S) {
    // смотришь на часть; луч прожектора находит тебя
    const k = seg(t, END_CRAWL_S, END_TITLE_S);
    return {
      ...base,
      place: 'base',
      y: 0.9 + 0.05 * smooth(k),
      z: 3.2,
      pitch: -0.03 + 0.08 * smooth(seg(k, 0, 0.4)),
      yaw: 0.12 * Math.sin(seg(k, 0, 0.5) * Math.PI),
      glare: smooth(seg(t, END_LOOK_S, END_TITLE_S)) * 0.85,
      title: smooth(seg(t, END_LOOK_S + 0.8, END_TITLE_S)),
      gear: 1,
      phase: t < END_LOOK_S ? 'look' : 'title',
    };
  }
  return { ...base, place: 'base', y: 0.95, z: 3.2, pitch: 0.05, glare: 0.85, title: 1, gear: 1, phase: 'done' };
}

/** Титры финала. */
export function endTitles(roll: SwampRoll): { title: string; lines: string[] } {
  return {
    title: 'КОНЕЦ',
    lines: [
      'Ты выбрался из гигахруща.',
      `Болото, туман, бетонный забор с колючкой. На воротах — «Войсковая часть ${roll.unit}».`,
      'Прожектор нашёл тебя.',
    ],
  };
}

/** Правило для игрока. */
export function swampRule(spec: SwampSpec = DEFAULT_SWAMP): string {
  return `Мокрый ход завода выводит к лестнице на крышу. Крыша заросла болотом; посреди — огромная шестерня, ` +
    `проворачивается на зуб за ${spec.toothS} с. Встань на зуб у самой грязи — это конец игры. Передумал — назад через люк.`;
}
