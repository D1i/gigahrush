import { afterEach, describe, expect, it } from 'vitest';
import type { RunExport, RunInstance } from '../blockout/types';
import {
  DORM,
  dormIndex,
  dormKind,
  dormValue,
  eliteAfter,
  isDormInstance,
  isObshInstance,
  noteText,
  plateText,
  rollDorm,
  type DormMeta,
} from './obshagaRooms';

const DEFAULTS = JSON.parse(JSON.stringify(DORM)) as typeof DORM;
afterEach(() => {
  Object.assign(DORM, JSON.parse(JSON.stringify(DEFAULTS)));
});

/** Много комнат: locs локаций по rooms комнат. */
function sample(seed: string, locs: number, rooms: number): DormMeta[] {
  const out: DormMeta[] = [];
  for (let l = 0; l < locs; l++) for (let k = 0; k < rooms; k++) out.push(rollDorm(seed, `i${l * 7 + 3}`, k));
  return out;
}

describe('rollDorm: доли', () => {
  const all = sample('доли', 150, 120);
  const later = all.filter((m) => m.k >= DORM.infEntryRooms);
  const share = (xs: DormMeta[], f: (m: DormMeta) => boolean) => xs.filter(f).length / Math.max(1, xs.length);

  it('номерные ≈ 25%, элитные ≈ 12% номерных', () => {
    const numbered = later.filter((m) => m.kind === 'numbered' || m.kind === 'elite');
    expect(numbered.length / later.length).toBeGreaterThan(0.24);
    expect(numbered.length / later.length).toBeLessThan(0.26);
    expect(share(numbered, (m) => m.kind === 'elite')).toBeGreaterThan(0.1);
    expect(share(numbered, (m) => m.kind === 'elite')).toBeLessThan(0.14);
  });

  it('номера: элитные — 6 цифр, номерные 1..999999 лог-равномерно, tier и табличка по виду', () => {
    // проверки — без expect на каждую комнату (дорого): копим нарушения
    const bad: DormMeta[] = [];
    for (const m of all) {
      const n = m.number;
      const ok =
        m.kind === 'plain'
          ? n === null && m.plate === null && m.tier === 0
          : m.kind === 'elite'
            ? Number.isInteger(n) && n! >= 100000 && n! <= 999999 && m.plate === String(n) && m.tier === 3
            : m.kind === 'numbered'
              ? Number.isInteger(n) && n! >= 1 && n! <= 999999 && m.plate === String(n) && m.tier === (n! < 100 ? 1 : 2)
              : Number.isInteger(n) && n! >= 1 && n! <= 999 && m.plate === `∞+${n}` && m.tier === 4;
      if (!ok) bad.push(m);
    }
    expect(bad).toEqual([]);
    const plain = later.filter((m) => m.kind === 'numbered');
    // шестизначные «пустышки» ≈ 1/6, меньше 100 ≈ 1/3
    expect(share(plain, (m) => m.number! >= 100000)).toBeGreaterThan(0.13);
    expect(share(plain, (m) => m.number! >= 100000)).toBeLessThan(0.2);
    expect(share(plain, (m) => m.number! < 100)).toBeGreaterThan(0.29);
    expect(share(plain, (m) => m.number! < 100)).toBeLessThan(0.38);
  });

  it('замки по виду', () => {
    for (const kind of ['plain', 'numbered', 'elite'] as const) {
      const xs = later.filter((m) => m.kind === kind);
      const p = share(xs, (m) => m.locked);
      const tol = kind === 'elite' ? 0.05 : 0.025;
      expect(Math.abs(p - DORM.locked[kind])).toBeLessThan(tol);
    }
    expect(all.filter((m) => m.kind === 'inf').every((m) => m.locked)).toBe(true);
  });

  it('записки: только в номерных/элитных, ≈ noteChance, указывают на следующую элитную', () => {
    expect(all.filter((m) => m.note != null).every((m) => m.kind === 'numbered' || m.kind === 'elite')).toBe(true);
    const numbered = later.filter((m) => m.kind === 'numbered' || m.kind === 'elite');
    expect(Math.abs(share(numbered, (m) => m.note != null) - DORM.noteChance)).toBeLessThan(0.04);
    let checked = 0;
    const bad: string[] = [];
    for (const m of all) {
      if (m.note == null) continue;
      const e = eliteAfter('доли', m.loc, m.k);
      const target = e && rollDorm('доли', m.loc, e.k);
      if (!e || e.number !== m.note || e.k <= m.k || target!.kind !== 'elite' || target!.number !== m.note || m.note < 100000 || m.note > 999999)
        bad.push(`${m.loc}/${m.k}`);
      // между ними элитных нет
      else for (let j = m.k + 1; j < e.k; j++) if (dormKind('доли', m.loc, j).kind === 'elite') bad.push(`${m.loc}/${m.k}→${j}`);
      checked++;
    }
    expect(bad).toEqual([]);
    expect(checked).toBeGreaterThan(500);
  });

  it('ключи: только за открытой дверью, ≈ keyChance; в первой открытой комнате локации — всегда', () => {
    expect(all.every((m) => !m.key || !m.locked)).toBe(true);
    const open = later.filter((m) => !m.locked && m.k > 10);
    expect(Math.abs(share(open, (m) => m.key) - DORM.keyChance)).toBeLessThan(0.025);
    for (let l = 0; l < 150; l++) {
      const loc = `i${l * 7 + 3}`;
      const first = all.find((m) => m.loc === loc && !m.locked)!;
      expect(first.key).toBe(true);
    }
  });
});

describe('∞', () => {
  it('ровно одна среди первых infEntryRooms комнат каждой локации', () => {
    for (let l = 0; l < 600; l++) {
      const loc = `i${l}`;
      const infs = [0, 1, 2].filter((k) => rollDorm('бесконечность', loc, k).kind === 'inf');
      expect(infs.length).toBe(1);
    }
    // какая из первых — разная по локациям
    const at = new Set<number>();
    for (let l = 0; l < 60; l++) for (let k = 0; k < 3; k++) if (dormKind('s', `i${l}`, k).kind === 'inf') at.add(k);
    expect(at.size).toBe(3);
  });

  it('ручка infEntryRooms читается вживую', () => {
    DORM.infEntryRooms = 5;
    for (let l = 0; l < 200; l++) {
      const infs = [0, 1, 2, 3, 4].filter((k) => dormKind('ручка', `i${l}`, k).kind === 'inf');
      expect(infs.length).toBe(1);
    }
  });

  it('дальше — ≈ infLaterChance (0.1%)', () => {
    let n = 0;
    let inf = 0;
    for (let l = 0; l < 400; l++)
      for (let k = 3; k < 1003; k++) {
        n++;
        if (dormKind('поздняя', `i${l}`, k).kind === 'inf') inf++;
      }
    // ожидание 400 при σ ≈ 20
    expect(n).toBe(400000);
    expect(inf).toBeGreaterThan(330);
    expect(inf).toBeLessThan(470);
  });
});

describe('детерминизм и JSON', () => {
  it('одинаковый сид → одинаково; разные — разное', () => {
    const a = sample('det', 20, 40);
    const b = sample('det', 20, 40);
    expect(b).toEqual(a);
    const c = sample('det2', 20, 40);
    expect(c).not.toEqual(a);
    expect(JSON.parse(JSON.stringify(a))).toEqual(a);
  });

  it('dormKind совпадает с rollDorm', () => {
    for (let k = 0; k < 300; k++) {
      const m = rollDorm('лёгкий', 'i5', k);
      expect(dormKind('лёгкий', 'i5', k)).toEqual({ kind: m.kind, number: m.number });
    }
  });

  it('ручки меняют исходы, но не сдвигают потоки', () => {
    const before = sample('ручки', 5, 60);
    DORM.locked.plain = 0;
    const after = sample('ручки', 5, 60);
    for (let n = 0; n < before.length; n++) {
      expect(after[n].kind).toBe(before[n].kind);
      expect(after[n].number).toBe(before[n].number);
    }
  });
});

describe('тексты и ценность', () => {
  it('табличка и записка', () => {
    expect(plateText({ kind: 'inf', number: 417 })).toBe('∞+417');
    expect(plateText({ kind: 'elite', number: 741213 })).toBe('741213');
    expect(plateText({ kind: 'plain', number: null })).toBeNull();
    expect(noteText({ loc: 'i0', k: 1, note: null })).toBeNull();
    const texts = new Set<string>();
    for (let k = 0; k < 200; k++) {
      const t = noteText({ loc: 'i0', k, note: 741213 })!;
      expect(t).toContain('741213');
      texts.add(t);
    }
    expect(texts.size).toBeGreaterThanOrEqual(5);
  });

  it('ценность монотонна по номеру и по виду', () => {
    expect(dormValue({ kind: 'plain', number: null })).toBe(0);
    let prev = 0;
    for (const n of [1, 2, 9, 10, 11, 99, 100, 312, 999, 1000, 54321, 99999, 100000, 999999]) {
      const v = dormValue({ kind: 'numbered', number: n });
      expect(v).toBeGreaterThan(prev);
      prev = v;
    }
    expect(prev).toBeLessThan(dormValue({ kind: 'elite', number: 100000 }));
    expect(dormValue({ kind: 'elite', number: 100000 })).toBeLessThan(dormValue({ kind: 'elite', number: 999999 }));
    expect(dormValue({ kind: 'elite', number: 999999 })).toBeLessThan(dormValue({ kind: 'inf', number: 1 }));
    expect(dormValue({ kind: 'inf', number: 1 })).toBe(1);
  });
});

// ───────────────────────── dormIndex на синтетическом прогоне ─────────────────────────

function inst(id: string, roomId: string, roomTags: string[]): RunInstance {
  return {
    id, roomId, roomName: roomId, roomTags, rot: 0, dx: 0, dy: 0, depth: 0, parent: null,
    bbox: { x0: 0, y0: 0, x1: 1, y1: 1 }, cells: [], doors: [], connectors: [], decor: [], spots: [],
    tier: null, danger: 0, dangerAcc: 0, loot: [],
  };
}
const cor = (id: string) => inst(id, 'obsh_cor_9', ['общага', 'коридор', 'ход', 'только-биом']);
const dorm = (id: string) => inst(id, 'obsh_room_2', ['общага', 'комната', 'только-биом']);
const hub = (id: string) => inst(id, 'obsh_hub_vahta', ['общага', 'вахта', 'хаб', 'только-биом']);
const khr = (id: string) => inst(id, 'khr_kitchen', ['хрущёвка', 'кухня']);
type Link = RunExport['links'][number];
const link = (a: string, b: string, extra: Partial<Link> = {}): Link => ({ a: { inst: a, connector: 'c' }, b: { inst: b, connector: 'c' }, ...extra });

function world(): RunExport {
  // A: i0 (вахта) — i1 — i2 коридоры, жилые i3, i5, i7; i8 — жилая за i9, связанным с i2 только швом wrap
  // B: i10 коридор, жилые i11, i12 (в массиве — не по порядку); i4 — хрущёвка между A и B (не общага: не связывает)
  // descent i2→i10 и sealed i7–i11 не связывают
  const instances = [hub('i0'), cor('i1'), cor('i2'), dorm('i3'), khr('i4'), dorm('i5'), dorm('i7'), dorm('i8'), cor('i9'), cor('i10'), dorm('i12'), dorm('i11')];
  const links: Link[] = [
    link('i0', 'i1'), link('i1', 'i2'), link('i1', 'i3'), link('i2', 'i5'), link('i2', 'i7'),
    link('i2', 'i9', { wrap: [0, 91] }), link('i9', 'i8'),
    link('i1', 'i4'), link('i4', 'i10'),
    link('i2', 'i10', { kind: 'descent', floors: 1 }),
    link('i7', 'i11', { sealed: true }),
    link('i10', 'i12'), link('i10', 'i11'),
  ];
  return {
    format: 'room-forge-run', version: 1, seed: 'мир', cellM: 0.1, settings: { gap: 0 }, props: [], items: [],
    instances, links, openConnectors: [],
  };
}

describe('dormIndex', () => {
  it('предикаты', () => {
    expect(isObshInstance(cor('i1'))).toBe(true);
    expect(isObshInstance(hub('i0'))).toBe(true);
    expect(isObshInstance(khr('i4'))).toBe(false);
    expect(isDormInstance(dorm('i3'))).toBe(true);
    expect(isDormInstance(cor('i1'))).toBe(false);
    expect(isDormInstance(inst('i6', 'obsh_vahter_room', ['общага', 'вахтёрская']))).toBe(false);
    expect(isDormInstance(inst('i6', 'khr_room', ['хрущёвка', 'комната']))).toBe(false);
  });

  it('локации — компоненты общаги, k — по order', () => {
    const rx = world();
    const idx = dormIndex(rx);
    expect([...idx.keys()]).toEqual(['i3', 'i5', 'i7', 'i8', 'i11', 'i12']);
    const want: Record<string, [string, number]> = { i3: ['i0', 0], i5: ['i0', 1], i7: ['i0', 2], i8: ['i0', 3], i11: ['i10', 0], i12: ['i10', 1] };
    for (const [id, [loc, k]] of Object.entries(want)) {
      const m = idx.get(id)!;
      expect(m.inst).toBe(id);
      expect(m.loc).toBe(loc);
      expect(m.k).toBe(k);
      expect({ ...m, inst: '' }).toEqual(rollDorm('мир', loc, k));
    }
    // ∞ — ровно одна в первых трёх у каждой локации (у B пока две комнаты — не больше одной)
    expect(['i3', 'i5', 'i7'].filter((id) => idx.get(id)!.kind === 'inf').length).toBe(1);
    expect(['i11', 'i12'].filter((id) => idx.get(id)!.kind === 'inf').length).toBeLessThanOrEqual(1);
    expect(JSON.parse(JSON.stringify([...idx.values()]))).toEqual([...idx.values()]);
  });

  it('кэш: тот же прогон — тот же объект; дописали экземпляры или покрутили ручки — пересчёт', () => {
    const rx = world();
    const a = dormIndex(rx);
    expect(dormIndex(rx)).toBe(a);
    rx.instances.push(dorm('i13'));
    rx.links.push(link('i10', 'i13'));
    const b = dormIndex(rx);
    expect(b).not.toBe(a);
    expect(b.get('i13')!.loc).toBe('i10');
    expect(b.get('i13')!.k).toBe(2);
    // прежние комнаты не сдвинулись
    for (const [id, m] of a) expect(b.get(id)).toEqual(m);
    expect(dormIndex(rx)).toBe(b);
    DORM.numberedChance = 1;
    const c = dormIndex(rx);
    expect(c).not.toBe(b);
    expect([...c.values()].every((m) => m.kind !== 'plain')).toBe(true);
  });

  it('свои предикаты', () => {
    const rx = world();
    const onlyA = dormIndex(rx, (i) => i.id === 'i3' || i.id === 'i5', (i) => ['i0', 'i1', 'i2'].includes(i.id));
    expect([...onlyA.keys()]).toEqual(['i3', 'i5']);
    expect(onlyA.get('i5')!.loc).toBe('i0');
    expect(onlyA.get('i5')!.k).toBe(1);
  });
});
