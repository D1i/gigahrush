// Эскалаторы «Фрактальной станции» (./fractalEsc.ts + наклон в ./fractalPhysics.ts, FRACTAL.md §4.3–4.4): лента,
// поездка от низа до схода за slope/0.75, высота ступней = rampH(s), вход только с торцов, срыв всего эскалатора
// (стадии по ESC, в fall — падение и приземление, подложка пуста), выход не срывается, grace, «донесло до низа»,
// перелезание через балюстраду, фоновый срыв, поза срыва для сцены.
import { describe, expect, it } from 'vitest';
import { AXIS_VEC, axisIdx, type Axis6, type V3 } from './fractalAxes';
import { buildFractalCell, solidAt, VX, type FractalEsc } from './fractalCell';
import { collapsePose, createEscWorld, startCollapse, stepEscWorld, type FrEscEvent, type FrEscWorld } from './fractalEsc';
import { canHop, createBody, FRP, rampH, rightOf, stepBody, type FrBody, type FrEnv, type FrEvent, type FrInput } from './fractalPhysics';
import { ESC } from './metroEscalator';

const cell = buildFractalCell('t1');
const P = cell.P;
const DT = 1 / 60;
const COS30 = Math.cos(Math.PI / 6);
const NO: FrInput = { fwd: 0, side: 0, run: false, dYaw: 0, dPitch: 0, use: false };
const W: FrInput = { ...NO, fwd: 1 };
const E: FrInput = { ...NO, use: true };

const mainIdx = cell.esc.findIndex((e) => e.kind === 'main');
const exitIdx = cell.exit.esc;
const main = cell.esc[mainIdx];
const upLane = main.lanes.findIndex((l) => l.dir === 1);

/** Точка в кадре эскалатора: s — вдоль fwd в плане, a — вдоль right, h — над полом. */
function at(e: FractalEsc, s: number, a: number, h: number): V3 {
  const U = AXIS_VEC[e.up], F = AXIS_VEC[e.fwd], R = AXIS_VEC[rightOf(e.up, e.fwd)];
  return [0, 1, 2].map((k) => e.o[k] + F[k] * s + R[k] * a + U[k] * h) as V3;
}
/** Высота ступней над полом эскалатора (с оборачиванием). */
function hOf(e: FractalEsc, b: FrBody): number {
  const U = AXIS_VEC[e.up], F = AXIS_VEC[e.fwd];
  let h = 0;
  for (let k = 0; k < 3; k++) {
    let d = b.pos[k] - e.o[k];
    d -= P * Math.round((d - F[k] * e.run * 0.5 - U[k] * e.rise * 0.5) / P);
    h += d * U[k];
  }
  return h;
}

/** Мир: тело + эскалаторы; шаг — сначала эскалаторы (с поездкой), потом тело. */
class Sim {
  env: FrEnv;
  w: FrEscWorld;
  b: FrBody;
  ev: FrEvent[] = [];
  esc: FrEscEvent[] = [];
  t = 0;
  private rideStart: { esc: number; lane: number } | null = null;
  constructor(b: FrBody, near: number[] = []) {
    this.w = createEscWorld(cell, 't1');
    this.env = { cell, esc: this.w };
    this.b = b;
    this.near = near;
  }
  near: number[];
  step(inp: FrInput): void {
    this.esc.push(...stepEscWorld(this.w, DT, { rideStart: this.rideStart, near: this.near, ride: this.b.ride }));
    this.rideStart = null;
    for (const e of stepBody(this.env, this.b, inp, DT)) {
      this.ev.push(e);
      if (e.k === 'ride') this.rideStart = { esc: e.esc, lane: e.lane };
    }
    this.t += DT;
  }
  until(inp: FrInput, maxS: number, done: () => boolean): boolean {
    for (let i = 0; i < maxS / DT; i++) {
      this.step(inp);
      if (done()) return true;
    }
    return false;
  }
}

/** Перед низом дорожки lane, лицом вверх по эскалатору. */
const atBottom = (e: FractalEsc, lane: number, s = -0.8): FrBody => createBody({ at: at(e, s, e.lanes[lane].off, 0), up: e.up, fwd: e.fwd }, [0, 0, 0]);

/** Встать на дорожку lane снизу и проехать до s ≥ sTo без ввода. */
function rideTo(e: FractalEsc, lane: number, sTo: number, near: number[] = []): Sim {
  const sim = new Sim(atBottom(e, lane), near);
  expect(sim.until(W, 3, () => sim.b.ride !== null)).toBe(true);
  expect(sim.until(NO, 120, () => (sim.b.ride?.s ?? 0) >= sTo)).toBe(true);
  return sim;
}

describe('лента и поездка', () => {
  it('belt: dir·0.75 по наклону; у выхода три дорожки 0 — вверх, 1 — стоит, 2 — вниз', () => {
    const w = createEscWorld(cell, 't1');
    for (const e of cell.esc) for (let l = 0; l < e.lanes.length; l++) expect(w.belt(e.i, l)).toBeCloseTo(e.lanes[l].dir * ESC.speed, 12);
    expect(cell.esc[exitIdx].lanes.map((l) => l.dir)).toEqual([1, 0, -1]);
    expect(w.stage(mainIdx)).toBeNull();
    expect(collapsePose(w, mainIdx)).toBeNull();
  });

  it('на дорожке «вверх» без ввода от низа до схода за slope/0.75 с (±5 %), ступни на rampH(s)', () => {
    expect(upLane).toBeGreaterThanOrEqual(0);
    const sim = new Sim(atBottom(main, upLane));
    expect(sim.until(W, 3, () => sim.b.ride !== null)).toBe(true);
    expect(sim.ev.find((e) => e.k === 'ride')).toEqual({ k: 'ride', esc: mainIdx, lane: upLane });
    expect(sim.b.ground).toBe('ramp');
    const s0 = sim.b.ride!.s, t0 = sim.t;
    let worst = 0;
    const ok = sim.until(NO, 80, () => {
      const r = sim.b.ride;
      if (r) worst = Math.max(worst, Math.abs(hOf(main, sim.b) - rampH(r.s)));
      return sim.b.ride === null;
    });
    expect(ok).toBe(true);
    expect(sim.ev.at(-1)).toEqual({ k: 'off' });
    const want = (main.run - s0) / COS30 / ESC.speed;
    expect(sim.t - t0).toBeGreaterThan(want * 0.95);
    expect(sim.t - t0).toBeLessThan(want * 1.05);
    expect(worst).toBeLessThan(1e-9);
    // сошёл на верхнюю площадку и стоит на ней
    sim.until(NO, 1, () => false);
    expect(sim.b.ground).toBe('floor');
    expect(hOf(main, sim.b)).toBeCloseTo(main.rise, 9);
  });

  it('прибытие: с верхней площадки выхода лицом вниз — дорожка 2 везёт вниз до пола', () => {
    const ex = cell.esc[exitIdx];
    const sim = new Sim(createBody(cell.arrival, [1, 1, 1]));
    expect(sim.until(W, 3, () => sim.b.ride !== null)).toBe(true);
    expect(sim.b.ride!.lane).toBe(2);
    expect(sim.until(NO, 80, () => sim.b.ride === null)).toBe(true);
    expect(hOf(ex, sim.b)).toBeCloseTo(0, 9);
    expect(sim.ev.some((e) => e.k === 'land' || e.k === 'rescue')).toBe(false);
  });

  it('с боков наклон — стена (балюстрада): сбоку на дорожку не войти', () => {
    // низкая часть наклона (под высокой — проход под эскалатором)
    const s = 2, h = 0;
    const a = main.width / 2 + FRP.half + 0.6;
    const R = rightOf(main.up, main.fwd);
    // стоим на полу сбоку у низкой части наклона, лицом к нему (−right)
    const b = createBody({ at: at(main, s, a, h), up: main.up, fwd: (R ^ 1) as Axis6 }, [0, 0, 0]);
    const sim = new Sim(b);
    sim.until(W, 2, () => false);
    expect(sim.ev.some((e) => e.k === 'ride')).toBe(false);
    expect(sim.b.ride).toBeNull();
    const U = AXIS_VEC[main.up], Rv = AXIS_VEC[R];
    let aa = 0;
    for (let k = 0; k < 3; k++) {
      let d = sim.b.pos[k] - main.o[k];
      d -= P * Math.round(d / P);
      aa += d * Rv[k];
    }
    expect(aa).toBeGreaterThanOrEqual(main.width / 2 + FRP.half - 1e-6);
    void U;
  });

  it('упал на наклон сверху (тот же up) — встал на дорожку', () => {
    // над наклоном гарантированно пусто 2.4 м: тело 1.7 м — с высоты 0.6 м
    const s = main.run / 2;
    const b = createBody({ at: at(main, s, main.lanes[upLane].off, rampH(s) + 0.6), up: main.up, fwd: main.fwd }, [0, 0, 0]);
    b.ground = 'air';
    const sim = new Sim(b);
    expect(sim.until(NO, 2, () => sim.b.ride !== null)).toBe(true);
    expect(sim.ev.map((e) => e.k)).toEqual(['ride', 'land']);
    expect(hOf(main, sim.b)).toBeCloseTo(rampH(sim.b.ride!.s), 9);
  });
});

describe('срыв', () => {
  it('срыв на середине: стадии по ESC, в fall — свободное падение и приземление, подложка пуста', () => {
    const sim = rideTo(main, upLane, main.run / 2);
    expect(startCollapse(sim.w, mainIdx, upLane, false)).toBe(true);
    expect(startCollapse(sim.w, mainIdx, 0, false)).toBe(false);
    const t0 = sim.t;
    const stageT: Record<string, number> = {};
    let airSeen = false, landed: FrEvent | undefined;
    sim.until(NO, 12, () => {
      for (const e of sim.esc) if (e.k === 'stage' && stageT[e.stage] === undefined) stageT[e.stage] = sim.t - t0;
      if (sim.b.ground === 'air') airSeen = true;
      landed = sim.ev.find((e) => e.k === 'land');
      return !!landed && stageT.broken !== undefined;
    });
    expect(sim.esc[0]).toEqual({ k: 'start', esc: mainIdx, lane: upLane, bg: false });
    expect(stageT.runaway).toBeCloseTo(ESC.shudderS, 1);
    expect(stageT.fall).toBeCloseTo(ESC.shudderS + ESC.runawayS, 1);
    expect(stageT.broken).toBeCloseTo(ESC.shudderS + ESC.runawayS + ESC.fallS, 1);
    expect(sim.esc.some((e) => e.k === 'broken' && e.esc === mainIdx)).toBe(true);
    expect(airSeen).toBe(true);
    expect(landed).toBeDefined();
    expect(sim.b.ground).toBe('floor');
    expect(sim.ev.some((e) => e.k === 'rescue')).toBe(false);
    expect(sim.w.broken.has(mainIdx)).toBe(true);
    expect(sim.w.runs.has(mainIdx)).toBe(false);
    expect(sim.w.stage(mainIdx)).toBe('broken');
    expect(sim.w.belt(mainIdx, upLane)).toBe(0);
    // подложка не твёрда (а без поломки — твёрда)
    let band = 0;
    for (let i = 0; i < cell.vox.length; i++) {
      if (cell.vox[i] !== VX.ESC0 + mainIdx) continue;
      band++;
      const x = i % P, y = Math.floor(i / P) % P, z = Math.floor(i / P / P);
      expect(solidAt(cell, x, y, z, sim.w.broken)).toBe(false);
      expect(solidAt(cell, x, y, z)).toBe(true);
    }
    expect(band).toBeGreaterThan(0);
    // упал ниже наклона — на пол эскалатора (или ниже)
    expect(hOf(main, sim.b)).toBeLessThan(rampH(main.run / 2));
  });

  it('runaway уносит вниз; донесло до низа — выбросило на пол (land power 1)', () => {
    const sim = rideTo(main, upLane, 2.5);
    startCollapse(sim.w, mainIdx, upLane, false);
    expect(sim.until(NO, 6, () => sim.b.ride === null)).toBe(true);
    expect(sim.w.stage(mainIdx)).toBe('runaway');
    const land = sim.ev.find((e) => e.k === 'land');
    expect(land).toMatchObject({ k: 'land', power: 1 });
    expect(sim.b.ground).toBe('floor');
    expect(hOf(main, sim.b)).toBeCloseTo(0, 9);
    expect(sim.b.stun).toBeGreaterThan(0);
  });

  it('E на наклоне в runaway — перелезть через балюстраду, дальше — падение; до runaway — нельзя', () => {
    const sim = rideTo(main, upLane, main.run * 0.6);
    startCollapse(sim.w, mainIdx, upLane, false);
    sim.step(E);
    expect(sim.b.ride).not.toBeNull();
    expect(canHop(sim.env, sim.b)).toBe(false);
    expect(sim.until(NO, 3, () => sim.w.stage(mainIdx) === 'runaway')).toBe(true);
    sim.step(NO);
    expect(canHop(sim.env, sim.b)).toBe(true);
    sim.step(E);
    expect(sim.b.ride).toBeNull();
    const R = AXIS_VEC[rightOf(main.up, main.fwd)];
    let a = 0;
    for (let k = 0; k < 3; k++) {
      let d = sim.b.pos[k] - main.o[k];
      d -= P * Math.round(d / P);
      a += d * R[k];
    }
    expect(Math.abs(a)).toBeGreaterThan(main.width / 2 + FRP.half);
    expect(sim.until(NO, 6, () => sim.ev.some((e) => e.k === 'land'))).toBe(true);
    expect(sim.ev.some((e) => e.k === 'rescue')).toBe(false);
  });

  it('эскалатор выхода не срывается никогда', () => {
    const w = createEscWorld(cell, 't1');
    expect(startCollapse(w, exitIdx, 0, false)).toBe(false);
    expect(startCollapse(w, exitIdx, 2, true)).toBe(false);
    expect(w.runs.size).toBe(0);
    // и фоновый не выбирает его
    for (let i = 0; i < 2000; i++) stepEscWorld(w, 1, { rideStart: null, near: [exitIdx] });
    expect(w.runs.size + w.broken.size).toBe(0);
  });

  it('бросок при входе не раньше graceS (и не на первой поездке); после — изредка срыв на доле пути', () => {
    const w = createEscWorld(cell, 't1');
    let starts = 0;
    // 59 с: поездки каждую секунду — ни одного броска
    for (let i = 0; i < 59; i++) {
      for (const e of stepEscWorld(w, 1, { rideStart: { esc: mainIdx, lane: upLane }, near: [] })) if (e.k === 'start') starts++;
      expect(w.pend).toBeNull();
    }
    expect(starts).toBe(0);
    expect(w.runs.size).toBe(0);
    // дальше — поездки, пока не выпадет (шанс 5 %): срыв — по времени на ленте
    let t = 0;
    while (!w.pend && t < 4000) {
      stepEscWorld(w, 1, { rideStart: { esc: mainIdx, lane: upLane }, near: [] });
      t++;
    }
    expect(w.pend).not.toBeNull();
    expect(w.pend!.at).toBeGreaterThanOrEqual(0.3);
    let got: FrEscEvent | undefined;
    for (let i = 0; i < 200 && !got; i++) got = stepEscWorld(w, 0.5, { rideStart: null, near: [] }).find((e) => e.k === 'start');
    expect(got).toMatchObject({ k: 'start', esc: mainIdx, bg: false });
  });

  it('отложенный срыв с поездкой: ждёт доли пути; сошёл раньше — пропал', () => {
    const w = createEscWorld(cell, 't1');
    w.dice.t = 1000;
    w.dice.rides = 1;
    // подобрать сид-поездку, где бросок выпал
    while (!w.pend) {
      stepEscWorld(w, DT, { rideStart: { esc: mainIdx, lane: upLane }, near: [], ride: { esc: mainIdx, lane: upLane, s: 0 } });
      w.dice.last = -Infinity;
    }
    const p = w.pend;
    expect(p.s0).toBe(0);
    const need = p.at * main.run;
    expect(stepEscWorld(w, DT, { rideStart: null, near: [], ride: { esc: mainIdx, lane: upLane, s: need - 0.1 } })).toEqual([]);
    expect(w.pend).not.toBeNull();
    const ev = stepEscWorld(w, DT, { rideStart: null, near: [], ride: { esc: mainIdx, lane: upLane, s: need + 0.01 } });
    expect(ev[0]).toMatchObject({ k: 'start', esc: mainIdx });
    // второй раз: сошёл — пропал
    const w2 = createEscWorld(cell, 't1');
    w2.dice.t = 1000;
    w2.dice.rides = 1;
    while (!w2.pend) {
      stepEscWorld(w2, DT, { rideStart: { esc: mainIdx, lane: upLane }, near: [], ride: { esc: mainIdx, lane: upLane, s: 0 } });
      w2.dice.last = -Infinity;
    }
    stepEscWorld(w2, DT, { rideStart: null, near: [], ride: null });
    expect(w2.pend).toBeNull();
  });

  it('фоновый срыв в кадре — когда-нибудь (bg), потом пауза pauseS; поза срыва для сцены', () => {
    const w = createEscWorld(cell, 't1');
    let st: FrEscEvent | undefined, t = 0;
    while (!st && t < 2000) {
      st = stepEscWorld(w, 0.5, { rideStart: null, near: [mainIdx, exitIdx] }).find((e) => e.k === 'start');
      t += 0.5;
    }
    expect(st).toMatchObject({ k: 'start', esc: mainIdx, bg: true });
    expect(collapsePose(w, mainIdx)).toMatchObject({ drop: 0 });
    // до fall — без падения; в fall — 0.5·g·τ²
    stepEscWorld(w, ESC.shudderS + ESC.runawayS + 0.5, { rideStart: null, near: [] });
    const pose = collapsePose(w, mainIdx)!;
    expect(pose.drop).toBeCloseTo(0.5 * 9.8 * 0.25, 6);
    expect(pose.belt).toBeLessThan(0);
    expect(w.broken.has(mainIdx)).toBe(true);
    expect(w.stage(mainIdx)).toBe('fall');
  });

  it('фоновый срыв не выбирает эскалатор, на котором едет игрок (как rideKey в метро)', () => {
    const other = cell.esc.findIndex((e, i) => i !== mainIdx && e.kind === 'main');
    const ride = { esc: mainIdx, lane: upLane, s: 5 };
    // в кадре только «свой» — фоновых срывов нет вовсе
    const w = createEscWorld(cell, 't1');
    for (let t = 0; t < 3000; t += 0.5) {
      const ev = stepEscWorld(w, 0.5, { rideStart: null, near: [mainIdx], ride });
      expect(ev.some((e) => e.k === 'start')).toBe(false);
    }
    // «свой» и чужой — срывается только чужой
    const w2 = createEscWorld(cell, 't1');
    let st: FrEscEvent | undefined;
    for (let t = 0; t < 3000 && !st; t += 0.5) st = stepEscWorld(w2, 0.5, { rideStart: null, near: [mainIdx, other], ride }).find((e) => e.k === 'start');
    expect(st).toMatchObject({ k: 'start', esc: other, bg: true });
    expect(w2.runs.has(mainIdx)).toBe(false);
  });

  it('все копии: срыв — по индексу эскалатора, тело в копии (2,−1,0) падает так же', () => {
    const sim = rideTo(main, upLane, main.run / 2);
    sim.b.cell = [2, -1, 0];
    startCollapse(sim.w, mainIdx, upLane, false);
    expect(sim.until(NO, 12, () => sim.ev.some((e) => e.k === 'land'))).toBe(true);
    expect(sim.b.cell).toEqual([2, -1, 0]);
    void axisIdx;
  });
});

// FIX (ревью): тело, падающее на боковую кромку наклона (|a| чуть больше width/2, бок задевает балюстраду),
// проваливалось на воксели подложки под настилом (ступни на 0.66 м ниже ленты) и потом ходило сквозь эскалатор:
// wasRamp снимал балюстраду целиком. Теперь падение садит на ленту или отжимает за балюстраду, а из призмы можно
// выйти только наружу.
describe('кромка наклона: падение на балюстраду, выход из призмы', () => {
  /** Ступни в кадре эскалатора: s, a, h (ближайший образ — как в физике). */
  function local(e: FractalEsc, b: FrBody): { s: number; a: number; h: number } {
    const U = AXIS_VEC[e.up], F = AXIS_VEC[e.fwd], R = AXIS_VEC[rightOf(e.up, e.fwd)];
    let s = 0, a = 0, h = 0;
    for (let k = 0; k < 3; k++) {
      let d = b.pos[k] - e.o[k];
      d -= P * Math.round((d - F[k] * e.run * 0.5 - U[k] * e.rise * 0.5) / P);
      s += d * F[k]; a += d * R[k]; h += d * U[k];
    }
    return { s, a, h };
  }
  const cl = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
  /** Тело задевает призму наклона (балюстрада над лентой и «тело» до подложки) — с допуском 1 мм. */
  function inPrism(e: FractalEsc, b: FrBody): boolean {
    const { s, a, h } = local(e, b);
    if (s + FRP.half <= 1e-3 || s - FRP.half >= e.run - 1e-3) return false;
    if (Math.abs(a) - FRP.half >= e.width / 2 - 1e-3) return false;
    const top = rampH(cl(s + FRP.half, 0, e.run)) + FRP.rail, bot = rampH(cl(s - FRP.half, 0, e.run)) - FRP.under;
    return h < top - 1e-3 && h + FRP.h > bot + 1e-3;
  }
  /** Падать без ввода maxS с; ни одного кадра «стоит на полу внутри призмы». */
  function dropOn(e: FractalEsc, s: number, a: number, over: number, maxS = 5): { sim: Sim; bad: number } {
    const b = createBody({ at: at(e, s, a, rampH(s) + over), up: e.up, fwd: e.fwd }, [0, 0, 0]);
    b.ground = 'air';
    const sim = new Sim(b);
    let bad = 0;
    sim.until(NO, maxS, () => {
      if (sim.b.ground === 'floor' && inPrism(e, sim.b)) bad++;
      return false;
    });
    return { sim, bad };
  }

  it('эскалатор 3 (main, up +Y), s = 15, 3 м над наклоном, |a| = 3.05…3.25 — на ленту или за балюстраду, не на подложку', () => {
    const e = cell.esc[3];
    expect(e.kind).toBe('main');
    expect(AXIS_VEC[e.up]).toEqual([0, 1, 0]);
    for (const sg of [1, -1]) {
      for (const a0 of [3.05, 3.1, 3.15, 3.2, 3.25]) {
        const { sim, bad } = dropOn(e, 15, sg * a0, 3);
        expect(bad).toBe(0);
        expect(sim.b.ground).not.toBe('air');
        if (sim.b.ride) expect(local(e, sim.b).h).toBeCloseTo(rampH(sim.b.ride.s), 9);
        else expect(Math.abs(local(e, sim.b).a)).toBeGreaterThanOrEqual(e.width / 2 + FRP.half);
      }
    }
  });

  it('все эскалаторы, обе кромки, четверти наклона: падение никогда не ставит тело на пол внутри призмы', () => {
    let tried = 0;
    cell.esc.forEach((e, i) => {
      if (i === exitIdx) return;
      for (const q of [0.25, 0.5, 0.75]) {
        for (const sg of [1, -1]) {
          for (const da of [0.02, 0.1, 0.2, 0.28]) {
            const s = e.run * q, a = sg * (e.width / 2 + da);
            // старт — выше балюстрады (rail над лентой у переднего края следа) и в свободном месте
            const over = FRP.rail + rampH(FRP.half) + 0.1;
            const p = at(e, s, a, rampH(s) + over), lo: V3 = [0, 0, 0], hi: V3 = [0, 0, 0], ua = axisIdx(e.up);
            for (let k = 0; k < 3; k++) {
              lo[k] = k === ua ? Math.min(p[k], p[k] + AXIS_VEC[e.up][k] * FRP.h) : p[k] - FRP.half;
              hi[k] = k === ua ? Math.max(p[k], p[k] + AXIS_VEC[e.up][k] * FRP.h) : p[k] + FRP.half;
            }
            let free = true;
            for (let z = Math.floor(lo[2]); z < Math.ceil(hi[2]) && free; z++)
              for (let y = Math.floor(lo[1]); y < Math.ceil(hi[1]) && free; y++)
                for (let x = Math.floor(lo[0]); x < Math.ceil(hi[0]) && free; x++) if (solidAt(cell, x, y, z)) free = false;
            if (!free) continue;
            tried++;
            const { sim, bad } = dropOn(e, s, a, over, 3);
            expect(bad, `esc ${i} s ${s.toFixed(1)} a ${a.toFixed(2)}`).toBe(0);
            expect(sim.ev.some((x) => x.k === 'rescue')).toBe(false);
          }
        }
      }
    });
    expect(tried).toBeGreaterThan(100);
  });

  it('уже в призме (стоит на подложке под настилом): вглубь и насквозь — нет, наружу — выходит', () => {
    const e = cell.esc[3];
    const R = rightOf(e.up, e.fwd);
    for (const a0 of [3.1, 2.8, -3.1]) {
      const sg = Math.sign(a0);
      // старое плохое состояние: ступни на вокселе подложки (h 8 при ленте 8.66), бок в балюстраде
      const mk = () => createBody({ at: at(e, 15, a0, 8), up: e.up, fwd: e.fwd }, [0, 0, 0]);
      const stay = new Sim(mk());
      stay.until(NO, 0.5, () => false);
      expect(stay.b.ground).toBe('floor');
      expect(local(e, stay.b).h).toBeCloseTo(8, 9);
      expect(inPrism(e, stay.b)).toBe(true);
      // вглубь (к середине и дальше): |a| не убывает, на другую сторону не попасть
      const inS = new Sim(mk());
      let minAbs = Infinity;
      inS.until({ ...NO, side: -sg }, 3, () => {
        minAbs = Math.min(minAbs, Math.abs(local(e, inS.b).a) * Math.sign(local(e, inS.b).a) * sg);
        return false;
      });
      expect(minAbs).toBeGreaterThanOrEqual(Math.abs(a0) - 1e-9);
      // наружу — выходит из призмы
      const outS = new Sim(mk());
      expect(outS.until({ ...NO, side: sg }, 3, () => !inPrism(e, outS.b))).toBe(true);
      expect(Math.abs(local(e, outS.b).a)).toBeGreaterThanOrEqual(e.width / 2 + FRP.half - 1e-3);
    }
    void R;
  });
});
