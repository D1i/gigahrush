// Находки: где лежат (пол / мебель / споты), детерминизм, проходимость и «не в проходе».
// Геометрия проверяется независимо от place.ts: клетки, стены, мебель, линии проёмов — прямо из RunExport.
import { describe, expect, it } from 'vitest';
import { propHeightM } from '../blockout/core';
import type { RunExport, RunInstance } from '../blockout/types';
import { generateRun } from '../gen/generate';
import { project, rectRoom } from '../gen/fixtures.test-util';
import { isFlatProp, PLAYER_RADIUS_M } from '../gen/walk';
import { exportRunJSON } from '../gen/world';
import type { Project } from '../model/types';
import { DOOR_CLEAR_M, floorPlan, ITEM_CLEAR_M, PATH_CLEAR_M, REACH_M, Slot, SPREAD_M, zInProp } from './place';
import { presetRuns, presets, streamWorld } from './runs.test-util';
import { pickupsOf } from './state';
import type { Pickup } from './types';

// ───────────────────────── независимая геометрия ─────────────────────────

function decode(rows: string[]): Set<string> {
  const out = new Set<string>();
  for (const row of rows) {
    const i = row.indexOf(':');
    const y = +row.slice(0, i);
    for (const part of row.slice(i + 1).split(',')) {
      const m = /^(-?\d+)(?:-(-?\d+))?$/.exec(part)!;
      const a = +m[1], b = m[2] !== undefined ? +m[2] : a;
      for (let x = a; x <= b; x++) out.add(`${x},${y}`);
    }
  }
  return out;
}

type Seg = [number, number, number, number];

function segLine(s: { side: string; cx: number; cy: number; len: number }): Seg {
  switch (s.side) {
    case 'N': return [s.cx, s.cy, s.cx + s.len, s.cy];
    case 'S': return [s.cx, s.cy + 1, s.cx + s.len, s.cy + 1];
    case 'W': return [s.cx, s.cy, s.cx, s.cy + s.len];
    default: return [s.cx + 1, s.cy, s.cx + 1, s.cy + s.len];
  }
}

function segDist(px: number, py: number, [ax, ay, bx, by]: Seg): number {
  const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
  const t = l2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l2)) : 0;
  return Math.hypot(ax + t * dx - px, ay + t * dy - py);
}

interface Geo {
  cells: Set<string>;
  /** клетки снаружи проёмов (створ) — не стена */
  stub: Set<string>;
  /** не плоская мебель: центр, поворот, полуразмеры (клетки), высота (м) */
  boxes: { id: string; x: number; y: number; rot: number; hw: number; hh: number; h: number }[];
  /** линии всех проёмов (метки и двери) */
  doors: Seg[];
  cellM: number;
}

function geoOf(rx: RunExport, inst: RunInstance): Geo {
  const cellM = rx.cellM;
  const cells = decode(inst.cells);
  const stub = new Set<string>();
  const out = { N: [0, -1], S: [0, 1], E: [1, 0], W: [-1, 0] } as const;
  const segs = [...inst.connectors, ...inst.doors];
  for (const s of segs) {
    const [dx, dy] = out[s.side];
    for (let i = 0; i < s.len; i++) {
      const x = s.side === 'N' || s.side === 'S' ? s.cx + i : s.cx, y = s.side === 'N' || s.side === 'S' ? s.cy : s.cy + i;
      for (let k = 1; k <= 4; k++) stub.add(`${x + dx * k},${y + dy * k}`);
    }
  }
  const byId = new Map(rx.props.map((p) => [p.id, p]));
  const boxes: Geo['boxes'] = [];
  const add = (id: string, propId: string, x: number, y: number, rot: number) => {
    const p = byId.get(propId);
    if (!p || isFlatProp(p)) return;
    boxes.push({ id, x, y, rot, hw: p.w / cellM / 2, hh: p.h / cellM / 2, h: propHeightM(p.tags, p.name) });
  };
  for (const d of inst.decor) add(d.id, d.propId, d.x, d.y, d.rot);
  for (const s of inst.spots) if (s.content?.kind === 'prop') add(`spot:${s.id}`, s.content.id, s.x, s.y, s.contentRot ?? s.rot + s.content.rot);
  return { cells, stub, boxes, doors: segs.map(segLine), cellM };
}

/** Расстояние от точки до прямоугольника мебели (0 — внутри), клетки. */
function boxDist(b: Geo['boxes'][number], px: number, py: number): number {
  const t = (b.rot * Math.PI) / 180, c = Math.cos(t), s = Math.sin(t);
  const dx = px - b.x, dy = py - b.y;
  const qx = Math.max(0, Math.abs(dx * c + dy * s) - b.hw), qy = Math.max(0, Math.abs(-dx * s + dy * c) - b.hh);
  return Math.hypot(qx, qy);
}

/** Круг радиуса r (клетки) вокруг точки не задевает стену (клетку вне пола и вне створов) и мебель. */
function clear(g: Geo, px: number, py: number, r: number): boolean {
  const k = Math.ceil(r) + 1;
  for (let y = Math.floor(py) - k; y <= Math.floor(py) + k; y++) {
    for (let x = Math.floor(px) - k; x <= Math.floor(px) + k; x++) {
      const key = `${x},${y}`;
      if (g.cells.has(key) || g.stub.has(key)) continue;
      const qx = Math.max(x - px, 0, px - (x + 1)), qy = Math.max(y - py, 0, py - (y + 1));
      if (Math.hypot(qx, qy) < r - 1e-6) return false;
    }
  }
  return g.boxes.every((b) => boxDist(b, px, py) >= r - 1e-6);
}

// ───────────────────────── проверка экземпляра ─────────────────────────

interface Tally {
  rooms: number;
  pickups: number;
  spot: number;
  decor: number;
  floor: number;
  /** на полу в зоне проёма / пути (тесная комната) */
  zone: number;
  /** проверено пар проёмов с прямым свободным проходом */
  straight: number;
  /** находок ближе SPREAD/2 к другой (места в комнате нет) */
  crowded: number;
}

const newTally = (): Tally => ({ rooms: 0, pickups: 0, spot: 0, decor: 0, floor: 0, zone: 0, straight: 0, crowded: 0 });

function checkInstance(rx: RunExport, inst: RunInstance, ps: Pickup[], t: Tally): void {
  const g = geoOf(rx, inst);
  const c = g.cellM;
  const where = `${inst.id} «${inst.roomName}»`;
  t.rooms++;
  t.pickups += ps.length;
  expect(new Set(ps.map((p) => p.id)).size, where).toBe(ps.length);
  expect(ps.every((p) => p.inst === inst.id && Number.isFinite(p.x) && Number.isFinite(p.y) && p.z >= 0), where).toBe(true);

  // 1. споты с предметом — один к одному, в точке спота
  const itemSpots = inst.spots.filter((s) => s.content?.kind === 'item');
  const spotPs = ps.filter((p) => p.from === 'spot');
  expect(spotPs.map((p) => p.id), where).toEqual(itemSpots.map((s) => `${inst.id}:spot:${s.id}`));
  itemSpots.forEach((s, i) => {
    expect(spotPs[i]).toMatchObject({ itemId: s.content!.id, count: 1, x: s.x, y: s.y });
    const on = g.boxes.filter((b) => boxDist(b, s.x, s.y) === 0);
    expect(spotPs[i].z).toBe(on.length ? Math.max(...on.map((b) => zInProp(b.h))) : 0);
  });
  t.spot += spotPs.length;

  // 2. лут — один к одному
  const lootPs = ps.filter((p) => p.from !== 'spot');
  expect(lootPs.map((p) => p.id), where).toEqual(inst.loot.map((_, i) => `${inst.id}:loot:${i}`));
  const placed: [number, number][] = spotPs.filter((p) => p.z === 0).map((p) => [p.x, p.y]);
  const plan = floorPlan(rx, inst);
  const grid = plan.walk.grid;
  let hasMain = false;
  for (const v of grid.cell) if (v === 2) hasMain = true;
  const want = hasMain ? 2 : 1;

  inst.loot.forEach((l, i) => {
    const p = lootPs[i];
    expect(p, where).toMatchObject({ itemId: l.itemId, count: l.count, from: l.from });
    expect(p.shopId).toBe(l.shopId);
    if (l.decorId) {
      // в мебели: внутри её прямоугольника, высота — по мебели
      const b = g.boxes.find((x) => x.id === l.decorId)!;
      expect(b, `${where}: мебель ${l.decorId}`).toBeDefined();
      expect(p.decorId).toBe(l.decorId);
      expect(boxDist(b, p.x, p.y), `${where}: ${p.id} в мебели`).toBe(0);
      expect(p.z).toBe(zInProp(b.h));
      expect(p.z).toBeGreaterThan(0);
      t.decor++;
      return;
    }
    // на полу
    t.floor++;
    expect(p.z).toBe(0);
    expect(p.decorId).toBeUndefined();
    expect(g.cells.has(`${Math.floor(p.x)},${Math.floor(p.y)}`), `${where}: ${p.id} на полу комнаты`).toBe(true);
    // не влипает в стены и мебель
    expect(clear(g, p.x, p.y, ITEM_CLEAR_M / c), `${where}: ${p.id} у стены/в мебели (${p.x}, ${p.y})`).toBe(true);
    // рукой достать с места, куда может встать центр капсулы (решётка walk.ts — источник правды о проходимости)
    let reach = Infinity;
    for (let j = 0; j < grid.h; j++) {
      for (let k = 0; k < grid.w; k++) {
        if (grid.cell[k + j * grid.w] !== want) continue;
        reach = Math.min(reach, Math.hypot(grid.x0 + k + 0.5 - p.x, grid.y0 + j + 0.5 - p.y));
      }
    }
    expect(reach * c, `${where}: ${p.id} далеко от проходимого`).toBeLessThanOrEqual(REACH_M + 1e-6);
    if (reach === 0) expect(clear(g, p.x, p.y, PLAYER_RADIUS_M / c), `${where}: ${p.id} капсула не встаёт`).toBe(true);

    const m = Math.floor(p.x) - plan.x0 + (Math.floor(p.y) - plan.y0) * plan.w;
    const cls = plan.cls[m];
    expect(cls, `${where}: ${p.id} класс`).toBeGreaterThan(Slot.None);
    if (cls === Slot.Door || cls === Slot.Path) {
      // у проёма / на пути — только если вне зон нет места не ближе SPREAD/2 к уже положенным
      t.zone++;
      const half = (SPREAD_M / 2 / c) ** 2;
      for (let q = 0; q < plan.cls.length; q++) {
        if (plan.cls[q] < Slot.Reach) continue;
        const qx = plan.x0 + (q % plan.w) + 0.5, qy = plan.y0 + Math.floor(q / plan.w) + 0.5;
        const ok = placed.some(([x, y]) => (x - qx) ** 2 + (y - qy) ** 2 < half);
        expect(ok, `${where}: ${p.id} в зоне при свободном месте (${qx}, ${qy})`).toBe(true);
      }
    } else {
      // независимо: не у линии проёма; не на прямом пути между серединами проёмов, если он свободен
      for (const d of g.doors) expect(segDist(p.x, p.y, d) * c, `${where}: ${p.id} у проёма`).toBeGreaterThanOrEqual(DOOR_CLEAR_M - 1e-6);
      const mids = plan.walk.openings.filter((o) => o.stand).map((o) => {
        const [ax, ay, bx, by] = segLine(o);
        return [(ax + bx) / 2, (ay + by) / 2] as const;
      });
      for (let a = 0; a < mids.length; a++) {
        for (let b = a + 1; b < mids.length; b++) {
          const s: Seg = [mids[a][0], mids[a][1], mids[b][0], mids[b][1]];
          const n = Math.ceil(Math.hypot(s[2] - s[0], s[3] - s[1]) * 2);
          let free = true;
          for (let k = 0; k <= n && free; k++) free = clear(g, s[0] + ((s[2] - s[0]) * k) / n, s[1] + ((s[3] - s[1]) * k) / n, (PLAYER_RADIUS_M + 0.05) / c);
          if (!free) continue;
          t.straight++;
          // допуск: путь идёт через ближайший к середине угол клетки на линии проёма (≤ 0.5 клетки)
          expect(segDist(p.x, p.y, s) * c, `${where}: ${p.id} на пути между проёмами`).toBeGreaterThanOrEqual(PATH_CLEAR_M - 0.051);
        }
      }
    }
    // разнесены: не ближе SPREAD/2 к уже положенным — если в комнате вообще есть такое место
    const near = placed.reduce((d, [x, y]) => Math.min(d, Math.hypot(x - p.x, y - p.y)), Infinity) * c;
    if (near < SPREAD_M / 2 - 1e-6) {
      t.crowded++;
      expect(near, `${where}: ${p.id} в одной точке с другой находкой`).toBeGreaterThan(0.05);
      for (let q = 0; q < plan.cls.length; q++) {
        if (plan.cls[q] === Slot.None) continue;
        const qx = plan.x0 + (q % plan.w) + 0.5, qy = plan.y0 + Math.floor(q / plan.w) + 0.5;
        const d = placed.reduce((acc, [x, y]) => Math.min(acc, Math.hypot(x - qx, y - qy)), Infinity) * c;
        expect(d, `${where}: ${p.id} тесно, хотя есть место (${qx}, ${qy})`).toBeLessThan(SPREAD_M / 2);
      }
    }
    placed.push([p.x, p.y]);
  });
}

// ───────────────────────── фикстура ─────────────────────────

/** Комната 4×3 м, двери 0.9 м на западе и востоке; сервант у северной стены, стол с предметом на нём,
 *  5 строк лута комнаты (на пол) и 2 строки тира в серванте. */
function hallProject(): Project {
  const r = rectRoom('hall', 40, 30, { tags: ['start'], conns: [['W', 9], ['E', 9]] });
  r.decor = [
    { id: 'd_sb', propId: 'sb', x: 10, y: 2.25, rot: 0 },
    { id: 'd_tbl', propId: 'tbl', x: 30, y: 25, rot: 0 },
    { id: 'd_rug', propId: 'rug', x: 20, y: 15, rot: 0 },
  ];
  r.spots = [{ id: 's_tbl', name: 'на столе', x: 30, y: 25, rot: 0, groupId: 'g' }];
  r.spotGroups = [{ id: 'g', name: 'G', color: '#fff', variants: [{ id: 'v', weight: 1, assign: { s_tbl: { kind: 'item', id: 'match', rot: 0 } } }] }];
  r.loot = ['kop', 'match', 'bandage', 'kop', 'match'].map((itemId, i) => ({ id: `l${i}`, itemId, chance: 1, min: 1 + i, max: 1 + i }));
  r.elite = [{ tierId: 't', weight: 1 }];
  return project([r], {
    props: [
      { id: 'sb', name: 'Сервант', w: 1.2, h: 0.45, color: '#a00', tex: null, tags: ['сервант'] },
      { id: 'tbl', name: 'Стол', w: 0.9, h: 0.6, color: '#0a0', tex: null, tags: ['стол'] },
      { id: 'rug', name: 'Ковёр', w: 1.5, h: 1, color: '#00a', tex: null, tags: ['ковёр'] },
    ],
    items: [
      { id: 'kop', name: 'Копейки', color: '#ff0', tags: ['currency'], note: '' },
      { id: 'sam', name: 'Самогонка', color: '#eee', tags: ['currency'], note: '' },
      { id: 'match', name: 'Спички', color: '#f80', tags: ['товар'], note: '' },
      { id: 'bandage', name: 'Бинт', color: '#fff', tags: ['товар'], note: '' },
    ],
    economy: {
      dangerLimit: 10,
      shops: [],
      passes: [],
      tiers: [{
        id: 't', name: 'Элитность 1', level: 1, danger: 3, color: '#ccc', note: '', loot: [
          { id: 'tr1', source: { kind: 'item', id: 'sam' }, steps: [{ upTo: 1, chance: 1 }], where: 'сервант' },
          { id: 'tr2', source: { kind: 'item', id: 'kop' }, steps: [{ upTo: 3, chance: 1 }], where: 'сервант' },
        ],
      }],
    },
  });
}

describe('находки: фикстура', () => {
  const p = hallProject();
  const rx = exportRunJSON(p, generateRun(p, { seed: 'fx', count: 1 })) as RunExport;
  const inst = rx.instances[0];
  const ps = pickupsOf(rx, inst);

  it('предмет на столе — на высоте стола; лут тира — внутри серванта, не в одной точке', () => {
    expect(ps.length).toBe(1 + 5 + 2);
    const spot = ps.find((x) => x.from === 'spot')!;
    expect(spot).toMatchObject({ id: `${inst.id}:spot:s_tbl`, itemId: 'match', count: 1, z: 0.75 });
    const inSb = ps.filter((x) => x.decorId === 'd_sb');
    expect(inSb.map((x) => x.itemId)).toEqual(['sam', 'kop']);
    expect(inSb.every((x) => x.z === 0.9)).toBe(true); // сервант 1.8 м — на полке посередине
    expect(Math.hypot(inSb[0].x - inSb[1].x, inSb[0].y - inSb[1].y)).toBeGreaterThan(3);
  });

  it('лут комнаты — на полу: не у дверей, не на линии между дверями, разнесён на SPREAD_M', () => {
    const floor = ps.filter((x) => x.from === 'room');
    expect(floor.length).toBe(5);
    const [w, e] = inst.connectors.map(segLine);
    const mid = (s: Seg) => [(s[0] + s[2]) / 2, (s[1] + s[3]) / 2];
    const axis: Seg = [...mid(w), ...mid(e)] as Seg;
    for (const f of floor) {
      expect(f.z).toBe(0);
      expect(segDist(f.x, f.y, axis) * 0.1).toBeGreaterThanOrEqual(PATH_CLEAR_M - 0.051);
      expect(Math.min(segDist(f.x, f.y, w), segDist(f.x, f.y, e)) * 0.1).toBeGreaterThanOrEqual(DOOR_CLEAR_M);
    }
    for (let a = 0; a < floor.length; a++) for (let b = a + 1; b < floor.length; b++) {
      expect(Math.hypot(floor[a].x - floor[b].x, floor[a].y - floor[b].y) * 0.1).toBeGreaterThanOrEqual(SPREAD_M - 1e-6);
    }
    checkInstance(rx, inst, ps, newTally());
  });

  it('пути между дверями: один, прямой (натянутая ломаная из двух точек)', () => {
    const plan = floorPlan(rx, inst);
    expect(plan.paths.length).toBe(1);
    expect(plan.paths[0].length).toBe(4);
  });

  it('детерминизм: тот же результат без кэша (копия JSON) и при повторном вызове', () => {
    const copy = JSON.parse(JSON.stringify(rx)) as RunExport;
    expect(pickupsOf(copy, copy.instances[0])).toEqual(ps);
    expect(pickupsOf(rx, inst)).toEqual(ps);
    // результат — копия: правка не портит кэш
    pickupsOf(rx, inst)[0].x = -999;
    expect(pickupsOf(rx, inst)).toEqual(ps);
  });
});

// ───────────────────────── пресеты ─────────────────────────

describe('находки на прогонах пресетов', { timeout: 240000 }, () => {
  const p = presets();
  const runs = presetRuns(p);
  const total = newTally();

  for (const [name, rx] of runs) {
    it(`${name}: все находки на месте, на полу — проходимо и не в проходе`, () => {
      const t = newTally();
      for (const inst of rx.instances) checkInstance(rx, inst, pickupsOf(rx, inst), t);
      expect(t.pickups).toBeGreaterThan(0);
      expect(t.floor).toBeGreaterThan(0);
      for (const k of Object.keys(t) as (keyof Tally)[]) total[k] += t[k];
    });
  }

  it('сводка: в мебели есть, на полу большинство вне зон проёмов', () => {
    expect(total.decor + total.spot).toBeGreaterThan(0);
    expect(total.straight).toBeGreaterThan(10);
    expect(total.crowded / total.floor).toBeLessThan(0.05);
    // зоны — только в тесных комнатах (санузлы, прихожие, кладовки)
    expect(total.zone / total.floor).toBeLessThan(0.4);
  });

  it('детерминизм: два независимых прогона одного сида дают те же находки', () => {
    const [, rx] = runs[1];
    const again = presetRuns(presets())[1][1];
    expect(again.instances.map((i) => pickupsOf(again, i))).toEqual(rx.instances.map((i) => pickupsOf(rx, i)));
  });

  it('бесконечный мир: находки комнаты не зависят от порядка обхода (по адресу и месту)', () => {
    const A = streamWorld(p, 'game-order', 2);
    const B = streamWorld(p, 'game-order', 0);
    // B раскрывается в другом порядке: старт, затем его соседи с конца и их соседи
    B.expand(B.startId!);
    const nb = B.run().links.filter((l) => l.a.inst === B.startId || l.b.inst === B.startId)
      .map((l) => (l.a.inst === B.startId ? l.b.inst : l.a.inst)).reverse();
    for (const id of nb) for (const n of B.ensureAround(id).reverse()) B.ensureAround(n);
    B.ensureAround(B.startId!);
    const ra = exportRunJSON(p, A.run()) as RunExport, rb = exportRunJSON(p, B.run()) as RunExport;
    const byAddr = new Map(rb.instances.map((i) => [B.addressOf(i.id), i]));
    const strip = (list: Pickup[]) => list.map(({ id: _i, inst: _n, ...rest }) => rest);
    let same = 0;
    for (const ia of ra.instances) {
      const ib = byAddr.get(A.addressOf(ia.id));
      if (!ib || ib.roomId !== ia.roomId || ib.rot !== ia.rot || ib.dx !== ia.dx || ib.dy !== ia.dy || (ib.w ?? 0) !== (ia.w ?? 0)) continue;
      expect(strip(pickupsOf(rb, ib)), A.addressOf(ia.id)!).toEqual(strip(pickupsOf(ra, ia)));
      same++;
    }
    expect(same).toBeGreaterThan(5);
  });
});
