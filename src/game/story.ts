/**
 * Сюжет режима «Запустить без отладки» (docs/GAMEPLAY.md, «Сюжет»): игра идёт по цепочке локаций — биомов
 * бесконечного мира, — а переходы между ними (спец-комнаты) ведут строго на следующий шаг, а не в случайный биом.
 *
 *   1 Хрущёвка ─ бесконечная лестница ─▶ 2 Подвал или питерские катакомбы ─ лифт (клетка/каретка), верхний этаж ─▶
 *   3 Сарай ─ люк вниз ─▶ 4 Погреб ─ дверь, заваливает снегом ─▶ 5 Снежные тоннели ─ подтаявший снег, ангар ─▶
 *   6 Завод ─ болото ─▶ 7 Конец
 *
 * Шаг может быть одним из нескольких биомов (подвал или катакомбы): переход предыдущего шага ведёт в один из них — тот,
 * что есть в мире (несколько — по переходу, детерминированно; мир решает сам, storyNexts — кандидаты).
 *
 * Срыв: Хвататель на лестнице утащил или из лифта выпал — игрок оказывается в общаге (STORY_FALL). Из общаги нет
 * чёткого выхода: двери на улицу ведут в хрущёвку (в начало!) или в подвал, переход общаги — дверь в снежные обвалы.
 *
 * Чистые данные и функции: мир (src/gen4d/stream.ts, WorldSettings.story) и вид (src/view3d/) читают сюжет отсюда.
 */

/** Чем из биома выходят дальше по сюжету — вид спец-локации комнаты-перехода (Room.location.kind). */
export type StoryVia = 'stairwell' | 'lift' | 'hatch' | 'snowdoor' | 'hangar' | 'swamp';

export interface StoryStep {
  /** биом шага (WorldSettings.biomes[].id) */
  biome: string;
  /** название для игрока */
  title: string;
  /** переход дальше по сюжету; null — нет */
  via: StoryVia | null;
  /** куда ведёт переход (id биома); null — конец игры */
  next: string | null;
  /** лифт: дальше по сюжету — только выход верхнего этажа (прочие — тот же биом) */
  liftTopOnly?: true;
  /** другие биомы, куда тоже может вести переход (тот же следующий шаг: подвал или катакомбы) */
  alt?: readonly string[];
}

/** Биом начала игры. */
export const STORY_START = 'khrush';

/** Шаги сюжета по порядку (7-й — конец игры, сцена болота на заводе). */
export const STORY_STEPS: readonly StoryStep[] = [
  { biome: 'khrush', title: 'Хрущёвка', via: 'stairwell', next: 'basement', alt: ['catacombs'] },
  { biome: 'basement', title: 'Подвал', via: 'lift', next: 'barn', liftTopOnly: true },
  { biome: 'barn', title: 'Бесконечный трухлявый сарай', via: 'hatch', next: 'cellar' },
  { biome: 'cellar', title: 'Погреб', via: 'snowdoor', next: 'snow' },
  { biome: 'snow', title: 'Снежные тоннели', via: 'hangar', next: 'factory' },
  { biome: 'factory', title: 'Завод', via: 'swamp', next: null },
];

/** Другие биомы шагов сюжета: делят номер шага с основным (share — его биом). Катакомбы — вместо подвала (шаг 2). */
export const STORY_ALT_STEPS: readonly (StoryStep & { share: string })[] = [
  { biome: 'catacombs', title: 'Питерские катакомбы', via: 'lift', next: 'barn', liftTopOnly: true, share: 'basement' },
];

/** Куда попадает игрок, которого утащил Хвататель на лестнице или выбросило из лифта. */
export const STORY_FALL = 'obshaga';

/** Общага — побочная ветка: переход — дверь в снежные обвалы, двери на улицу — в хрущёвку или подвал (по двери). */
export const STORY_OBSHAGA: StoryStep & { streetDoors: readonly string[] } = {
  biome: STORY_FALL, title: 'Общага', via: 'snowdoor', next: 'snow', streetDoors: ['khrush', 'basement'],
};

/** Ещё не сделано: выход из общаги в «Планетарные мосты». */
export const STORY_TODO = ['Планетарные мосты (выход из общаги)'] as const;

/** Заглушки: биом сюжета, которого пока нет, растёт комнатами и отделкой другого (погреб — подвал). */
export const STORY_PLACEHOLDER: Readonly<Record<string, string>> = { cellar: 'basement' };

/** Шаг сюжета биома (общага — своя ветка); null — биом вне сюжета. */
export function storyStep(biome: string | null | undefined): StoryStep | null {
  if (!biome) return null;
  if (biome === STORY_OBSHAGA.biome) return STORY_OBSHAGA;
  return STORY_STEPS.find((s) => s.biome === biome) ?? STORY_ALT_STEPS.find((s) => s.biome === biome) ?? null;
}

/** Вид перехода, который встаёт в биоме по сюжету; null — переходов нет (вне сюжета или свой выход). */
export function storyVia(biome: string | null | undefined): StoryVia | null {
  return storyStep(biome)?.via ?? null;
}

/**
 * Куда может вести переход сюжета из биома — кандидаты по порядку: основной биом следующего шага, затем другие (alt).
 * Лифт подвала (катакомб): дальше — только с верхнего этажа (top), прочие выходы — в тот же биом. [] — вне сюжета /
 * конец. Какие из кандидатов есть в мире и какой выбрать — решает мир (src/gen4d/stream.ts).
 */
export function storyNexts(biome: string | null | undefined, lift?: { floor: number; top: number }): string[] {
  const s = storyStep(biome);
  if (!s?.next) return [];
  if (s.liftTopOnly && lift && lift.floor !== lift.top) return [s.biome];
  return [s.next, ...(s.alt ?? [])];
}

/** Куда ведёт переход сюжета из биома — основной кандидат storyNexts; null — вне сюжета / конец. */
export function storyNext(biome: string | null | undefined, lift?: { floor: number; top: number }): string | null {
  return storyNexts(biome, lift)[0] ?? null;
}

/** Номер шага сюжета для игрока (1…7; другой биом шага — номер шага: катакомбы — 2; общага — 0, вне сюжета — −1). */
export function storyIndex(biome: string | null | undefined): number {
  if (biome === STORY_OBSHAGA.biome) return 0;
  const alt = STORY_ALT_STEPS.find((s) => s.biome === biome);
  const i = STORY_STEPS.findIndex((s) => s.biome === (alt ? alt.share : biome));
  return i < 0 ? -1 : i + 1;
}

/** Все биомы, которые нужны сюжету, по порядку шагов (другие биомы шага — сразу за основным). Мир сюжета берёт их из
 *  мира проекта и пресетов; другого биома шага (катакомбы) нигде нет — его просто нет в мире. */
export function storyBiomes(): string[] {
  const steps = STORY_STEPS.flatMap((s) => [s.biome, ...STORY_ALT_STEPS.filter((a) => a.share === s.biome).map((a) => a.biome)]);
  return [...new Set([...steps, STORY_FALL, ...STORY_OBSHAGA.streetDoors])];
}
