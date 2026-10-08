// Снежные тоннели бесконечного мира (docs/GENERATOR-4D.md §20): сеть лазов из своих комнат, вход — берлога-развилка,
// выход — подтаявшая берлога (спец-локация «Ангар», по правилу хабов), переходов по счётчику в снегу нет, обвал
// заваливает проём навсегда (и в сохранении), ворота ангара — этажами ниже: в завод, если он есть, иначе другой биом.
import { describe, expect, it } from 'vitest';
import { createDefaultProject } from '../data/presets';
import { BIOME_ONLY_TAG, generateRun } from '../gen/generate';
import type { Project, Run, WorldSettings } from '../model/types';
import { cloneBiome, newWorldSettings, tunnelKind } from './biomes';
import { createStreamWorld, streamSettings, type StreamWorld } from './stream';

const project = (): Project => {
  const p = createDefaultProject();
  p.finishes ??= [];
  p.finishRules ??= [];
  return p;
};
const p = project();
const roomOf = (run: Run, id: string) => p.rooms.find((r) => r.id === run.instances.find((i) => i.id === id)!.roomId)!;
const world = (o: Partial<WorldSettings> = {}): WorldSettings => ({ ...newWorldSettings(), ...o });
const snow = (seed: string, o: Partial<WorldSettings> = {}) =>
  createStreamWorld(p, streamSettings(seed, { world: world({ startBiome: 'snow', trAfter: 100000, ...o }) }));

/** «Проползти» мир: раскрыть экземпляры в ширину от from, пока комнат меньше n. */
function walk(w: StreamWorld, n: number, from = w.startId!): void {
  const seen = new Set<string>();
  const q = [from];
  while (q.length && w.run().instances.length < n) {
    const id = q.shift()!;
    if (seen.has(id)) continue;
    seen.add(id);
    w.expand(id);
    for (const l of w.run().links) {
      if (l.kind === 'descent' || l.kind === 'lift' || l.sealed) continue;
      if (l.a.inst === id && !seen.has(l.b.inst)) q.push(l.b.inst);
      if (l.b.inst === id && !seen.has(l.a.inst)) q.push(l.a.inst);
    }
  }
}
/** Ползти вглубь, как игрок: раскрыть кусок, дальше — в последний ещё не пройденный соседний (тупик — назад). */
function crawl(w: StreamWorld, n: number, from = w.startId!): void {
  const seen = new Set<string>();
  const stack = [from];
  while (stack.length && w.run().instances.length < n) {
    const id = stack[stack.length - 1];
    if (!seen.has(id)) {
      seen.add(id);
      w.expand(id);
    }
    const next = w.run().links
      .filter((l) => !l.kind && !l.sealed && (l.a.inst === id || l.b.inst === id))
      .map((l) => (l.a.inst === id ? l.b.inst : l.a.inst))
      .filter((x) => !seen.has(x));
    if (next.length) stack.push(next[next.length - 1]);
    else stack.pop();
  }
}
const thawOf = (w: StreamWorld) => w.run().instances.filter((i) => roomOf(w.run(), i.id).location?.kind === 'hangar');

describe('снежные тоннели: сеть лазов', { timeout: 300000 }, () => {
  it('комнаты: лазы 1.2 м (метка snow), берлоги, подтаявшая берлога — «Ангар»; только в биоме', () => {
    const rooms = p.rooms.filter((r) => r.tags[0] === 'снег');
    expect(rooms.length).toBeGreaterThanOrEqual(15);
    for (const r of rooms) {
      expect(r.tags, r.id).toContain(BIOME_ONLY_TAG);
      for (const c of r.connectors) expect(['snow', 'snow>den', 'den>snow'], r.id).toContain(c.tag);
      for (const c of r.connectors) expect(c.len, r.id).toBe(12);
      expect(tunnelKind(r), r.id).not.toBeNull();
    }
    const kinds = new Set(rooms.map((r) => tunnelKind(r)));
    for (const k of ['straight', 'turn', 'branch', 'storage', 'hub']) expect(kinds.has(k as never), k).toBe(true);
    const thaw = rooms.filter((r) => r.location);
    expect(thaw.map((r) => r.id)).toEqual(['snow_thaw']);
    expect(thaw[0].location?.kind).toBe('hangar');
    expect(tunnelKind(thaw[0])).toBe('hub');
    // горки и ямы — «вверх и вниз»
    expect(rooms.some((r) => r.tags.includes('горка'))).toBe(true);
    expect(rooms.some((r) => r.tags.includes('яма'))).toBe(true);
  });

  it('старт в снегу — берлога на три лаза (не подтаявшая); растут только комнаты снега; подтаявшая берлога — далеко от входа', () => {
    let found = 0;
    for (const seed of ['снег-1', 'снег-2', 'снег-3']) {
      const w = snow(seed);
      const start = roomOf(w.run(), w.startId!);
      expect(start.tags).toContain('берлога');
      expect(start.location).toBeFalsy();
      crawl(w, 420);
      const run = w.run();
      for (const i of run.instances) expect(roomOf(run, i.id).tags[0], i.id).toBe('снег');
      expect(w.clusterAt(w.startId!)?.tunnels).toBe(true);
      const t = thawOf(w);
      found += t.length;
      // по правилу хабов — не ближе 60 м ползком: глубина в дереве роста — не меньше ~12 кусков
      for (const i of t) expect(i.depth, `${seed} ${i.id}`).toBeGreaterThanOrEqual(12);
      // лазы ветвятся: развилок и поворотов много
      const k = run.instances.map((i) => tunnelKind(roomOf(run, i.id)));
      expect(k.filter((x) => x === 'branch').length / k.length).toBeGreaterThan(0.08);
      expect(k.filter((x) => x === 'turn').length / k.length).toBeGreaterThan(0.12);
    }
    expect(found).toBeGreaterThan(0);
  });

  it('переходы по счётчику в снегу не встают (выход — свой, подтаявший снег)', () => {
    const w = snow('снег-переход', { trAfter: 0, trBase: 1, trStep: 0 });
    for (let k = 0; k < 6; k++) {
      walk(w, 60 + k * 40);
      for (const i of w.run().instances) w.enter(i.id);
    }
    expect(w.transitionState()?.pending).toBe(true);
    for (const i of w.run().instances) {
      const loc = roomOf(w.run(), i.id).location?.kind;
      expect(loc === 'stairwell' || loc === 'lift', i.id).toBe(false);
      expect(roomOf(w.run(), i.id).tags[0]).toBe('снег');
    }
  });

  it('ангар: descend из подтаявшей берлоги — этажами ниже, другой биом, счётчик с нуля; с заводом — в его хаб', () => {
    const pick = (o: Partial<WorldSettings> = {}) => {
      for (const seed of ['ангар-1', 'ангар-2', 'ангар-3', 'ангар-4', 'ангар-5']) {
        const w = snow(seed, o);
        crawl(w, 500);
        const t = thawOf(w)[0];
        if (t) return { w, t };
      }
      throw new Error('нет подтаявшей берлоги');
    };
    const { w, t } = pick();
    const L = w.locationOf(t.id);
    expect(L?.kind).toBe('hangar');
    const k = L!.kind === 'hangar' ? L!.roll.floorsDown : 0;
    expect(k).toBeGreaterThanOrEqual(2);
    const r0 = w.transitionState()!.resets;
    const exit = w.descend(t.id);
    expect(w.descend(t.id)).toBe(exit);
    const run = w.run();
    const ei = run.instances.find((i) => i.id === exit)!;
    expect(ei.floor ?? 0).toBe((t.floor ?? 0) - k);
    expect(w.clusterAt(exit)?.biome?.id).not.toBe('snow');
    expect(w.transitionState()!.resets).toBe(r0 + 1);
    expect(run.links.some((l) => l.kind === 'descent' && l.a.inst === t.id && l.b.inst === exit)).toBe(true);
    // в мире есть «Завод» (здесь — подвал под id factory): ворота ведут в его хаб
    const fac = cloneBiome(newWorldSettings().biomes.find((b) => b.id === 'basement')!);
    fac.id = 'factory';
    fac.name = 'Завод (проверка)';
    const base = newWorldSettings();
    const g = pick({ biomes: [...base.biomes, fac] });
    const ex2 = g.w.descend(g.t.id);
    expect(g.w.clusterAt(ex2)?.biome?.id).toBe('factory');
    expect(tunnelKind(roomOf(g.w.run(), ex2))).toBe('hub');
  });

  it('обвал: проём завален навсегда (обе метки), сохранение → загрузка; несвязанную метку не завалить', () => {
    const w = snow('обвал');
    walk(w, 80);
    const run = w.run();
    const l = run.links.find((x) => !x.kind || x.kind === 'door')!;
    expect(w.doorState(l.a.inst, l.a.connector)).toBe('linked');
    expect(w.collapse(l.a.inst, l.a.connector)).toBe(true);
    expect(w.doorState(l.a.inst, l.a.connector)).toBe('collapsed');
    expect(w.doorState(l.b.inst, l.b.connector)).toBe('collapsed');
    expect(w.run().links.some((x) => x.a.inst === l.a.inst && x.a.connector === l.a.connector && x.sealed)).toBe(true);
    const sv = w.save();
    const w2 = createStreamWorld(p, w.settings, sv);
    expect(w2.stale).toBe(false);
    expect(w2.doorState(l.b.inst, l.b.connector)).toBe('collapsed');
    // нераскрытая (не связанная) метка — нечего заваливать
    const free = run.instances.flatMap((i) => roomOf(run, i.id).connectors.filter((c) => w.doorState(i.id, c.id) === 'pending').map((c) => [i.id, c.id] as const))[0];
    if (free) expect(w.collapse(free[0], free[1])).toBe(false);
  });

  it('снега нет вне биомов: прежняя прогулка и прогоны', () => {
    const legacy = createStreamWorld(p, streamSettings('снег-вне', { world: null }));
    walk(legacy, 150);
    for (const i of legacy.run().instances) expect(roomOf(legacy.run(), i.id).tags[0]).not.toBe('снег');
    const run = generateRun(p, { ...p.generator, seed: 'снег-прогон', count: 120 });
    for (const i of run.instances) expect(p.rooms.find((r) => r.id === i.roomId)!.tags[0]).not.toBe('снег');
  });
});
