// Переход (спец-комната: лестница, лифт…) не встаёт за проёмом ниже человеческого роста — лазом, куда только ползком
// (катакомбы: cat_duct 0.8×0.8 м; высота проёма — по метке, TAG_OPEN_H).
import { describe, expect, it } from 'vitest';
import { createDefaultProject } from '../data/presets';
import { TAG_OPEN_H } from '../data/roomBuilder';
import type { Project, Run, WorldSettings } from '../model/types';
import { newWorldSettings } from './biomes';
import { createStreamWorld, streamSettings, type StreamWorld } from './stream';

const project = (): Project => {
  const p = createDefaultProject();
  p.finishes ??= [];
  p.finishRules ??= [];
  return p;
};
const p = project();
const byId = new Map(p.rooms.map((r) => [r.id, r]));
const roomOf = (run: Run, id: string) => byId.get(run.instances.find((i) => i.id === id)!.roomId)!;
const world = (o: Partial<WorldSettings> = {}): WorldSettings => ({ ...newWorldSettings(), ...o });
const hasCatacombs = newWorldSettings().biomes.some((b) => b.id === 'catacombs');

/** «Пройти» мир: раскрыть экземпляры в ширину от старта, пока комнат меньше n; войти во все (счётчик переходов). */
function walk(w: StreamWorld, n: number): void {
  const seen = new Set<string>();
  const q = [w.startId!];
  while (q.length && w.run().instances.length < n) {
    const id = q.shift()!;
    if (seen.has(id)) continue;
    seen.add(id);
    w.expand(id);
    w.enter(id);
    for (const l of w.run().links) {
      if (l.kind === 'descent' || l.kind === 'lift') continue;
      if (l.a.inst === id && !seen.has(l.b.inst)) q.push(l.b.inst);
      if (l.b.inst === id && !seen.has(l.a.inst)) q.push(l.a.inst);
    }
  }
}

describe('переход не встаёт за низким проёмом (лазом)', () => {
  it.runIf(hasCatacombs)('катакомбы: спец-комнаты перехода — только за проходами в рост, не за лазом cat_duct', () => {
    expect(TAG_OPEN_H.cat_duct).toBeLessThan(1.8);
    let specials = 0;
    for (const seed of ['d1', 'd2', 'd3', 'd4', 'd5', 'd6', 'd7', 'd8']) {
      const w = createStreamWorld(p, streamSettings(seed, {
        world: world({ startBiome: 'catacombs', trAfter: 0, trBase: 1, trStep: 0, trLanding: 0 }),
      }));
      walk(w, 120);
      const run = w.run();
      for (const l of run.links) {
        if (l.kind) continue;
        for (const [me, other] of [[l.a, l.b], [l.b, l.a]] as const) {
          if (!roomOf(run, me.inst).location) continue;
          specials++;
          const tag = roomOf(run, other.inst).connectors.find((c) => c.id === other.connector)!.tag;
          expect(TAG_OPEN_H[tag] ?? Infinity, `${seed}: ${roomOf(run, me.inst).id} за меткой ${tag}`).toBeGreaterThanOrEqual(1.8);
        }
      }
    }
    expect(specials).toBeGreaterThanOrEqual(1);
  }, 600000);
});
