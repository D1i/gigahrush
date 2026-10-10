// Лут комнат в мире прогулки: флаги мира (setFlag / flag / flags, takeLoot / lootTaken — кто первый), сохранение туда-
// обратно, мусор, предел FLAGS_MAX; WorldOp 'loot' / 'flag' у двух копий мира (как в коопе) и отпечаток; состояние ячейки
// у WorldDrop (n/q/w/u); точки лута lootOf на мире проекта по умолчанию — детерминизм, на полу комнаты или на мебели,
// предмет спота — на споте, хук комнаты получает rx, спец-локация — без лута.
import { afterEach, describe, expect, it } from 'vitest';
import { isFlatProp } from '../gen/walk';
import { ALL4, project, rectRoom } from '../gen/fixtures.test-util';
import { exportRunJSON } from '../gen/world';
import { createDefaultProject } from '../data/presets';
import { lootDef } from '../data/itemsLoot';
import { decodeCells, zInProp } from '../game/place';
import { registerLootRoom, type LootRoomInfo } from '../game/loot';
import { propHeightM } from '../blockout/core';
import type { RunExport, RunInstance } from '../blockout/types';
import type { Project } from '../model/types';
import { DEFAULT_WALK, WalkSession, type WorldOp } from '../view3d/walk';
import { newWorldSettings } from './biomes';
import { createStreamWorld, FLAGS_MAX, LOOT_FLAG, normDrop, streamSettings, type StreamSave, type StreamWorld, type WorldDrop } from './stream';
import { lootOf, lootRoomOf, tierRank, type LootSpot } from './streamLoot';

const proj = (): Project => project([rectRoom('box', 20, 16, { tags: ['start'], conns: ALL4(8) }), rectRoom('hall', 30, 10, { conns: ALL4(8) })]);
const p = proj();
const mk = (save?: StreamSave) => createStreamWorld(p, streamSettings('loot'), save);
const roundtrip = (s: StreamSave): StreamSave => JSON.parse(JSON.stringify(s));
/** без времени: момент сохранения и время генерации */
const noSavedAt = (s: StreamSave) => ({ ...s, savedAt: 0, run: { ...s.run, ms: 0 } });
const drop = (id: string, inst = 'i0', o: Partial<WorldDrop> = {}): WorldDrop => ({ id, item: 'it_matches', inst, x: 1.25, y: 0, z: -3.5, yaw: 0.7, ...o });

describe('stream: флаги мира и подобранный лут', () => {
  it('setFlag: кто первый — тот и поставил; порядок, номер версии; мир (куски) не трогается', () => {
    const w = mk();
    w.expand(w.startId!);
    let calls = 0;
    w.onChange(() => calls++);
    const run0 = w.run();
    expect(w.flags()).toEqual([]);
    expect(w.flagsRev()).toBe(0);
    expect(w.setFlag('unlock:i0/box_c1')).toBe(true);
    expect(w.setFlag('unlock:i0/box_c1')).toBe(false);
    expect(w.setFlag('x'.repeat(64))).toBe(true);
    for (const bad of ['', 'x'.repeat(65), 5, null, undefined, {}]) expect(w.setFlag(bad as string), String(bad)).toBe(false);
    expect(w.flag('unlock:i0/box_c1')).toBe(true);
    expect(w.flag('нет')).toBe(false);
    expect(w.flags()).toEqual(['unlock:i0/box_c1', 'x'.repeat(64)]);
    expect(w.flags()).toBe(w.flags());
    expect(Object.isFrozen(w.flags())).toBe(true);
    expect(w.flagsRev()).toBe(2);
    expect(calls).toBe(0);
    expect(w.run()).toBe(run0);
  });

  it('takeLoot: id «<inst>:L<k>» у существующего экземпляра — флаг «loot:<id>»; второй раз и негодные — false', () => {
    const w = mk();
    w.expand(w.startId!);
    const other = w.run().instances[1].id;
    expect(w.lootTaken('i0:L0')).toBe(false);
    expect(w.takeLoot('i0:L0')).toBe(true);
    expect(w.takeLoot('i0:L0')).toBe(false);
    expect(w.takeLoot(`${other}:L12`)).toBe(true);
    for (const bad of ['i0', 'i0:L', 'i0:Lx', 'i0:L12345', 'i9999:L0', ':L0', 'i0:l0', 'i0:L0 ', 7, null]) expect(w.takeLoot(bad as string), String(bad)).toBe(false);
    expect(w.lootTaken('i0:L0')).toBe(true);
    expect(w.lootTaken(`${other}:L12`)).toBe(true);
    expect(w.lootTaken('i0:L1')).toBe(false);
    expect(w.flag(LOOT_FLAG + 'i0:L0')).toBe(true);
    expect(w.flags()).toEqual(['loot:i0:L0', `loot:${other}:L12`]);
    expect(w.lootRev()).toBe(2);
    // общий набор: флаг «loot:…» напрямую — тот же предмет
    expect(w.setFlag('loot:i0:L3')).toBe(true);
    expect(w.takeLoot('i0:L3')).toBe(false);
    expect(w.lootRev()).toBe(w.flagsRev());
  });

  it('сохранение: только если есть; туда и обратно — те же флаги (порядок) и то же сохранение', () => {
    const A = mk();
    A.expand(A.startId!);
    expect('flags' in A.save()).toBe(false);
    A.takeLoot('i0:L1');
    A.setFlag('unlock:i1/hall_c0');
    A.takeLoot('i0:L0');
    const sv = roundtrip(A.save());
    expect(sv.flags).toEqual(['loot:i0:L1', 'unlock:i1/hall_c0', 'loot:i0:L0']);
    const B = mk(sv);
    expect(B.stale).toBe(false);
    expect(B.flags()).toEqual(A.flags());
    expect(B.lootTaken('i0:L1')).toBe(true);
    expect(B.takeLoot('i0:L0')).toBe(false);
    expect(B.flagsRev()).toBe(0);
    expect(noSavedAt(B.save())).toEqual(noSavedAt(A.save()));
  });

  it('мусор в сохранении — отброшен, мир не устарел; устаревшее сохранение — флаги пропали вместе с миром', () => {
    const A = mk();
    A.expand(A.startId!);
    const sv = roundtrip(A.save());
    for (const junk of ['x', 5, { a: 1 }, null]) {
      const w = mk({ ...sv, flags: junk as unknown as string[] });
      expect(w.stale).toBe(false);
      expect(w.flags()).toEqual([]);
    }
    const w = mk({ ...sv, flags: ['a', 5, '', 'x'.repeat(65), null, 'a', 'loot:i0:L0', { k: 1 }] as unknown as string[] });
    expect(w.flags()).toEqual(['a', 'loot:i0:L0']);
    A.setFlag('a');
    const p2 = proj();
    p2.rooms[0] = rectRoom('box', 22, 16, { tags: ['start'], conns: ALL4(8) });
    const B = createStreamWorld(p2, streamSettings('loot'), roundtrip(A.save()));
    expect(B.stale).toBe(true);
    expect(B.flags()).toEqual([]);
  });

  it(`предел ${FLAGS_MAX}: сверх него пропадают самые старые; из сохранения — последние ${FLAGS_MAX}`, () => {
    const w = mk();
    for (let i = 0; i < FLAGS_MAX + 5; i++) w.setFlag(`f${i}`);
    expect(w.flags()).toHaveLength(FLAGS_MAX);
    expect(w.flags()[0]).toBe('f5');
    expect(w.flag('f0')).toBe(false);
    // вытесненный — снова ставится
    expect(w.setFlag('f0')).toBe(true);
    expect(w.flags()[FLAGS_MAX - 1]).toBe('f0');
    const B = mk({ ...roundtrip(w.save()), flags: Array.from({ length: FLAGS_MAX + 50 }, (_, i) => `s${i}`) });
    expect(B.flags()).toHaveLength(FLAGS_MAX);
    expect(B.flags()[0]).toBe('s50');
  });

  it("WorldOp 'loot' / 'flag': у двух копий мира (кооп) — одинаково, второй раз — null; отпечаток — с флагами, только если есть", () => {
    const opts = { ...DEFAULT_WALK, seed: 'loot-coop', clusters: false };
    const A = new WalkSession(p, opts, { save: null, opened: [], key: 'test/A' });
    const B = new WalkSession(p, opts, { save: null, opened: [], key: 'test/B' });
    const start = A.world.startId!;
    A.apply({ k: 'enter', id: start });
    B.apply({ k: 'enter', id: start });
    const fp0 = A.fingerprint();
    expect(fp0).not.toMatch(/\/f\d/);
    const ops: WorldOp[] = [
      { k: 'loot', id: `${start}:L0` },
      { k: 'loot', id: `${start}:L0` },
      { k: 'flag', id: `unlock:${start}/box_c1` },
      { k: 'flag', id: `unlock:${start}/box_c1` },
      { k: 'loot', id: 'i9999:L0' },
      { k: 'loot', id: 'мусор' },
      { k: 'flag', id: 'x'.repeat(65) },
      { k: 'flag', id: `loot:${start}:L1` },
      { k: 'loot', id: `${start}:L1` },
    ];
    const ra = ops.map((op) => A.apply(op));
    const rb = ops.map((op) => B.apply(op));
    expect(ra).toEqual([`${start}:L0`, null, `unlock:${start}/box_c1`, null, null, null, null, `loot:${start}:L1`, null]);
    expect(rb).toEqual(ra);
    expect(A.world.flags()).toEqual([`loot:${start}:L0`, `unlock:${start}/box_c1`, `loot:${start}:L1`]);
    expect(B.world.flags()).toEqual(A.world.flags());
    expect(B.fingerprint()).toBe(A.fingerprint());
    expect(A.fingerprint()).toBe(`${fp0}/f3:loot:${start}:L1`);
    expect(noSavedAt(B.world.save())).toEqual(noSavedAt(A.world.save()));
    // опоздавший — из сохранения (чекпойнт): те же флаги и отпечаток
    const C = new WalkSession(p, opts, { save: roundtrip(A.world.save()), opened: [], key: 'test/C' });
    expect(C.world.flags()).toEqual(A.world.flags());
    expect(C.fingerprint()).toBe(A.fingerprint());
    expect(C.apply({ k: 'loot', id: `${start}:L0` })).toBeNull();
    for (const s of [A, B, C]) s.dispose();
  });
});

describe('stream: состояние ячейки у выброшенного предмета (n/q/w/u)', () => {
  it('normDrop: n целое 1…999, u целое 0…255 — иначе негодный; q и w — прижаты к 0…1; сохранение туда-обратно', () => {
    const full = drop('a', 'i0', { n: 7, q: 0.25, w: 1, u: 3 });
    expect(normDrop(full)).toEqual(full);
    expect(normDrop(drop('a', 'i0', { q: 1.5, w: -0.2 }))).toEqual(drop('a', 'i0', { q: 1, w: 0 }));
    expect(normDrop(drop('a', 'i0', { n: 1, u: 0 }))).toEqual(drop('a', 'i0', { n: 1, u: 0 }));
    const bad: Partial<WorldDrop>[] = [
      { n: 0 }, { n: 1000 }, { n: 1.5 }, { n: NaN }, { n: '3' as unknown as number }, { u: 256 }, { u: -1 }, { u: 0.5 },
      { q: NaN }, { q: Infinity }, { q: '0.5' as unknown as number }, { w: null as unknown as number },
    ];
    for (const o of bad) expect(normDrop(drop('a', 'i0', o)), JSON.stringify(o)).toBeNull();
    const A = mk();
    expect(A.dropItem(full)).toBe(true);
    expect(A.dropItem(drop('b', 'i0', { item: 'it_kerosene', q: 0.75 }))).toBe(true);
    expect(A.dropItem(drop('c', 'i0', { n: 0 }))).toBe(false);
    const sv = roundtrip(A.save());
    expect(sv.drops).toEqual([full, drop('b', 'i0', { item: 'it_kerosene', q: 0.75 })]);
    const B = mk(sv);
    expect(B.drops()).toEqual(A.drops());
    expect(B.pickItem('a')).toEqual(full);
  });
});

// ───────────────────────── точки лута на мире проекта по умолчанию ─────────────────────────

const dp = (() => {
  const x = createDefaultProject();
  x.finishes ??= [];
  x.finishRules ??= [];
  return x;
})();

/** Мир хрущёвок с квартирой старта (и соседними, пока не наберётся n комнат) — раскрыт в ширину. */
function khrush(seed: string, n = 40): { w: StreamWorld; rx: RunExport } {
  const w = createStreamWorld(dp, streamSettings(seed, { world: { ...newWorldSettings(), startBiome: 'khrush', trAfter: 100000 } }));
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
  return { w, rx: exportRunJSON(dp, w.run()) as RunExport };
}

/** Мебель экземпляра (не плоская): рамки w × d, повёрнутые на rot, в мировых клетках; высота болванки, м. */
function solids(rx: RunExport, i: RunInstance): { x: number; y: number; rot: number; hw: number; hh: number; h: number }[] {
  const props = new Map(rx.props.map((x) => [x.id, x] as const));
  const out: { x: number; y: number; rot: number; hw: number; hh: number; h: number }[] = [];
  const add = (id: string, x: number, y: number, rot: number) => {
    const pr = props.get(id);
    if (pr && !isFlatProp(pr)) out.push({ x, y, rot, hw: pr.w / rx.cellM / 2, hh: pr.h / rx.cellM / 2, h: propHeightM(pr.tags, pr.name) });
  };
  for (const d of i.decor) add(d.propId, d.x, d.y, d.rot);
  for (const s of i.spots) if (s.content?.kind === 'prop') add(s.content.id, s.x, s.y, s.contentRot ?? s.rot + (s.content.rot ?? 0));
  return out;
}
const inBox = (b: { x: number; y: number; rot: number; hw: number; hh: number }, px: number, py: number, pad = 0): boolean => {
  const t = (b.rot * Math.PI) / 180, c = Math.cos(t), s = Math.sin(t);
  const dx = px - b.x, dy = py - b.y;
  return Math.abs(dx * c + dy * s) <= b.hw + pad && Math.abs(-dx * s + dy * c) <= b.hh + pad;
};

describe('lootOf: точки лута в мире', { timeout: 300000 }, () => {
  const off: (() => void)[] = [];
  afterEach(() => {
    while (off.length) off.pop()!();
  });

  it('детерминизм: у двух копий мира — те же точки; кэш; id «<inst>:L<k>»; подобранные — тоже в списке', () => {
    const a = khrush('лут-1'), b = khrush('лут-1');
    let total = 0;
    for (const i of a.rx.instances) {
      const la = lootOf(a.w, i.id, a.rx);
      expect(lootOf(b.w, i.id, b.rx)).toEqual(la);
      expect(lootOf(a.w, i.id, a.rx)).toBe(la);
      expect(Object.isFrozen(la)).toBe(true);
      la.forEach((s, k) => {
        expect(s.id).toBe(`${i.id}:L${k}`);
        expect(s.id.length).toBeLessThanOrEqual(64);
        expect(s.inst).toBe(i.id);
      });
      total += la.length;
    }
    expect(total).toBeGreaterThan(10);
    const first = a.rx.instances.map((i) => lootOf(a.w, i.id, a.rx)).find((l) => l.length)!;
    const rev = a.w.lootRev();
    expect(a.w.takeLoot(first[0].id)).toBe(true);
    expect(a.w.lootRev()).toBe(rev + 1);
    expect(a.w.lootTaken(first[0].id)).toBe(true);
    expect(lootOf(a.w, first[0].inst, a.rx)).toBe(first);
    // экземпляра нет в rx — пусто и не в кэше
    const c = khrush('лут-1');
    expect(lootOf(c.w, 'i5', { ...c.rx, instances: [] })).toEqual([]);
    expect(lootOf(c.w, 'i5', c.rx)).toEqual(lootOf(a.w, 'i5', a.rx));
  });

  it('где лежит: в клетках своей комнаты; на полу (y = низ комнаты) — не в стене и не в мебели; выше — на мебели / площадке', () => {
    let floor = 0, raised = 0;
    const bad: string[] = [];
    for (const seed of ['лут-2', 'лут-3', 'лут-4']) {
      const { w, rx } = khrush(seed);
      const c = rx.cellM;
      for (const i of rx.instances) {
        const cells = decodeCells(i.cells);
        const boxes = solids(rx, i);
        for (const s of lootOf(w, i.id, rx)) {
          const px = s.x / c, py = -s.z / c;
          const cx = Math.floor(px), cy = Math.floor(py);
          if (!cells.has(`${cx},${cy}`)) bad.push(`${s.id}: вне комнаты`);
          if (![s.x, s.y, s.z, s.yaw].every(Number.isFinite) || Math.abs(s.yaw) > Math.PI + 1e-3) bad.push(`${s.id}: числа ${s.yaw}`);
          const h = s.y - (i.z ?? 0);
          const pads = (i.stair?.pads ?? []).filter((q) => px > q.x0 && px < q.x1 && py > q.y0 && py < q.y1).map((q) => q.z);
          if (Math.abs(h) < 1e-6) {
            floor++;
            // не в стене: соседние клетки (±1 клетка = 0.1 м) — тоже пол комнаты; не в мебели
            for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (!cells.has(`${cx + dx},${cy + dy}`)) bad.push(`${s.id}: у самой стены`);
            if (boxes.some((b) => inBox(b, px, py))) bad.push(`${s.id}: в мебели`);
          } else {
            raised++;
            // на мебели (сверху у низкой, на середине у высокой) или на площадке лестницы
            const ok = boxes.some((b) => inBox(b, px, py, 1e-6) && Math.abs(zInProp(b.h) - h) < 2e-3) || pads.some((z) => Math.abs(z - h) < 2e-3)
              || pads.some((z) => boxes.some((b) => inBox(b, px, py, 1e-6) && Math.abs(z + zInProp(b.h) - h) < 2e-3));
            if (!ok) bad.push(`${s.id}: висит на ${h}`);
          }
        }
      }
    }
    expect(bad).toEqual([]);
    expect(floor).toBeGreaterThan(20);
    expect(raised).toBeGreaterThan(0);
  });

  it('предмет каталога на споте комнаты — на этом споте; элитность — ранг тира по уровню', () => {
    let found = 0;
    for (const seed of ['лут-2', 'лут-5', 'лут-6']) {
      const { w, rx } = khrush(seed);
      const c = rx.cellM;
      for (const i of rx.instances) {
        const spots = lootOf(w, i.id, rx);
        for (const sp of i.spots) {
          const d = sp.content?.kind === 'item' ? lootDef(sp.content.id) : null;
          if (!d || d.rarity === 'unique') continue;
          const at = (s: LootSpot) => s.item === d.id && Math.abs(s.x - sp.x * c) < 2e-3 && Math.abs(s.z + sp.y * c) < 2e-3;
          expect(spots.some(at), `${i.id}/${sp.id} ${d.id}`).toBe(true);
          found++;
        }
        expect(lootRoomOf(w, i.id, rx)!.tier).toBe(tierRank(rx, i.tier));
      }
    }
    expect(found).toBeGreaterThan(0);
    const tiers = [{ id: 'b', level: 5 }, { id: 'a', level: 1 }, { id: 'c', level: 8 }, { id: 'd', level: 12 }, { id: 'e', level: 15 }, { id: 'f', level: 3 }];
    const rx = { tiers } as unknown as RunExport;
    expect(['a', 'f', 'b', 'c', 'd', 'e', 'нет', null].map((t) => tierRank(rx, t))).toEqual([0, 1, 2, 3, 4, 4, 0, 0]);
  });

  it('хук комнаты: получает rx и вид комнаты; обязательное — первой точкой; спец-локация — без лута', () => {
    const { w, rx } = khrush('лут-7', 12);
    const seen: LootRoomInfo[] = [];
    off.push(registerLootRoom('khrush', (r) => (seen.push(r), r.inst === 'i1' ? { force: [{ item: 'it_key', n: 2 }] } : null)));
    const l1 = lootOf(w, 'i1', rx);
    expect(l1[0]).toMatchObject({ id: 'i1:L0', item: 'it_key', n: 2, inst: 'i1' });
    expect(seen[0].rx).toBe(rx);
    expect(seen[0]).toMatchObject({ inst: 'i1', addr: w.addressOf('i1'), biome: 'khrush', roomId: rx.instances[1].roomId });
    // спец-локация (здесь — подменённый locationOf) — пусто
    const fake = Object.create(w) as StreamWorld;
    fake.locationOf = () => ({ kind: 'lair', spec: { kind: 'lair' }, roll: null }) as unknown as ReturnType<StreamWorld['locationOf']>;
    expect(lootOf(fake, 'i1', rx)).toEqual([]);
    expect(lootRoomOf(fake, 'i1', rx)).toBeNull();
  });
});
