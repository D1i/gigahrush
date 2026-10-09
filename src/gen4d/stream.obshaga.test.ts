// Общага (docs/GENERATOR-4D.md §22): сеть длинных коридоров с тупиковыми комнатами по бокам, общие помещения,
// лестницы и спуск в затопленный подвал, вестибюль с вахтой — хаб и вход; не агрессивно неевклидова.
import { describe, expect, it } from 'vitest';
import { createDefaultProject } from '../data/presets';
import { TAG_LEN } from '../data/roomBuilder';
import { BIOME_ONLY_TAG, generateRun } from '../gen/generate';
import { doorStyleFor, leafHere } from '../blockout/doors';
import { cellKey, parseKey } from '../model/cells';
import { connDz, STOREY_M, stairIssues } from '../model/stairs';
import type { Project, Room, Run, WorldSettings } from '../model/types';
import { biomeMul, newWorldSettings, tunnelKind } from './biomes';
import { validateFoldRun } from './fold';
import { roomSightM } from './space';
import { createStreamWorld, streamSettings, type StreamSave, type StreamWorld } from './stream';
import { DEFAULT_WALK, walkStreamSettings } from '../view3d/walk';

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
const obshaga = (seed: string, o: Partial<WorldSettings> = {}) =>
  createStreamWorld(p, streamSettings(seed, { world: world({ startBiome: 'obshaga', trAfter: 100000, ...o }) }));
const tun = (o: Partial<WorldSettings['tunnels']>) => ({ ...newWorldSettings().biomes.find((b) => b.id === 'obshaga')!.tunnels, ...o });
const has = (r: Room, t: string) => r.tags.includes(t);
const OWN = p.rooms.filter((r) => r.tags[0] === 'общага');

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

/** Закрытые выходы мира: [экземпляр, метка]. */
function exitsOf(w: StreamWorld): [string, string][] {
  const out: [string, string][] = [];
  const run = w.run();
  for (const i of run.instances) for (const c of roomOf(run, i.id).connectors) if (w.doorState(i.id, c.id) === 'exit') out.push([i.id, c.id]);
  return out;
}

/** Путь по полу комнаты от её первой двери до самой дальней клетки, м (BFS по 4 соседям). */
function deepestM(r: Room): number {
  const c = r.connectors[0];
  const start: [number, number] = c.side === 'S' ? [c.cx + Math.floor(c.len / 2), c.cy] : c.side === 'N' ? [c.cx + Math.floor(c.len / 2), c.cy] : [c.cx, c.cy + Math.floor(c.len / 2)];
  const dist = new Map<string, number>([[cellKey(...start), 0]]);
  const q: [number, number][] = [start];
  let max = 0;
  while (q.length) {
    const [x, y] = q.shift()!;
    const d = dist.get(cellKey(x, y))!;
    max = Math.max(max, d);
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const k = cellKey(x + dx, y + dy);
      if (!r.cells.has(k) || dist.has(k)) continue;
      dist.set(k, d + 1);
      q.push([x + dx, y + dy]);
    }
  }
  return max * p.settings.cellM;
}

describe('общага: комнаты', () => {
  it('коридоры 2 м с дверями по бокам, куски ≤ 9 м; комнаты — тупики на 2–3 кровати; общие помещения — одна дверь', () => {
    expect(OWN.length).toBeGreaterThanOrEqual(25);
    for (const r of OWN) {
      expect(r.tags, r.id).toContain(BIOME_ONLY_TAG);
      // предел обзора прогулки 9 м: длиннее — комната выпала бы из пула
      expect(roomSightM(r, p.settings.cellM), r.id).toBeLessThanOrEqual(9 + 1e-9);
    }
    // кроме тупика коридора с дверью в снег (переход сюжета, спец-локация)
    const cors = OWN.filter((r) => has(r, 'коридор') && !r.location);
    expect(cors.length).toBeGreaterThanOrEqual(8);
    for (const r of cors) {
      const passes = r.connectors.filter((c) => c.tag === 'obshaga');
      expect(passes.every((c) => c.len === TAG_LEN.obshaga && c.len === 20), r.id).toBe(true);
      expect(r.connectors.every((c) => ['obshaga', 'obshaga>room', 'obshaga>common', 'obshaga>stairs'].includes(c.tag)), r.id).toBe(true);
      expect(tunnelKind(r), r.id).not.toBeNull();
    }
    // прямые куски с комнатами: двери — по бокам (восток / запад), через ~3.6 м
    const straight = cors.filter((r) => tunnelKind(r) === 'straight');
    expect(straight.filter((r) => r.connectors.some((c) => c.tag === 'obshaga>room')).length).toBeGreaterThanOrEqual(4);
    for (const r of straight) for (const c of r.connectors) if (c.tag !== 'obshaga') expect(['E', 'W'], r.id).toContain(c.side);
    // жилые комнаты: одна дверь-створка в коридор, 2–3 кровати, бедно (без ковров, сервантов)
    const rooms = OWN.filter((r) => has(r, 'комната'));
    expect(rooms.length).toBeGreaterThanOrEqual(3);
    for (const r of rooms) {
      expect(r.connectors.map((c) => c.tag), r.id).toEqual(['room>obshaga']);
      expect(tunnelKind(r), r.id).toBe('storage');
      const beds = r.decor.filter((d) => d.propId === 'p_obsh_bed').length;
      expect(beds, r.id).toBeGreaterThanOrEqual(2);
      expect(beds, r.id).toBeLessThanOrEqual(3);
      expect(r.decor.every((d) => d.propId.startsWith('p_obsh_')), r.id).toBe(true);
    }
    // общие помещения — одна дверь 'common>obshaga'
    for (const t of ['кухня', 'туалет', 'душ', 'прачечная']) {
      const list = OWN.filter((r) => has(r, t));
      expect(list.length, t).toBeGreaterThanOrEqual(1);
      for (const r of list) expect(r.connectors.map((c) => c.tag), r.id).toEqual(['common>obshaga']);
    }
    // туалет: кабинки с перегородками и чашами «Генуя»; кухня: 3–5 плит
    const wc = OWN.find((r) => has(r, 'туалет'))!;
    expect(wc.decor.filter((d) => d.propId === 'p_obsh_toilet').length).toBeGreaterThanOrEqual(4);
    expect(wc.decor.filter((d) => d.propId === 'p_obsh_partition').length).toBeGreaterThanOrEqual(4);
    const kitchen = OWN.find((r) => has(r, 'кухня'))!;
    expect(kitchen.decor.filter((d) => d.propId === 'p_obsh_stove').length).toBeGreaterThanOrEqual(3);
  });

  it('душевая — улитка: путь от двери до середины в разы длиннее габарита; кабинки с перегородками', () => {
    const r = OWN.find((x) => has(x, 'душ'))!;
    const xs = [...r.cells].map(parseKey);
    const span = (Math.max(...xs.map(([x]) => x)) - Math.min(...xs.map(([x]) => x)) + 1) * p.settings.cellM;
    // полтора оборота прохода 2.4 м в квадрате 9 м: путь в середину ≥ 2.5 габарита
    expect(deepestM(r)).toBeGreaterThanOrEqual(2.5 * span);
    expect(r.decor.filter((d) => d.propId === 'p_obsh_shower').length).toBeGreaterThanOrEqual(8);
    expect(r.decor.filter((d) => d.propId === 'p_obsh_partition').length).toBeGreaterThanOrEqual(8);
  });

  it('вахта — хаб с выходом на улицу и дверью в комнату вахтёра; там всегда керосиновая лампа, в кухнях и комнатах — редко', () => {
    const hub = OWN.find((r) => has(r, 'вахта'))!;
    expect(tunnelKind(hub)).toBe('hub');
    expect(hub.connectors.filter((c) => c.tag === 'obshaga').length).toBeGreaterThanOrEqual(3);
    expect(hub.connectors.filter((c) => c.tag === 'stair')).toHaveLength(1);
    expect(hub.connectors.filter((c) => c.tag === 'hall>vahter')).toHaveLength(1);
    expect(hub.decor.map((d) => d.propId)).toEqual(expect.arrayContaining(['p_obsh_vahter_desk', 'p_obsh_keyboard', 'p_obsh_noticeboard', 'p_obsh_sofa', 'p_obsh_clock']));
    // единственный хаб общаги — вестибюль (старт и вход сети)
    expect(OWN.filter((r) => tunnelKind(r) === 'hub').map((r) => r.id)).toEqual([hub.id]);
    const vr = OWN.find((r) => has(r, 'вахтёрская'))!;
    expect(vr.connectors.map((c) => c.tag)).toEqual(['vahter>hall']);
    expect(vr.decor.map((d) => d.propId)).toEqual(expect.arrayContaining(['p_obsh_bed', 'p_obsh_tv']));
    // лампа: спот 'lantern' (группа 'lantern', содержимое — prop p_obsh_lantern)
    const lampChance = (r: Room): number => {
      const g = r.spotGroups.find((x) => x.id === `${r.id}_g_lantern`);
      if (!g) return 0;
      const sum = g.variants.reduce((s, v) => s + v.weight, 0);
      return g.variants.filter((v) => v.assign[`${r.id}_s_lantern`]?.id === 'p_obsh_lantern').reduce((s, v) => s + v.weight, 0) / sum;
    };
    expect(lampChance(vr)).toBe(1);
    for (const r of OWN.filter((x) => has(x, 'комната') || has(x, 'кухня'))) {
      expect(lampChance(r), r.id).toBeGreaterThan(0.05);
      expect(lampChance(r), r.id).toBeLessThan(0.15);
    }
    expect(OWN.filter((r) => lampChance(r) > 0).every((r) => has(r, 'комната') || has(r, 'кухня') || has(r, 'вахтёрская'))).toBe(true);
  });

  it('лестницы: клетка 2.4×5.4 м сбоку коридора, марш на этаж, верх — северный проём; спуск — внизу ход подвала 1.6 м', () => {
    const st = OWN.filter((r) => has(r, 'лестница'));
    expect(st.map((r) => r.id).sort()).toEqual(['obsh_stair', 'obsh_stair_dn', 'obsh_stair_down']);
    // клетка — не кусок прямого хода: в линию коридора не встаёт, только за проёмом 'obshaga>stairs' сбоку
    const side = OWN.filter((r) => r.connectors.some((c) => c.tag === 'obshaga>stairs'));
    expect(side.length).toBeGreaterThanOrEqual(1);
    for (const r of side) expect(tunnelKind(r), r.id).toBe('straight');
    for (const r of st) {
      expect(r.cells.size, r.id).toBe(24 * 54);
      expect(tunnelKind(r), r.id).toBeNull();
      expect(r.connectors.filter((c) => c.tag === 'stairs>obshaga'), r.id).toHaveLength(1);
      expect(r.connectors.map((c) => c.side).sort(), r.id).toEqual(['N', 'S']);
      // настоящая лестница вместо декорации марша: верх — у северной метки (этаж), низ — у южной (0)
      expect(r.decor.filter((d) => d.propId === 'p_obsh_stair_flight'), r.id).toEqual([]);
      expect(stairIssues(r), r.id).toEqual([]);
      expect(r.stair?.flights, r.id).toHaveLength(1);
      expect(r.stair!.flights[0].up, r.id).toBe('N');
      const dz = (side: string) => connDz(r, r.connectors.findIndex((c) => c.side === side));
      expect(dz('N'), r.id).toBeCloseTo(STOREY_M, 9);
      expect(dz('S'), r.id).toBe(0);
    }
    const sides = (id: string) => byId.get(id)!.connectors.map((c) => `${c.side}:${c.tag}`).sort();
    // наверх: из коридора — низ (юг), коридор этажа выше — верх (север); вниз — наоборот; в подвал — внизу ход 1.6 м
    expect(sides('obsh_stair')).toEqual(['N:obshaga', 'S:stairs>obshaga']);
    expect(sides('obsh_stair_dn')).toEqual(['N:stairs>obshaga', 'S:obshaga']);
    expect(sides('obsh_stair_down')).toEqual(['N:stairs>obshaga', 'S:obshaga_bsm']);
    const bsm = OWN.filter((r) => has(r, 'подвал'));
    expect(bsm.length).toBeGreaterThanOrEqual(4);
    for (const r of bsm) {
      expect(r.tags, r.id).toContain('затоплено');
      expect(r.connectors.every((c) => c.tag === 'obshaga_bsm' && c.len === 16), r.id).toBe(true);
    }
  });

  it('двери комнат — настоящие створки: полотно в комнате, у коридора наличник; закрытые — дверь общаги', () => {
    for (const tag of ['room>obshaga', 'common>obshaga', 'vahter>hall']) {
      expect(leafHere(tag), tag).toBe(true);
      expect(doorStyleFor(tag, ['общага', 'комната'], false, 'a/b')?.id, tag).toBe('obshaga_room');
    }
    expect(leafHere('obshaga>room')).toBe(false);
    // запертая (не выросшая) дверь коридора — закрытое полотно со стороны коридора
    expect(doorStyleFor('obshaga>room', ['общага', 'коридор', 'ход'], true, 'a/b')?.id).toBe('obshaga_room');
    // закрытый конец коридора — тамбурная, хода подвала — железная, двери на улицу — тамбурная
    expect(doorStyleFor('obshaga', ['общага', 'коридор', 'ход'], true, 'a/b')?.id).toBe('tambour');
    expect(doorStyleFor('obshaga_bsm', ['общага', 'подвал', 'затоплено', 'ход'], true, 'a/b')?.id).toBe('basement_metal');
    expect(doorStyleFor('stair', ['общага', 'вахта', 'хаб'], true, 'a/b')?.id).toBe('tambour');
    expect(doorStyleFor('obshaga', ['общага', 'коридор'], false, 'a/b')).toBeNull();
  });

  it('только в биоме «Общага»: в другие биомы по тегам «коридор», «кухня», «лестница», «подвал» не попадает', () => {
    const bs = newWorldSettings().biomes;
    for (const r of OWN) {
      expect(bs.filter((b) => biomeMul(b, r) > 0).map((b) => b.id), r.id).toEqual(['obshaga']);
    }
    // а квартирные комнаты с теми же тегами в биом общаги не попадают
    const ob = bs.find((b) => b.id === 'obshaga')!;
    expect(p.rooms.filter((r) => r.tags[0] !== 'общага' && biomeMul(ob, r) > 0)).toEqual([]);
  });
});

describe('общага: сеть коридоров', { timeout: 600000 }, () => {
  it('старт — вестибюль с вахтой; длинные коридоры с комнатами по бокам; кухни, туалеты, душевые, прачечные, лестницы, подвал', () => {
    const found = new Map<string, number>();
    for (const seed of ['o1', 'o2', 'o3']) {
      const w = obshaga(seed);
      const start = roomOf(w.run(), w.startId!);
      expect(start.tags).toEqual(expect.arrayContaining(['общага', 'вахта', 'хаб']));
      expect(w.clusterAt(w.startId!)).toMatchObject({ tunnels: true, biome: { id: 'obshaga' } });
      const exit = start.connectors.find((c) => c.tag === 'stair')!;
      expect(w.doorState(w.startId!, exit.id)).toBe('exit');
      walk(w, 260);
      const run = w.run();
      expect(run.instances.length).toBeGreaterThanOrEqual(200);
      const rooms = run.instances.map((i) => roomOf(run, i.id));
      for (const r of rooms) expect(r.tags[0], r.id).toBe('общага');
      const n = (t: string) => rooms.filter((r) => has(r, t)).length;
      for (const t of ['кухня', 'туалет', 'душ', 'прачечная', 'лестница', 'подвал']) found.set(t, (found.get(t) ?? 0) + (n(t) > 0 ? 1 : 0));
      // комната вахтёра — у стартового вестибюля
      const vahter = run.links.find((l) => !l.kind && ((l.a.inst === w.startId && roomOf(run, l.b.inst).tags.includes('вахтёрская')) || (l.b.inst === w.startId && roomOf(run, l.a.inst).tags.includes('вахтёрская'))));
      expect(vahter, seed).toBeTruthy();
      // коридоры — основа; комнат много (по бокам)
      expect(n('коридор')).toBeGreaterThan(n('хаб') * 10);
      expect(n('комната')).toBeGreaterThanOrEqual(40);
      // жилые комнаты — тупики: ровно одна связь, с коридором
      for (const i of run.instances) {
        const r = roomOf(run, i.id);
        if (!has(r, 'комната')) continue;
        const ls = run.links.filter((l) => !l.kind && (l.a.inst === i.id || l.b.inst === i.id));
        expect(ls, i.id).toHaveLength(1);
        const other = ls[0].a.inst === i.id ? ls[0].b.inst : ls[0].a.inst;
        expect(roomOf(run, other).tags, i.id).toContain('коридор');
      }
      // проёмы: коридоры 2.0 м, ходы подвала 1.6 м, двери 0.9 м
      for (const l of run.links) {
        if (l.kind) continue;
        const ca = roomOf(run, l.a.inst).connectors.find((c) => c.id === l.a.connector)!;
        const cb = roomOf(run, l.b.inst).connectors.find((c) => c.id === l.b.connector)!;
        expect(ca.len, `${ca.tag}–${cb.tag}`).toBe(cb.len);
        if (ca.tag === 'obshaga') expect(cb.tag).toBe('obshaga');
        if (ca.tag === 'obshaga_bsm') expect(cb.tag).toBe('obshaga_bsm');
      }
      // отделка: коридоры — кафель с побелкой и линолеум / метлах, подвал — вода, комнаты — краска
      for (const [k, i] of run.instances.entries()) {
        const r = roomOf(run, i.id), f = run.content[k].finish;
        if (has(r, 'коридор')) {
          expect(f.wall, i.roomId).toBe('f_obsh_corridor');
          expect(['f_obsh_lino_brown', 'f_metlakh'], i.roomId).toContain(f.floor);
        }
        if (has(r, 'подвал')) expect(f.floor, i.roomId).toBe('f_bsm_water');
        if (has(r, 'комната')) expect(['f_obsh_paint_beige', 'f_obsh_paint_green', 'f_wp_rogozhka'], i.roomId).toContain(f.wall);
      }
      // керосиновая лампа у вахтёра: спот 'lantern' с prop p_obsh_lantern (мировые клетки — в run.content)
      const vk = run.instances.findIndex((i) => roomOf(run, i.id).tags.includes('вахтёрская'));
      const lamp = run.content[vk].spots.find((s) => s.spotId.endsWith('_s_lantern'));
      expect(lamp?.content).toMatchObject({ kind: 'prop', id: 'p_obsh_lantern' });
      expect(validateFoldRun(p, run)).toEqual([]);
    }
    // за 260 комнат от вахты общие помещения, лестницы и подвал — хоть в двух мирах из трёх
    for (const t of ['кухня', 'туалет', 'душ', 'прачечная', 'лестница', 'подвал']) expect(found.get(t), t).toBeGreaterThanOrEqual(2);
  });

  it('лестницы: вверх — этаж выше (z + 2.7), спуск в подвал — этаж ниже коридора (−2.7 от старта); полы проёмов вровень', () => {
    let ups = 0, downs = 0, fromStart = 0;
    const near = (a: number, b: number) => Math.abs(a - b) < 1e-6;
    for (const seed of ['o1', 'o3', 'o4', 'o5', 'o6']) {
      const w = obshaga(seed);
      walk(w, 260);
      const run = w.run();
      const inst = new Map(run.instances.map((i) => [i.id, i]));
      const doorZ = (id: string, conn: string) => {
        const r = roomOf(run, id);
        return (inst.get(id)!.z ?? 0) + connDz(r, r.connectors.findIndex((c) => c.id === conn));
      };
      // каждый проём: полы двух меток на одной высоте
      for (const l of run.links) if (!l.kind && !l.wrap) expect(doorZ(l.a.inst, l.a.connector), `${l.a.inst}–${l.b.inst}`).toBeCloseTo(doorZ(l.b.inst, l.b.connector), 6);
      // старт — на нулевой высоте
      expect(inst.get(w.startId!)!.z ?? 0).toBe(0);
      for (const i of run.instances) {
        const r = roomOf(run, i.id);
        if (!has(r, 'лестница')) continue;
        // соседи зала за верхней (N) и нижней (S) меткой
        const side = (s: string) => {
          const c = r.connectors.find((x) => x.side === s)!;
          const l = run.links.find((x) => !x.kind && ((x.a.inst === i.id && x.a.connector === c.id) || (x.b.inst === i.id && x.b.connector === c.id)));
          return l ? inst.get(l.a.inst === i.id ? l.b.inst : l.a.inst)! : null;
        };
        const top = side('N'), bottom = side('S');
        // соседи — ровные комнаты (за лестницей бывает лестница: у неё низ комнаты ниже её верхней метки)
        if (!top || !bottom || roomOf(run, top.id).stair || roomOf(run, bottom.id).stair) continue;
        expect(top.z ?? 0, i.id).toBeCloseTo((bottom.z ?? 0) + STOREY_M, 6);
        if (r.id === 'obsh_stair_down') {
          downs++;
          expect(roomOf(run, bottom.id).tags, i.id).toContain('подвал');
          // спустились из коридора этажа старта — подвал на −2.7
          if (near(top.z ?? 0, 0)) {
            fromStart++;
            expect(bottom.z ?? 0, i.id).toBeCloseTo(-STOREY_M, 6);
          }
        } else ups++;
      }
      // подвал — всегда на этаж ниже какого-то коридора: высота кратна этажу
      for (const i of run.instances) {
        const z = i.z ?? 0;
        expect(near(z / STOREY_M, Math.round(z / STOREY_M)), i.id).toBe(true);
      }
      expect(validateFoldRun(p, run)).toEqual([]);
    }
    expect(ups).toBeGreaterThanOrEqual(3);
    expect(downs).toBeGreaterThanOrEqual(2);
    expect(fromStart).toBeGreaterThanOrEqual(1);
  });

  it('не агрессивно неевклидова: прямые коридоры, редкие повороты и развилки, колец и швов меньше, чем в снегу', () => {
    let pieces = 0, bends = 0, odd = 0, rooms = 0;
    for (const seed of ['n1', 'n2', 'n3', 'n4']) {
      const w = obshaga(seed);
      walk(w, 200);
      const run = w.run();
      rooms += run.instances.length;
      for (const i of run.instances) {
        const r = roomOf(run, i.id);
        const k = tunnelKind(r);
        if (k !== 'straight' && k !== 'turn' && k !== 'branch') continue;
        pieces++;
        if (k !== 'straight') bends++;
      }
      odd += w.stats().rings + w.stats().wraps;
      expect(validateFoldRun(p, run)).toEqual([]);
    }
    // ≥ 85% кусков сети — прямые
    expect(bends / pieces, `${bends} из ${pieces}`).toBeLessThan(0.15);
    // снег по умолчанию: те же замеры
    let sPieces = 0, sBends = 0, sOdd = 0, sRooms = 0;
    for (const seed of ['n1', 'n2']) {
      const w = createStreamWorld(p, streamSettings(seed, { world: world({ startBiome: 'snow', trAfter: 100000 }) }));
      walk(w, 200);
      const run = w.run();
      sRooms += run.instances.length;
      for (const i of run.instances) {
        const k = tunnelKind(roomOf(run, i.id));
        if (k !== 'straight' && k !== 'turn' && k !== 'branch') continue;
        sPieces++;
        if (k !== 'straight') sBends++;
      }
      sOdd += w.stats().rings + w.stats().wraps;
    }
    expect(bends / pieces).toBeLessThan((sBends / sPieces) / 2);
    // колец и бесконечных участков на 100 комнат — меньше, чем в снегу (и не больше одного)
    expect((odd / rooms) * 100).toBeLessThanOrEqual(1);
    expect(odd / rooms).toBeLessThanOrEqual(sOdd / sRooms);
  });

  it('прямые коридоры (настройки «Прогулки» проекта): медиана прямого прогона ≥ 25 м, четверть — ≥ 40 м; лестницы — сбоку', () => {
    // прогон — подряд стоящие прямые куски коридора (по одной оси) от поворота / развилки / вестибюля до следующего
    // поворота, развилки, вестибюля или тупика; меряется, идя по нему (раскрывая куски), из проходов вестибюля старта и
    // дальше из проходов поворотов, развилок и вестибюлей, где кончился прошлый
    const isRun = (r: Room) => tunnelKind(r) === 'straight' && has(r, 'коридор');
    const lenM = (r: Room) => {
      const ys = [...r.cells].map((k) => parseKey(k)[1]);
      return (Math.max(...ys) - Math.min(...ys) + 1) * p.settings.cellM;
    };
    const runs: number[] = [];
    let pieces = 0, inserts = 0;
    for (const seed of ['qa-obsh-1', 'qa-obsh-2', 's1', 's2', 's3', 's4', 's5', 's6']) {
      const w = createStreamWorld(p, walkStreamSettings(p, { ...DEFAULT_WALK, seed, biome: 'obshaga' }));
      const q: [string, string][] = roomOf(w.run(), w.startId!).connectors.filter((c) => c.tag === 'obshaga').map((c) => [w.startId!, c.id]);
      for (let n = 0; q.length && n < 14; n++) {
        let [cur, conn] = q.shift()!;
        let m = 0;
        for (let k = 0; k < 200; k++) {
          w.expand(cur);
          if (w.doorState(cur, conn) !== 'linked') break;
          const run = w.run();
          const l = run.links.find((x) => !x.kind && ((x.a.inst === cur && x.a.connector === conn) || (x.b.inst === cur && x.b.connector === conn)))!;
          const o = l.a.inst === cur ? l.b : l.a;
          const r = roomOf(run, o.inst);
          // лестница в линии коридора не встаёт (клетки — сбоку)
          expect(r.tags, o.inst).not.toContain('лестница');
          if (!isRun(r)) {
            const k2 = tunnelKind(r);
            if (k2 === 'turn' || k2 === 'branch' || k2 === 'hub') {
              w.expand(o.inst);
              for (const c of r.connectors) if (c.tag === 'obshaga' && c.id !== o.connector) q.push([o.inst, c.id]);
            }
            break;
          }
          m += lenM(r) + p.settings.cellM;
          pieces++;
          if (r.id === 'obsh_cor_1') inserts++;
          const c = r.connectors.find((x) => x.id === o.connector)!;
          cur = o.inst;
          conn = r.connectors.find((x) => x.tag === 'obshaga' && x.side !== c.side)!.id;
        }
        runs.push(m);
      }
    }
    runs.sort((a, b) => a - b);
    const at = (f: number) => runs[Math.floor(f * (runs.length - 1))];
    const msg = `прогонов ${runs.length}: медиана ${at(0.5).toFixed(1)} м, p75 ${at(0.75).toFixed(1)} м`;
    expect(runs.length).toBeGreaterThanOrEqual(60);
    expect(at(0.5), msg).toBeGreaterThanOrEqual(25);
    expect(at(0.75), msg).toBeGreaterThanOrEqual(40);
    // вставки по 1 м — редкость (добор колец и щелей)
    expect(inserts / pieces, `${inserts} из ${pieces}`).toBeLessThan(0.06);
  });

  it('кольца из вахты и бесконечные участки (если включить) — только своей сетью и без лестниц', () => {
    let rings = 0, wraps = 0;
    for (const seed of ['r1', 'r2', 'r3', 'r4']) {
      const w = obshaga(seed, { biomes: newWorldSettings().biomes.map((b) => (b.id === 'obshaga' ? { ...b, tunnels: tun({ ring: 1, loop: 0.3, loopMinDist: 4, hubEvery: [30, 60] }) } : b)) });
      walk(w, 160);
      const run = w.run();
      rings += w.stats().rings;
      wraps += w.stats().wraps;
      for (const l of run.links) {
        if (l.kind) continue;
        const ca = roomOf(run, l.a.inst).connectors.find((c) => c.id === l.a.connector)!;
        const cb = roomOf(run, l.b.inst).connectors.find((c) => c.id === l.b.connector)!;
        expect(ca.tag === 'obshaga_bsm', `${ca.tag}–${cb.tag}`).toBe(cb.tag === 'obshaga_bsm');
        expect(ca.len).toBe(cb.len);
        // шов бесконечного участка — не через лестницу
        if (l.wrap) for (const i of [l.a.inst, l.b.inst]) expect(roomOf(run, i).tags).not.toContain('лестница');
      }
      expect(validateFoldRun(p, run)).toEqual([]);
    }
    expect(rings).toBeGreaterThanOrEqual(2);
    expect(wraps).toBeGreaterThanOrEqual(1);
  });

  it('«Прогулка» (настройки проекта: складки не ближе 6 м): у каждого вестибюля — комната вахтёра с лампой; и при входе переходом', () => {
    const ws = (seed: string) => walkStreamSettings(p, { ...DEFAULT_WALK, seed, biome: 'obshaga' });
    expect(ws('x').fold.localM).toBeGreaterThan(0);
    /** Вестибюли прогона, раскрытые: дверь будки связана с комнатой вахтёра, в ней спот лампы с лампой. */
    const checkHubs = (w: StreamWorld, label: string): number => {
      const run = w.run();
      let n = 0;
      for (const i of run.instances) {
        const r = roomOf(run, i.id);
        if (!has(r, 'вахта')) continue;
        const c = r.connectors.find((x) => x.tag === 'hall>vahter')!;
        const st = w.doorState(i.id, c.id);
        expect(st, `${label} ${i.id}`).not.toBe('dead');
        if (st !== 'linked') continue;
        const l = run.links.find((x) => !x.kind && ((x.a.inst === i.id && x.a.connector === c.id) || (x.b.inst === i.id && x.b.connector === c.id)))!;
        const v = l.a.inst === i.id ? l.b.inst : l.a.inst;
        expect(roomOf(run, v).tags, label).toContain('вахтёрская');
        const k = run.instances.findIndex((x) => x.id === v);
        expect(run.content[k].spots.find((s) => s.spotId === 'obsh_vahter_room_s_lantern')?.content, label).toMatchObject({ kind: 'prop', id: 'p_obsh_lantern' });
        n++;
      }
      return n;
    };
    let hubs = 0;
    for (const seed of ['qa-obsh-1', 'qa-obsh-2', 'w1', 'w2', 'w3', 'w4']) {
      const w = createStreamWorld(p, ws(seed));
      w.expand(w.startId!);
      // старт — вестибюль, комната вахтёра — сразу
      const start = roomOf(w.run(), w.startId!);
      expect(w.doorState(w.startId!, start.connectors.find((c) => c.tag === 'hall>vahter')!.id), seed).toBe('linked');
      walk(w, 220);
      hubs += checkHubs(w, seed);
      expect(validateFoldRun(p, w.run())).toEqual([]);
    }
    expect(hubs).toBeGreaterThan(6);
    // вход переходом (площадка → общага): вход сети — вестибюль, у него комната вахтёра
    let entries = 0;
    for (const seed of ['t1', 't2', 't3', 't4']) {
      const s = ws(seed);
      s.world = { ...s.world!, startBiome: 'khrush', trAfter: 0, trBase: 1, trStep: 0, trToBiome: 1, trLanding: 1, biomes: s.world!.biomes.filter((b) => b.id === 'khrush' || b.id === 'obshaga') };
      const w = createStreamWorld(p, s);
      w.enter(w.startId!);
      const run0 = w.run();
      const exit = exitsOf(w).find(([i, c]) => roomOf(run0, i).connectors.find((x) => x.id === c)!.len >= 7)!;
      const t = w.openDoor(...exit)!;
      w.enter(t);
      const door = exitsOf(w).find(([i]) => i === t)!;
      const hub = w.openDoor(...door)!;
      expect(w.clusterAt(hub)!.biome?.id, seed).toBe('obshaga');
      expect(roomOf(w.run(), hub).tags, seed).toContain('вахта');
      w.expand(hub);
      entries += checkHubs(w, seed);
      expect(validateFoldRun(p, w.run())).toEqual([]);
    }
    expect(entries).toBeGreaterThanOrEqual(4);
  });

  it('выход — двери вестибюля на улицу: за ними квартиры, остальные выходы общаги исчезают', () => {
    const w = obshaga('up');
    walk(w, 120);
    const exits = exitsOf(w);
    expect(exits.length).toBeGreaterThanOrEqual(1);
    for (const [i, c] of exits) expect(roomOf(w.run(), i).connectors.find((x) => x.id === c)!.tag).toBe('stair');
    const id = w.openDoor(...exits[0])!;
    expect(id).toBeTruthy();
    expect(w.clusterAt(id)!.tunnels).toBe(false);
    expect(roomOf(w.run(), id).tags).not.toContain('общага');
    for (const [x, y] of exits.slice(1)) expect(w.doorState(x, y)).toBe('dead');
    expect(validateFoldRun(p, w.run())).toEqual([]);
  });

  it('вне биома общаги нет: прежняя прогулка, прогон, квартиры хрущёвок', () => {
    const own = (run: Run) => run.instances.filter((i) => byId.get(i.roomId)!.tags[0] === 'общага');
    const legacy = createStreamWorld(p, streamSettings('legacy'));
    walk(legacy, 300);
    expect(own(legacy.run())).toEqual([]);
    expect(own(generateRun(p, { seed: 'g1', count: 80 }))).toEqual([]);
    const kh = createStreamWorld(p, streamSettings('kh', { world: world({ trAfter: 100000 }) }));
    walk(kh, 200);
    expect(own(kh.run())).toEqual([]);
  });

  it('сохранение → загрузка: общага растёт дальше так же', () => {
    const a = obshaga('save');
    walk(a, 90);
    const sv: StreamSave = JSON.parse(JSON.stringify(a.save()));
    const b = createStreamWorld(p, a.settings, sv);
    expect(b.stale).toBe(false);
    walk(a, 170);
    walk(b, 170);
    expect(b.run().instances.map((i) => [i.roomId, i.dx, i.dy, i.w])).toEqual(a.run().instances.map((i) => [i.roomId, i.dx, i.dy, i.w]));
  });
});
