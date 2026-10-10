// Погреб бесконечного мира (docs/GENERATOR-4D.md §25): нора земляных ходов 0.6 м и щелей 0.4 м (только боком) из своих
// комнат, клетушки за щелями, вход — камера с лазом наверх, выход — камера с дверью в снег (по правилу хабов: не ближе
// 40 м ходами от прошлой камеры), переходов по счётчику нет, обвал и раскопка — как в снегу; модели предметов погреба.
import { describe, expect, it } from 'vitest';
import { getBounds, NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { fileURLToPath } from 'node:url';
import { propHeightM } from '../blockout/core';
import { createDefaultProject } from '../data/presets';
import { PROP_DEFS } from '../data/props';
import { TAG_LEN } from '../data/roomBuilder';
import { BIOME_ONLY_TAG, generateRun } from '../gen/generate';
import { SNOWDOOR_CONN } from '../locations/storyDoors';
import { cellKey, parseKey } from '../model/cells';
import type { Project, Room, Run, WorldSettings } from '../model/types';
import { newWorldSettings, storyWorld, TUNNEL_PASS_TAGS, tunnelKind } from './biomes';
import { validateFoldRun } from './fold';
import { createStreamWorld, streamSettings, type StreamSave, type StreamWorld } from './stream';

const project = (): Project => {
  const p = createDefaultProject();
  p.finishes ??= [];
  p.finishRules ??= [];
  return p;
};
const p = project();
const roomOf = (run: Run, id: string) => p.rooms.find((r) => r.id === run.instances.find((i) => i.id === id)!.roomId)!;
const world = (o: Partial<WorldSettings> = {}): WorldSettings => ({ ...newWorldSettings(), ...o });
const cellar = (seed: string, o: Partial<WorldSettings> = {}) =>
  createStreamWorld(p, streamSettings(seed, { world: world({ startBiome: 'cellar', trAfter: 100000, ...o }) }));
const CEL = (r: Room) => r.tags[0] === 'погреб' && r.tags.includes(BIOME_ONLY_TAG);

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
      if (l.kind === 'descent' || l.kind === 'lift' || l.sealed) continue;
      if (l.a.inst === id && !seen.has(l.b.inst)) q.push(l.b.inst);
      if (l.b.inst === id && !seen.has(l.a.inst)) q.push(l.a.inst);
    }
  }
}
/** Идти вглубь, как игрок: раскрыть кусок, дальше — в последний ещё не пройденный соседний (тупик — назад). */
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
const exitsOf = (w: StreamWorld) => w.run().instances.filter((i) => roomOf(w.run(), i.id).location?.kind === 'snowdoor');

/** Ширины пола по строкам (клетки), по оси север — юг. */
function rowWidths(r: Room): number[] {
  const pts = [...r.cells].map(parseKey);
  const y0 = Math.min(...pts.map(([, y]) => y)), y1 = Math.max(...pts.map(([, y]) => y));
  const out: number[] = [];
  for (let y = y0; y <= y1; y++) out.push(pts.filter(([, yy]) => yy === y).length);
  return out;
}

describe('погреб: нора земляных ходов', { timeout: 300000 }, () => {
  const rooms = p.rooms.filter(CEL);

  it('комнаты: ходы 0.6 м (cellar), щели 0.4 м — боком, клетушки за щелью, камеры с лазом наверх; только в биоме', () => {
    expect(rooms.length).toBeGreaterThanOrEqual(20);
    for (const r of p.rooms.filter((x) => x.tags.includes('погреб') && x.tags.includes(BIOME_ONLY_TAG))) expect(r.tags[0], r.id).toBe('погреб');
    for (const r of rooms) {
      expect(tunnelKind(r), r.id).not.toBeNull();
      for (const c of r.connectors) {
        if (c.id === SNOWDOOR_CONN) continue;
        expect(['cellar', 'cellar>bin', 'bin>cellar', 'stair'], `${r.id} ${c.tag}`).toContain(c.tag);
        if (c.tag === 'cellar') expect(c.len, r.id).toBe(6);
        if (c.tag !== 'cellar' && c.tag !== 'stair') expect(c.len, r.id).toBe(4);
      }
      // подвесных предметов нет: потолок болванки (2.5 м) в погребе не виден
      for (const d of r.decor) expect(p.props.find((x) => x.id === d.propId)!.tags, `${r.id} ${d.propId}`).not.toContain('потолок');
    }
    expect(TAG_LEN.cellar).toBe(6);
    expect(TAG_LEN['cellar>bin']).toBe(4);
    const kinds = new Set(rooms.map((r) => tunnelKind(r)));
    for (const k of ['straight', 'turn', 'branch', 'storage', 'hub']) expect(kinds.has(k as never), k).toBe(true);
    // щели — «песочные часы»: устья во всю ширину хода, середина 0.4 м
    const sq = rooms.filter((r) => r.tags.includes('щель'));
    expect(sq.length).toBeGreaterThanOrEqual(3);
    for (const r of sq) {
      expect(tunnelKind(r), r.id).toBe('straight');
      const ws = rowWidths(r);
      expect(ws[0], r.id).toBe(6);
      expect(ws[ws.length - 1], r.id).toBe(6);
      expect(Math.min(...ws), r.id).toBe(4);
      expect(ws.filter((x) => x === 4).length, r.id).toBeGreaterThanOrEqual(12);
    }
    // по весам: щели — заметная доля прямых кусков (идти боком часто)
    const straight = rooms.filter((r) => tunnelKind(r) === 'straight');
    const wSq = sq.reduce((s, r) => s + r.gen.weight, 0), wSt = straight.reduce((s, r) => s + r.gen.weight, 0);
    expect(wSq / wSt).toBeGreaterThan(0.6);
    // клетушки — одна щель 'bin>cellar'
    for (const r of rooms.filter((x) => tunnelKind(x) === 'storage')) expect(r.connectors.map((c) => c.tag), r.id).toEqual(['bin>cellar']);
    // обычные камеры: без спец-локации, ≥ 3 хода и лаз наверх ('stair' — вход из люка сарая)
    const hubs = rooms.filter((r) => tunnelKind(r) === 'hub' && !r.location);
    expect(hubs.length).toBeGreaterThanOrEqual(2);
    for (const r of hubs) {
      expect(r.connectors.filter((c) => c.tag === 'cellar').length, r.id).toBeGreaterThanOrEqual(3);
      expect(r.connectors.filter((c) => c.tag === 'stair').length, r.id).toBe(1);
    }
  });

  it('выход — только камера с дверью в снег: хаб, спец-локация snowdoor, метка SNOWDOOR_CONN на стене (не проход сети)', () => {
    const ex = rooms.filter((r) => r.location);
    expect(ex.map((r) => r.id)).toEqual(['cel_hub_snowdoor']);
    const r = ex[0];
    expect(r.location?.kind).toBe('snowdoor');
    expect(tunnelKind(r)).toBe('hub');
    expect(r.gen.weight).toBeGreaterThan(0);
    expect(r.tags.slice(0, 2)).toEqual(['погреб', 'хаб']);
    const c = r.connectors.find((x) => x.id === SNOWDOOR_CONN)!;
    expect(c).toBeDefined();
    expect(TUNNEL_PASS_TAGS.has(c.tag)).toBe(false);
    expect(c.len).toBe(TAG_LEN[c.tag as keyof typeof TAG_LEN]);
    expect(r.doors.some((d) => d.side === c.side && d.cx === c.cx && d.cy === c.cy && d.len === c.len)).toBe(true);
    // на стене: клетки проёма в комнате, снаружи — нет
    expect(r.cells.has(cellKey(c.cx, c.cy))).toBe(true);
    expect(r.connectors.filter((x) => x.tag === 'cellar').length).toBeGreaterThanOrEqual(3);
  });

  it('старт в погребе — камера (не выход); растут только комнаты погреба; щелей треть, развилок и поворотов много; выход — через 40–100 м', () => {
    let found = 0;
    for (const seed of ['погреб-1', 'погреб-2', 'погреб-3']) {
      const w = cellar(seed);
      const start = roomOf(w.run(), w.startId!);
      expect(tunnelKind(start)).toBe('hub');
      expect(start.location).toBeFalsy();
      crawl(w, 450);
      const run = w.run();
      expect(w.clusterAt(w.startId!)?.tunnels).toBe(true);
      expect(w.clusterAt(w.startId!)?.biome?.id).toBe('cellar');
      for (const i of run.instances) expect(CEL(roomOf(run, i.id)), i.id).toBe(true);
      const all = run.instances.map((i) => roomOf(run, i.id));
      const pass = all.filter((r) => r.tags.includes('ход'));
      const share = pass.filter((r) => r.tags.includes('щель')).length / pass.length;
      expect(share, seed).toBeGreaterThan(0.25);
      expect(share, seed).toBeLessThan(0.5);
      const k = all.map((r) => tunnelKind(r));
      expect(k.filter((x) => x === 'branch').length / k.length).toBeGreaterThan(0.1);
      expect(k.filter((x) => x === 'turn').length / k.length).toBeGreaterThan(0.15);
      expect(k.filter((x) => x === 'storage').length).toBeGreaterThan(5);
      // метры ходом от прошлой камеры: выход — не ближе 40 м (у родителя), дальше 100 м без камеры не уходят
      const td = w.save().world!.tdist!;
      for (const e of exitsOf(w)) {
        const par = run.instances.find((x) => x.id === e.parent)!;
        expect(td[par.order], `${seed} ${e.id}`).toBeGreaterThanOrEqual(40);
        expect(e.depth, `${seed} ${e.id}`).toBeGreaterThanOrEqual(12);
      }
      expect(Math.max(...td), seed).toBeLessThanOrEqual(105);
      found += exitsOf(w).length;
      if (seed === 'погреб-1') expect(validateFoldRun(p, run)).toEqual([]);
    }
    expect(found).toBeGreaterThan(0);
  });

  it('переходов по счётчику в погребе нет (выход — свой: дверь в снег)', () => {
    const w = cellar('погреб-переход', { trAfter: 0, trBase: 1, trStep: 0 });
    for (let k = 0; k < 5; k++) {
      walk(w, 60 + k * 40);
      for (const i of w.run().instances) w.enter(i.id);
    }
    expect(w.transitionState()?.pending).toBe(true);
    for (const i of w.run().instances) {
      const r = roomOf(w.run(), i.id);
      expect(CEL(r), i.id).toBe(true);
      expect(r.location?.kind === undefined || r.location.kind === 'snowdoor', i.id).toBe(true);
    }
  });

  it('дверь в снег: метка глухая с постановки; descend — снежные тоннели, счётчик с нуля', () => {
    let hit: { w: StreamWorld; id: string } | null = null;
    for (const seed of ['снег-1', 'снег-2', 'снег-3', 'снег-4']) {
      const w = cellar(seed);
      crawl(w, 400);
      const e = exitsOf(w)[0];
      if (e) {
        hit = { w, id: e.id };
        break;
      }
    }
    expect(hit).not.toBeNull();
    const { w, id } = hit!;
    expect(w.doorState(id, SNOWDOOR_CONN)).toBe('dead');
    expect(w.locationOf(id)?.kind).toBe('snowdoor');
    const r0 = w.transitionState()!.resets;
    const out = w.descend(id);
    expect(w.descend(id)).toBe(out);
    expect(w.clusterAt(out)?.biome?.id).toBe('snow');
    expect(w.transitionState()!.resets).toBe(r0 + 1);
    expect(w.run().links.some((l) => l.kind === 'descent' && l.a.inst === id && l.b.inst === out)).toBe(true);
  });

  it('обвал и раскопка: проём завален навсегда (обе метки), работа копится — всё переживает сохранение', () => {
    const w = cellar('погреб-обвал');
    walk(w, 80);
    const links = w.run().links.filter((x) => !x.kind || x.kind === 'door');
    const [l, m] = [links[0], links[1]];
    expect(w.collapse(l.a.inst, l.a.connector)).toBe(true);
    expect(w.collapse(m.a.inst, m.a.connector)).toBe(true);
    expect(w.doorState(l.b.inst, l.b.connector)).toBe('collapsed');
    expect(w.digThrough(m.a.inst, m.a.connector, 0.4)).toBeCloseTo(0.4);
    const w2 = createStreamWorld(p, w.settings, JSON.parse(JSON.stringify(w.save())) as StreamSave);
    expect(w2.stale).toBe(false);
    expect(w2.doorState(l.a.inst, l.a.connector)).toBe('collapsed');
    expect(w2.doorState(l.b.inst, l.b.connector)).toBe('collapsed');
    expect(w2.collapseProgress(m.b.inst, m.b.connector)).toBeCloseTo(0.4);
    expect(w2.digThrough(m.b.inst, m.b.connector, 0.6)).toBe(1);
    expect(w2.doorState(m.a.inst, m.a.connector)).toBe('linked');
    const w3 = createStreamWorld(p, w2.settings, w2.save());
    expect(w3.doorState(m.b.inst, m.b.connector)).toBe('linked');
    expect(w3.doorState(l.b.inst, l.b.connector)).toBe('collapsed');
  });

  it('сохранение → загрузка: погреб растёт дальше так же; тот же сид — тот же погреб', () => {
    const a = cellar('погреб-сохранение');
    walk(a, 90);
    const b = createStreamWorld(p, a.settings, JSON.parse(JSON.stringify(a.save())) as StreamSave);
    expect(b.stale).toBe(false);
    expect(b.run().links).toEqual(a.run().links);
    walk(a, 200);
    walk(b, 200);
    expect(b.run().instances.map((i) => [i.roomId, i.dx, i.dy, i.w])).toEqual(a.run().instances.map((i) => [i.roomId, i.dx, i.dy, i.w]));
    expect(validateFoldRun(p, b.run())).toEqual([]);
    const c = cellar('погреб-сохранение');
    walk(c, 200);
    expect(c.run().links).toEqual(a.run().links);
  });

  it('предметы: у каждого p_cel_* — модель (≤ 2500 треугольников, цвет в гамме, без свечения); крепь не загораживает ход', async () => {
    const doc = await new NodeIO().registerExtensions(ALL_EXTENSIONS).read(fileURLToPath(new URL('../view3d/assets/cellar_props.glb', import.meta.url)));
    const nodes = new Map(doc.getRoot().listScenes()[0].listChildren().map((n) => [n.getName(), n] as const));
    const defs = PROP_DEFS.filter((x) => x.id.startsWith('p_cel_'));
    expect(defs.length).toBe(7);
    for (const d of defs) {
      const n = nodes.get(d.id);
      expect(n, d.id).toBeTruthy();
      const b = getBounds(n!);
      expect(b.min[1], d.id).toBeCloseTo(0, 2);
      // крепь шире прохода на стойки (уходят в стены), прочее — по плану
      expect(b.max[0] - b.min[0], d.id).toBeLessThanOrEqual(d.w + 0.15);
      let tris = 0;
      for (const pr of n!.getMesh()!.listPrimitives()) {
        tris += pr.getIndices()!.getCount() / 3;
        const m = pr.getMaterial()!;
        expect(m.getName(), d.id).toMatch(/^cel_/);
        expect(Math.max(...m.getBaseColorFactor().slice(0, 3)), `${d.id} ${m.getName()}`).toBeGreaterThan(0.12);
        expect(m.getEmissiveFactor(), d.id).toEqual([0, 0, 0]);
      }
      expect(tris, d.id).toBeLessThanOrEqual(2500);
    }
    for (const id of nodes.keys()) expect(defs.some((d) => d.id === id), id).toBe(true);
    const h = (id: string) => propHeightM(PROP_DEFS.find((x) => x.id === id)!.tags, PROP_DEFS.find((x) => x.id === id)!.name);
    expect(h('p_cel_frame')).toBe(0.01);
    expect(h('p_cel_frame_narrow')).toBe(0.01);
    expect(h('p_cel_heap')).toBe(0.25);
    expect(h('p_cel_shelf')).toBe(1.8);
    // перемычка крепи выше головы стоя (глаз 1.6 м)
    expect(getBounds(nodes.get('p_cel_frame')!).max[1]).toBeGreaterThan(1.8);
  });

  it('погреба нет вне биома: прежняя прогулка и прогоны; в мире сюжета погреб — свой биом, не заглушка', () => {
    const legacy = createStreamWorld(p, streamSettings('погреб-вне', { world: null }));
    walk(legacy, 150);
    for (const i of legacy.run().instances) expect(roomOf(legacy.run(), i.id).tags[0]).not.toBe('погреб');
    const run = generateRun(p, { ...p.generator, seed: 'погреб-прогон', count: 120 });
    for (const i of run.instances) expect(p.rooms.find((r) => r.id === i.roomId)!.tags[0]).not.toBe('погреб');
    const b = storyWorld(newWorldSettings()).biomes.find((x) => x.id === 'cellar')!;
    expect(b.tags.map((t) => t.tag)).toEqual(['погреб']);
    expect(b.layout).toBe('tunnels');
    expect(b.dark).toBe(1);
  });
});
