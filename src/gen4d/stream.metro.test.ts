// Метро (docs/GENERATOR-4D.md §24): бесконечная колонная станция — три сети (зал, переходы, служебные ходы) со своими
// станциями («станции внутри станций»), эскалаторы на три этажа, вестибюли с выходом в город — хабы и вход.
import { describe, expect, it } from 'vitest';
import { createDefaultProject } from '../data/presets';
import { TAG_LEN, TAG_OPEN_H } from '../data/roomBuilder';
import { BIOME_ONLY_TAG, generateRun } from '../gen/generate';
import { doorStyleFor, leafHere } from '../blockout/doors';
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
const roomOf = (run: Run, id: string) => byId.get(run.instances.find((i) => i.id === id)!.roomId)!;
const world = (o: Partial<WorldSettings> = {}): WorldSettings => ({ ...newWorldSettings(), ...o });
const metro = (seed: string, o: Partial<WorldSettings> = {}) =>
  createStreamWorld(p, streamSettings(seed, { world: world({ startBiome: 'metro', trAfter: 100000, ...o }) }));
const tun = (o: Partial<WorldSettings['tunnels']>) => ({ ...newWorldSettings().biomes.find((b) => b.id === 'metro')!.tunnels, ...o });
const has = (r: Room, t: string) => r.tags.includes(t);
const OWN = p.rooms.filter((r) => r.tags[0] === 'метро');
const own = (id: string) => byId.get(id)!;

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

/** Соседи экземпляра по связям (без шва и переходов): [экземпляр, своя метка, его метка]. */
function neighbours(run: Run, id: string): [string, string, string][] {
  const out: [string, string, string][] = [];
  for (const l of run.links) {
    if (l.kind) continue;
    if (l.a.inst === id) out.push([l.b.inst, l.a.connector, l.b.connector]);
    if (l.b.inst === id) out.push([l.a.inst, l.b.connector, l.a.connector]);
  }
  return out;
}

describe('метро: комнаты', () => {
  it('все — «только в биоме», группа «метро», предел обзора 28 м; обязательные id на месте', () => {
    expect(OWN.length).toBeGreaterThanOrEqual(30);
    for (const r of OWN) {
      expect(r.tags, r.id).toContain(BIOME_ONLY_TAG);
      expect(r.id.startsWith('metro_'), r.id).toBe(true);
      expect(roomSightM(r, p.settings.cellM), r.id).toBeLessThanOrEqual(28 + 1e-9);
      expect(stairIssues(r), r.id).toEqual([]);
    }
    for (const id of [
      'metro_hall_9', 'metro_hall_9p', 'metro_hall_x', 'metro_vest', 'metro_esc_tunnel', 'metro_esc_tunnel_s', 'metro_esc_hall',
      'metro_burnt_hall', 'metro_per_9', 'metro_per_4', 'metro_per_turn', 'metro_per_T', 'metro_per_stair_up', 'metro_per_stair_dn',
      'metro_per_from_hall', 'metro_mini_9', 'metro_slu_9', 'metro_slu_4', 'metro_slu_turn', 'metro_slu_T', 'metro_slu_door', 'metro_micro_9',
    ]) expect(byId.has(id), id).toBe(true);
    // высота потолка: залы и вестибюли 4.5, у эскалатора 3.5, переходы и станция поменьше 3.2, служебные — обычная
    for (const r of OWN) {
      const want = has(r, 'вестибюль') || ['metro_hall_9', 'metro_hall_9p', 'metro_hall_x', 'metro_hall_T'].includes(r.id) ? 4.5
        : has(r, 'эскалатор') || r.id.startsWith('metro_esc_hall') || r.id === 'metro_burnt_hall' ? 3.5
        : has(r, 'переход') || r.id === 'metro_mini_9' ? 3.2 : undefined;
      expect(r.ceilM, r.id).toBe(want);
    }
    // проёмы: зал на всю высоту, переходы 2.9, эскалатор 3.2
    expect(TAG_OPEN_H.metro_hall).toBe(4.5);
    expect(TAG_OPEN_H.metro_per).toBe(2.9);
    expect(TAG_OPEN_H['hall>per']).toBe(2.9);
    expect(TAG_OPEN_H['esc>hall']).toBe(3.2);
    expect(TAG_OPEN_H.metro_slu).toBeUndefined();
  });

  it('пролёт зала 18×9 м: ось — проход во всю ширину на торцах, пути и платформы у путевых стен, ряды пилонов', () => {
    const h = own('metro_hall_9');
    expect(h.tags.slice(0, 3)).toEqual(['метро', 'зал', 'ход']);
    expect(h.cells.size).toBe(180 * 90 - 4 * 8 * 12);
    expect(tunnelKind(h)).toBe('straight');
    expect(h.connectors.map((c) => `${c.side}:${c.tag}:${c.len}`).sort()).toEqual(['N:metro_hall:176', 'S:metro_hall:176']);
    expect(TAG_LEN.metro_hall).toBe(176);
    // пилоны 0.8×1.2 — вырезы x 5.2–6.0 и 12.0–12.8, y 1.6–2.8 и 6.2–7.4 (ряд симметричен: кусок встаёт любым торцом)
    for (const [x, y] of [[52, 16], [59, 27], [120, 62], [127, 73]]) expect(h.cells.has(`${x},${y}`), `${x},${y}`).toBe(false);
    for (const [x, y] of [[51, 16], [60, 16], [52, 15], [52, 28], [59, 61], [90, 45]]) expect(h.cells.has(`${x},${y}`), `${x},${y}`).toBe(true);
    const props = h.decor.map((d) => d.propId);
    for (const id of ['p_metro_track', 'p_metro_edge', 'p_metro_panel', 'p_metro_light', 'p_metro_bench']) expect(props, id).toContain(id);
    expect(props.filter((x) => x === 'p_metro_track')).toHaveLength(2);
    // пролёт с переходом: проём 3.0 м в западной путевой стене между пилонами
    const hp = own('metro_hall_9p');
    expect(tunnelKind(hp)).toBe('straight');
    expect(hp.connectors.find((c) => c.tag === 'hall>per')).toMatchObject({ side: 'W', cx: 0, cy: 30, len: 30 });
    expect(own('metro_hall_x').connectors.filter((c) => c.tag === 'metro_hall')).toHaveLength(4);
    expect(tunnelKind(own('metro_hall_x'))).toBe('branch');
    expect(own('metro_hall_x').tags).toContain('развилка');
  });

  it('эскалатор: план 6.0×19.0, три марша style escalator (дорожки 1.2 м через 0.8), верх на +8.1 у северного торца', () => {
    const r = own('metro_esc_tunnel');
    expect(r.tags.slice(0, 4)).toEqual(['метро', 'эскалатор', 'лестница', 'ход']);
    expect(r.cells.size).toBe(60 * 190);
    expect(r.decor).toEqual([]);
    const fl = r.stair!.flights;
    expect(fl).toHaveLength(3);
    expect(fl.map((f) => [f.x, f.w])).toEqual([[4, 12], [24, 12], [44, 12]]);
    for (const f of fl) expect(f).toMatchObject({ y: 25, h: 140, up: 'N', z0: 0, z1: 8.1, style: 'escalator' });
    expect(r.stair!.pads).toEqual([{ x: 0, y: 0, w: 60, h: 25, z: 8.1 }]);
    const dz = (side: string) => connDz(r, r.connectors.findIndex((c) => c.side === side));
    expect(dz('N')).toBeCloseTo(8.1, 9);
    expect(dz('S')).toBe(0);
    for (const c of r.connectors) expect(c).toMatchObject({ tag: 'esc>hall', len: 52, cx: 4 });
    // короткий: подъём 5.4, марш 9.4 м, план 6.0×14.4
    const s = own('metro_esc_tunnel_s');
    expect(s.cells.size).toBe(60 * 144);
    expect(s.stair!.flights.map((f) => [f.h, f.z1, f.style])).toEqual([[94, 5.4, 'escalator'], [94, 5.4, 'escalator'], [94, 5.4, 'escalator']]);
    // тоннель — только между залами у эскалатора (метки направленные)
    for (const r2 of OWN) {
      const esc = r2.connectors.filter((c) => c.tag === 'esc>hall' || c.tag === 'hall>esc');
      if (has(r2, 'эскалатор')) expect(esc.every((c) => c.tag === 'esc>hall'), r2.id).toBe(true);
      else expect(esc.every((c) => c.tag === 'hall>esc'), r2.id).toBe(true);
    }
    expect(own('metro_esc_hall').decor.map((d) => d.propId)).toContain('p_metro_esc_booth');
    expect(own('metro_burnt_hall').decor.map((d) => d.propId)).toEqual(expect.arrayContaining(['p_metro_esc_wreck', 'p_metro_debris']));
  });

  it('вестибюль — хаб с выходом в город, кассами и турникетами; станции поменьше и крошечные — куски прямых своих сетей', () => {
    const v = own('metro_vest');
    expect(tunnelKind(v)).toBe('hub');
    expect(v.connectors.filter((c) => c.tag === 'stair').length).toBeGreaterThanOrEqual(1);
    expect(v.connectors.filter((c) => c.tag === 'metro_per').length).toBeGreaterThanOrEqual(2);
    expect(v.decor.map((d) => d.propId)).toEqual(expect.arrayContaining(['p_metro_kassa', 'p_metro_turnstile', 'p_metro_esc_booth']));
    expect(OWN.filter((r) => tunnelKind(r) === 'hub').every((r) => has(r, 'вестибюль'))).toBe(true);
    const mini = own('metro_mini_9'), micro = own('metro_micro_9');
    expect(tunnelKind(mini)).toBe('straight');
    expect(mini.connectors.every((c) => c.tag === 'metro_per')).toBe(true);
    expect(tunnelKind(micro)).toBe('straight');
    expect(micro.connectors.every((c) => c.tag === 'metro_slu')).toBe(true);
    // служебные помещения — тупики за дверью служебного хода
    for (const r of OWN.filter((x) => has(x, 'служебное') && !has(x, 'ход'))) {
      expect(r.connectors.map((c) => c.tag), r.id).toEqual(['room>slu']);
      expect(tunnelKind(r), r.id).toBe('storage');
    }
    expect(own('metro_machine').decor.map((d) => d.propId)).toContain('p_metro_gears');
  });

  it('двери: широкие закрытые проходы — глухая стена с панно, переходы и выход в город — маятниковые, служебные — железные', () => {
    expect(doorStyleFor('metro_hall', ['метро', 'зал', 'ход'], true, 'a/b')?.id).toBe('metro_wall');
    expect(doorStyleFor('esc>hall', ['метро', 'эскалатор'], true, 'a/b')?.id).toBe('metro_wall');
    expect(doorStyleFor('metro_per', ['метро', 'переход', 'ход'], true, 'a/b')?.id).toBe('metro_door');
    expect(doorStyleFor('stair', ['метро', 'вестибюль', 'зал', 'хаб'], true, 'a/b')?.id).toBe('metro_door');
    expect(doorStyleFor('metro_slu', ['метро', 'служебное', 'ход'], true, 'a/b')?.id).toBe('service_metal');
    // открытые проходы — без двери; служебные двери — полотном в служебный ход / помещение
    for (const tag of ['metro_hall', 'metro_per', 'metro_slu', 'hall>per', 'per>hall', 'esc>hall', 'hall>esc']) expect(doorStyleFor(tag, ['метро'], false, 'a/b'), tag).toBeNull();
    expect(doorStyleFor('per>slu', ['метро', 'переход'], false, 'a/b')?.id).toBe('service_metal');
    expect(leafHere('slu>per')).toBe(true);
    expect(leafHere('room>slu')).toBe(true);
  });

  it('только в биоме «Метро»: в другие биомы по тегам «лестница», «служебное» не попадает', () => {
    const bs = newWorldSettings().biomes;
    for (const r of OWN) expect(bs.filter((b) => biomeMul(b, r) > 0).map((b) => b.id), r.id).toEqual(['metro']);
    const mb = bs.find((b) => b.id === 'metro')!;
    expect(p.rooms.filter((r) => r.tags[0] !== 'метро' && biomeMul(mb, r) > 0)).toEqual([]);
    expect(mb).toMatchObject({ layout: 'tunnels', viewM: 70, sightM: 28 });
    expect(mb.dark).toBeUndefined();
    expect(mb.tunnels).toMatchObject({ hubEvery: [140, 300], turn: 0.06, branch: 0.14, storage: 0.55, ring: 0.3, ringLen: [40, 90], loop: 0.1, loopLen: [27, 54], loopMinDist: 30 });
  });
});

describe('метро: сеть', { timeout: 600000 }, () => {
  it('старт — вестибюль; есть залы, переходы, эскалаторы, служебные ходы; станции поменьше и крошечные достижимы', () => {
    const found = new Map<string, number>();
    const seeds = ['m1', 'm2', 'm3', 'm4'];
    for (const seed of seeds) {
      const w = metro(seed);
      const start = roomOf(w.run(), w.startId!);
      expect(start.tags, seed).toEqual(expect.arrayContaining(['метро', 'вестибюль', 'хаб']));
      expect(w.clusterAt(w.startId!)).toMatchObject({ tunnels: true, biome: { id: 'metro' } });
      const exit = start.connectors.find((c) => c.tag === 'stair')!;
      expect(w.doorState(w.startId!, exit.id)).toBe('exit');
      walk(w, 300);
      const run = w.run();
      expect(run.instances.length).toBeGreaterThanOrEqual(250);
      const rooms = run.instances.map((i) => roomOf(run, i.id));
      for (const r of rooms) expect(r.tags[0], r.id).toBe('метро');
      const n = (pred: (r: Room) => boolean) => rooms.filter(pred).length;
      for (const [k, pred] of [
        ['зал', (r: Room) => r.id.startsWith('metro_hall_')],
        ['переход', (r: Room) => has(r, 'переход')],
        ['эскалатор', (r: Room) => has(r, 'эскалатор')],
        ['служебный ход', (r: Room) => has(r, 'служебное') && has(r, 'ход')],
        ['служебное помещение', (r: Room) => has(r, 'служебное') && !has(r, 'ход')],
        ['станция поменьше', (r: Room) => r.id === 'metro_mini_9'],
        ['крошечная станция', (r: Room) => r.id === 'metro_micro_9'],
      ] as const) found.set(k, (found.get(k) ?? 0) + (n(pred) > 0 ? 1 : 0));
      // залы — основа станции
      expect(n((r) => has(r, 'зал')), seed).toBeGreaterThan(rooms.length * 0.25);
      // проёмы: метки связей совместимы, одной длины; полы двух меток на одной высоте
      const inst = new Map(run.instances.map((i) => [i.id, i]));
      const doorZ = (id: string, conn: string) => {
        const r = roomOf(run, id);
        return (inst.get(id)!.z ?? 0) + connDz(r, r.connectors.findIndex((c) => c.id === conn));
      };
      for (const l of run.links) {
        if (l.kind) continue;
        const ca = roomOf(run, l.a.inst).connectors.find((c) => c.id === l.a.connector)!;
        const cb = roomOf(run, l.b.inst).connectors.find((c) => c.id === l.b.connector)!;
        expect(ca.len, `${ca.tag}–${cb.tag}`).toBe(cb.len);
        if (!l.wrap) expect(doorZ(l.a.inst, l.a.connector), `${l.a.inst}–${l.b.inst}`).toBeCloseTo(doorZ(l.b.inst, l.b.connector), 6);
      }
      // эскалатор — между двумя залами у эскалатора, верх выше низа на подъём тоннеля
      for (const i of run.instances) {
        const r = roomOf(run, i.id);
        if (!has(r, 'эскалатор')) continue;
        for (const [o] of neighbours(run, i.id)) expect(roomOf(run, o).connectors.some((c) => c.tag === 'hall>esc'), i.id).toBe(true);
      }
      // отделка: залы — мрамор и гранит, переходы — кафель с цоколем, служебные — краска над кафелем
      for (const [k, i] of run.instances.entries()) {
        const r = roomOf(run, i.id), f = run.content[k].finish;
        if (r.id.startsWith('metro_hall_')) expect([f.wall, f.floor], i.roomId).toEqual(['f_metro_marble', 'f_metro_granite']);
        if (has(r, 'переход')) expect(f.wall, i.roomId).toBe('f_metro_tile');
        if (has(r, 'служебное')) expect(f.wall, i.roomId).toBe('f_metro_slu');
        if (has(r, 'сгоревший')) expect(f.wall, i.roomId).toBe('f_metro_soot');
      }
      expect(validateFoldRun(p, run), seed).toEqual([]);
    }
    // за 300 комнат от вестибюля — каждая сеть и обе маленькие станции хоть в трёх мирах из четырёх
    for (const [k, v] of found) expect(v, k).toBeGreaterThanOrEqual(3);
    expect(found.size).toBe(7);
  });

  it('эскалаторы: верх тоннеля на +8.1 (короткого +5.4) над низом; этажи растут вверх и вниз', () => {
    let up = 0, down = 0, tunnels = 0;
    for (const seed of ['e1', 'e2', 'e3', 'e4']) {
      const w = metro(seed);
      walk(w, 250);
      const run = w.run();
      const inst = new Map(run.instances.map((i) => [i.id, i]));
      const z0 = inst.get(w.startId!)!.z ?? 0;
      expect(z0).toBe(0);
      for (const i of run.instances) {
        const r = roomOf(run, i.id);
        if (!has(r, 'эскалатор')) continue;
        tunnels++;
        const rise = r.stair!.flights[0].z1;
        for (const [o, mine] of neighbours(run, i.id)) {
          const side = r.connectors.find((c) => c.id === mine)!.side;
          // сосед у верхнего торца стоит на rise выше низа тоннеля
          expect(inst.get(o)!.z ?? 0, i.id).toBeCloseTo((i.z ?? 0) + (side === 'N' ? rise : 0), 6);
        }
      }
      for (const i of run.instances) {
        const z = i.z ?? 0;
        if (z > 1e-6) up++;
        if (z < -1e-6) down++;
      }
      expect(validateFoldRun(p, run), seed).toEqual([]);
    }
    expect(tunnels).toBeGreaterThanOrEqual(6);
    expect(up).toBeGreaterThan(0);
    expect(down).toBeGreaterThan(0);
  });

  it('бесконечность: швы прямых участков (зал, переходы) и кольца из вестибюлей — своей сетью и без лестниц', () => {
    let rings = 0, wraps = 0, hallWraps = 0;
    // швы — по умолчанию (10% на кусок не ближе 30 м к вестибюлю); кольца — из каждого вестибюля, вестибюли часто
    const ringy = { biomes: newWorldSettings().biomes.map((b) => (b.id === 'metro' ? { ...b, tunnels: tun({ ring: 1, hubEvery: [30, 60] }) } : b)) };
    for (const [seed, o] of [['r1', {}], ['r2', {}], ['r3', ringy], ['r4', ringy], ['r5', ringy]] as const) {
      const w = metro(seed, o);
      walk(w, 200);
      const run = w.run();
      rings += w.stats().rings;
      wraps += w.stats().wraps;
      for (const l of run.links) {
        if (l.kind) continue;
        const ca = roomOf(run, l.a.inst).connectors.find((c) => c.id === l.a.connector)!;
        const cb = roomOf(run, l.b.inst).connectors.find((c) => c.id === l.b.connector)!;
        expect(ca.len).toBe(cb.len);
        if (!l.wrap) continue;
        expect(ca.tag, `${ca.tag}–${cb.tag}`).toBe(cb.tag);
        if (ca.tag === 'metro_hall') hallWraps++;
        for (const i of [l.a.inst, l.b.inst]) expect(roomOf(run, i).tags).not.toContain('лестница');
      }
      expect(validateFoldRun(p, run), seed).toEqual([]);
    }
    expect(rings).toBeGreaterThanOrEqual(2);
    expect(wraps).toBeGreaterThanOrEqual(4);
    expect(hallWraps).toBeGreaterThanOrEqual(1);
  });

  it('выход — двери вестибюля «Выход в город»: за ними квартиры, остальные выходы метро исчезают', () => {
    const w = metro('up');
    walk(w, 150);
    const exits = exitsOf(w);
    expect(exits.length).toBeGreaterThanOrEqual(1);
    for (const [i, c] of exits) expect(roomOf(w.run(), i).connectors.find((x) => x.id === c)!.tag).toBe('stair');
    const id = w.openDoor(...exits[0])!;
    expect(id).toBeTruthy();
    expect(w.clusterAt(id)!.tunnels).toBe(false);
    expect(roomOf(w.run(), id).tags).not.toContain('метро');
    for (const [x, y] of exits.slice(1)) expect(w.doorState(x, y)).toBe('dead');
    expect(validateFoldRun(p, w.run())).toEqual([]);
  });

  it('вне биома метро нет: прежняя прогулка, прогон, квартиры хрущёвок', () => {
    const ownI = (run: Run) => run.instances.filter((i) => byId.get(i.roomId)!.tags[0] === 'метро');
    const legacy = createStreamWorld(p, streamSettings('legacy'));
    walk(legacy, 300);
    expect(ownI(legacy.run())).toEqual([]);
    expect(ownI(generateRun(p, { seed: 'g1', count: 80 }))).toEqual([]);
    const kh = createStreamWorld(p, streamSettings('kh', { world: world({ trAfter: 100000 }) }));
    walk(kh, 200);
    expect(ownI(kh.run())).toEqual([]);
  });

  it('сохранение → загрузка: метро растёт дальше так же', () => {
    const a = metro('save');
    walk(a, 90);
    const sv: StreamSave = JSON.parse(JSON.stringify(a.save()));
    const b = createStreamWorld(p, a.settings, sv);
    expect(b.stale).toBe(false);
    walk(a, 200);
    walk(b, 200);
    expect(b.run().instances.map((i) => [i.roomId, i.dx, i.dy, i.w, i.z ?? 0])).toEqual(a.run().instances.map((i) => [i.roomId, i.dx, i.dy, i.w, i.z ?? 0]));
  });
});
