import { describe, expect, it } from 'vitest';
import { makeRng } from '../model/rng';
import type { Instance, Prop, Room, Variant } from '../model/types';
import { generateRun, rollContent } from './generate';
import { project, rectRoom } from './fixtures.test-util';
import { isFlatProp, walkCheck, walkMessage, type ContentGroup } from './walk';

const prop = (id: string, w: number, h: number, tags: string[] = [], name = id): Prop => ({ id, name, w, h, color: '#888', tex: null, tags });
const PROPS: Prop[] = [
  prop('box', 0.6, 0.4, ['коробки']),
  prop('stool', 0.35, 0.35, ['табурет']),
  prop('rug', 2, 3, ['ковёр', 'пол'], 'Ковёр'),
  prop('pole', 0.1, 0.1, ['стояк']),
];
const byId = (list: Prop[]) => new Map(list.map((p) => [p.id, p]));

/** Комната 4×3 м, двери 0.9 м на западной и восточной стенах (y 1.0–1.9). */
function hall(): Room {
  const r = rectRoom('hall', 40, 30);
  r.connectors = [
    { id: 'w', name: 'Запад', tag: 'door', cx: 0, cy: 10, side: 'W', len: 9 },
    { id: 'e', name: 'Восток', tag: 'door', cx: 39, cy: 10, side: 'E', len: 9 },
  ];
  r.doors = r.connectors.map((c) => ({ id: `d_${c.id}`, cx: c.cx, cy: c.cy, side: c.side, len: c.len }));
  return r;
}

/** Блок x 1.0–3.0 м от северной стены вниз; проход только под ним, шириной gap м. */
function blocked(gap: number, rot = 0): { r: Room; props: Map<string, Prop> } {
  const r = hall();
  const h = 3 - gap;
  const props = byId([...PROPS, prop('blk', rot === 90 ? h : 2, rot === 90 ? 2 : h)]);
  r.decor = [{ id: 'b', propId: 'blk', x: 20, y: (h / 2) * 10, rot }];
  return { r, props };
}

describe('walkCheck', () => {
  it('пустая комната: обе двери достижимы, решётка с полем вокруг', () => {
    const res = walkCheck(hall(), byId(PROPS));
    expect(res.ok).toBe(true);
    expect(res.blockedDoors).toEqual([]);
    expect(res.openings.map((o) => [o.id, o.ids, o.ok, o.stand])).toEqual([
      ['w', ['w', 'd_w'], true, true],
      ['e', ['e', 'd_e'], true, true],
    ]);
    const g = res.grid;
    // центр клетки у стены (0.05 м от стены) недоступен, в середине комнаты — доступен
    const at = (x: number, y: number) => g.cell[(x - g.x0) + (y - g.y0) * g.w];
    expect(at(0, 25)).toBe(0);
    expect(at(20, 15)).toBe(2);
    expect(at(3, 25)).toBe(2); // 0.35 м от стены
    expect(at(2, 25)).toBe(0); // 0.25 м
    expect(at(0, 14)).toBe(2); // в створе двери стены нет
    // угол на линии проёма свободен (створ продолжает пол наружу на 0.3 м), у косяка — нет
    const corner = (x: number, y: number) => g.corner[(x - g.x0) + (y - g.y0) * (g.w + 1)];
    expect(corner(0, 14)).toBe(2);
    expect(corner(0, 11)).toBe(0);
  });

  it('щель 0.6 м проходима, 0.59 м — нет (и с поворотом на 90°)', () => {
    for (const rot of [0, 90]) {
      const a = blocked(0.6, rot);
      expect(walkCheck(a.r, a.props).ok, `0.6 rot ${rot}`).toBe(true);
      const b = blocked(0.59, rot);
      const res = walkCheck(b.r, b.props);
      expect(res.ok, `0.59 rot ${rot}`).toBe(false);
      expect(res.blockedDoors).toEqual(['e']);
      expect(walkMessage(res)).toBe('двери «Запад» и «Восток» разделены мебелью');
    }
  });

  it('ковёр и прочие плоские prop не мешают; высокие — мешают', () => {
    expect(isFlatProp(PROPS[2])).toBe(true);
    expect(isFlatProp(prop('x', 1, 1, ['коврик']))).toBe(true);
    expect(isFlatProp(PROPS[0])).toBe(false);
    expect(isFlatProp(PROPS[1])).toBe(false);
    const { r } = blocked(0.3);
    const props = byId([...PROPS, prop('blk', 2, 2.7, ['ковёр'])]);
    expect(walkCheck(r, props).ok).toBe(true);
  });

  it('проём уже 0.6 м не пропускает; мебель вплотную к проёму его загораживает', () => {
    const narrow = hall();
    narrow.connectors[1].len = 5;
    narrow.doors[1].len = 5;
    const n = walkCheck(narrow, byId(PROPS));
    expect(n.ok).toBe(false);
    expect(n.openings[1].stand).toBe(false);
    expect(walkMessage(n)).toBe('проём «Восток» загорожен вплотную');

    const r = hall();
    r.decor = [{ id: 's', propId: 'stool', x: 39 - 2, y: 14.5, rot: 0 }]; // табурет в 0.03 м от восточной двери
    const res = walkCheck(r, byId(PROPS));
    expect(res.ok).toBe(false);
    expect(res.openings.map((o) => o.stand)).toEqual([true, false]);
  });

  it('поворот на 45°: диагональная перегородка режет комнату, вдоль стены — нет', () => {
    const r = hall();
    const props = byId([...PROPS, prop('plank', 5, 0.2)]);
    r.decor = [{ id: 'p', propId: 'plank', x: 20, y: 15, rot: 45 }];
    expect(walkCheck(r, props).ok).toBe(false);
    r.decor[0] = { id: 'p', propId: 'plank', x: 20, y: 1, rot: 0 };
    expect(walkCheck(r, props).ok).toBe(true);
  });

  it('extra: выпавшие prop учитываются; кэш видит перемещение декора', () => {
    const r = hall();
    const props = byId(PROPS);
    const wall = Array.from({ length: 8 }, (_, i) => ({ propId: 'box', x: 20, y: 2 + i * 4, rot: 90 }));
    expect(walkCheck(r, props, wall).ok).toBe(false);
    expect(walkCheck(r, props, wall.slice(0, 6)).ok).toBe(false); // щель 0.5 м
    expect(walkCheck(r, props, wall.slice(0, 5)).ok).toBe(true); // щель 0.9 м
    r.decor = [{ id: 'k', propId: 'box', x: 37, y: 14.5, rot: 90 }];
    expect(walkCheck(r, props).ok).toBe(false);
    r.decor[0].x = 30; // мутация на месте, как в редакторе
    expect(walkCheck(r, props).ok).toBe(true);
    r.cells.delete('20,15'); // мутация пола
    expect(walkCheck(r, props).ok).toBe(true);
  });

  // цель — < 2 мс с нуля (обычно ≈ 1 мс) и ≈ 0.1 мс из кэша; пороги с запасом ×4–10 на загруженную машину —
  // тест ловит только порядковые регрессии (как perf.test.ts)
  it('скорость: 4000 клеток с нуля < 8 мс, с декором из кэша < 1 мс', () => {
    const props = byId([...PROPS, prop('sofa', 1.9, 0.85)]);
    const mk = (n: number): Room => {
      const r = rectRoom(`big${n}`, 63, 63);
      r.connectors = [
        { id: 'a', name: 'a', tag: 'door', cx: 10, cy: 0, side: 'N', len: 9 },
        { id: 'b', name: 'b', tag: 'door', cx: 62, cy: 30, side: 'E', len: 9 },
        { id: 'c', name: 'c', tag: 'door', cx: 0, cy: 40, side: 'W', len: 9 },
      ];
      r.decor = Array.from({ length: 16 }, (_, k) => ({ id: `d${k}`, propId: k % 2 ? 'sofa' : 'box', x: 8 + (k % 4) * 14, y: 10 + Math.floor(k / 4) * 14, rot: (k * 30) % 180 }));
      return r;
    };
    const rooms = Array.from({ length: 180 }, (_, k) => mk(k));
    for (let k = 0; k < 60; k++) walkCheck(rooms[k], props, [{ propId: 'box', x: 30, y: 30 + k * 0.1, rot: 0 }]); // прогрев
    // «с нуля» — новая комната: базовая решётка, декор и связность считаются заново; лучшая из 3 серий
    let cold = Infinity;
    for (let s = 0; s < 3; s++) {
      const t0 = performance.now();
      for (let k = 0; k < 40; k++) walkCheck(rooms[60 + s * 40 + k], props);
      cold = Math.min(cold, (performance.now() - t0) / 40);
    }
    const r = mk(0);
    walkCheck(r, props);
    const t = performance.now();
    for (let k = 0; k < 100; k++) walkCheck(r, props, [{ propId: 'stool', x: 30 + k * 0.1, y: 30, rot: 0 }]);
    const warm = (performance.now() - t) / 100;
    console.log(`[walk] 3969 клеток: с нуля ${cold.toFixed(2)} мс, декор из кэша + prop ${warm.toFixed(3)} мс`);
    expect(cold).toBeLessThan(8);
    expect(warm).toBeLessThan(1);
  });
});

// ───────────────────────── розыгрыш спотов ─────────────────────────

/** Коридор с группой спотов: v1 (вес 5) — коробки поперёк прохода, v2 (3) — у стены, v3 (2) — пусто. */
function corridorProject(variants?: Variant[]) {
  const r = hall();
  r.spots = [
    { id: 'mid', name: 'mid', x: 20, y: 15, rot: 90, groupId: 'g' },
    { id: 'mid2', name: 'mid2', x: 20, y: 9, rot: 90, groupId: 'g' },
    { id: 'mid3', name: 'mid3', x: 20, y: 21, rot: 90, groupId: 'g' },
    { id: 'mid4', name: 'mid4', x: 20, y: 3, rot: 90, groupId: 'g' },
    { id: 'mid5', name: 'mid5', x: 20, y: 27, rot: 90, groupId: 'g' },
    { id: 'side', name: 'side', x: 20, y: 2, rot: 0, groupId: 'g' },
  ];
  const all = (id: string) => ({ kind: 'prop' as const, id, rot: 0 });
  r.spotGroups = [{
    id: 'g', name: 'g', color: '#fff',
    variants: variants ?? [
      { id: 'v1', weight: 5, assign: { mid: all('box'), mid2: all('box'), mid3: all('box'), mid4: all('box'), mid5: all('box') } },
      { id: 'v2', weight: 3, assign: { side: all('box') } },
      { id: 'v3', weight: 2, assign: {} },
    ],
  }];
  return project([r], { props: PROPS, items: [{ id: 'it', name: 'it', color: '#fff', tags: [], note: '' }] });
}

const INST: Instance = { id: 'i0', roomId: 'hall', rot: 0, dx: 0, dy: 0, order: 0, parent: null, depth: 0 };

describe('rollContent: проходимость', () => {
  it('вариант поперёк прохода подменяется следующим по весу, без лишних бросков', () => {
    const p = corridorProject();
    const room = p.rooms[0];
    let subs = 0;
    for (let i = 0; i < 300; i++) {
      const rolled = makeRng(`s${i}`).weightedIndex([5, 3, 2]); // тира нет — первый бросок у группы
      const c = rollContent(p, room, INST, makeRng(`s${i}`), null);
      const g = c.groups[0] as ContentGroup;
      if (rolled === 0) {
        subs++;
        expect(g).toEqual({ groupId: 'g', variantId: 'v2', fallback: true });
        expect(c.spots.find((s) => s.spotId === 'side')!.content).toEqual({ kind: 'prop', id: 'box', rot: 0 });
      } else {
        expect(g).toEqual({ groupId: 'g', variantId: rolled === 1 ? 'v2' : 'v3' });
        expect('fallback' in g).toBe(false);
      }
    }
    expect(subs).toBeGreaterThan(100);
  });

  it('крайний случай: подходящего варианта нет — выпавший без напольных prop, предметы остаются', () => {
    const box = { kind: 'prop' as const, id: 'box', rot: 0 };
    const p = corridorProject([
      { id: 'v1', weight: 1, assign: { mid: box, mid2: box, mid3: box, mid4: box, mid5: box, side: { kind: 'item', id: 'it', rot: 0 } } },
    ]);
    const c = rollContent(p, p.rooms[0], INST, makeRng('x'), null);
    expect(c.groups).toEqual([{ groupId: 'g', variantId: 'v1', fallback: true }]);
    expect(c.spots.filter((s) => s.content).map((s) => s.content!.kind)).toEqual(['item']);
  });

  it('декор уже перекрывает проход — подмен нет (поведение как раньше)', () => {
    const p = corridorProject();
    p.rooms[0].decor = [{ id: 'k', propId: 'box', x: 37, y: 14.5, rot: 90 }]; // у восточной двери
    for (let i = 0; i < 100; i++) {
      const rolled = makeRng(`s${i}`).weightedIndex([5, 3, 2]);
      const c = rollContent(p, p.rooms[0], INST, makeRng(`s${i}`), null);
      expect(c.groups).toEqual([{ groupId: 'g', variantId: `v${rolled + 1}` }]);
    }
  });

  it('прогон: подмены отмечены и посчитаны в warnings; без подмен warnings не меняются', () => {
    const p = corridorProject();
    p.rooms[0].tags = ['start'];
    const run = generateRun(p, { seed: 'walk', count: 1 });
    const n = run.content.filter((c) => c.groups.some((g) => (g as ContentGroup).fallback)).length;
    const w = run.warnings.filter((x) => x.startsWith('Проходимость'));
    expect(w.length).toBe(n > 0 ? 1 : 0);
    let seen = 0;
    for (let i = 0; i < 40 && seen < 2; i++) {
      const r = generateRun(p, { seed: `walk${i}`, count: 1 });
      const fb = (r.content[0].groups[0] as ContentGroup).fallback === true;
      expect(r.warnings.some((x) => x.startsWith('Проходимость: подменено вариантов спотов — 1 из 1'))).toBe(fb);
      if (fb) seen++;
    }
    expect(seen).toBe(2);
  });
});

describe('rollContent на пресетах', () => {
  it('без подмен результат совпадает с прежним (бит в бит); подмены — только у вариантов поперёк прохода', async () => {
    const { createDefaultProject } = await import('../data/presets');
    const p = createDefaultProject();
    // «прежний» розыгрыш: тот же проект, но у каждой комнаты первый проём наглухо закрыт глыбой без тегов —
    // проход перекрыт декором, поэтому подмен нет (WalkRoll ничего не делает)
    const legacy = createDefaultProject();
    legacy.props.push(prop('__block', 3, 3));
    for (const r of legacy.rooms) {
      const c = r.connectors[0];
      r.decor.push({ id: '__b', propId: '__block', x: c.cx + 0.5, y: c.cy + 0.5, rot: 0 });
    }
    let subs = 0, same = 0;
    p.rooms.forEach((room, ri) => {
      const inst: Instance = { ...INST, roomId: room.id };
      for (let i = 0; i < 25; i++) {
        const a = rollContent(p, room, inst, makeRng(`b${i}`), null);
        const b = rollContent(legacy, legacy.rooms[ri], inst, makeRng(`b${i}`), null);
        expect(b.groups.some((g) => (g as ContentGroup).fallback)).toBe(false);
        const fb = a.groups.filter((g) => (g as ContentGroup).fallback);
        if (fb.length === 0) {
          expect(a).toEqual(b);
          expect(JSON.stringify(a)).toBe(JSON.stringify(b));
          same++;
        } else {
          subs += fb.length;
          expect(a.tierId).toBe(b.tierId);
          // остальные группы — те же варианты, подменённая — другой (или без напольных prop)
          a.groups.forEach((g, gi) => { if (!(g as ContentGroup).fallback) expect(g).toEqual(b.groups[gi]); });
        }
      }
    });
    expect(same).toBeGreaterThan(subs);
  }, 60000);
});
