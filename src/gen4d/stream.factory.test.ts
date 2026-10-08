// Завод бесконечного мира (docs/GENERATOR-4D.md §21): сеть цехов из своих комнат, влажность кусков, «иди туда, где
// влажнее» — болото и комната-финал «Лестница на крышу» (спец-локация 'swamp').
import { describe, expect, it } from 'vitest';
import { createDefaultProject } from '../data/presets';
import { BIOME_ONLY_TAG } from '../gen/generate';
import type { Project, Run, WorldSettings } from '../model/types';
import { newWorldSettings, tunnelKind } from './biomes';
import { createStreamWorld, streamSettings, type StreamWorld } from './stream';
import { DEFAULT_WET, WET_TAGS, wetLevel } from './wet';

const p: Project = createDefaultProject();
const roomOf = (run: Run, id: string) => p.rooms.find((r) => r.id === run.instances.find((i) => i.id === id)!.roomId)!;
const world = (o: Partial<WorldSettings> = {}): WorldSettings => ({ ...newWorldSettings(), ...o });
const factory = (seed: string, o: Partial<WorldSettings> = {}) =>
  createStreamWorld(p, streamSettings(seed, { world: world({ startBiome: 'factory', trAfter: 100000, ...o }) }));

/** Соседи по проёмам (без переходов-связей). */
function neighbors(w: StreamWorld, id: string): string[] {
  const out: string[] = [];
  for (const l of w.run().links) {
    if (l.kind === 'descent' || l.kind === 'lift' || l.sealed) continue;
    if (l.a.inst === id) out.push(l.b.inst);
    if (l.b.inst === id) out.push(l.a.inst);
  }
  return out;
}

/** «Пройти» мир: раскрыть экземпляры в ширину от старта, пока комнат меньше n. */
function walk(w: StreamWorld, n: number): void {
  const seen = new Set<string>();
  const q = [w.startId!];
  while (q.length && w.run().instances.length < n) {
    const id = q.shift()!;
    if (seen.has(id)) continue;
    seen.add(id);
    w.expand(id);
    for (const nb of neighbors(w, id)) if (!seen.has(nb)) q.push(nb);
  }
}

/** Идти жадно: из текущего куска — в ещё не пройденный соседний, где влажнее (wetter) или суше. Путь до болота. */
function follow(w: StreamWorld, wetter: boolean, steps: number): { path: string[]; swamp: string | null } {
  const path = [w.startId!];
  const seen = new Set(path);
  for (let k = 0; k < steps; k++) {
    const cur = path[path.length - 1];
    if (w.locationOf(cur)?.kind === 'swamp') return { path, swamp: cur };
    w.expand(cur);
    const next = neighbors(w, cur).filter((x) => !seen.has(x) && (w.wetAt(x) || w.locationOf(x)?.kind === 'swamp'));
    if (!next.length) break;
    const val = (x: string) => (w.locationOf(x)?.kind === 'swamp' ? 2 : w.wetAt(x)!.w);
    next.sort((a, b) => (wetter ? val(b) - val(a) : val(a) - val(b)));
    path.push(next[0]);
    seen.add(next[0]);
  }
  const last = path[path.length - 1];
  return { path, swamp: w.locationOf(last)?.kind === 'swamp' ? last : null };
}

describe('завод: сеть цехов', { timeout: 300000 }, () => {
  it('комнаты: каждая ступень влажности — прямые, повороты, развилки, хаб; проходы 2 м; только в биоме', () => {
    const fac = p.rooms.filter((r) => r.tags[0] === 'завод');
    expect(fac.length).toBeGreaterThanOrEqual(30);
    for (const r of fac) expect(r.tags, r.id).toContain(BIOME_ONLY_TAG);
    for (const tag of WET_TAGS) {
      const lv = fac.filter((r) => r.tags.includes(tag) && !r.location);
      const kinds = new Set(lv.map((r) => tunnelKind(r)));
      for (const k of ['straight', 'turn', 'branch', 'hub'] as const) expect(kinds.has(k), `${tag}: ${k}`).toBe(true);
    }
    for (const r of fac) for (const c of r.connectors) expect([c.tag, c.len], `${r.id}/${c.id}`).toEqual(['factory', 20]);
    // финал — одна комната, спец-локация «Болото на крыше», с топью
    const fin = p.rooms.filter((r) => r.location?.kind === 'swamp');
    expect(fin.map((r) => r.id)).toEqual(['fac_swamp_roof']);
    expect(fin[0].tags).toContain('топь');
    // всё крутится: в машинном цеху и в пролётах — шестерни, маховики, валы, конвейеры (споты с розыгрышем)
    const spun = new Set(['p_fac_gear_large', 'p_fac_gear_small', 'p_fac_gear_pair', 'p_fac_flywheel', 'p_fac_shaft', 'p_fac_conveyor', 'p_fac_fan']);
    const dry = fac.filter((r) => r.tags.includes('сухо') && r.tags.includes('ход') && r.spots.length > 4);
    for (const r of dry) {
      const props = r.spotGroups.flatMap((g) => g.variants.flatMap((v) => Object.values(v.assign).filter((a) => a.kind === 'prop').map((a) => a.id)));
      expect(props.some((id) => spun.has(id)), r.id).toBe(true);
    }
  });

  it('старт в заводе — сухой цех-хаб, влажность 0, ход становится влажнее', () => {
    const w = factory('сухо');
    const s = w.startId!;
    const r = roomOf(w.run(), s);
    expect(r.tags).toContain('хаб');
    expect(r.tags).toContain('сухо');
    expect(w.wetAt(s)).toEqual({ w: 0, dir: 1, level: 0 });
    expect(w.clusterAt(s)?.biome?.id).toBe('factory');
    expect(w.clusterAt(s)?.biome?.wet).toEqual(DEFAULT_WET);
  });

  it('правило влажности: ступень куска — по его влажности; на развилке один выход мокрее, остальные суше', () => {
    for (const seed of ['цех-1', 'цех-2', 'цех-3']) {
      const w = factory(seed);
      walk(w, 220);
      const run = w.run();
      let forks = 0;
      for (const i of run.instances) {
        const wi = w.wetAt(i.id);
        if (!wi) continue;
        const r = roomOf(run, i.id);
        if (r.location?.kind === 'swamp') {
          expect(wi.w).toBe(1);
          continue;
        }
        // ступень: тег комнаты совпадает с влажностью (пул ступени есть всегда)
        expect(r.tags, `${seed} ${i.id} w=${wi.w}`).toContain(WET_TAGS[wetLevel(Math.min(wi.w, 0.999))]);
        expect(wi.w).toBeGreaterThanOrEqual(0);
        expect(wi.w).toBeLessThanOrEqual(1);
      }
      // развилки: среди детей куска (родитель ребёнка — другой конец его первой связи: связи — в порядке постановки)
      // «мокрый» (влажность = своя + fork, у болота — 1) — не больше одного, остальные суше
      const parent = new Map<string, string>();
      for (const l of run.links) {
        if (l.kind === 'descent' || l.kind === 'lift') continue;
        if (!parent.has(l.b.inst) && l.a.inst !== run.instances[0].id + '#') parent.set(l.b.inst, l.a.inst);
      }
      for (const i of run.instances) {
        const wi = w.wetAt(i.id);
        if (!wi) continue;
        const kids = run.instances.filter((x) => parent.get(x.id) === i.id && w.wetAt(x.id));
        const up = kids.filter((x) => {
          const k = w.wetAt(x.id)!;
          return Math.abs(k.w - Math.min(1, wi.w + DEFAULT_WET.fork)) < 1e-9 && k.dir === 1;
        });
        if (kids.length >= 2) {
          forks++;
          expect(up.length, `${seed} ${i.id}`).toBeLessThanOrEqual(1);
          for (const x of kids) if (!up.includes(x)) expect(w.wetAt(x.id)!.w, `${seed} ${x.id}`).toBeLessThan(wi.w + 1e-9);
        }
      }
      expect(forks).toBeGreaterThan(0);
    }
  });

  it('иди туда, где влажнее: дошёл до болота — комната-финал (спец-локация swamp)', () => {
    const lens: number[] = [];
    for (const seed of ['болото-1', 'болото-2', 'болото-3', 'болото-4', 'болото-5']) {
      const w = factory(seed);
      const { path, swamp } = follow(w, true, 200);
      expect(swamp, `${seed}: путь ${path.length} кусков, влажность ${path.map((x) => w.wetAt(x)?.w.toFixed(2)).join(' ')}`).not.toBeNull();
      lens.push(path.length);
      // влажность по мокрому пути не убывает
      const ws = path.map((x) => w.wetAt(x)!.w);
      for (let k = 1; k < ws.length; k++) expect(ws[k]).toBeGreaterThanOrEqual(ws[k - 1] - 1e-9);
      const L = w.locationOf(swamp!);
      expect(L?.kind).toBe('swamp');
      if (L?.kind === 'swamp') expect(L.roll.unit).toBeGreaterThanOrEqual(10000);
      expect(roomOf(w.run(), swamp!).id).toBe('fac_swamp_roof');
    }
    // путь — десятки кусков, не сотни
    expect(Math.max(...lens)).toBeLessThan(80);
    expect(Math.min(...lens)).toBeGreaterThan(5);
  });

  it('туда, где суше: болота нет, остаёшься в сухих цехах', () => {
    for (const seed of ['сухо-1', 'сухо-2']) {
      const w = factory(seed);
      const { path, swamp } = follow(w, false, 60);
      expect(swamp).toBeNull();
      expect(Math.max(...path.map((x) => w.wetAt(x)!.w))).toBeLessThan(0.4);
    }
  });

  it('сохранение → загрузка: влажность кусков та же, рост дальше — тот же', () => {
    const a = factory('сохр');
    walk(a, 120);
    const save = JSON.parse(JSON.stringify(a.save()));
    expect(Array.isArray(save.world.twet)).toBe(true);
    const b = createStreamWorld(p, save.settings, save);
    expect(b.stale).toBe(false);
    for (const i of a.run().instances) expect(b.wetAt(i.id), i.id).toEqual(a.wetAt(i.id));
    // дальше — одинаково
    walk(a, 200);
    walk(b, 200);
    expect(b.run().instances.map((i) => [i.id, i.roomId, b.wetAt(i.id)?.w])).toEqual(a.run().instances.map((i) => [i.id, i.roomId, a.wetAt(i.id)?.w]));
  });

  it('вне завода влажности нет; финала нет ни в прежней прогулке, ни в других биомах', () => {
    const legacy = createStreamWorld(p, streamSettings('без-биомов'));
    walk(legacy, 200);
    expect(legacy.run().instances.some((i) => i.id && legacy.wetAt(i.id))).toBe(false);
    expect(legacy.run().instances.some((i) => roomOf(legacy.run(), i.id).tags[0] === 'завод')).toBe(false);
    const khr = createStreamWorld(p, streamSettings('хрущ', { world: world({ trAfter: 100000 }) }));
    walk(khr, 150);
    expect(khr.run().instances.some((i) => khr.wetAt(i.id))).toBe(false);
  });
});
