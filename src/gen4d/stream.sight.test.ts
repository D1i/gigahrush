// Свой предел обзора биома (Biome.sightM, docs/GENERATOR-4D.md §24): комнаты биома с большим внутренним обзором не
// выкидываются из пула (buildPool / analyzeGrowth / Stream), растут только в биомах, чей предел их пускает; квартиры
// такого биома стыкуются по его пределу; validateFoldRun сверяет линии через такие комнаты с их пределом
// (Run.settings.sightRooms). Без биомов со своим пределом всё как раньше.
import { describe, expect, it } from 'vitest';
import { createDefaultProject } from '../data/presets';
import { room } from '../data/roomBuilder';
import { analyzeGrowth, BIOME_ONLY_TAG } from '../gen/generate';
import type { Biome, Project, Room, WorldSettings } from '../model/types';
import { biomeSightM, defaultBiomes, newWorldSettings, normBiome, ownSightBiomes, roomSightLimit } from './biomes';
import { validateFoldRun } from './fold';
import { buildPool } from './foldcore';
import { roomSightM } from './space';
import { createStreamWorld, streamSettings, type StreamWorld } from './stream';

/** Зал 12×12 (внутренний обзор по диагонали ~17 м — больше общих 9 м), коридорные двери с четырёх сторон. */
const big = (): Room =>
  room('tt_big', 'Тестовый большой зал', { tags: ['тест-зал', 'зал', BIOME_ONLY_TAG], note: 'тест', gen: { weight: 5, min: 0, max: 9999 }, elite: [] })
    .rect(0, 0, 12, 12)
    .open('N', 5.35, 'corridor', 'С').open('S', 5.35, 'corridor', 'Ю').open('W', 5.35, 'corridor', 'З').open('E', 5.35, 'corridor', 'В')
    .build();
/** Малая комната 3×3 с теми же дверями. */
const small = (): Room =>
  room('tt_small', 'Тестовая малая комната', { tags: ['тест-зал', 'коридор', BIOME_ONLY_TAG], note: 'тест', gen: { weight: 3, min: 0, max: 9999 }, elite: [] })
    .rect(0, 0, 3, 3)
    .open('N', 0.85, 'corridor', 'С').open('S', 0.85, 'corridor', 'Ю').open('W', 0.85, 'corridor', 'З').open('E', 0.85, 'corridor', 'В')
    .build();

function project(): Project {
  const p = createDefaultProject();
  p.finishes ??= [];
  p.finishRules ??= [];
  p.rooms.push(big(), small());
  return p;
}
const p = project();

const biome = (id: string, sightM?: number): Biome => ({
  id, name: `Тест ${id}`, color: '#888888', tags: [{ tag: 'тест-зал', mul: 1 }], ...(sightM !== undefined ? { sightM } : {}), note: 'тест',
});
const world = (biomes: Biome[], start: string): WorldSettings => ({ ...newWorldSettings(), biomes, startBiome: start, trAfter: 100000 });
const make = (w: WorldSettings, seed = 'sight') => createStreamWorld(p, streamSettings(seed, { world: w }));

/** «Пройти» мир: раскрыть экземпляры в ширину от старта, пока комнат меньше n. */
function walk(w: StreamWorld, n: number): void {
  const seen = new Set<string>();
  const q = [w.startId!];
  while (q.length && w.run().instances.length < n) {
    const id = q.shift()!;
    if (seen.has(id)) continue;
    seen.add(id);
    w.expand(id);
    for (const l of w.run().links) {
      if (l.kind === 'descent' || l.kind === 'lift') continue;
      if (l.a.inst === id && !seen.has(l.b.inst)) q.push(l.b.inst);
      if (l.b.inst === id && !seen.has(l.a.inst)) q.push(l.a.inst);
    }
  }
}
const hasBig = (w: StreamWorld) => w.run().instances.some((i) => i.roomId === 'tt_big');

describe('свой предел обзора биома (Biome.sightM)', { timeout: 120000 }, () => {
  it('тестовый зал внутри длиннее общего предела', () => {
    expect(roomSightM(big(), 0.1)).toBeGreaterThan(16);
    expect(roomSightM(small(), 0.1)).toBeLessThan(9);
  });

  it('normBiome: поле сохраняется на своём месте (после viewM), 0 — значение, мусор — нет поля', () => {
    const b = normBiome({ id: 'x', tags: [], viewM: 70, sightM: 28, note: 'n' })!;
    expect(Object.keys(b)).toEqual(['id', 'name', 'color', 'tags', 'viewM', 'sightM', 'note']);
    expect(b.sightM).toBe(28);
    expect(normBiome({ id: 'x', sightM: 0 })!.sightM).toBe(0);
    expect(normBiome({ id: 'x', sightM: 500 })!.sightM).toBe(200);
    for (const bad of [-1, 'x', null, NaN]) expect('sightM' in normBiome({ id: 'x', sightM: bad })!).toBe(false);
    // пресет со своим пределом (метро) — сохранение → загрузка без изменений, порядок полей тот же
    for (const d of defaultBiomes().filter((x) => x.sightM !== undefined)) {
      const back = normBiome(JSON.parse(JSON.stringify(d)))!;
      expect(back).toEqual(d);
      expect(Object.keys(back)).toEqual(Object.keys(d));
    }
  });

  it('предел биома и комнаты: нет поля — общий, 0 — без предела, комната — самый мягкий из её биомов', () => {
    expect(biomeSightM(biome('a'), 9)).toBe(9);
    expect(biomeSightM(biome('a', 28), 9)).toBe(28);
    expect(biomeSightM(biome('a', 0), 9)).toBe(0);
    expect(biomeSightM(null, 9)).toBe(9);
    const w = world([biome('tt', 28), biome('tt2')], 'tt');
    expect(ownSightBiomes(w, 9)).toBe(true);
    expect(ownSightBiomes(world([biome('tt', 9), biome('tt2')], 'tt'), 9)).toBe(false);
    expect(roomSightLimit(w, big(), 9)).toBe(28);
    expect(roomSightLimit(world([biome('tt2')], 'tt2'), big(), 9)).toBe(9);
    expect(roomSightLimit(world([biome('tt', 0)], 'tt'), big(), 9)).toBe(0);
    // «только в биоме», ни в одном биоме не растёт — общий; обычная комната (растёт и запасным ростом) — не уже общего
    expect(roomSightLimit(world([newWorldSettings().biomes[0]], newWorldSettings().biomes[0].id), big(), 9)).toBe(9);
    const plain = p.rooms.find((r) => !r.tags.includes(BIOME_ONLY_TAG))!;
    expect(roomSightLimit(w, plain, 9)).toBe(9);
  });

  it('buildPool / analyzeGrowth: с пределом комнаты зал в пуле, его двери ростовые; без него — исключён', () => {
    const w = world([biome('tt', 28)], 'tt');
    const limOf = (r: Room) => roomSightLimit(w, r, 9);
    const off = buildPool(p, 'exact', 9, 0.1);
    expect(off.tooLong.map((t) => t.room.id)).toContain('tt_big');
    expect(off.pool.some((i) => i.room.id === 'tt_big')).toBe(false);
    const on = buildPool(p, 'exact', 9, 0.1, limOf);
    expect(on.tooLong.map((t) => t.room.id)).not.toContain('tt_big');
    expect(on.pool.some((i) => i.room.id === 'tt_big')).toBe(true);
    // остальные комнаты — как без своего предела
    expect(on.pool.length).toBe(off.pool.length + 1);
    // рост: в проекте только зал и комната-лист — дверь листа ростовая, только если зал в пуле
    const leaf = room('tt_leaf', 'Тестовый лист', { tags: ['тест-зал', BIOME_ONLY_TAG], note: 'тест', gen: { weight: 1, min: 0, max: 99 }, elite: [] })
      .rect(0, 0, 3, 3).open('N', 0.85, 'corridor', 'С').build();
    const q: Project = { ...p, rooms: [big(), leaf] };
    expect(analyzeGrowth(q, { sightM: 9 }).tt_leaf.grow).toEqual([false]);
    expect(analyzeGrowth(q, { sightM: 9 }, (r) => roomSightLimit(w, r, 9)).tt_leaf.grow).toEqual([true]);
  });

  it('мир: в биоме со своим пределом зал растёт, validateFoldRun чисто (линии — до предела зала)', () => {
    const w = make(world([biome('tt', 28)], 'tt'));
    walk(w, 40);
    expect(hasBig(w)).toBe(true);
    expect(w.warnings.join(' ')).not.toMatch(/Тестовый большой зал/);
    const run = w.run();
    // за дверями зала встают комнаты: стыковка в квартире биома — по его пределу (линии сквозь зал длиннее общих 9 м)
    const bigs = new Set(run.instances.filter((i) => i.roomId === 'tt_big').map((i) => i.id));
    expect(run.links.some((l) => !l.kind && (bigs.has(l.a.inst) || bigs.has(l.b.inst)))).toBe(true);
    expect(run.settings.sightRooms?.tt_big).toBe(28);
    expect(validateFoldRun(p, run)).toEqual([]);
    // без своих пределов комнат в прогоне проверка видит длинные линии сквозь зал
    const { sightRooms: _s, ...rest } = run.settings;
    expect(validateFoldRun(p, { ...run, settings: rest }).join(' ')).toMatch(/длиннее предела/);
  });

  it('мир: без своего предела зал исключён (предупреждение), в прогоне нет пределов комнат', () => {
    const w = make(world([biome('tt')], 'tt'));
    walk(w, 40);
    expect(hasBig(w)).toBe(false);
    expect(w.warnings.join(' ')).toMatch(/Тестовый большой зал/);
    expect(w.run().settings.sightRooms).toBeUndefined();
    expect(validateFoldRun(p, w.run())).toEqual([]);
  });

  it('другой биом той же группы без своего предела: зал в общем пуле, но в его квартирах не растёт', () => {
    for (const seed of ['a', 'b', 'c']) {
      const w = make(world([biome('tt', 28), biome('tt2')], 'tt2'), seed);
      walk(w, 40);
      expect(w.run().instances.length).toBeGreaterThan(3);
      expect(hasBig(w), seed).toBe(false);
      expect(w.warnings.join(' ')).not.toMatch(/Тестовый большой зал/);
    }
  });

  it('широкий проход (17.6 м) между ходами: линии вдоль зазора проёма — по его комнатам, validateFoldRun чисто', () => {
    const wide = (id: string): Room => {
      const r = room(id, `Тестовый широкий ход ${id}`, { tags: ['тест-широкий', 'ход', BIOME_ONLY_TAG], note: 'тест', gen: { weight: 1, min: 0, max: 9999 }, elite: [] })
        .rect(0, 0, 18, 6).open('N', 0.2, 'metro_hall', 'С').open('S', 0.2, 'metro_hall', 'Ю').build();
      r.connectors.forEach((c) => (c.tag = 'tt_wide'));
      return r;
    };
    const q: Project = { ...p, rooms: [...p.rooms, wide('tt_wide_a'), wide('tt_wide_b')] };
    const b: Biome = { ...biome('tw', 28), tags: [{ tag: 'тест-широкий', mul: 1 }] };
    const w = createStreamWorld(q, streamSettings('wide', { world: world([b], 'tw') }));
    walk(w, 12);
    const run = w.run();
    expect(run.links.filter((l) => !l.kind).length).toBeGreaterThan(0);
    expect(validateFoldRun(q, run)).toEqual([]);
  });

  it('сохранение → загрузка мира с биомом со своим пределом', () => {
    const wset = world([biome('tt', 28)], 'tt');
    const w = make(wset);
    walk(w, 30);
    const sv = JSON.parse(JSON.stringify(w.save()));
    const back = createStreamWorld(p, streamSettings('sight', { world: wset }), sv);
    expect(back.stale).toBe(false);
    expect(back.run().instances.map((i) => i.roomId)).toEqual(w.run().instances.map((i) => i.roomId));
    expect(back.run().settings.sightRooms).toEqual(w.run().settings.sightRooms);
  });
});
