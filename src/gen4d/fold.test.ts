import { describe, expect, it } from 'vitest';
import { createDefaultProject } from '../data/presets';
import { generateRun } from '../gen/generate';
import { ALL4, checkLinks, checkNoOverlap, ok, project, rectRoom, strip } from '../gen/fixtures.test-util';
import { runWorld } from '../gen/world';
import { hashSeed } from '../model/rng';
import type { Connector, FoldSettings, Project, Room, Run, ShiftMode } from '../model/types';
import { DEFAULT_FOLD, generateFoldRun, overlapPairs, validateFoldRun, visibleSet } from './fold';
import { computePvs } from './pvs';
import { SightSpace } from './sight4d';
import { Shapes } from './space';

/** Пресеты. Поля отделки могут временно отсутствовать (их дописывают параллельно) — подстраховка. */
function presets(): Project {
  const p = createDefaultProject();
  p.finishes ??= [];
  p.finishRules ??= [];
  // тесты написаны под базовые настройки складок (DEFAULT_FOLD, с бесшовностью), а не под
  // значения по умолчанию проекта («много складок» под портальный рендер)
  p.generator.fold = { ...DEFAULT_FOLD };
  return p;
}

/** Копия проекта с режимом порога mode на метках с тегом tag (или на всех, если tag = null). */
function withShift(p: Project, tag: string | null, mode: ShiftMode): Project {
  return {
    ...p,
    rooms: p.rooms.map((r) => ({
      ...r,
      connectors: r.connectors.map((c) => (tag === null || c.tag === tag ? { ...c, shift: mode } : c)),
    })),
  };
}

const fold = (f: Partial<FoldSettings>): FoldSettings => ({ ...DEFAULT_FOLD, ...f });
const wOf = (run: Run) => new Map(run.instances.map((i) => [i.id, i.w ?? 0]));
const pairKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);

describe('складчатый генератор: детерминизм и инварианты', { timeout: 120000 }, () => {
  const p = presets();

  it('тот же сид — тот же прогон; другой сид — другой', () => {
    for (const seed of ['a1', 'a2', 'a3']) {
      const a = generateFoldRun(p, { seed, count: 80 });
      const b = generateFoldRun(p, { seed, count: 80 });
      expect(strip(a)).toEqual(strip(b));
    }
    const x = generateFoldRun(p, { seed: 'x', count: 80 });
    const y = generateFoldRun(p, { seed: 'y', count: 80 });
    expect(JSON.stringify(x.instances)).not.toBe(JSON.stringify(y.instances));
  });

  it('не мутирует проект; w, dw и Run.fold заполнены; настройки нормализованы', () => {
    const before = JSON.stringify(p.rooms.map((r) => r.connectors));
    const run = generateFoldRun(p, { seed: 'm', count: 40, fold: { shiftChance: 7, maxShift: -3, localRadius: 0, maxLayer: 2.7 } });
    expect(JSON.stringify(p.rooms.map((r) => r.connectors))).toBe(before);
    expect(run.settings.mode).toBe('fold');
    expect(run.settings.fold).toEqual({ shiftChance: 1, maxShift: 0, localRadius: 1, maxLayer: 2, seamless: true });
    for (const i of run.instances) expect(typeof i.w).toBe('number');
    for (const l of run.links) expect(typeof l.dw).toBe('number');
    expect(run.fold).toBeDefined();
  });

  it('validateFoldRun пуст на пресетах (count 30/150, с дозаполнением и без); связи лицом к лицу', () => {
    for (const count of [30, 150]) {
      let short = 0;
      for (let i = 1; i <= 4; i++) {
        for (const fill of [false, true]) {
          const run = generateFoldRun(p, { seed: `v${i}`, count, fill });
          expect(validateFoldRun(p, run)).toEqual([]);
          checkLinks(p, run);
          // набор числа — свойство пресетов, не инвариант: изредка рост глохнет (на 150 — примерно 1 прогон из 40
          // с большой шахтой «Ржавого лифта»; причины — в Run.stop), но не намного
          if (run.instances.length < count) short++;
          expect(run.instances.length).toBeGreaterThanOrEqual(Math.floor(count * 0.9));
        }
      }
      expect(short).toBeLessThanOrEqual(1);
    }
  });

  it('Run.sight считается всегда (по порталам); строки «не применяется» больше нет', () => {
    const run = generateFoldRun(p, { seed: 's', count: 30, sightM: 9 });
    expect(run.warnings.some((w) => w.includes('не применяется'))).toBe(false);
    expect(run.sight.maxM).toBeGreaterThan(0);
    expect(run.sight.maxM).toBeLessThanOrEqual(9);
    expect(run.sight.line).not.toBeNull();
    const flat = generateFoldRun(p, { seed: 's', count: 30, sightM: 0 });
    expect(flat.sight.maxM).toBeGreaterThan(0);
    expect(flat.warnings.some((w) => w.startsWith('Предел обзора'))).toBe(false);
    expect(flat.warnings.some((w) => w.startsWith('Складки: слоёв'))).toBe(true);
  });

  it('Run.fold согласован с overlapPairs: пары в разных слоях и дальше localRadius по графу', () => {
    for (let i = 1; i <= 3; i++) {
      const run = generateFoldRun(p, { seed: `o${i}`, count: 150 });
      const pairs = overlapPairs(p, run);
      expect(pairs.length).toBe(run.fold!.overlaps);
      expect(run.fold!.overlaps).toBeGreaterThan(0);
      const w = wOf(run);
      for (const [a, b] of pairs) {
        expect(w.get(a)).not.toBe(w.get(b));
        expect(visibleSet(run, a, run.settings.fold!.localRadius).has(b)).toBe(false);
      }
      let shifted = 0;
      for (const l of run.links) if (l.dw) shifted++;
      expect(run.fold!.shifted).toBe(shifted);
      const ws = [...w.values()];
      expect(run.fold!.minW).toBe(Math.min(0, ...ws));
      expect(run.fold!.maxW).toBe(Math.max(0, ...ws));
      expect(run.fold!.layers).toBe(new Set(ws).size);
      for (const v of ws) expect(Math.abs(v)).toBeLessThanOrEqual(DEFAULT_FOLD.maxLayer);
    }
  });

  it('наполнение: content на каждый экземпляр, dangerAcc — по дереву роста', () => {
    const run = generateFoldRun(p, { seed: 'c', count: 60, fill: true });
    expect(run.content.map((c) => c.inst)).toEqual(run.instances.map((i) => i.id));
    const acc = new Map(run.content.map((c) => [c.inst, c]));
    for (const i of run.instances) {
      const c = acc.get(i.id)!;
      const up = i.parent ? acc.get(i.parent)!.dangerAcc : 0;
      expect(c.dangerAcc).toBeCloseTo(up + c.danger, 9);
    }
  });
});

describe('складчатый генератор: рост не глохнет', { timeout: 180000 }, () => {
  const p = presets();

  it('count 150 и 300 набираются на 10/10 сидов (без предела обзора)', () => {
    const check: Run[] = [];
    for (const count of [150, 300]) {
      for (let i = 1; i <= 10; i++) {
        const run = generateFoldRun(p, { seed: `hrush-${i}`, count, fill: false, sightM: 0 });
        expect(run.instances.length).toBe(count);
        expect(run.stop).toBeUndefined();
        if (i <= 2) check.push(run);
      }
    }
    for (const run of check) expect(validateFoldRun(p, run)).toEqual([]);
  });

  it('самоблокирующаяся цепочка поворотов: евклидов глохнет, складчатый набирает count', () => {
    // комната-поворот с метками N и E: цепочка петляет и упирается сама в себя
    const q = project([rectRoom('turn', 20, 20, { tags: ['start'], max: 999, conns: [['N', 8], ['E', 8]] })]);
    let euclidShort = 0;
    for (let i = 1; i <= 10; i++) {
      if (generateRun(q, { seed: `t${i}`, count: 300 }).instances.length < 300) euclidShort++;
      const run = generateFoldRun(q, { seed: `t${i}`, count: 300 });
      expect(run.instances.length).toBe(300);
      expect(validateFoldRun(q, run)).toEqual([]);
    }
    expect(euclidShort).toBeGreaterThanOrEqual(5);
  });

  it('count недостижим из-за max — stop-диагностика и совет', () => {
    const q = project([
      rectRoom('a', 20, 20, { tags: ['start'], max: 1, conns: ALL4(8) }),
      rectRoom('b', 20, 20, { max: 3, conns: ALL4(8) }),
    ]);
    const run = generateFoldRun(q, { seed: 'x', count: 10 });
    expect(run.instances.length).toBe(4);
    expect(run.stop).toBeDefined();
    expect(run.stop!.atMax).toBeGreaterThan(0);
    expect(run.stop!.maxRooms).toEqual(['a', 'b']);
    expect(run.warnings.some((w) => w.startsWith('Поставлено 4 из 10 комнат'))).toBe(true);
    expect(run.warnings.some((w) => w.startsWith('Совет: поднимите max'))).toBe(true);
    expect(validateFoldRun(q, run)).toEqual([]);
  });
});

describe('складчатый генератор: сдвиги порогов', { timeout: 180000 }, () => {
  const p = presets();

  it('shiftChance 0: сдвиг только по нужде — в слое родителя комнате не было места', () => {
    // прямая цепочка комнат никогда не упирается сама в себя — сдвигов нет вовсе
    const line = project([rectRoom('seg', 30, 12, { tags: ['start'], max: 999, conns: [['W', 8], ['E', 8]] })]);
    const flat = generateFoldRun(line, { seed: 'l', count: 50, fold: fold({ shiftChance: 0, maxShift: 6 }) });
    expect(flat.instances.length).toBe(50);
    expect(flat.fold).toMatchObject({ shifted: 0, overlaps: 0, layers: 1 });
    // та же цепочка при shiftChance 1 — сдвигается каждый порог
    const all = generateFoldRun(line, { seed: 'l', count: 50, fold: fold({ shiftChance: 1, maxShift: 1, maxLayer: 100 }) });
    expect(all.fold!.shifted).toBe(all.links.length);
    expect(validateFoldRun(line, all)).toEqual([]);

    // на пресетах: каждый ростовой сдвиг — потому что в слое родителя тело кандидата уже пересекалось
    // с комнатой, поставленной раньше
    for (let i = 1; i <= 4; i++) {
      const run = generateFoldRun(p, { seed: `n${i}`, count: 150, fold: fold({ shiftChance: 0, maxShift: 6 }) });
      expect(validateFoldRun(p, run)).toEqual([]);
      const byId = new Map(run.instances.map((x) => [x.id, x]));
      const clash = new Set(overlapPairs(p, run).map(([a, b]) => pairKey(a, b)));
      let forced = 0;
      for (const l of run.links) {
        const child = byId.get(l.b.inst)!;
        if (!l.dw || child.parent !== l.a.inst) continue;
        const wp = byId.get(l.a.inst)!.w ?? 0;
        const why = run.instances.some((x) => (x.w ?? 0) === wp && x.order < child.order && clash.has(pairKey(x.id, child.id)));
        expect(why, `${l.a.inst} → ${l.b.inst}: сдвиг без нужды`).toBe(true);
        forced++;
      }
      expect(forced).toBe(run.fold!.shifted - run.links.filter((l) => l.dw && byId.get(l.b.inst)!.parent !== l.a.inst).length);
    }
  });

  it('maxShift 0 (и maxLayer 0) — плоский евклидов план без пересечений', () => {
    for (const f of [{ maxShift: 0 }, { maxLayer: 0 }]) {
      for (let i = 1; i <= 3; i++) {
        const run = generateFoldRun(p, { seed: `f${i}`, count: 100, fold: fold(f) });
        expect(run.fold).toMatchObject({ minW: 0, maxW: 0, layers: 1, overlaps: 0, shifted: 0 });
        for (const x of run.instances) expect(x.w).toBe(0);
        checkNoOverlap(runWorld(p, run), run.settings.gap);
        checkLinks(p, run);
        expect(validateFoldRun(p, run)).toEqual([]);
      }
    }
  });

  it("'always' на входах в квартиры (landing>apt): каждая квартира в своём слое, квартиры делят одно место", () => {
    const q = withShift(p, 'landing>apt', 'always');
    const flatTags = new Set(['прихожая', 'кухня', 'жилая', 'санузел', 'кладовка', 'балкон']);
    const isFlat = (roomId: string) => q.rooms.find((r) => r.id === roomId)!.tags.some((t) => flatTags.has(t));
    let flatPairs = 0;
    for (let i = 1; i <= 4; i++) {
      const run = generateFoldRun(q, { seed: `apt${i}`, count: 150 });
      expect(validateFoldRun(q, run)).toEqual([]);
      const worlds = new Map(runWorld(q, run).map((w) => [w.inst.id, w]));
      const w = wOf(run);
      let doors = 0;
      for (const l of run.links) {
        const A = worlds.get(l.a.inst)!.connectors.find((c) => c.id === l.a.connector)!;
        if (A.tag !== 'landing>apt' && A.tag !== 'apt>landing') continue;
        doors++;
        expect(l.dw).not.toBe(0);
        expect(w.get(l.a.inst)).not.toBe(w.get(l.b.inst));
      }
      expect(doors).toBeGreaterThan(10);
      const byId = new Map(run.instances.map((x) => [x.id, x]));
      for (const [a, b] of overlapPairs(q, run)) if (isFlat(byId.get(a)!.roomId) && isFlat(byId.get(b)!.roomId)) flatPairs++;
    }
    expect(flatPairs).toBeGreaterThan(0);
  });

  it("'never' на всех метках — никаких сдвигов; 'always' при maxShift 0 — тупик с причиной", () => {
    const q = withShift(p, null, 'never');
    const run = generateFoldRun(q, { seed: 'nv', count: 60 });
    expect(run.fold).toMatchObject({ layers: 1, shifted: 0, overlaps: 0 });
    expect(validateFoldRun(q, run)).toEqual([]);

    const box = project([rectRoom('box', 20, 20, { tags: ['start'], conns: ALL4(8) })]);
    const stuck = generateFoldRun(withShift(box, null, 'always'), { seed: 'al', count: 5, fold: fold({ maxShift: 0 }) });
    expect(stuck.instances.length).toBe(1);
    expect(stuck.stop!.noSpace).toBe(4);
    expect(stuck.warnings.some((w) => w.includes('правила сдвига несовместимы'))).toBe(true);
  });

  it('петли замыкаются, в том числе между слоями; гарантии целы', () => {
    const q = project([rectRoom('b', 20, 20, { tags: ['start'], conns: ALL4(8) }), rectRoom('c', 30, 20, { conns: ALL4(8) })]);
    let loops = 0, shiftedLoops = 0;
    for (let i = 1; i <= 6; i++) {
      const run = generateFoldRun(q, { seed: `b${i}`, count: 60, fold: fold({ shiftChance: 0.4 }) });
      expect(validateFoldRun(q, run)).toEqual([]);
      const byId = new Map(run.instances.map((x) => [x.id, x]));
      for (const l of run.links) {
        if (byId.get(l.b.inst)!.parent === l.a.inst) continue;
        loops++;
        if (l.dw) shiftedLoops++;
      }
    }
    expect(loops).toBeGreaterThan(0);
    expect(shiftedLoops).toBeGreaterThan(0);
  });
});

describe('складчатый генератор: видимое множество', { timeout: 180000 }, () => {
  const p = presets();

  it('visibleSet: сам экземпляр, соседи по связям; неизвестный id — пусто', () => {
    const run = generateFoldRun(p, { seed: 'vis', count: 40 });
    const id = run.instances[0].id;
    expect([...visibleSet(run, id, 0)]).toEqual([id]);
    const nb = new Set<string>([id]);
    for (const l of run.links) {
      if (l.a.inst === id) nb.add(l.b.inst);
      if (l.b.inst === id) nb.add(l.a.inst);
    }
    expect(visibleSet(run, id, 1)).toEqual(nb);
    expect(visibleSet(run, 'нет', 2).size).toBe(0);
  });

  it('localRadius 2: «комната + соседи» (depth 1) ни у одного экземпляра не содержит пересекающихся пар', () => {
    const cases: [number, Partial<FoldSettings>, number][] = [
      [150, {}, 1], [300, {}, 1], [150, { shiftChance: 0.6 }, 1], [150, { localRadius: 4 }, 2], [150, { localRadius: 1, shiftChance: 0.5 }, 0],
    ];
    for (const [count, f, depth] of cases) {
      for (let i = 1; i <= 3; i++) {
        const run = generateFoldRun(p, { seed: `vs${i}`, count, fold: fold(f) });
        const clash = overlapPairs(p, run);
        expect(clash.length).toBeGreaterThan(0); // пересечения есть, но не в видимом множестве
        const set = new Set(clash.map(([a, b]) => pairKey(a, b)));
        for (const inst of run.instances) {
          const vis = [...visibleSet(run, inst.id, depth)];
          for (let a = 0; a < vis.length; a++) {
            for (let b = a + 1; b < vis.length; b++) ok(!set.has(pairKey(vis[a], vis[b])), `${inst.id}: видны пересекающиеся ${vis[a]} и ${vis[b]}`);
          }
        }
      }
    }
  });
});

describe('validateFoldRun ловит порчу', () => {
  it('dw не сходится, пересечение в одном слое, сводка не сходится', () => {
    const p = presets();
    const run = generateFoldRun(p, { seed: 'bad', count: 60 });
    expect(validateFoldRun(p, run)).toEqual([]);
    // 1) сдвинуть слой экземпляра — разойдутся dw его связей
    const leaf = run.instances[run.instances.length - 1];
    const r1: Run = { ...run, instances: run.instances.map((i) => (i === leaf ? { ...i, w: (i.w ?? 0) + 5 } : i)) };
    const e1 = validateFoldRun(p, r1);
    expect(e1.some((e) => e.includes('w(b) − w(a)'))).toBe(true);
    // 2) пересекающуюся пару положить в один слой
    const [a, b] = overlapPairs(p, run)[0];
    const wa = run.instances.find((i) => i.id === a)!.w ?? 0;
    const r2: Run = { ...run, instances: run.instances.map((i) => (i.id === b ? { ...i, w: wa } : i)) };
    expect(validateFoldRun(p, r2).some((e) => e.includes('в одном слое'))).toBe(true);
    // 3) сводка не сходится
    const r3: Run = { ...run, fold: { ...run.fold!, overlaps: run.fold!.overlaps + 1 } };
    expect(validateFoldRun(p, r3).some((e) => e.includes('Run.fold.overlaps'))).toBe(true);
  });
});

describe('дальность обзора в 4D: линия идёт по порталам, слои не важны', { timeout: 180000 }, () => {
  // две соосные комнаты 30×12, проём 8 клеток по центру торцов, gap = 1: A — x 0…29, проём — x 30, B — x 31…60
  const A = rectRoom('a', 30, 12, { tags: ['start'], conns: [['E', 8]] });
  const B = rectRoom('b', 30, 12, { conns: [['W', 8]] });
  const shapes = new Shapes(1);
  const world = (room: typeof A, dx: number, dy: number) => {
    const sh = shapes.get(room, 0);
    return { sh, conns: sh.conns.map((c) => ({ ...c, cx: c.cx + dx, cy: c.cy + dy })) };
  };
  const pair = () => {
    const S = new SightSpace(1);
    const a = world(A, 0, 0), b = world(B, 31, 0);
    S.addRoom(a.sh, 0, 0);
    S.addRoom(b.sh, 31, 0);
    S.addPortal(0, a.conns[0], 1, b.conns[0]);
    return S;
  };

  it('линия сквозь проём — из комнаты в комнату: 30 + 1 + 30 клеток = 6.1 м', () => {
    const r = pair().scan(0.1);
    expect(r.maxM).toBeCloseTo(6.1, 9);
    expect(r.line).toEqual([0, 2.5, 61, 2.5]); // первая строка проёма (y = 2), от края до края
  });

  it('комната другого слоя на пути луча не удлиняет и не обрывает линию', () => {
    // C перекрывает A, проём и B (другой слой, не связана): линия A→B прежняя
    const S1 = pair();
    S1.addRoom(shapes.get(rectRoom('c', 50, 12), 0), 10, 0);
    expect(S1.scan(0.1)).toEqual({ maxM: 6.1, line: [0, 2.5, 61, 2.5] });
    // C продолжает B по 3D за его торцом (x 45…94): через стену B луч в неё не уходит
    const S2 = pair();
    S2.addRoom(shapes.get(rectRoom('c', 50, 12), 0), 45, 0);
    expect(S2.scan(0.1)).toEqual({ maxM: 6.1, line: [0, 2.5, 61, 2.5] });
    // и сама C — отдельный контекст: её собственная линия 5 м
    expect(S2.walk(2, 45, 5, 1, 0, Infinity)).toBe(49);
  });

  it('диагональ сквозь угол не проходит: у края проёма луч обрывается', () => {
    const S = pair();
    // (29, 8) → (30, 9): обе угловые клетки проходимы (проём и A) — шаг есть;
    // (30, 9) → (31, 10): угловая (30, 10) — стена за краем проёма — шага нет
    expect(S.move(0, 29, 8, 1, 1)).toBe(-1);
    expect(S.walk(0, 29, 8, 1, 1, Infinity)).toBe(1);
    // L-образная комната: диагональ через внутренний угол не идёт
    const L = rectRoom('L', 1, 1);
    L.cells = new Set(['0,0', '0,1', '1,1']);
    const SL = new SightSpace(1);
    SL.addRoom(shapes.get(L, 0), 0, 0);
    expect(SL.walk(0, 0, 0, 1, 1, Infinity)).toBe(0);
  });

  it('gap = 0: проём — ребро между рядами клеток', () => {
    const S = new SightSpace(0);
    const sh0 = new Shapes(0);
    const a = sh0.get(A, 0), b = sh0.get(B, 0);
    S.addRoom(a, 0, 0);
    S.addRoom(b, 30, 0);
    S.addPortal(0, a.conns[0], 1, { ...b.conns[0], cx: b.conns[0].cx + 30 });
    expect(S.scan(0.1).maxM).toBeCloseTo(6.0, 9);
  });

  it('validateFoldRun считает линии независимо: ручной прогон с комнатой другого слоя поверх', () => {
    const C = rectRoom('c', 50, 12);
    const q = project([A, B, C]);
    const settings = { ...q.generator, sightM: 0, mode: 'fold' as const, fold: DEFAULT_FOLD };
    const run: Run = {
      seed: 'hand', settings,
      instances: [
        { id: 'i0', roomId: 'a', rot: 0, dx: 0, dy: 0, order: 0, parent: null, depth: 0, w: 0 },
        { id: 'i1', roomId: 'b', rot: 0, dx: 31, dy: 0, order: 1, parent: 'i0', depth: 1, w: 1 },
        { id: 'i2', roomId: 'c', rot: 0, dx: 10, dy: 0, order: 2, parent: null, depth: 0, w: 3 },
      ],
      links: [{ a: { inst: 'i0', connector: A.connectors[0].id }, b: { inst: 'i1', connector: B.connectors[0].id }, dw: 1 }],
      openConnectors: [], content: [], totals: {}, warnings: [],
      sight: { maxM: 6.1, line: [0, 2.5, 61, 2.5] },
      fold: { minW: 0, maxW: 3, layers: 3, overlaps: 2, shifted: 1 },
      ms: 0,
    };
    expect(validateFoldRun(q, run)).toEqual([]);
    // предел 6 м: линия 6.1 м сквозь проём — нарушение
    const strict = validateFoldRun(q, { ...run, settings: { ...settings, sightM: 6 } });
    expect(strict.some((e) => e.startsWith('линия обзора 6.10 м'))).toBe(true);
    // Run.sight не сходится со сканом
    expect(validateFoldRun(q, { ...run, sight: { maxM: 9, line: null } }).some((e) => e.includes('полный скан по порталам'))).toBe(true);
  });

  it('генератор соблюдает предел (9/7/6 м): validateFoldRun чист, Run.sight ≤ предела; детерминизм', () => {
    const p = presets();
    for (const sightM of [9, 7, 6]) {
      for (let i = 1; i <= 3; i++) {
        const run = generateFoldRun(p, { seed: `sl${i}`, count: 60, sightM });
        expect(validateFoldRun(p, run)).toEqual([]);
        expect(run.sight.maxM).toBeLessThanOrEqual(sightM + 1e-9);
        if (i === 1) expect(strip(generateFoldRun(p, { seed: `sl${i}`, count: 60, sightM }))).toEqual(strip(run));
      }
    }
  });

  it('жёсткий предел: комнаты длиннее — из пула (предупреждение); тупики по обзору — в stop', () => {
    const p = presets();
    const run = generateFoldRun(p, { seed: 'tight', count: 60, sightM: 5 });
    expect(run.warnings.some((w) => w.startsWith('Предел обзора 5 м: исключены комнаты'))).toBe(true);
    expect(run.stop).toBeDefined();
    expect(run.stop!.sight).toBeGreaterThan(0);
    expect(run.warnings.some((w) => /предел обзора — \d+/.test(w))).toBe(true);
    expect(validateFoldRun(p, run)).toEqual([]);
    const ids = new Set(run.instances.map((i) => i.roomId));
    expect(ids.has('corr_malosem_long')).toBe(false); // коридор с обзором 9 м — вне пула
  });

  it('при sightM = 0 раскладка бит в бит прежняя (снимок до введения обзора)', () => {
    const q = project([
      rectRoom('box', 20, 20, { tags: ['start'], conns: ALL4(8) }),
      rectRoom('hall', 40, 12, { conns: ALL4(8) }),
      rectRoom('turn', 20, 20, { max: 999, conns: [['N', 8], ['E', 8]] }),
    ]);
    const cases: [string, number, number, number][] = [
      ['s1', 40, 1, 459032466], ['s2', 80, 1, 1031395923], ['s3', 60, 0, 4037550593], ['s4', 60, 2, 1576305170],
    ];
    for (const [seed, count, gap, digest] of cases) {
      const r = generateFoldRun(q, { seed, count, gap, fill: true, sightM: 0 });
      expect(hashSeed(JSON.stringify({ i: r.instances, l: r.links, o: r.openConnectors })), `${seed}`).toBe(digest);
    }
  });
});

describe('бесшовная видимость (PVS)', { timeout: 180000 }, () => {
  const conn = (id: string, side: Connector['side'], cx: number, cy: number, len = 8): Connector => ({ id, name: id, tag: 'door', cx, cy, side, len });
  const room = (id: string, w: number, h: number, conns: Connector[], start = false): Room => {
    const r = rectRoom(id, w, h, { tags: start ? ['start'] : [] });
    r.connectors = conns;
    return r;
  };
  // A — комната; B — длинный коридор вправо, выход на север в дальнем конце; C — коридор вверх; D — комната за поворотом
  const A = room('A', 30, 12, [conn('a', 'E', 29, 2)], true);
  const B = room('B', 60, 12, [conn('bw', 'W', 0, 2), conn('bn', 'N', 48, 0), conn('be', 'E', 59, 2)]);
  const C = room('C', 12, 40, [conn('cs', 'S', 2, 39), conn('cn', 'N', 2, 0)]);
  const D = room('D', 30, 20, [conn('ds', 'S', 11, 19)]);
  const E = room('E', 30, 12, [conn('ew', 'W', 0, 2)]); // за второй дверью на одной прямой с первой
  const place: Record<string, [Room, number, number]> = { i0: [A, 0, 0], i1: [B, 31, 0], i2: [C, 77, -41], i3: [D, 68, -62], i4: [E, 92, 0] };
  const links: [string, string, string, string][] = [['i0', 'a', 'i1', 'bw'], ['i1', 'bn', 'i2', 'cs'], ['i2', 'cn', 'i3', 'ds'], ['i1', 'be', 'i4', 'ew']];
  const shapes = new Shapes(1);
  const space = () => {
    const S = new SightSpace(1);
    const ids = Object.keys(place);
    for (const id of ids) { const [r, dx, dy] = place[id]; S.addRoom(shapes.get(r, 0), dx, dy); }
    const wc = (id: string, c: string) => {
      const [r, dx, dy] = place[id];
      const k = r.connectors.findIndex((x) => x.id === c);
      const w = shapes.get(r, 0).conns[k];
      return { ...w, cx: w.cx + dx, cy: w.cy + dy };
    };
    for (const [a, ca, b, cb] of links) S.addPortal(ids.indexOf(a), wc(a, ca), ids.indexOf(b), wc(b, cb));
    return S;
  };
  const handRun = (pvs: Record<string, string[]>): [Project, Run] => {
    const q = project([A, B, C, D, E]);
    const settings = { ...q.generator, sightM: 9, mode: 'fold' as const, fold: DEFAULT_FOLD };
    const ids = Object.keys(place);
    const run: Run = {
      seed: 'hand', settings,
      instances: ids.map((id, order) => ({ id, roomId: place[id][0].id, rot: 0, dx: place[id][1], dy: place[id][2], order, parent: null, depth: 0, w: 0 })),
      links: links.map(([a, ca, b, cb]) => ({ a: { inst: a, connector: ca }, b: { inst: b, connector: cb }, dw: 0 })),
      openConnectors: [], content: [], totals: {}, warnings: [],
      sight: { maxM: 0, line: null }, fold: { minW: 0, maxW: 0, layers: 1, overlaps: 0, shifted: 0 }, ms: 0, pvs,
    };
    return [q, run];
  };
  const ids = ['i0', 'i1', 'i2', 'i3', 'i4'];
  const pvsOf = (S: SightSpace) => Object.fromEntries(ids.map((id, i) => [id, computePvs(S, i, 90, 0.5).map((j) => ids[j])]));

  it('коридор с поворотом: за углом комната не в PVS; дверь на одной прямой — дальняя комната в PVS', () => {
    const pvs = pvsOf(space());
    expect(pvs.i0).toContain('i1');
    expect(pvs.i0).toContain('i4'); // A → B → E: обе двери на одной прямой
    expect(pvs.i0).toContain('i2'); // в северный проём коридора видно под углом из двери A
    expect(pvs.i0).not.toContain('i3'); // D — за поворотом
    expect(pvs.i3).not.toContain('i0');
    expect(pvs.i3).toContain('i2');
  });

  it('независимая проверка лучами согласна: убрать видимую комнату из PVS — ошибка', () => {
    const pvs = pvsOf(space());
    const [q, run0] = handRun(pvs);
    // sight в ручном прогоне не сходится — интересуют только ошибки PVS
    const pvsErrs = (r: Run) => validateFoldRun(q, r, { pvsPoints: 1000, pvsRays: 360 }).filter((e) => e.startsWith('PVS(') || e.startsWith('Run.pvs'));
    expect(pvsErrs(run0)).toEqual([]);
    const cut = { ...pvs, i0: pvs.i0.filter((x) => x !== 'i4') };
    expect(pvsErrs(handRun(cut)[1]).some((e) => e.startsWith('PVS(i0) не содержит i4'))).toBe(true);
  });

  it('пресеты: PVS консервативен (густые лучи) и попарно без пересечений; детерминизм', () => {
    const p = presets();
    for (const sightM of [9, 7]) {
      const run = generateFoldRun(p, { seed: `pv${sightM}`, count: 30, sightM });
      expect(run.pvs).toBeDefined();
      expect(Object.keys(run.pvs!).length).toBe(run.instances.length);
      expect(validateFoldRun(p, run, { pvsPoints: 1000, pvsRays: 240 })).toEqual([]);
      const clash = new Set(overlapPairs(p, run).map(([a, b]) => pairKey(a, b)));
      for (const [id, set] of Object.entries(run.pvs!)) {
        expect(set).toContain(id);
        for (let i = 0; i < set.length; i++) for (let j = i + 1; j < set.length; j++) ok(!clash.has(pairKey(set[i], set[j])), `PVS(${id}): ${set[i]} и ${set[j]}`);
      }
      expect(strip(generateFoldRun(p, { seed: `pv${sightM}`, count: 30, sightM }))).toEqual(strip(run));
    }
  });

  it('пресеты: инварианты на разных сидах; меньше пересечений, чем без бесшовности', () => {
    const p = presets();
    let on = 0, off = 0;
    for (let i = 1; i <= 4; i++) {
      const run = generateFoldRun(p, { seed: `ps${i}`, count: 60, sightM: 9 });
      expect(validateFoldRun(p, run)).toEqual([]);
      on += run.fold!.overlaps;
      off += generateFoldRun(p, { seed: `ps${i}`, count: 60, sightM: 9, fold: fold({ seamless: false }) }).fold!.overlaps;
    }
    expect(on).toBeLessThan(off);
  });

  it('seamless выключен или sightM = 0 — PVS нет, предупреждение', () => {
    const p = presets();
    const off = generateFoldRun(p, { seed: 'w', count: 20, sightM: 9, fold: fold({ seamless: false }) });
    expect(off.pvs).toBeUndefined();
    expect(off.warnings.some((w) => w.startsWith('Бесшовная видимость выключена'))).toBe(true);
    const flat = generateFoldRun(p, { seed: 'w', count: 20, sightM: 0 });
    expect(flat.pvs).toBeUndefined();
    expect(flat.warnings.some((w) => w.startsWith('Бесшовная видимость работает только с пределом обзора'))).toBe(true);
  });
});
