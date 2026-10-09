// Сюжет режима «Запустить без отладки» (src/game/story.ts): цепочка шагов и куда ведут переходы.
import { describe, expect, it } from 'vitest';
import {
  STORY_ALT_STEPS, STORY_FALL, STORY_OBSHAGA, STORY_PLACEHOLDER, STORY_START, STORY_STEPS, storyBiomes, storyIndex, storyNext, storyNexts,
  storyStep, storyVia,
} from './story';

describe('сюжет: цепочка локаций', () => {
  it('шаги идут по порядку: каждый переход — в биом следующего шага, последний (завод) — конец игры', () => {
    expect(STORY_STEPS[0].biome).toBe(STORY_START);
    expect(STORY_STEPS.map((s) => s.biome)).toEqual(['khrush', 'basement', 'barn', 'cellar', 'snow', 'factory']);
    STORY_STEPS.forEach((s, i) => expect(s.next, s.biome).toBe(STORY_STEPS[i + 1]?.biome ?? null));
    expect(STORY_STEPS.map((s) => s.via)).toEqual(['stairwell', 'lift', 'hatch', 'snowdoor', 'hangar', 'swamp']);
  });

  it('storyNext: по сюжету; лифт подвала — дальше только с верхнего этажа, прочие этажи — тот же подвал', () => {
    expect(storyNext('khrush')).toBe('basement');
    expect(storyNext('barn')).toBe('cellar');
    expect(storyNext('cellar')).toBe('snow');
    expect(storyNext('snow')).toBe('factory');
    expect(storyNext('factory')).toBeNull();
    expect(storyNext('basement')).toBe('barn');
    expect(storyNext('basement', { floor: 4, top: 4 })).toBe('barn');
    expect(storyNext('basement', { floor: 2, top: 4 })).toBe('basement');
    expect(storyNext('basement', { floor: -1, top: 4 })).toBe('basement');
    // лифт вне подвала — сюжет про верхний этаж не знает: обычный переход шага
    expect(storyNext('khrush', { floor: 1, top: 4 })).toBe('basement');
    for (const b of ['rich', 'malosem', '', null, undefined]) expect(storyNext(b)).toBeNull();
  });

  it('шаг 2 — подвал или питерские катакомбы: лестница ведёт в любой из них, лифт катакомб — как подвала', () => {
    expect(storyNexts('khrush')).toEqual(['basement', 'catacombs']);
    expect(storyNext('khrush')).toBe('basement');
    expect(STORY_ALT_STEPS.map((s) => [s.biome, s.share])).toEqual([['catacombs', 'basement']]);
    expect(storyStep('catacombs')).toMatchObject({ title: 'Питерские катакомбы', via: 'lift', next: 'barn', liftTopOnly: true });
    expect(storyVia('catacombs')).toBe('lift');
    expect(storyNexts('catacombs', { floor: 5, top: 5 })).toEqual(['barn']);
    expect(storyNexts('catacombs', { floor: 3, top: 5 })).toEqual(['catacombs']);
    expect(storyNexts('basement', { floor: -1, top: 5 })).toEqual(['basement']);
    expect(storyNexts('factory')).toEqual([]);
    expect(storyNexts(null)).toEqual([]);
    // номер шага: катакомбы делят его с подвалом; завод — 6 (7 — конец игры)
    expect(storyIndex('basement')).toBe(2);
    expect(storyIndex('catacombs')).toBe(2);
    expect(storyIndex('barn')).toBe(3);
  });

  it('общага — побочная ветка: срыв ведёт в неё, переход — дверь в снег, двери на улицу — в хрущёвку или подвал', () => {
    expect(STORY_FALL).toBe('obshaga');
    expect(storyStep(STORY_FALL)).toBe(STORY_OBSHAGA);
    expect(storyVia('obshaga')).toBe('snowdoor');
    expect(storyNext('obshaga')).toBe('snow');
    expect(STORY_OBSHAGA.streetDoors).toEqual(['khrush', 'basement']);
    expect(storyIndex('obshaga')).toBe(0);
    expect(storyIndex('khrush')).toBe(1);
    expect(storyIndex('factory')).toBe(6);
    expect(storyIndex('rich')).toBe(-1);
    expect(storyVia('rich')).toBeNull();
  });

  it('storyBiomes: все биомы сюжета без повторов; заглушка погреба — подвал', () => {
    const bs = storyBiomes();
    expect(new Set(bs).size).toBe(bs.length);
    expect(bs).toEqual(['khrush', 'basement', 'catacombs', 'barn', 'cellar', 'snow', 'factory', 'obshaga']);
    expect(STORY_PLACEHOLDER).toEqual({ cellar: 'basement' });
  });
});
