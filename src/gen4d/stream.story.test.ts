// Мир сюжета (WorldSettings.story, src/game/story.ts — «Запустить без отладки»): переходы ведут строго по цепочке
// хрущёвка → (бесконечная лестница) → подвал → (лифт, верхний этаж) → сарай → (люк) → погреб → (дверь в снег) → снег;
// срыв с лестницы / из лифта — в общагу; из общаги — дверь в снег и двери на улицу (хрущёвка или подвал).
import { describe, expect, it } from 'vitest';
import { createDefaultProject } from '../data/presets';
import { HATCH_ID, SNOWDOOR_CELLAR_ID, SNOWDOOR_OBSHAGA_ID } from '../data/roomsSpecial';
import { strip } from '../gen/fixtures.test-util';
import { newSnowDoor, SNOWDOOR_CONN } from '../locations/storyDoors';
import { STORY_OBSHAGA } from '../game/story';
import { bbox } from '../model/cells';
import type { Biome, LiftSide, Project, Room, Run, WorldSettings } from '../model/types';
import { DEFAULT_WALK, hasWalkSave, resetWalkSave, storyWalk, WalkSession, walkStreamSettings } from '../view3d/walk';
import { biomeMul, defaultBiomes, newWorldSettings, normWorld, storyWorld } from './biomes';
import { validateFoldRun } from './fold';
import { createStreamWorld, normStream, streamSettings, worldKey, type StreamSave, type StreamWorld } from './stream';

const project = (): Project => {
  const p = createDefaultProject();
  p.finishes ??= [];
  p.finishRules ??= [];
  return p;
};
const p = project();
const byId = new Map(p.rooms.map((r) => [r.id, r]));
const roomOf = (w: StreamWorld, id: string): Room => byId.get(w.run().instances[Number(id.slice(1))].roomId)!;
const biomeOf = (w: StreamWorld, id: string) => w.clusterAt(id)?.biome?.id ?? null;
const locOf = (w: StreamWorld, id: string) => roomOf(w, id).location?.kind ?? null;

/** Пресеты и мир без биомов погреба и катакомб: мир сюжета с заглушкой погреба (STORY_PLACEHOLDER — копия подвала) и
 *  без катакомб — даже когда настоящие 'cellar' и 'catacombs' появятся в defaultBiomes (их проверяют свои проверки). */
const noCellar = (bs: readonly Biome[]): Biome[] => bs.filter((b) => b.id !== 'cellar' && b.id !== 'catacombs');
const PRESETS = noCellar(defaultBiomes());
const placeholderWorld = (o: Partial<WorldSettings> = {}): WorldSettings => {
  const w = { ...newWorldSettings(), ...o };
  return storyWorld({ ...w, biomes: noCellar(w.biomes) }, PRESETS);
};

/** Мир сюжета (погреб — заглушка); переход выпадает в первой же засчитанной комнате (trAfter 0, шанс 1). o — поверх
 *  мира сюжета. */
const story = (seed: string, o: Partial<WorldSettings> = {}, q: Project = p): StreamWorld =>
  createStreamWorld(q, streamSettings(seed, { world: { ...placeholderWorld({ trAfter: 0, trBase: 1, trStep: 0 }), ...o } }));

/** Прогон без времени и сводки (счётчик колец сети ходов в сохранении не хранится — после загрузки сводка другая). */
const same = (r: Run) => ({ ...strip(r), warnings: r.warnings.filter((x) => !x.startsWith('Бесконечный мир:')) });

/** Сохранение → JSON → загрузка. */
const reload = (w: StreamWorld): StreamWorld => createStreamWorld(p, w.settings, JSON.parse(JSON.stringify(w.save())) as StreamSave);

/** Закрытые выходы квартир (сетей ходов) мира: [экземпляр, метка]. */
function exitsOf(w: StreamWorld): [string, string][] {
  const out: [string, string][] = [];
  for (const i of w.run().instances) for (const c of roomOf(w, i.id).connectors) if (w.doorState(i.id, c.id) === 'exit') out.push([i.id, c.id]);
  return out;
}

/**
 * Ходить, как игрок, от from: входить в комнаты (счётчик переходов) и раскрывать их — в ширину по дверям; в квартирах,
 * когда идти некуда, — открыть закрытый выход (не из сети ходов: выходы её хабов ведут наверх, прочь из биома). Пока в
 * биоме biome не встанет спец-комната вида kind (не из skip); её id.
 */
function seek(w: StreamWorld, from: string, kind: string, biome: string, skip: ReadonlySet<string> = new Set()): string {
  const seen = new Set<string>();
  const q = [from];
  for (let step = 0; step < 4000; step++) {
    const hit = w.run().instances.find((i) => !skip.has(i.id) && locOf(w, i.id) === kind && biomeOf(w, i.id) === biome);
    if (hit) return hit.id;
    if (!q.length) {
      const ex = exitsOf(w).find(([i]) => !w.clusterAt(i)?.tunnels && biomeOf(w, i) === biome);
      if (!ex) break;
      const id = w.openDoor(...ex);
      if (id) q.push(id);
      continue;
    }
    const id = q.shift()!;
    if (seen.has(id)) continue;
    seen.add(id);
    w.enter(id);
    w.expand(id);
    for (const l of w.run().links) {
      if (l.kind === 'descent' || l.kind === 'lift' || l.sealed) continue;
      if (l.a.inst === id && !seen.has(l.b.inst)) q.push(l.b.inst);
      if (l.b.inst === id && !seen.has(l.a.inst)) q.push(l.a.inst);
    }
  }
  throw new Error(`не встретилась спец-комната «${kind}» в биоме ${biome}`);
}

/** Спец-комнаты переходов мира: вид → биомы квартир, где стоят. */
function specials(w: StreamWorld): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  for (const i of w.run().instances) {
    const k = locOf(w, i.id);
    if (!k || k === 'hangar' || k === 'swamp' || k === 'lair') continue;
    const s = out.get(k) ?? new Set<string>();
    s.add(biomeOf(w, i.id) ?? '-');
    out.set(k, s);
  }
  return out;
}

/** Выход лифта L на этаже floor, не логово (если логово — другая сторона). */
function liftSide(w: StreamWorld, L: string, floor: number): LiftSide {
  const loc = w.locationOf(L);
  if (loc?.kind !== 'lift') throw new Error(`${L} — не лифт`);
  return loc.roll.lair?.floor === floor && loc.roll.lair.side === 'straight' ? 'right' : 'straight';
}

/** Пройти сюжет от старта до снега: id ключевых комнат по шагам. */
function playChain(seed: string) {
  const w = story(seed);
  const stair = seek(w, w.startId!, 'stairwell', 'khrush');
  const bsm = w.descend(stair);
  const lift = seek(w, bsm, 'lift', 'basement');
  const loc = w.locationOf(lift);
  if (loc?.kind !== 'lift') throw new Error('не лифт');
  const top = loc.roll.floors;
  const barn = w.ascend(lift, top, liftSide(w, lift, top));
  const hatch = seek(w, barn, 'hatch', 'barn');
  const cellar = w.descend(hatch);
  const door = seek(w, cellar, 'snowdoor', 'cellar');
  const snow = w.descend(door);
  return { w, stair, bsm, lift, top, barn, hatch, cellar, door, snow };
}

describe('мир сюжета: биомы', { timeout: 120000 }, () => {
  it('storyWorld: story, старт — хрущёвка, только биомы сюжета, погреб — копия подвала (нет погреба); богатых, площадок и «Спуска в подвал» нет', () => {
    const all = newWorldSettings();
    const base = { ...all, biomes: noCellar(all.biomes) };
    const s = storyWorld(base, PRESETS);
    expect(s.story).toBe(true);
    expect(s.startBiome).toBe('khrush');
    expect(s.trLanding).toBe(0);
    expect(s.biomes.map((b) => b.id)).toEqual(['khrush', 'basement', 'barn', 'cellar', 'snow', 'factory', 'obshaga']);
    expect(s.biomes.some((b) => b.rich)).toBe(false);
    const cellar = s.biomes.find((b) => b.id === 'cellar')!;
    const bsm = base.biomes.find((b) => b.id === 'basement')!;
    expect(cellar.name).toBe('Погреб');
    expect(cellar.layout).toBe('tunnels');
    expect(cellar.tags).toEqual(bsm.tags);
    expect(cellar.finishRules).toEqual(bsm.finishRules);
    expect(s.biomes.find((b) => b.id === 'khrush')!.tags.some((t) => t.tag === 'спуск')).toBe(false);
    // исходный мир не тронут; свой биом автора — как есть
    expect(base.story).toBeUndefined();
    expect(base.biomes.find((b) => b.id === 'khrush')!.tags.some((t) => t.tag === 'спуск')).toBe(true);
    const mine = { ...base, biomes: base.biomes.map((b) => (b.id === 'barn' ? { ...b, name: 'Мой сарай' } : b)) };
    expect(storyWorld(mine, PRESETS).biomes.find((b) => b.id === 'barn')!.name).toBe('Мой сарай');
    // недостающие биомы — из пресетов
    expect(storyWorld({ ...base, biomes: base.biomes.filter((b) => b.id === 'khrush') }, PRESETS).biomes.map((b) => b.id)).toEqual(s.biomes.map((b) => b.id));
  });

  it('настоящий погреб (биом cellar в мире или в пресетах) storyWorld не заменяет заглушкой', () => {
    const real: Biome = { id: 'cellar', name: 'Погреб (настоящий)', color: '#553322', tags: [{ tag: 'погреб', mul: 1 }], layout: 'tunnels', note: '' };
    const w = newWorldSettings();
    const inWorld = storyWorld({ ...w, biomes: [...noCellar(w.biomes), real] }, PRESETS).biomes.find((b) => b.id === 'cellar');
    expect(inWorld).toEqual(real);
    const inPresets = storyWorld({ ...w, biomes: noCellar(w.biomes) }, [...PRESETS, real]).biomes.find((b) => b.id === 'cellar');
    expect(inPresets).toEqual(real);
    // по умолчанию: погреб пресетов, если он там есть, иначе заглушка
    const def = storyWorld(newWorldSettings()).biomes.find((b) => b.id === 'cellar')!;
    const preset = defaultBiomes().find((b) => b.id === 'cellar');
    if (preset) expect(def).toEqual(newWorldSettings().biomes.find((b) => b.id === 'cellar') ?? preset);
    else expect(def.tags).toEqual(defaultBiomes().find((b) => b.id === 'basement')!.tags);
  });

  it('поле story переживает normWorld, normStream и сохранение мира; без сюжета поля нет', () => {
    const s = placeholderWorld();
    expect(normWorld(JSON.parse(JSON.stringify(s)))).toEqual(s);
    expect(normWorld(newWorldSettings()).story).toBeUndefined();
    expect(normStream({ seed: 'x', world: s }).world?.story).toBe(true);
    const w = story('norm');
    expect(w.save().settings.world?.story).toBe(true);
    expect(reload(w).settings.world?.story).toBe(true);
  });

  it('«Прогулка» сюжета: свой ключ и мир сюжета; биом старта не действует', () => {
    const s = walkStreamSettings(p, { ...storyWalk('гигахрущ'), biome: 'snow' });
    expect(s.world?.story).toBe(true);
    expect(s.world?.startBiome).toBe('khrush');
    expect(walkStreamSettings(p, DEFAULT_WALK).world?.story).toBeUndefined();
    const w = createStreamWorld(p, s);
    expect(biomeOf(w, w.startId!)).toBe('khrush');
  });

  it('комнаты переходов: люк ровно в центре, дверь в снег — глухая метка «snowdoor»; вес роста 0; вариант — по биому', () => {
    const hatch = byId.get(HATCH_ID)!;
    expect(hatch.location).toEqual({ kind: 'hatch', floorsDown: [1, 1] });
    // люк — ровно в центре габарита комнаты (вид ищет его там), один, в полу
    const hs = hatch.decor.filter((d) => d.propId === 'p_cellar_hatch');
    expect(hs).toHaveLength(1);
    const bb = bbox(hatch.cells)!;
    expect([hs[0].x, hs[0].y]).toEqual([(bb.x0 + bb.x1) / 2, (bb.y0 + bb.y1) / 2]);
    expect(p.props.find((x) => x.id === 'p_cellar_hatch')!.tags).toEqual(expect.arrayContaining(['люк', 'пол']));
    expect(hatch.connectors.map((c) => c.tag)).toEqual(['barn']);
    for (const id of [SNOWDOOR_CELLAR_ID, SNOWDOOR_OBSHAGA_ID]) {
      const r = byId.get(id)!;
      expect(r.location, id).toEqual({ kind: 'snowdoor', digs: [4, 6], floorsDown: [0, 1] });
      expect(r.connectors.filter((c) => c.id === SNOWDOOR_CONN), id).toHaveLength(1);
      expect(r.connectors.filter((c) => c.len >= 1), id).toHaveLength(2);
    }
    for (const r of [hatch, byId.get(SNOWDOOR_CELLAR_ID)!, byId.get(SNOWDOOR_OBSHAGA_ID)!]) expect(r.gen.weight, r.id).toBe(0);
    const bs = placeholderWorld().biomes;
    const grows = (id: string) => bs.filter((b) => biomeMul(b, byId.get(id)!) > 0).map((b) => b.id);
    expect(grows(HATCH_ID)).toEqual(['barn']);
    expect(grows(SNOWDOOR_CELLAR_ID)).toEqual(['basement', 'cellar']);
    expect(grows(SNOWDOOR_OBSHAGA_ID)).toEqual(['obshaga']);
  });
});

describe('мир сюжета: переходы по цепочке', { timeout: 600000 }, () => {
  it('хрущёвка → лестница → подвал → лифт (верхний этаж) → сарай → люк → погреб → дверь в снег → снег', () => {
    const c = playChain('сюжет-1');
    const { w } = c;
    expect(biomeOf(w, w.startId!)).toBe('khrush');
    // в каждом биоме — только свои переходы сюжета
    expect(Object.fromEntries([...specials(w)].map(([k, b]) => [k, [...b].sort()]))).toEqual({
      stairwell: ['khrush'], lift: ['basement'], hatch: ['barn'], snowdoor: ['cellar'],
    });
    expect(biomeOf(w, c.bsm)).toBe('basement');
    expect(w.clusterAt(c.bsm)!.tunnels).toBe(true);
    expect(biomeOf(w, c.barn)).toBe('barn');
    expect(roomOf(w, c.hatch).id).toBe(HATCH_ID);
    expect(biomeOf(w, c.cellar)).toBe('cellar');
    expect(roomOf(w, c.door).id).toBe(SNOWDOOR_CELLAR_ID);
    // дверь в снег — глухая, никогда не связывается
    expect(w.doorState(c.door, SNOWDOOR_CONN)).toBe('dead');
    expect(w.run().links.some((l) => (l.a.inst === c.door && l.a.connector === SNOWDOOR_CONN) || (l.b.inst === c.door && l.b.connector === SNOWDOOR_CONN))).toBe(false);
    expect(biomeOf(w, c.snow)).toBe('snow');
    // розыгрыши люка и двери: этажи спуска — по ним; повтор — тот же выход
    const h = w.locationOf(c.hatch), d = w.locationOf(c.door);
    expect(h?.kind).toBe('hatch');
    expect(d?.kind).toBe('snowdoor');
    if (h?.kind === 'hatch') expect(w.run().instances[Number(c.cellar.slice(1))].floor ?? 0).toBe((w.run().instances[Number(c.hatch.slice(1))].floor ?? 0) - h.roll.floorsDown);
    if (d?.kind === 'snowdoor') {
      expect(d.roll.digs).toBeGreaterThanOrEqual(4);
      expect(d.roll.digs).toBeLessThanOrEqual(6);
      expect([0, 1]).toContain(d.roll.floorsDown);
    }
    expect(w.descend(c.hatch)).toBe(c.cellar);
    expect(w.descend(c.door)).toBe(c.snow);
    expect(validateFoldRun(p, w.run())).toEqual([]);
  });

  it('лифт подвала: дальше по сюжету — только верхний этаж, прочие этажи и вниз — снова подвал', () => {
    const w = story('лифт');
    const bsm = w.descend(seek(w, w.startId!, 'stairwell', 'khrush'));
    const lift = seek(w, bsm, 'lift', 'basement');
    const loc = w.locationOf(lift);
    if (loc?.kind !== 'lift') throw new Error('не лифт');
    const { floors, down, lair } = loc.roll;
    for (let f = -down; f <= floors; f++) {
      if (f === 0) continue;
      for (const side of ['straight', 'right'] as LiftSide[]) {
        const id = w.ascend(lift, f, side);
        // логово — тупик в биоме, куда вёл бы выход
        expect(biomeOf(w, id), `${f} ${side}${lair?.floor === f && lair.side === side ? ' логово' : ''}`).toBe(f === floors ? 'barn' : 'basement');
      }
    }
    expect(validateFoldRun(p, w.run())).toEqual([]);
  });

  it('шаг 2 — подвал или катакомбы: без катакомб в мире — всегда подвал; с ними — по лестнице (детерминированно), лифт катакомб с верхнего этажа — в сарай', () => {
    for (const seed of ['шаг2-1', 'шаг2-2', 'шаг2-3', 'шаг2-4']) {
      const w = story(seed);
      expect(w.settings.world!.biomes.some((b) => b.id === 'catacombs')).toBe(false);
      expect(biomeOf(w, w.descend(seek(w, w.startId!, 'stairwell', 'khrush'))), seed).toBe('basement');
    }
    // поддельные катакомбы (только в проверке): копия подвала со своим id
    const base = { ...newWorldSettings(), trAfter: 0, trBase: 1, trStep: 0 };
    const cat: Biome = { ...base.biomes.find((b) => b.id === 'basement')!, id: 'catacombs', name: 'Катакомбы (проверка)' };
    const ws = storyWorld({ ...base, biomes: [...noCellar(base.biomes), cat] }, PRESETS);
    expect(ws.biomes.map((b) => b.id)).toEqual(['khrush', 'basement', 'catacombs', 'barn', 'cellar', 'snow', 'factory', 'obshaga']);
    const got = new Map<string, string>();
    let liftDone = false;
    for (let k = 1; k <= 12 && (got.size < 2 || !liftDone || new Set(got.values()).size < 2); k++) {
      const seed = `катакомбы-${k}`;
      const w = createStreamWorld(p, streamSettings(seed, { world: ws }));
      const stair = seek(w, w.startId!, 'stairwell', 'khrush');
      const to = w.descend(stair);
      const b = biomeOf(w, to)!;
      expect(['basement', 'catacombs'], seed).toContain(b);
      got.set(seed, b);
      // тот же сид и те же действия — туда же
      const w2 = createStreamWorld(p, streamSettings(seed, { world: ws }));
      expect(biomeOf(w2, w2.descend(seek(w2, w2.startId!, 'stairwell', 'khrush')))).toBe(b);
      if (b === 'catacombs' && !liftDone) {
        expect(w.clusterAt(to)!.tunnels).toBe(true);
        const lift = seek(w, to, 'lift', 'catacombs');
        const loc = w.locationOf(lift);
        if (loc?.kind !== 'lift') throw new Error('не лифт');
        const top = loc.roll.floors;
        expect(biomeOf(w, w.ascend(lift, top, liftSide(w, lift, top)))).toBe('barn');
        if (top > 1) expect(biomeOf(w, w.ascend(lift, 1, liftSide(w, lift, 1)))).toBe('catacombs');
        expect(validateFoldRun(p, w.run())).toEqual([]);
        liftDone = true;
      }
    }
    expect(new Set(got.values())).toEqual(new Set(['basement', 'catacombs']));
    expect(liftDone).toBe(true);
  });

  it('срыв: с лестницы и из лифта — в общагу (вестибюль), один приход на локацию; счётчик с нуля; связь fall', () => {
    const w = story('срыв');
    const stair = seek(w, w.startId!, 'stairwell', 'khrush');
    const r0 = w.transitionState()!.resets;
    const ob = w.fall(stair);
    expect(w.fall(stair)).toBe(ob);
    expect(w.transitionState()!.resets).toBe(r0 + 1);
    expect(biomeOf(w, ob)).toBe('obshaga');
    expect(roomOf(w, ob).tags).toContain('вахта');
    expect(w.exitOf(stair)).toBeNull();
    const fl = w.run().links.find((l) => l.kind === 'descent' && l.a.inst === stair)!;
    expect(fl).toMatchObject({ b: { inst: ob }, fall: true });
    expect(w.run().instances[Number(ob.slice(1))].floor ?? 0).toBe(-(fl.floors ?? 0));
    // та же лестница может и вывести (другой игрок в коопе пережил её): спуск — отдельно, в подвал
    const bsm = w.descend(stair);
    expect(bsm).not.toBe(ob);
    expect(biomeOf(w, bsm)).toBe('basement');
    expect(w.fall(stair)).toBe(ob);
    // из лифта
    const lift = seek(w, bsm, 'lift', 'basement');
    const ob2 = w.fall(lift);
    expect(biomeOf(w, ob2)).toBe('obshaga');
    expect(w.fall(lift)).toBe(ob2);
    // не лестница и не лифт — ошибка
    expect(() => w.fall(w.startId!)).toThrow(/нет спец-локации/);
    expect(() => w.fall('нет')).toThrow();
    expect(validateFoldRun(p, w.run())).toEqual([]);
  });

  it('общага: переход — дверь в снег (вариант общаги) → снег', () => {
    const w = story('общага-снег');
    const ob = w.fall(seek(w, w.startId!, 'stairwell', 'khrush'));
    const door = seek(w, ob, 'snowdoor', 'obshaga');
    expect(roomOf(w, door).id).toBe(SNOWDOOR_OBSHAGA_ID);
    expect(w.doorState(door, SNOWDOOR_CONN)).toBe('dead');
    expect([...specials(w).keys()].sort()).toEqual(['snowdoor', 'stairwell']);
    const snow = w.descend(door);
    expect(biomeOf(w, snow)).toBe('snow');
    expect(validateFoldRun(p, w.run())).toEqual([]);
  });

  it('общага: двери на улицу — по двери хрущёвка (квартира) или подвал (хаб сети ходов)', () => {
    const got = new Set<string>();
    for (const seed of ['улица-1', 'улица-2', 'улица-3', 'улица-4', 'улица-5', 'улица-6', 'улица-7', 'улица-8']) {
      const w = story(seed, { startBiome: 'obshaga', trAfter: 100000 });
      const [door] = exitsOf(w);
      expect(roomOf(w, door[0]).connectors.find((c) => c.id === door[1])!.tag).toBe('stair');
      const id = w.openDoor(...door)!;
      expect(id).toBeTruthy();
      const b = biomeOf(w, id)!;
      expect(STORY_OBSHAGA.streetDoors).toContain(b);
      got.add(b);
      if (b === 'basement') {
        expect(w.clusterAt(id)!.tunnels).toBe(true);
        expect(roomOf(w, id).tags).toContain('хаб');
        // сеть растёт дальше на ходу
        expect(w.expand(id).length).toBeGreaterThan(0);
      } else expect(w.clusterAt(id)!.tunnels).toBe(false);
      // тот же сид — та же дверь ведёт туда же
      const w2 = story(seed, { startBiome: 'obshaga', trAfter: 100000 });
      expect(biomeOf(w2, w2.openDoor(...exitsOf(w2)[0])!)).toBe(b);
      expect(validateFoldRun(p, w.run())).toEqual([]);
    }
    expect([...got].sort()).toEqual(['basement', 'khrush']);
  });

  it('хрущёвка: «Спуска в подвал» нет — выход с меткой хода ведёт в квартиру хрущёвки', () => {
    const w = story('спуск', { trAfter: 100000 });
    const seen = new Set<string>();
    for (let k = 0; k < 40; k++) {
      const ex = exitsOf(w)[0];
      if (!ex) break;
      const id = w.openDoor(...ex);
      if (id) seen.add(biomeOf(w, id)!);
    }
    expect([...seen]).toEqual(['khrush']);
    for (const i of w.run().instances) expect(roomOf(w, i.id).tags, i.id).not.toContain('спуск');
  });

  it('погреб со своим выходом (хаб «Дверь в снег», ownExit): переходов по счётчику нет, descend из хаба — в снег', () => {
    // как будет у настоящего погреба: хаб сети со спец-локацией snowdoor, «только в биоме», метка id 'snowdoor' на стене
    const src = byId.get('bsm_hub_boiler')!;
    const hub: Room = {
      ...structuredClone(src), id: 'test_cellar_exit', name: 'Погреб: выход в снег (проверка)', tags: ['подвал', 'хаб', 'только-биом'],
      gen: { ...src.gen, weight: 5, max: 99 }, location: newSnowDoor(),
    };
    const k = hub.connectors.findIndex((c) => c.tag === 'basement');
    hub.connectors[k] = { ...hub.connectors[k], id: SNOWDOOR_CONN };
    const q: Project = { ...p, rooms: [...p.rooms, hub] };
    const qb = new Map(q.rooms.map((r) => [r.id, r]));
    const w = story('погреб-выход', { startBiome: 'cellar' }, q);
    expect(w.transitionState()).toBeTruthy();
    const seen = new Set<string>();
    const queue = [w.startId!];
    let exit: string | null = null;
    for (let s = 0; s < 3000 && queue.length && !exit; s++) {
      const id = queue.shift()!;
      if (seen.has(id)) continue;
      seen.add(id);
      w.enter(id);
      w.expand(id);
      for (const l of w.run().links) {
        if (l.kind || l.sealed) continue;
        if (l.a.inst === id) queue.push(l.b.inst);
        if (l.b.inst === id) queue.push(l.a.inst);
      }
      exit = w.run().instances.find((i) => i.roomId === 'test_cellar_exit')?.id ?? null;
    }
    expect(exit).toBeTruthy();
    // переход выпал, но в сети со своим выходом по счётчику не ставится
    expect(w.transitionState()!.pending).toBe(true);
    expect(w.run().instances.filter((i) => qb.get(i.roomId)!.location && i.roomId !== 'test_cellar_exit')).toEqual([]);
    expect(w.doorState(exit!, SNOWDOOR_CONN)).toBe('dead');
    const snow = w.descend(exit!);
    expect(biomeOf(w, snow)).toBe('snow');
    const b = createStreamWorld(q, w.settings, JSON.parse(JSON.stringify(w.save())));
    expect(b.stale).toBe(false);
    expect(b.descend(exit!)).toBe(snow);
    expect(validateFoldRun(q, w.run())).toEqual([]);
  });

  it('дверь в снег вне сюжета — тоже в снежные тоннели (если они есть в мире), как ворота ангара — в завод', () => {
    for (const seed of ['вне-1', 'вне-2', 'вне-3']) {
      // мир без сюжета, старт — вестибюль общаги; в сохранении он подменён дверью в снег общаги (без сюжета она сама не
      // встаёт — так встанет хаб-выход настоящего погреба)
      const w0 = createStreamWorld(p, streamSettings(seed, { world: { ...newWorldSettings(), startBiome: 'obshaga' } }));
      const sv = JSON.parse(JSON.stringify(w0.save())) as StreamSave;
      expect(sv.run.instances).toHaveLength(1);
      sv.run.instances[0].roomId = SNOWDOOR_OBSHAGA_ID;
      delete sv.rooms;
      const w = createStreamWorld(p, w0.settings, sv);
      expect(w.stale).toBe(false);
      expect(w.settings.world?.story).toBeUndefined();
      expect(w.locationOf(w.startId!)?.kind).toBe('snowdoor');
      expect(biomeOf(w, w.descend(w.startId!)), seed).toBe('snow');
    }
  });

  it('снег: переходов по счётчику нет; ангар → завод', () => {
    for (const seed of ['ангар-1', 'ангар-2', 'ангар-3', 'ангар-4']) {
      const w = story(seed, { startBiome: 'snow' });
      let thaw: string | null = null;
      try {
        thaw = seek(w, w.startId!, 'hangar', 'snow');
      } catch {
        continue;
      }
      expect(specials(w).size).toBe(0);
      const f = w.descend(thaw);
      expect(biomeOf(w, f)).toBe('factory');
      const sv = reload(w);
      expect(sv.stale).toBe(false);
      expect(sv.descend(thaw)).toBe(f);
      return;
    }
    throw new Error('подтаявшей берлоги не нашлось');
  });
});

describe('мир сюжета: сохранение и детерминизм', { timeout: 600000 }, () => {
  it('сохранение → загрузка после каждого вида перехода: не устарел, тот же мир, переходы — те же id', () => {
    const w = story('сохранение');
    const check = (label: string) => {
      const b = reload(w);
      expect(b.stale, `${label}: ${b.warnings.join(' ')}`).toBe(false);
      expect(same(b.run()), label).toEqual(same(w.run()));
      return b;
    };
    const stair = seek(w, w.startId!, 'stairwell', 'khrush');
    const ob = w.fall(stair);
    expect(check('срыв').fall(stair)).toBe(ob);
    const bsm = w.descend(stair);
    expect(check('лестница').descend(stair)).toBe(bsm);
    const lift = seek(w, bsm, 'lift', 'basement');
    const loc = w.locationOf(lift);
    if (loc?.kind !== 'lift') throw new Error('не лифт');
    const side = liftSide(w, lift, loc.roll.floors);
    const barn = w.ascend(lift, loc.roll.floors, side);
    expect(check('лифт').liftExitOf(lift, loc.roll.floors, side)).toBe(barn);
    const ob2 = w.fall(lift);
    expect(check('срыв из лифта').fall(lift)).toBe(ob2);
    const hatch = seek(w, barn, 'hatch', 'barn');
    const cellar = w.descend(hatch);
    expect(check('люк').descend(hatch)).toBe(cellar);
    const door = seek(w, cellar, 'snowdoor', 'cellar');
    const snow = w.descend(door);
    const b = check('дверь в снег');
    expect(b.descend(door)).toBe(snow);
    expect(b.doorState(door, SNOWDOOR_CONN)).toBe('dead');
    // загруженный мир продолжается так же, как живой
    const odoor = seek(w, ob, 'snowdoor', 'obshaga', new Set([door]));
    const odoorB = seek(b, ob, 'snowdoor', 'obshaga', new Set([door]));
    expect(odoorB).toBe(odoor);
    expect(b.descend(odoor)).toBe(w.descend(odoor));
    expect(same(b.run())).toEqual(same(w.run()));
    expect(validateFoldRun(p, w.run())).toEqual([]);
  });

  it('устаревание: у локации спуска убрали спец-локацию — сохранение отброшено (и для люка, и для срыва)', () => {
    const c = playChain('устарел');
    const sv = JSON.parse(JSON.stringify(c.w.save())) as StreamSave;
    for (const id of [HATCH_ID, 'stair_loop']) {
      const q: Project = { ...p, rooms: p.rooms.map((r) => (r.id === id ? { ...r, location: null } : r)) };
      const x = createStreamWorld(q, c.w.settings, sv);
      expect(x.stale, id).toBe(true);
    }
  });

  it('детерминизм: два мира с одной историей операций совпадают (кооп повторяет операции у всех)', () => {
    const a = playChain('дет'), b = playChain('дет');
    expect(strip(b.w.run())).toEqual(strip(a.w.run()));
    expect([b.stair, b.bsm, b.lift, b.barn, b.hatch, b.cellar, b.door, b.snow]).toEqual([a.stair, a.bsm, a.lift, a.barn, a.hatch, a.cellar, a.door, a.snow]);
    const fa = a.w.fall(a.lift), fb = b.w.fall(b.lift);
    expect(fb).toBe(fa);
    const noTime = (sv: StreamSave) => ({ ...sv, savedAt: 0, run: strip(sv.run) });
    expect(noTime(b.w.save())).toEqual(noTime(a.w.save()));
  });
});

describe('прогулка сюжета (src/view3d/walk.ts)', { timeout: 600000 }, () => {
  it('storyWalk, свой ключ сохранения (hasWalkSave, resetWalkSave), WalkSession.story, операция fall', () => {
    const g = globalThis as unknown as Record<string, unknown>;
    const was = g.localStorage;
    const store = new Map<string, string>();
    g.localStorage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, String(v)),
      removeItem: (k: string) => void store.delete(k),
    };
    try {
      const opts = storyWalk('ключ');
      expect(opts).toMatchObject({ seed: 'ключ', clusters: true, biome: null, story: true });
      const key = worldKey('ключ', ['квартиры', 'сюжет']);
      expect(hasWalkSave(p, opts)).toBe(false);
      store.set(key, '{}');
      store.set(key + '/player', '{}');
      store.set(worldKey('ключ', ['квартиры']), '{}');
      expect(hasWalkSave(p, opts)).toBe(true);
      // отладочная прогулка того же сида — свой ключ, сюжет его не трогает
      expect(hasWalkSave(p, { ...DEFAULT_WALK, seed: 'ключ', biome: 'snow' })).toBe(false);
      resetWalkSave(p, opts);
      expect(hasWalkSave(p, opts)).toBe(false);
      expect(store.has(key + '/player')).toBe(false);
      expect(store.has(worldKey('ключ', ['квартиры']))).toBe(true);
      expect(hasWalkSave(p, { ...DEFAULT_WALK, seed: 'ключ' })).toBe(true);
      // сессия сюжета: мир сюжета, ключ — свой; срыв — операция мира, повтор — та же комната
      const q: Project = { ...p, world: { ...p.world, trAfter: 0, trBase: 1, trStep: 0 } };
      const S = new WalkSession(q, opts);
      expect(S.story).toBe(true);
      expect(S.key).toBe(key);
      expect(S.world.settings.world?.story).toBe(true);
      expect(new WalkSession(q, { ...DEFAULT_WALK, seed: 'ключ' }, { save: null, opened: [], key: 'x' }).story).toBe(false);
      const stair = seek(S.world, S.world.startId!, 'stairwell', 'khrush');
      const ob = S.apply({ k: 'fall', id: stair });
      expect(ob).toBeTruthy();
      expect(S.apply({ k: 'fall', id: stair })).toBe(ob);
      expect(biomeOf(S.world, ob!)).toBe('obshaga');
      expect(S.apply({ k: 'fall', id: S.world.startId! })).toBeNull();
      S.saveNow();
      expect(hasWalkSave(q, opts)).toBe(true);
      // загрузка: мир сюжета из сохранения, срыв на месте
      const T = new WalkSession(q, opts);
      expect(T.world.stale).toBe(false);
      expect(T.apply({ k: 'fall', id: stair })).toBe(ob);
      S.dispose();
      T.dispose();
    } finally {
      g.localStorage = was;
    }
  });
});
