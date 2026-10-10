// Катакомбы (docs/GENERATOR-4D.md, раздел «Катакомбы»): сеть ходов трёх эпох (имперские, советские, смешанные), лазы
// 0.8×0.8, трубы поперёк хода, насосные станции и залы-убежища с сухой площадкой на +2.1, боковые ниши-убежища; у
// каждого хаба и ниши — сухое место выше пика наводнения, до ближайшего сухого места недалеко.
import { describe, expect, it } from 'vitest';
import { createDefaultProject } from '../data/presets';
import { TAG_LEN } from '../data/roomBuilder';
import { BIOME_ONLY_TAG, generateRun } from '../gen/generate';
import { doorStyleFor } from '../blockout/doors';
import { parseKey } from '../model/cells';
import { connDz, stairIssues } from '../model/stairs';
import type { Project, Room, Run, WorldSettings } from '../model/types';
import { biomeMul, newWorldSettings, tunnelKind } from './biomes';
import { validateFoldRun } from './fold';
import { roomSightM } from './space';
import { createStreamWorld, streamSettings, type StreamSave, type StreamWorld } from './stream';

const project = (): Project => {
  const p = createDefaultProject();
  p.finishes ??= [];
  p.finishRules ??= [];
  return p;
};
const p = project();
const byId = new Map(p.rooms.map((r) => [r.id, r]));
const propById = new Map(p.props.map((x) => [x.id, x]));
const roomOf = (run: Run, id: string) => byId.get(run.instances.find((i) => i.id === id)!.roomId)!;
const world = (o: Partial<WorldSettings> = {}): WorldSettings => ({ ...newWorldSettings(), ...o });
const cat = (seed: string, o: Partial<WorldSettings> = {}) =>
  createStreamWorld(p, streamSettings(seed, { world: world({ startBiome: 'catacombs', trAfter: 100000, ...o }) }));
const tun = (o: Partial<WorldSettings['tunnels']>) => ({ ...newWorldSettings().biomes.find((b) => b.id === 'catacombs')!.tunnels, ...o });
const has = (r: Room, t: string) => r.tags.includes(t);
const OWN = p.rooms.filter((r) => r.tags[0] === 'катакомбы');
const ERAS = ['имперский', 'советский', 'смешанный'];
/** пик воды 2.0 м — сухо от +2.1 */
const DRY_Z = 2.1;

/** Самая высокая площадка комнаты, м (0 — без лестницы). */
const padZ = (r: Room) => Math.max(0, ...(r.stair?.pads ?? []).map((x) => x.z));
/** Комната с сухим местом: площадка на ≥ +2.1. */
const dry = (r: Room) => padZ(r) >= DRY_Z - 1e-9;
/** Габарит комнаты по осям, м. */
function extent(r: Room): [number, number] {
  const pts = [...r.cells].map(parseKey);
  const xs = pts.map(([x]) => x), ys = pts.map(([, y]) => y);
  return [(Math.max(...xs) - Math.min(...xs) + 1) * p.settings.cellM, (Math.max(...ys) - Math.min(...ys) + 1) * p.settings.cellM];
}
const lenM = (r: Room) => Math.max(...extent(r));

/** «Пройти» мир: раскрыть экземпляры в ширину от from, пока комнат меньше n. */
function walk(w: StreamWorld, n: number, from = w.startId!): void {
  const seen = new Set<string>();
  const q = [from];
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

/** Связи проёмов экземпляра: [сосед, своя метка, метка соседа]. */
function nbs(run: Run, id: string): [string, string, string][] {
  const out: [string, string, string][] = [];
  for (const l of run.links) {
    if (l.kind) continue;
    if (l.a.inst === id) out.push([l.b.inst, l.a.connector, l.b.connector]);
    else if (l.b.inst === id) out.push([l.a.inst, l.b.connector, l.a.connector]);
  }
  return out;
}

/** Путь по сети от каждой комнаты до ближайшей комнаты с сухим местом, м (Дейкстра: ребро — полсуммы длин кусков). */
function dryDist(run: Run): Map<string, number> {
  const d = new Map<string, number>();
  const q: [number, string][] = [];
  for (const i of run.instances) if (dry(roomOf(run, i.id))) {
    d.set(i.id, 0);
    q.push([0, i.id]);
  }
  while (q.length) {
    q.sort((a, b) => a[0] - b[0]);
    const [k, id] = q.shift()!;
    if (k > (d.get(id) ?? Infinity)) continue;
    for (const [o] of nbs(run, id)) {
      const v = k + (lenM(roomOf(run, id)) + lenM(roomOf(run, o))) / 2;
      if (v < (d.get(o) ?? Infinity)) {
        d.set(o, v);
        q.push([v, o]);
      }
    }
  }
  return d;
}

describe('катакомбы: комнаты', () => {
  it('ходы трёх эпох: прямые 1–9 м, поворот, тройник, крестовина; проходы 2.0 м; только в биоме, обзор ≤ 9 м', () => {
    expect(OWN.length).toBeGreaterThanOrEqual(40);
    for (const r of OWN) {
      expect(r.tags, r.id).toContain(BIOME_ONLY_TAG);
      expect(r.id.startsWith('cat_'), r.id).toBe(true);
      expect(roomSightM(r, p.settings.cellM), r.id).toBeLessThanOrEqual(9 + 1e-9);
      expect(r.location ?? null, r.id).toBeNull();
      for (const c of r.connectors) {
        expect(['catacombs', 'cat_duct', 'catacombs>refuge', 'refuge>catacombs', 'stair'], r.id).toContain(c.tag);
        expect(c.len, `${r.id} ${c.tag}`).toBe(TAG_LEN[c.tag as keyof typeof TAG_LEN]);
      }
    }
    expect(TAG_LEN.catacombs).toBe(20);
    expect(TAG_LEN.cat_duct).toBe(8);
    for (const era of ERAS) {
      const list = OWN.filter((r) => r.tags[1] === era);
      const kinds = new Set(list.map((r) => tunnelKind(r)));
      for (const k of ['straight', 'turn', 'branch'] as const) expect(kinds.has(k), `${era}: ${k}`).toBe(true);
      // свой потолок: имперский свод 3.0, советский 2.6, смешанный — тот или другой
      for (const r of list) expect(r.ceilM, r.id).toBeGreaterThanOrEqual(2.6);
    }
    // прямые всех длин (вставки 1 и 2 м — для колец), самая длинная — 9 м
    const lens = new Set(OWN.filter((r) => tunnelKind(r) === 'straight' && has(r, 'ход') && !has(r, 'лаз') && !has(r, 'устье')).map((r) => extent(r)[1]));
    for (const L of [1, 2, 4, 6, 8, 9]) expect(lens.has(L), `${L} м`).toBe(true);
    // имперские прямые — под сводом во всю длину (вкладыши 1 и 2 м), потолок 3.0
    for (const r of OWN.filter((x) => has(x, 'имперский') && tunnelKind(x) === 'straight' && !has(x, 'устье'))) {
      const v = r.decor.reduce((s, d) => s + (d.propId === 'p_cat_vault_2' ? 2 : d.propId === 'p_cat_vault_1' ? 1 : 0), 0);
      expect(v, r.id).toBeCloseTo(extent(r)[1], 9);
      expect(r.ceilM, r.id).toBe(3);
    }
    for (const r of OWN.filter((x) => has(x, 'советский') && has(x, 'ход'))) expect(r.ceilM, r.id).toBe(2.6);
    // советские — кабели, разбитые плафоны, щиты; смешанные — завалы штукатурки
    const props = (era: string) => new Set(OWN.filter((r) => has(r, era)).flatMap((r) => r.decor.map((d) => d.propId)));
    expect([...props('советский')]).toEqual(expect.arrayContaining(['p_cat_cables', 'p_cat_lamp_dead', 'p_cat_box', 'p_cat_sign', 'p_cat_hermo', 'p_cat_gate']));
    expect([...props('смешанный')]).toEqual(expect.arrayContaining(['p_cat_rubble']));
    expect([...props('имперский')]).toEqual(expect.arrayContaining(['p_cat_mark', 'p_cat_pipe_wall']));
    // света нет ни одного (только фонарь игрока)
    for (const r of OWN) for (const d of r.decor) expect(propById.get(d.propId)!.tags, `${r.id} ${d.propId}`).not.toContain('свет');
  });

  it('трубы поперёк хода: низкая и средняя — перелезть (тег «перелаз»), высокая — пригнуться; куски-препятствия разных эпох', () => {
    const obst = OWN.filter((r) => has(r, 'препятствие'));
    expect(new Set(obst.map((r) => r.tags[1])).size).toBeGreaterThanOrEqual(3);
    const pipes = new Set(obst.flatMap((r) => r.decor.map((d) => d.propId)).filter((id) => /^p_cat_pipe_(low|mid|high)$/.test(id)));
    expect([...pipes].sort()).toEqual(['p_cat_pipe_high', 'p_cat_pipe_low', 'p_cat_pipe_mid']);
    for (const id of ['p_cat_pipe_low', 'p_cat_pipe_mid']) expect(propById.get(id)!.tags, id).toContain('перелаз');
    for (const r of obst) {
      expect(tunnelKind(r), r.id).toBe('straight');
      // труба — во всю ширину хода, посередине куска (не у проёмов)
      for (const d of r.decor.filter((x) => /^p_cat_pipe_(low|mid|high)$/.test(x.propId))) {
        expect(propById.get(d.propId)!.w, d.propId).toBeCloseTo(2, 1);
        expect(d.y * p.settings.cellM, r.id).toBeGreaterThan(1);
        expect(d.y * p.settings.cellM, r.id).toBeLessThan(extent(r)[1] - 1);
      }
    }
  });

  it('лазы 0.8×0.8 (потолок 0.85): прямые 1/2/4 м и поворот; устья — ход 2.0 с одной стороны, лаз с другой', () => {
    const ducts = OWN.filter((r) => has(r, 'лаз'));
    expect(ducts.length).toBeGreaterThanOrEqual(4);
    for (const r of ducts) {
      expect(Math.min(...extent(r)), r.id).toBeCloseTo(0.8, 9);
      expect(r.ceilM, r.id).toBeCloseTo(0.85, 9);
      expect(r.connectors.every((c) => c.tag === 'cat_duct' && c.len === 8), r.id).toBe(true);
      expect(['straight', 'turn'], r.id).toContain(tunnelKind(r));
    }
    expect(new Set(ducts.filter((r) => tunnelKind(r) === 'straight').map((r) => extent(r)[1]))).toEqual(new Set([1, 2, 4]));
    expect(ducts.some((r) => tunnelKind(r) === 'turn')).toBe(true);
    const mouths = OWN.filter((r) => has(r, 'устье'));
    expect(mouths.length).toBeGreaterThanOrEqual(2);
    for (const r of mouths) {
      expect(r.connectors.map((c) => c.tag).sort(), r.id).toEqual(['cat_duct', 'catacombs']);
      expect(tunnelKind(r), r.id).toBe('straight');
    }
  });

  it('хабы — станции и зал-убежище: 3–4 хода, марш наверх, у каждого сухая площадка на +2.1; ниши-убежища тоже', () => {
    const hubs = OWN.filter((r) => tunnelKind(r) === 'hub');
    expect(hubs.length).toBeGreaterThanOrEqual(3);
    expect(hubs.some((r) => has(r, 'станция'))).toBe(true);
    expect(hubs.some((r) => has(r, 'убежище'))).toBe(true);
    for (const r of hubs) {
      const passes = r.connectors.filter((c) => c.tag === 'catacombs').length;
      expect(passes, r.id).toBeGreaterThanOrEqual(3);
      expect(passes, r.id).toBeLessThanOrEqual(4);
      expect(r.connectors.filter((c) => c.tag === 'stair'), r.id).toHaveLength(1);
      // хаб — 9 м в длину и не шире 6.3 (диагональ 45° ≤ 9 м)
      const [a, b] = extent(r);
      expect(Math.min(a, b), r.id).toBeLessThanOrEqual(6.3 + 1e-9);
    }
    expect(hubs.some((r) => r.connectors.filter((c) => c.tag === 'catacombs').length === 4)).toBe(true);
    // станции: колонны, насос, задвижка, пульт, барабан
    const st = new Set(hubs.filter((r) => has(r, 'станция')).flatMap((r) => r.decor.map((d) => d.propId)));
    expect([...st]).toEqual(expect.arrayContaining(['p_cat_pump', 'p_cat_valve', 'p_cat_panel', 'p_cat_drum']));
    expect([...st].some((id) => id.startsWith('p_cat_column_'))).toBe(true);
    // ниши-убежища: одна дверь к ходу, 2×3–2×4 м
    const niches = OWN.filter((r) => tunnelKind(r) === 'storage');
    expect(niches.length).toBeGreaterThanOrEqual(2);
    for (const r of niches) {
      expect(r.connectors.map((c) => c.tag), r.id).toEqual(['refuge>catacombs']);
      expect(has(r, 'убежище'), r.id).toBe(true);
      const [a, b] = extent(r).sort((x, y) => x - y);
      expect(a, r.id).toBeCloseTo(2, 9);
      expect(b, r.id).toBeGreaterThanOrEqual(3);
      expect(b, r.id).toBeLessThanOrEqual(4);
    }
    // сухое место: у каждого хаба и убежища — лестница на площадку ≥ +2.1, описание лестницы верно, все проёмы — на
    // полу сети (площадка меток не касается: мир не поднимается)
    for (const r of [...hubs, ...OWN.filter((x) => has(x, 'убежище'))]) {
      expect(stairIssues(r), r.id).toEqual([]);
      expect(padZ(r), r.id).toBeGreaterThanOrEqual(DRY_Z);
      expect(r.stair!.flights.length, r.id).toBeGreaterThanOrEqual(1);
      r.connectors.forEach((c, ci) => expect(connDz(r, ci), `${r.id} ${c.name}`).toBe(0));
    }
    // в убежищах — матрас или лавка, огарки; на площадке
    for (const r of OWN.filter((x) => has(x, 'убежище'))) {
      const ids = r.decor.map((d) => d.propId);
      expect(ids.some((id) => id === 'p_cat_mattress' || id === 'p_cat_bench'), r.id).toBe(true);
      expect(ids, r.id).toContain('p_cat_candles');
    }
    // у остальных комнат лестниц нет — все проходы сети на одной высоте
    for (const r of OWN) if (!dry(r)) expect(r.stair ?? null, r.id).toBeNull();
  });

  it('двери: закрытый ход — закладка кирпичом или бетоном, лаз — ржавая решётка, ниша — кирпич; проходы без полотна', () => {
    const T = ['катакомбы', 'имперский', 'ход'];
    const ids = new Set(Array.from({ length: 40 }, (_, i) => doorStyleFor('catacombs', T, true, `i${i}/c`)!.id));
    expect([...ids].sort()).toEqual(['cat_bricked', 'cat_concrete']);
    expect(doorStyleFor('cat_duct', ['катакомбы', 'лаз', 'ход'], true, 'a/b')?.id).toBe('cat_grate');
    expect(doorStyleFor('catacombs>refuge', T, true, 'a/b')?.id).toBe('cat_bricked');
    expect(doorStyleFor('refuge>catacombs', ['катакомбы', 'убежище'], true, 'a/b')?.id).toBe('cat_bricked');
    expect(doorStyleFor('stair', ['катакомбы', 'станция', 'советский', 'хаб'], true, 'a/b')?.id).toBe('basement_metal');
    for (const tag of ['catacombs', 'cat_duct', 'catacombs>refuge', 'refuge>catacombs']) expect(doorStyleFor(tag, T, false, 'a/b'), tag).toBeNull();
  });

  it('только в биоме «Катакомбы»: в другие биомы не попадает, чужие комнаты в катакомбах не растут', () => {
    const bs = newWorldSettings().biomes;
    const cb = bs.find((b) => b.id === 'catacombs')!;
    expect(cb).toMatchObject({ layout: 'tunnels', dark: 1 });
    expect(cb.rich).toBeUndefined();
    expect(cb.wet).toBeUndefined();
    for (const r of OWN) expect(bs.filter((b) => biomeMul(b, r) > 0).map((b) => b.id), r.id).toEqual(['catacombs']);
    expect(p.rooms.filter((r) => r.tags[0] !== 'катакомбы' && biomeMul(cb, r) > 0)).toEqual([]);
    // отделка — по эпохе и виду (правила на сам тег 'катакомбы' нет — иначе он победил бы)
    const tags = (cb.finishRules ?? []).map((x) => x.tag);
    expect(tags).not.toContain('катакомбы');
    for (const t of [...ERAS, 'лаз', 'станция', 'убежище']) expect(tags, t).toContain(t);
  });
});

describe('катакомбы: сеть', { timeout: 600000 }, () => {
  it('старт — хаб; растут только катакомбы: три эпохи, лазы, трубы, станции, убежища; все проходы на одной высоте', () => {
    const found = new Map<string, number>();
    const mark = (k: string) => found.set(k, (found.get(k) ?? 0) + 1);
    for (const seed of ['c1', 'c2', 'c3']) {
      const w = cat(seed);
      const start = roomOf(w.run(), w.startId!);
      expect(tunnelKind(start), seed).toBe('hub');
      expect(w.clusterAt(w.startId!)).toMatchObject({ tunnels: true, biome: { id: 'catacombs' } });
      const exit = start.connectors.find((c) => c.tag === 'stair')!;
      expect(w.doorState(w.startId!, exit.id)).toBe('exit');
      walk(w, 240);
      const run = w.run();
      expect(run.instances.length).toBeGreaterThanOrEqual(200);
      const rooms = run.instances.map((i) => roomOf(run, i.id));
      for (const r of rooms) expect(r.tags[0], r.id).toBe('катакомбы');
      for (const t of [...ERAS, 'лаз', 'устье', 'препятствие', 'станция', 'убежище']) if (rooms.some((r) => has(r, t))) mark(t);
      if (rooms.some((r) => tunnelKind(r) === 'storage')) mark('ниша');
      // ходы — основа сети, хабов — единицы на десяток кусков
      const n = (t: string) => rooms.filter((r) => has(r, t)).length;
      expect(n('ход')).toBeGreaterThan(n('хаб') * 5);
      // проёмы: ход — с ходом (2.0), лаз — с лазом (0.8), ниша — дверью 0.9
      for (const l of run.links) {
        if (l.kind) continue;
        const ca = roomOf(run, l.a.inst).connectors.find((c) => c.id === l.a.connector)!;
        const cb = roomOf(run, l.b.inst).connectors.find((c) => c.id === l.b.connector)!;
        expect(ca.len, `${ca.tag}–${cb.tag}`).toBe(cb.len);
        if (ca.tag === 'catacombs' || ca.tag === 'cat_duct') expect(cb.tag).toBe(ca.tag);
      }
      // все экземпляры — на высоте старта (площадки убежищ меток не касаются)
      for (const i of run.instances) expect(i.z ?? 0, i.id).toBe(0);
      // отделка: имперские — кирпич, смешанные — облупленная облицовка, лазы — ил на дне
      for (const [k, i] of run.instances.entries()) {
        const r = roomOf(run, i.id), f = run.content[k].finish;
        if (r.tags[1] === 'имперский') expect(f.wall, i.roomId).toBe('f_cat_brick');
        if (r.tags[1] === 'смешанный') expect(f.wall, i.roomId).toBe('f_cat_peel');
        if (r.tags[1] === 'лаз') expect(f.floor, i.roomId).toBe('f_cat_silt');
      }
      expect(validateFoldRun(p, run)).toEqual([]);
    }
    for (const t of [...ERAS, 'лаз', 'устье', 'препятствие', 'станция', 'убежище', 'ниша']) expect(found.get(t), t).toBeGreaterThanOrEqual(2);
  });

  it('сеть уходит в лаз и возвращается в ход: от устья по лазам — к другому устью', () => {
    let through = 0, mouths = 0;
    for (const seed of ['d1', 'd2', 'd3', 'd4']) {
      const w = cat(seed);
      walk(w, 260);
      const run = w.run();
      for (const i of run.instances) {
        const r = roomOf(run, i.id);
        if (!has(r, 'устье')) continue;
        mouths++;
        // от лаза устья — только по лазам; дошли до другого устья — вышли обратно в ход
        const ductC = r.connectors.find((c) => c.tag === 'cat_duct')!.id;
        const seen = new Set([i.id]);
        let q = nbs(run, i.id).filter(([, own]) => own === ductC).map(([o]) => o);
        let out = false;
        while (q.length && !out) {
          const next: string[] = [];
          for (const id of q) {
            if (seen.has(id)) continue;
            seen.add(id);
            const o = roomOf(run, id);
            if (has(o, 'устье')) {
              out = true;
              break;
            }
            expect(has(o, 'лаз'), `${seed} ${id}`).toBe(true);
            next.push(...nbs(run, id).map(([x]) => x));
          }
          q = next;
        }
        if (out) through++;
      }
      expect(validateFoldRun(p, run)).toEqual([]);
    }
    expect(mouths).toBeGreaterThanOrEqual(6);
    expect(through).toBeGreaterThanOrEqual(2);
  });

  it('правило выживания: от любой комнаты сети до ближайшего сухого места (площадка ≥ +2.1) — не дальше 60 м', () => {
    const all: number[] = [];
    for (const seed of ['s1', 's2', 's3', 's4', 's5']) {
      const w = cat(seed);
      walk(w, 220);
      const run = w.run();
      const d = dryDist(run);
      for (const i of run.instances) {
        const v = d.get(i.id);
        expect(v, `${seed} ${i.id} (${i.roomId})`).toBeDefined();
        all.push(v!);
      }
    }
    all.sort((a, b) => a - b);
    const at = (f: number) => all[Math.floor(f * (all.length - 1))];
    const msg = `комнат ${all.length}: медиана ${at(0.5).toFixed(1)} м, p90 ${at(0.9).toFixed(1)} м, макс ${at(1).toFixed(1)} м`;
    expect(at(1), msg).toBeLessThanOrEqual(60);
    expect(at(0.5), msg).toBeLessThanOrEqual(20);
  });

  it('кольца из хаба и бесконечные участки (если включить) — своей сетью, без лестниц; мир не ломается', () => {
    let rings = 0, wraps = 0;
    for (const seed of ['r1', 'r2', 'r3', 'r4']) {
      const w = cat(seed, { biomes: newWorldSettings().biomes.map((b) => (b.id === 'catacombs' ? { ...b, tunnels: tun({ ring: 1, loop: 0.3, loopMinDist: 4 }) } : b)) });
      walk(w, 180);
      const run = w.run();
      rings += w.stats().rings;
      wraps += w.stats().wraps;
      for (const l of run.links) {
        if (l.kind) continue;
        const ca = roomOf(run, l.a.inst).connectors.find((c) => c.id === l.a.connector)!;
        const cb = roomOf(run, l.b.inst).connectors.find((c) => c.id === l.b.connector)!;
        expect(ca.len).toBe(cb.len);
        if (l.wrap) for (const i of [l.a.inst, l.b.inst]) expect(roomOf(run, i).stair ?? null).toBeNull();
      }
      expect(validateFoldRun(p, run)).toEqual([]);
    }
    expect(rings).toBeGreaterThanOrEqual(2);
    expect(wraps).toBeGreaterThanOrEqual(1);
  });

  it('переход по счётчику: в ходах катакомб встаёт лифт (спец-комната перехода) — за проходом хода 2.0 м', () => {
    let lifts = 0, specials = 0;
    for (const seed of ['t1', 't2', 't3', 't4', 't5', 't6']) {
      const w = cat(seed, { trAfter: 0, trBase: 1, trStep: 0, trLanding: 0 });
      for (let k = 0; k < 4 && !lifts; k++) {
        walk(w, 40 + k * 30);
        for (const i of w.run().instances) w.enter(i.id);
      }
      const run = w.run();
      for (const i of run.instances) {
        const kind = roomOf(run, i.id).location?.kind;
        if (kind !== 'lift' && kind !== 'stairwell') continue;
        // спец-комната стоит за проходом сети катакомб
        const by = nbs(run, i.id).map(([o, , oc]) => [roomOf(run, o), oc] as const).filter(([o]) => o.tags[0] === 'катакомбы');
        expect(by.length, `${seed} ${i.id}`).toBeGreaterThanOrEqual(1);
        specials++;
        if (kind === 'lift' && by.some(([o, oc]) => o.connectors.find((c) => c.id === oc)!.tag === 'catacombs')) lifts++;
      }
      expect(validateFoldRun(p, run)).toEqual([]);
    }
    expect(specials).toBeGreaterThanOrEqual(2);
    expect(lifts).toBeGreaterThanOrEqual(1);
  });

  it('выход — марш наверх хаба: за ним квартиры, остальные выходы катакомб исчезают', () => {
    const w = cat('up');
    walk(w, 100);
    const exits: [string, string][] = [];
    for (const i of w.run().instances) for (const c of roomOf(w.run(), i.id).connectors) if (w.doorState(i.id, c.id) === 'exit') exits.push([i.id, c.id]);
    expect(exits.length).toBeGreaterThanOrEqual(1);
    for (const [i, c] of exits) expect(roomOf(w.run(), i).connectors.find((x) => x.id === c)!.tag).toBe('stair');
    const id = w.openDoor(...exits[0])!;
    expect(id).toBeTruthy();
    expect(w.clusterAt(id)!.tunnels).toBe(false);
    expect(roomOf(w.run(), id).tags[0]).not.toBe('катакомбы');
    for (const [x, y] of exits.slice(1)) expect(w.doorState(x, y)).toBe('dead');
    expect(validateFoldRun(p, w.run())).toEqual([]);
  });

  it('вне биома катакомб нет: прежняя прогулка, прогон, квартиры хрущёвок', () => {
    const own = (run: Run) => run.instances.filter((i) => byId.get(i.roomId)!.tags[0] === 'катакомбы');
    const legacy = createStreamWorld(p, streamSettings('legacy'));
    walk(legacy, 300);
    expect(own(legacy.run())).toEqual([]);
    expect(own(generateRun(p, { seed: 'g1', count: 80 }))).toEqual([]);
    const kh = createStreamWorld(p, streamSettings('kh', { world: world({ trAfter: 100000 }) }));
    walk(kh, 200);
    expect(own(kh.run())).toEqual([]);
  });

  it('сохранение → загрузка: катакомбы растут дальше так же', () => {
    const a = cat('save');
    walk(a, 90);
    const sv: StreamSave = JSON.parse(JSON.stringify(a.save()));
    const b = createStreamWorld(p, a.settings, sv);
    expect(b.stale).toBe(false);
    walk(a, 180);
    walk(b, 180);
    expect(b.run().instances.map((i) => [i.roomId, i.dx, i.dy, i.w])).toEqual(a.run().instances.map((i) => [i.roomId, i.dx, i.dy, i.w]));
  });
});
