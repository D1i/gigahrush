import { afterEach, describe, expect, it } from 'vitest';
import src from './smile.ts?raw';
import {
  createSmile, forceSmile, SMILE, smileChosen, smileLocked, smileNearest, smilePos, smileRooms, smileView, stepSmile,
  type SmileEvent, type SmileInput, type SmilePlayer, type SmileSpot, type SmileState, type SpotKind,
} from './smile';

/** Шаг — двоичная дробь: суммы времени точны. */
const DT = 1 / 32;
const WALK = 1.7;
const EPS = 1e-9;

/** Дефолты ручек — восстановить после теста (тесты правят SMILE, как бестиарий). */
const DEF = JSON.parse(JSON.stringify(SMILE));
afterEach(() => {
  const d = JSON.parse(JSON.stringify(DEF));
  for (const k of Object.keys(d)) (SMILE as Record<string, unknown>)[k] = d[k];
});

/** Коридор вдоль x (y = 0). Места выглядывания — на y = 1 каждые 3 м: двери жилых комнат r<x> (комната — по y > 1),
 *  каждые 15 м — угол, каждые 30 м — окно. Путь от избранного — |dx| + 1. */
function spotAt(x: number): SmileSpot {
  const kind: SpotKind = x % 30 === 0 ? 'window' : x % 15 === 0 ? 'corner' : 'door';
  if (kind === 'door') return { id: `d${x}`, kind, p: { x, y: 1, room: `r${x}` }, z: 0, yaw: -Math.PI / 2, side: 1, hideRoom: `r${x}`, door: `door${x}` };
  return { id: `${kind}${x}`, kind, p: { x, y: 1, room: 'c' }, z: 0, yaw: -Math.PI / 2, side: -1, hideRoom: null };
}
const SPOTS: SmileSpot[] = [];
for (let x = -60; x <= 60; x += 3) SPOTS.push(spotAt(x));

function mkPlayer(id: string, x: number, o: Partial<SmilePlayer> = {}): SmilePlayer {
  return { id, p: { x, y: 0, room: 'c' }, z: 0, fx: 1, fy: 0, vx: 0, vy: 0, flash: false, sees: false, aim: false, room: 'c', inside: null, alive: true, obsh: true, ...o };
}

interface World {
  players: SmilePlayer[];
  dark: boolean;
  aheadNull?: boolean;
  farNull?: boolean;
}

function input(w: World): SmileInput {
  return {
    players: w.players,
    dark: w.dark,
    walkSpeed: WALK,
    spots: (_st, ch) => SPOTS.map((spot) => ({ spot, pathM: Math.abs(spot.p.x - ch.p.x) + 1, inView: true })),
    ahead: (p, d) => (w.aheadNull ? null : { p: { x: p.p.x + (p.vx < 0 ? -d : d), y: 0, room: 'c' }, z: 0, yaw: p.vx < 0 ? 0 : Math.PI }),
    far: (c) => (w.farNull ? null : { x: c.p.x - 30, y: 0, room: 'c' }),
  };
}

type Log = { t: number; e: SmileEvent }[];
type Ev<T extends SmileEvent['type']> = Extract<SmileEvent, { type: T }>;

function step(s: SmileState, w: World, dt = DT, log?: Log): SmileEvent[] {
  const ev = stepSmile(s, dt, input(w));
  if (log) for (const e of ev) log.push({ t: s.t, e });
  return ev;
}

function run(s: SmileState, w: World, secs: number, log: Log = [], dt = DT): Log {
  for (let i = 0, n = Math.round(secs / dt); i < n; i++) step(s, w, dt, log);
  return log;
}

/** Шагать, пока не случится событие type (не дольше maxS): само событие и время конца его шага. */
function until<T extends SmileEvent['type']>(s: SmileState, w: World, type: T, maxS = 400, log: Log = []): { t: number; e: Ev<T> } {
  for (let i = 0, n = Math.round(maxS / DT); i < n; i++) {
    const ev = step(s, w, DT, log);
    const e = ev.find((x) => x.type === type);
    if (e) return { t: s.t, e: e as Ev<T> };
  }
  throw new Error(`нет события ${type} за ${maxS} с`);
}

const types = (log: Log) => log.map((x) => x.e.type);
const near = (a: number, b: number, tol = DT) => Math.abs(a - b) <= tol + EPS;
const aimAt = (p: SmilePlayer, on: boolean) => {
  p.sees = on;
  p.aim = on;
};

/** Охота со стадии 2 до разрыва лица: избранный A (фонарь) смотрит в прицел. */
function toTear(seed: string, A: SmilePlayer, w: World) {
  const s = createSmile(seed);
  forceSmile(s, 2);
  const peek = until(s, w, 'peek', 10);
  aimAt(A, true);
  const tear = until(s, w, 'tear', 10);
  aimAt(A, false);
  return { s, peek, tear };
}

/** Бежать от неё со скоростью v (вектор от места выглядывания к игроку). */
function runFrom(A: SmilePlayer, sp: SmileSpot, v: number) {
  const dx = A.p.x - sp.p.x, dy = A.p.y - sp.p.y, L = Math.hypot(dx, dy);
  A.vx = (dx / L) * v;
  A.vy = (dy / L) * v;
}

/** Охота до провокации (стадия 3): разрыв, побежал, встала впереди. */
function toProvoke(seed: string, A: SmilePlayer, w: World) {
  const { s, tear } = toTear(seed, A, w);
  runFrom(A, s.spot!, WALK * 1.5);
  const flee = until(s, w, 'flee', 2);
  A.vx = A.vy = 0;
  const provoke = until(s, w, 'provoke', 5);
  return { s, tear, flee, provoke };
}

describe('«Улыбка»: модуль без движка', () => {
  it('ни Babylon, ни DOM, ни Math.random: импорты — ГСЧ и тип точки', () => {
    const imports = [...src.matchAll(/^import .* from '([^']+)';$/gm)].map((m) => m[1]);
    expect(imports.sort()).toEqual(['../model/rng', './obshaga']);
    expect(src).toMatch(/^import type \{ Pt \} from '\.\/obshaga';$/m);
    expect(src).not.toMatch(/@babylonjs|document\.|window\.|Math\.random/);
  });

  it('ручки — обычный изменяемый объект с дефолтами контракта; правка действует сразу', () => {
    expect(Object.isFrozen(SMILE)).toBe(false);
    expect(SMILE.firstHuntS).toEqual([40, 80]);
    expect(SMILE.huntCooldownS).toEqual([50, 100]);
    expect(SMILE.afterKillS).toEqual([120, 200]);
    expect([SMILE.omenS, SMILE.crunchAt, SMILE.peeks1, SMILE.noticeS, SMILE.hideS]).toEqual([3.5, 0.4, 3, 0.15, 0.35]);
    expect([SMILE.peek1DistM, SMILE.peek1GapS, SMILE.peek1MaxS]).toEqual([[9, 18], [6, 14], 10]);
    expect([SMILE.peeks2, SMILE.peek2DistM, SMILE.peek2GapS, SMILE.peek2MaxS]).toEqual([4, [4, 10], [5, 10], 16]);
    expect([SMILE.stareS, SMILE.aimCircle, SMILE.stareGraceS, SMILE.tearS, SMILE.fleeSpeedK, SMILE.fleeWaitS]).toEqual([5, 0.1, 0.35, 1.2, 0.6, 4]);
    expect([SMILE.provokeAheadM, SMILE.provokeS, SMILE.provokes, SMILE.relocateS, SMILE.pounceR, SMILE.pounceS, SMILE.eatS]).toEqual([[5, 9], 20, 2, 1.5, 1, 0.45, 3.5]);
    expect([SMILE.trapFromStage, SMILE.trapRooms, SMILE.trapCloseS, SMILE.trapDarkS, SMILE.trapEyesS, SMILE.trapChokeS, SMILE.againStage]).toEqual([2, 2, 2.4, 0.6, 4, 3, 2]);
    expect([SMILE.windowChance, SMILE.cornerChance]).toEqual([0.15, 0.25]);
    expect(SMILE.heart).toEqual({ omen1: 0, peek2: 0.35, tear: 0.6, provoke: 1 });
    expect(SMILE.ring).toEqual({ stage1: 0.25, stage2: 0.4, stage3: 0.6 });
    // избранный на стадии 2 подходит раньше, чем она хватает
    expect(SMILE.approach2M).toBeGreaterThan(SMILE.pounceR);

    // бестиарий правит на лету: предвестие 1 с, хруст посередине
    SMILE.omenS = 1;
    SMILE.crunchAt = 0.5;
    const A = mkPlayer('A', 0, { flash: true });
    const w: World = { players: [A], dark: false };
    const s = createSmile('mut');
    forceSmile(s, 1);
    const log: Log = [];
    const omen = until(s, w, 'omen', 1, log);
    const crunch = until(s, w, 'crunch', 2, log);
    const peek = until(s, w, 'peek', 2, log);
    expect(near(crunch.t - omen.t, 0.5)).toBe(true);
    expect(near(peek.t - omen.t, 1)).toBe(true);
  });

  it('избранный — держащий фонарь: прежний, пока держит; иначе первый по id; никто — null', () => {
    const a = mkPlayer('a', 0, { flash: true }), b = mkPlayer('b', 0, { flash: true }), c = mkPlayer('c', 0);
    expect(smileChosen(null, [b, a, c])).toBe('a');
    expect(smileChosen('b', [a, b, c])).toBe('b');
    expect(smileChosen('c', [a, b, c])).toBe('a');
    expect(smileChosen('b', [a, { ...b, alive: false }])).toBe('a');
    expect(smileChosen('a', [{ ...a, obsh: false }, c])).toBe(null);
  });
});

describe('«Улыбка»: охота по стадиям', () => {
  it('без фонаря охоты нет — лишь хруст вдалеке; взяли фонарь — охота со стадии 1', () => {
    const A = mkPlayer('A', 0);
    const w: World = { players: [A], dark: false };
    const s = createSmile('noflash');
    const dt = 1 / 4;
    const log = run(s, w, 400, [], dt);
    expect(types(log)).not.toContain('omen');
    expect(types(log)).not.toContain('peek');
    const crunches = log.filter((x) => x.e.type === 'crunch');
    expect(crunches.length).toBeGreaterThanOrEqual(5);
    for (const c of crunches) expect((c.e as Ev<'crunch'>).p).toEqual({ x: -30, y: 0, room: 'c' });
    // хруст раз в noFlashS
    for (let i = 1; i < crunches.length; i++) {
      const gap = crunches[i].t - crunches[i - 1].t;
      expect(gap).toBeGreaterThanOrEqual(SMILE.noFlashS[0] - dt - EPS);
      expect(gap).toBeLessThanOrEqual(SMILE.noFlashS[1] + dt + EPS);
    }
    expect(s.stage).toBe(0);
    const v = smileView(s);
    expect([v.visible, v.chosen, v.heart, v.ring]).toEqual([false, null, 0, 0]);

    A.flash = true;
    const omen = until(s, w, 'omen', SMILE.noFlashS[1] + 1);
    expect(omen.e).toEqual({ type: 'omen', chosen: 'A', stage: 1 });
    expect(s.hunt).toBe(1);
  }, 60000);

  it('стадии по порядку: 3 раза издалека → 4 ближе → «потеряла интерес» → новая охота со стадии againStage', () => {
    const A = mkPlayer('A', 0, { flash: true });
    const w: World = { players: [A], dark: false };
    const s = createSmile('order');
    const dt = 1 / 16;
    const log = run(s, w, 500, [], dt);
    const ev = log.map((x) => x.e);
    const end = ev.findIndex((e) => e.type === 'end');
    expect(ev[end]).toEqual({ type: 'end', why: 'lost' });
    // до конца охоты — 7 раз «предвестие → хруст → выглянула → спряталась»
    expect(types(log.slice(0, end))).toEqual(Array(7).fill(['omen', 'crunch', 'peek', 'hide']).flat());
    const omens = ev.filter((e): e is Ev<'omen'> => e.type === 'omen');
    expect(omens.slice(0, 8).map((e) => e.stage)).toEqual([1, 1, 1, 2, 2, 2, 2, 2]);
    expect(log[0].t).toBeGreaterThanOrEqual(SMILE.firstHuntS[0]);
    expect(log[0].t).toBeLessThanOrEqual(SMILE.firstHuntS[1] + dt + EPS);
    let prev = '';
    for (let k = 0; k < 7; k++) {
      const [o, c, p, h] = log.slice(4 * k, 4 * k + 4);
      expect(near(c.t - o.t, SMILE.crunchAt * SMILE.omenS, dt)).toBe(true);
      expect(near(p.t - o.t, SMILE.omenS, dt)).toBe(true);
      // не заметили — прячется сама через peekMaxS (+ прятка hideS — уже в hide-событии нет: событие в начале прятки)
      expect(near(h.t - p.t, k < 3 ? SMILE.peek1MaxS : SMILE.peek2MaxS, dt)).toBe(true);
      const sp = (p.e as Ev<'peek'>).spot;
      const path = Math.abs(sp.p.x - A.p.x) + 1;
      const [lo, hi] = k < 3 ? SMILE.peek1DistM : SMILE.peek2DistM;
      expect(path).toBeGreaterThanOrEqual(lo);
      expect(path).toBeLessThanOrEqual(hi);
      expect(sp.id).not.toBe(prev);
      prev = sp.id;
    }
    // новая охота — после перезарядки, со стадии 2
    const again = log.find((x, i) => i > end && x.e.type === 'omen')!;
    expect((again.e as Ev<'omen'>).stage).toBe(2);
    const gap = again.t - log[end].t;
    expect(gap).toBeGreaterThanOrEqual(SMILE.huntCooldownS[0] - EPS);
    expect(gap).toBeLessThanOrEqual(SMILE.huntCooldownS[1] + dt + EPS);
  }, 60000);

  it('стадия 1: прячется, как только избранный заметил её (noticeS); подошли ближе 3 м — тоже', () => {
    const A = mkPlayer('A', 0, { flash: true }), B = mkPlayer('B', -40);
    const w: World = { players: [A, B], dark: false };
    const s = createSmile('notice');
    forceSmile(s, 1);
    const p = until(s, w, 'peek', 10);
    expect(s.stage).toBe(1);
    // видна краем глаза — копится; мелькнула и пропала — сначала
    A.sees = true;
    run(s, w, 0.1);
    A.sees = false;
    step(s, w);
    expect(s.phase).toBe('peek');
    A.sees = true;
    const t0 = s.t;
    const h = until(s, w, 'hide', 2);
    expect(h.t - t0).toBeGreaterThanOrEqual(SMILE.noticeS - EPS);
    expect(h.t - t0).toBeLessThanOrEqual(SMILE.noticeS + DT + EPS);
    expect(h.e.spot).toEqual(p.e.spot);
    // успела выглянуть на (0.1 + 1/32 + 0.15625) / peekInS — прячется за hideS × столько
    expect(s.phaseDur).toBeLessThan(SMILE.hideS);
    A.sees = false;

    const p2 = until(s, w, 'peek', 40);
    B.p = { x: p2.e.spot.p.x, y: p2.e.spot.p.y - 2.9, room: 'c' };
    const h2 = until(s, w, 'hide', 1);
    expect(near(h2.t - p2.t, DT)).toBe(true);
  });

  it('стадия 2: прицел копится stareS, обрыв ≤ stareGraceS прощается, дольше — сгорает', () => {
    function tearAfter(gap: number): number {
      const A = mkPlayer('A', 0, { flash: true });
      const w: World = { players: [A], dark: false };
      const s = createSmile('stare');
      forceSmile(s, 2);
      const p = until(s, w, 'peek', 10);
      expect(s.look).toBe('A');
      aimAt(A, true);
      run(s, w, 2);
      aimAt(A, false);
      run(s, w, gap);
      aimAt(A, true);
      return until(s, w, 'tear', 10).t - p.t;
    }
    expect(near(tearAfter(0.25), 2 + 0.25 + 3)).toBe(true);
    expect(near(tearAfter(0.5), 2 + 0.5 + 5)).toBe(true);
    // в кадре, но не в круге прицела — не копится
    const A = mkPlayer('A', 0, { flash: true, sees: true });
    const w: World = { players: [A], dark: false };
    const s = createSmile('stare');
    forceSmile(s, 2);
    until(s, w, 'peek', 10);
    const log = run(s, w, 10);
    expect(types(log)).not.toContain('tear');
  });

  it('после разрыва: побежал от неё (≥ fleeSpeedK × шаг) — сразу уходит за дверь, стадия 3; не побежал — сама через fleeWaitS', () => {
    function fleeAfter(seed: string, v: number) {
      const A = mkPlayer('A', 0, { flash: true });
      const w: World = { players: [A], dark: false };
      const { s, tear } = toTear(seed, A, w);
      expect(s.phase).toBe('tear');
      runFrom(A, s.spot!, v);
      const f = until(s, w, 'flee', 10);
      expect([s.stage, s.phase]).toEqual([3, 'gone']);
      return f.t - tear.t;
    }
    expect(near(fleeAfter('flee', SMILE.fleeSpeedK * WALK + 0.05), DT)).toBe(true);
    expect(near(fleeAfter('flee', SMILE.fleeSpeedK * WALK - 0.05), SMILE.tearS + SMILE.fleeWaitS)).toBe(true);
    // к ней — не бег
    expect(near(fleeAfter('flee', -WALK * 2), SMILE.tearS + SMILE.fleeWaitS)).toBe(true);

    // лицо рвётся за tearS
    const A = mkPlayer('A', 0, { flash: true });
    const w: World = { players: [A], dark: false };
    const { s } = toTear('torn', A, w);
    run(s, w, SMILE.tearS / 2);
    expect(smileView(s).torn).toBeGreaterThan(0.4);
    expect(smileView(s).torn).toBeLessThan(0.6);
    run(s, w, SMILE.tearS);
    expect(smileView(s).torn).toBe(1);
  });

  it('стадия 2: не избранный подошёл на pounceR — бросок; избранный подошёл — уходит (стадия 3), его не хватает', () => {
    const A = mkPlayer('A', 0, { flash: true }), B = mkPlayer('B', -40);
    const w: World = { players: [A, B], dark: false };
    const s = createSmile('st2');
    forceSmile(s, 2);
    const p = until(s, w, 'peek', 10);
    B.p = { x: p.e.spot.p.x + 0.5, y: p.e.spot.p.y - 0.6, room: 'c' };
    const pc = until(s, w, 'pounce', 1);
    expect(pc.e.victim).toBe('B');
    expect(near(pc.t - p.t, DT)).toBe(true);

    const A2 = mkPlayer('A', 0, { flash: true });
    const w2: World = { players: [A2], dark: false };
    const s2 = createSmile('st2b');
    forceSmile(s2, 2);
    const p2 = until(s2, w2, 'peek', 10);
    A2.p = { x: p2.e.spot.p.x, y: p2.e.spot.p.y - 0.5, room: 'c' };
    const log: Log = [];
    until(s2, w2, 'flee', 1, log);
    expect(types(log)).not.toContain('pounce');
    expect(s2.stage).toBe(3);
  });

  it('посреди охоты фонарь убрали — выглядывание прячется, охота кончается «потеряла интерес»', () => {
    const A = mkPlayer('A', 0, { flash: true });
    const w: World = { players: [A], dark: false };
    const s = createSmile('drop');
    forceSmile(s, 2);
    until(s, w, 'peek', 10);
    A.flash = false;
    const log: Log = [];
    const h = until(s, w, 'hide', 1, log);
    expect(near(h.t, s.t)).toBe(true);
    const end = until(s, w, 'end', 30, log);
    expect(end.e.why).toBe('lost');
    expect(s.from).toBe(SMILE.againStage);
  });
});

describe('«Улыбка»: провокация и еда', () => {
  it('стадия 3: встаёт впереди по ходу; подошёл на pounceR — бросок, еда eatS, смерть, перезарядка afterKillS', () => {
    const A = mkPlayer('A', 0, { flash: true }), B = mkPlayer('B', -40);
    const w: World = { players: [A, B], dark: false };
    const { s, flee, provoke } = toProvoke('eat', A, w);
    expect(near(provoke.t - flee.t, SMILE.goneS)).toBe(true);
    const d = provoke.e.p.x - A.p.x;
    expect(d).toBeGreaterThanOrEqual(SMILE.provokeAheadM[0]);
    expect(d).toBeLessThanOrEqual(SMILE.provokeAheadM[1]);
    let v = smileView(s);
    expect([v.visible, v.pose, v.heart, v.ring, v.chosen]).toEqual([true, 'stand', 1, 0.6, 'A']);
    expect(v.p).toEqual(provoke.e.p);

    B.p = { x: provoke.e.p.x + 0.9, y: 0, room: 'c' };
    const log: Log = [];
    const pc = until(s, w, 'pounce', 1, log);
    expect(pc.e.victim).toBe('B');
    v = smileView(s);
    expect([v.pose, v.torn, v.eat?.victim]).toEqual(['pounce', 1, 'B']);
    run(s, w, SMILE.pounceS + DT, log);
    v = smileView(s);
    expect([v.pose, v.eat?.victim, v.visible]).toEqual(['eat', 'B', true]);
    expect(v.p).toEqual({ x: provoke.e.p.x + 0.9, y: 0, room: 'c' });
    const eaten = until(s, w, 'eaten', 10, log);
    expect(eaten.e.victim).toBe('B');
    expect(near(eaten.t - pc.t, SMILE.pounceS + SMILE.eatS)).toBe(true);
    expect(types(log).slice(-2)).toEqual(['eaten', 'end']);
    expect(log[log.length - 1].e).toEqual({ type: 'end', why: 'kill' });
    expect([s.stage, s.kills, s.from, s.eat, s.chosen]).toEqual([0, 1, 1, null, null]);
    expect(s.next).toBeGreaterThanOrEqual(SMILE.afterKillS[0]);
    expect(s.next).toBeLessThanOrEqual(SMILE.afterKillS[1]);
    // новая охота — со стадии 1
    step(s, w);
    expect(s.chosen).toBe('A');
    const again = until(s, w, 'omen', SMILE.afterKillS[1] + 1);
    expect(again.e.stage).toBe(1);
  });

  it('стадия 3: избранный не смотрит > relocateS и дальше 4 м — переставляется вперёд (до provokes раз); provokeS — уходит', () => {
    const A = mkPlayer('A', 0, { flash: true });
    const w: World = { players: [A], dark: false };
    const { s, provoke } = toProvoke('relocate', A, w);
    const log: Log = [];
    const end = until(s, w, 'end', SMILE.provokeS + 1, log);
    expect(end.e.why).toBe('timeout');
    expect(near(end.t - provoke.t, SMILE.provokeS)).toBe(true);
    const moves = log.filter((x) => x.e.type === 'provoke');
    expect(moves.length).toBe(SMILE.provokes);
    let t = provoke.t;
    for (const m of moves) {
      expect(near(m.t - t, SMILE.relocateS + DT)).toBe(true);
      t = m.t;
    }
    // следующая охота — со стадии againStage
    const again = until(s, w, 'omen', SMILE.huntCooldownS[1] + 1);
    expect(again.e.stage).toBe(SMILE.againStage);

    // смотрит на неё — не переставляется
    const A2 = mkPlayer('A', 0, { flash: true });
    const w2: World = { players: [A2], dark: false };
    const r2 = toProvoke('relocate', A2, w2);
    A2.sees = true;
    const log2: Log = [];
    until(r2.s, w2, 'end', SMILE.provokeS + 1, log2);
    expect(types(log2)).toEqual(['end']);
  });

  it('темно — новые выглядывания не начинаются, предвестие сгорает; идущая стадия 3 продолжается', () => {
    const A = mkPlayer('A', 0, { flash: true }), B = mkPlayer('B', -40);
    const w: World = { players: [A, B], dark: true };
    const s = createSmile('dark');
    forceSmile(s, 2);
    const log = run(s, w, 120);
    expect(log).toEqual([]);
    w.dark = false;
    const o = until(s, w, 'omen', SMILE.retryS + DT);
    expect(o.e.stage).toBe(2);
    w.dark = true;
    const log2 = run(s, w, 10);
    expect(types(log2)).not.toContain('peek');
    expect(s.phase).toBe('idle');

    w.dark = false;
    const A2 = mkPlayer('A', 0, { flash: true }), B2 = mkPlayer('B', -40);
    const w2: World = { players: [A2, B2], dark: false };
    const { s: s2, provoke } = toProvoke('dark3', A2, w2);
    w2.dark = true;
    run(s2, w2, 1);
    expect(s2.phase).toBe('provoke');
    B2.p = { x: s2.at!.p.x, y: 0.5, room: 'c' };
    const pc = until(s2, w2, 'pounce', 1);
    expect(pc.e.victim).toBe('B');
    expect(provoke.e.p.x).toBeGreaterThan(0);
  });
});

describe('«Улыбка»: ловушка-комната', () => {
  it('не избранный зашёл в её комнату: дверь закрывается, лампы бьются, глаза, удушье, смерть; дверь заперта', () => {
    const A = mkPlayer('A', 0, { flash: true }), B = mkPlayer('B', -40);
    const w: World = { players: [A, B], dark: false };
    const s = createSmile('trap');
    forceSmile(s, 2);
    const p = until(s, w, 'peek', 10);
    const room = p.e.spot.hideRoom!, door = p.e.spot.door!;
    expect(room).toBeTruthy();
    expect(smileRooms(s)).toEqual([room]);
    B.p = { x: p.e.spot.p.x, y: 4, room };
    B.inside = room;
    const log: Log = [];
    const tr = until(s, w, 'trap', 1, log);
    expect(tr.e).toEqual({ type: 'trap', victim: 'B', room, door });
    // выглядывала из этой самой двери — ушла к жертве
    expect(types(log)).toEqual(['trap', 'hide']);
    expect(smileLocked(s, door)).toBe(true);
    expect(smileLocked(s, 'door-other')).toBe(false);
    expect(smileView(s).trap).toEqual({ victim: 'B', room, door, ph: 'close', t: 0 });

    const seq: Log = [];
    const death = until(s, w, 'trapDeath', 15, seq);
    expect(types(seq)).toEqual(['trapDark', 'trapEyes', 'trapChoke', 'trapDeath', 'end']);
    const at = (k: string) => seq.find((x) => x.e.type === k)!.t;
    expect(near(at('trapDark') - tr.t, SMILE.trapCloseS)).toBe(true);
    expect(near(at('trapEyes') - at('trapDark'), SMILE.trapDarkS)).toBe(true);
    expect(near(at('trapChoke') - at('trapEyes'), SMILE.trapEyesS)).toBe(true);
    expect(near(death.t - at('trapChoke'), SMILE.trapChokeS)).toBe(true);
    expect(death.e).toEqual({ type: 'trapDeath', victim: 'B', room, door });
    expect(seq[seq.length - 1].e).toEqual({ type: 'end', why: 'kill' });
    expect([s.stage, s.kills, s.from, s.trap]).toEqual([0, 1, 1, null]);
    // дверь заперта ещё trapUnlockS
    expect(smileLocked(s, door)).toBe(true);
    run(s, w, SMILE.trapUnlockS - 0.1);
    expect(smileLocked(s, door)).toBe(true);
    run(s, w, 0.2);
    expect(smileLocked(s, door)).toBe(false);
  });

  it('пока дверь закрывается, жертва выскочила — trapEscape, дверь не заперта, смерти нет', () => {
    const A = mkPlayer('A', 0, { flash: true }), B = mkPlayer('B', -40);
    const w: World = { players: [A, B], dark: false };
    const s = createSmile('escape');
    forceSmile(s, 2);
    const p = until(s, w, 'peek', 10);
    const room = p.e.spot.hideRoom!, door = p.e.spot.door!;
    B.p = { x: p.e.spot.p.x, y: 4, room };
    B.inside = room;
    until(s, w, 'trap', 1);
    run(s, w, 1);
    B.inside = null;
    B.p = { x: p.e.spot.p.x, y: -2, room: 'c' };
    const log: Log = [];
    const esc = until(s, w, 'trapEscape', 1, log);
    expect(esc.e).toEqual({ type: 'trapEscape', victim: 'B', room, door });
    expect(smileLocked(s, door)).toBe(false);
    run(s, w, 15, log);
    expect(types(log)).not.toContain('trapDeath');
  });

  it('избранного «она просто пропускает»; на стадии 1 ловушек нет (trapFromStage)', () => {
    const A = mkPlayer('A', 0, { flash: true }), B = mkPlayer('B', -40);
    const w: World = { players: [A, B], dark: false };
    const s = createSmile('pass');
    forceSmile(s, 2);
    const p = until(s, w, 'peek', 10);
    const room = p.e.spot.hideRoom!, door = p.e.spot.door!;
    A.p = { x: p.e.spot.p.x, y: 4, room };
    A.inside = room;
    const log = run(s, w, 30);
    expect(types(log)).not.toContain('trap');
    expect(smileLocked(s, door)).toBe(false);

    // стадия 1: не избранный зашёл в комнату, из которой она выглядывала, — ничего
    const stage1 = (seed: string) => {
      const A1 = mkPlayer('A', 0, { flash: true }), B1 = mkPlayer('B', -40);
      const w1: World = { players: [A1, B1], dark: false };
      const s1 = createSmile(seed);
      forceSmile(s1, 1);
      let pk = until(s1, w1, 'peek', 30);
      while (pk.e.spot.hideRoom === null) pk = until(s1, w1, 'peek', 60);
      B1.p = { x: pk.e.spot.p.x, y: 4, room: pk.e.spot.hideRoom! };
      B1.inside = pk.e.spot.hideRoom;
      const l: Log = [];
      for (let i = 0; i < 2000 && s1.stage === 1; i++) step(s1, w1, DT, l);
      return l;
    };
    expect(types(stage1('pass1'))).not.toContain('trap');
    SMILE.trapFromStage = 1;
    expect(types(stage1('pass1'))).toContain('trap');
  });

  it('«её» комнаты — последние trapRooms, только комнаты (не углы и окна); новая охота — заново', () => {
    const A = mkPlayer('A', 0, { flash: true });
    const w: World = { players: [A], dark: false };
    const s = createSmile('rooms');
    forceSmile(s, 2);
    const peeks: SmileSpot[] = [];
    for (let k = 0; k < 3; k++) peeks.push(until(s, w, 'peek', 40).e.spot);
    const doors = peeks.map((sp) => sp.hideRoom).filter((r): r is string => r !== null);
    const uniq = doors.filter((r, i) => doors.lastIndexOf(r) === i);
    expect(smileRooms(s)).toEqual(uniq.slice(-SMILE.trapRooms));
    until(s, w, 'end', 120);
    expect(smileRooms(s)).toEqual([]);
  });
});

describe('«Улыбка»: вид', () => {
  it('модель — только в появлении; сердце и писк — по стадии; голова — на ближайшего', () => {
    const A = mkPlayer('A', 0, { flash: true }), B = mkPlayer('B', -40);
    const w: World = { players: [A, B], dark: false };
    const s = createSmile('view');
    forceSmile(s, 1);
    until(s, w, 'omen', 1);
    let v = smileView(s);
    expect([v.visible, v.chosen, v.heart, v.ring, v.pose, v.p]).toEqual([false, 'A', 0, 0.25, null, null]);
    const p = until(s, w, 'peek', 5);
    v = smileView(s);
    expect(v.visible).toBe(true);
    expect(v.pose).toBe(p.e.spot.kind === 'window' ? 'window' : 'peek');
    expect(v.lean).toBeLessThan(0.2);
    expect(v.look).toBe(null);
    run(s, w, SMILE.peekInS);
    expect(smileView(s).lean).toBe(1);
    expect(smilePos(s)).toEqual({ p: p.e.spot.p, z: 0 });
    expect(smileNearest(s, [A, B])?.id).toBe('A');

    const s2 = createSmile('view2');
    forceSmile(s2, 2);
    until(s2, w, 'omen', 1);
    expect([smileView(s2).heart, smileView(s2).ring]).toEqual([0.35, 0.4]);
    until(s2, w, 'peek', 5);
    expect(smileView(s2).look).toBe('A');
    aimAt(A, true);
    until(s2, w, 'tear', 10);
    aimAt(A, false);
    expect([smileView(s2).heart, smileView(s2).ring]).toEqual([0.6, 0.4]);
    runFrom(A, s2.spot!, WALK * 2);
    until(s2, w, 'flee', 1);
    A.vx = A.vy = 0;
    v = smileView(s2);
    expect([v.visible, v.heart, v.ring]).toEqual([true, 1, 0.6]);
    run(s2, w, SMILE.hideS + DT);
    expect(smileView(s2).visible).toBe(false);
    until(s2, w, 'provoke', 5);
    v = smileView(s2);
    expect([v.visible, v.pose, v.torn, v.look]).toEqual([true, 'stand', 1, 'A']);
    until(s2, w, 'end', 30);
    v = smileView(s2);
    expect([v.visible, v.heart, v.ring, v.stage]).toEqual([false, 0, 0, 0]);
  });

  it('хруст — в far(); нет далёкой точки — в 20 м по взгляду избранного', () => {
    const A = mkPlayer('A', 2, { flash: true, fx: 0, fy: 1 });
    const w: World = { players: [A], dark: false, farNull: true };
    const s = createSmile('crunch');
    forceSmile(s, 1);
    const c = until(s, w, 'crunch', 5);
    expect(c.e.p).toEqual({ x: 2, y: 20 });
  });
});

describe('«Улыбка»: детерминизм и JSON', () => {
  /** Блуждающий кооп на двоих: A с фонарём ходит туда-сюда и временами смотрит в прицел, B заходит в комнаты. */
  function wander(s: SmileState): World {
    const t = s.t;
    const look = t % 20 < 7;
    const A = mkPlayer('A', 12 * Math.sin(t / 17), { flash: true, vx: (12 / 17) * Math.cos(t / 17), sees: look, aim: look, fx: Math.cos(t / 5), fy: Math.sin(t / 5) });
    const bx = -10 + 8 * Math.sin(t / 11);
    const door = Math.round(bx / 3) * 3;
    const inRoom = Math.floor(t / 25) % 2 === 0 && spotAt(door).kind === 'door';
    const B = inRoom ? mkPlayer('B', door, { p: { x: door, y: 4, room: `r${door}` }, inside: `r${door}` }) : mkPlayer('B', bx, { vx: (8 / 11) * Math.cos(t / 11) });
    return { players: [A, B], dark: Math.floor(t / 90) % 4 === 3 };
  }

  /** Шаг блуждания: 1/8 с (длинные прогоны; точность шага тут не важна). */
  const WDT = 1 / 8;

  function play(seed: string, secs: number, s = createSmile(seed)): { s: SmileState; log: Log } {
    const log: Log = [];
    for (let i = 0, n = Math.round(secs / WDT); i < n; i++) step(s, wander(s), WDT, log);
    return { s, log };
  }

  it('один сид и один ход входов — одни события; другой сид — другая охота', () => {
    const a = play('x', 600), b = play('x', 600), c = play('y', 600);
    expect(JSON.stringify(a.log)).toBe(JSON.stringify(b.log));
    expect(a.s).toStrictEqual(b.s);
    expect(JSON.stringify(a.log)).not.toBe(JSON.stringify(c.log));
    // сценарий и правда гоняет охоту: выглядывания, разрывы, провокации, ловушки
    const seen = new Set(types(a.log));
    for (const k of ['omen', 'crunch', 'peek', 'hide', 'tear', 'flee', 'provoke', 'end']) expect(seen.has(k as SmileEvent['type'])).toBe(true);
  }, 60000);

  /** Путь к первому не-JSON значению (NaN, Infinity, undefined, функция, класс) или null — всё простое. */
  function notJson(v: unknown, path = '$'): string | null {
    if (v === null || typeof v === 'string' || typeof v === 'boolean') return null;
    if (typeof v === 'number') return Number.isFinite(v) ? null : path;
    if (Array.isArray(v)) {
      for (let i = 0; i < v.length; i++) {
        const r = notJson(v[i], `${path}[${i}]`);
        if (r) return r;
      }
      return null;
    }
    if (typeof v === 'object' && Object.getPrototypeOf(v) === Object.prototype) {
      for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
        const r = notJson(x, `${path}.${k}`);
        if (r) return r;
      }
      return null;
    }
    return path;
  }

  it('состояние — простой JSON на каждом шаге (без NaN/Infinity/undefined); продолжение с копии — те же события', () => {
    const s = createSmile('json');
    const kinds = new Set<string>();
    for (let i = 0, n = Math.round(900 / WDT); i < n; i++) {
      for (const e of step(s, wander(s), WDT)) kinds.add(e.type);
      kinds.add(`phase:${s.phase}`);
      if (s.trap) kinds.add(`trap:${s.trap.ph}`);
      expect(notJson(s)).toBe(null);
      expect(notJson(smileView(s))).toBe(null);
      if (i % 64 === 0) expect(JSON.parse(JSON.stringify(s))).toStrictEqual(s);
    }
    for (const k of ['phase:peek', 'phase:tear', 'phase:provoke', 'trap:choke', 'trapDeath']) expect(kinds.has(k)).toBe(true);
    // продолжение с копии
    const copy = JSON.parse(JSON.stringify(s)) as SmileState;
    const a = play('json', 300, s), b = play('json', 300, copy);
    expect(JSON.stringify(a.log)).toBe(JSON.stringify(b.log));
    expect(a.s).toStrictEqual(b.s);
  }, 60000);

  it('длинный dt проходит несколько фаз: границы — те же, что при мелком шаге', () => {
    const go = (dt: number) => {
      const A = mkPlayer('A', 0, { flash: true });
      const w: World = { players: [A], dark: false };
      const s = createSmile('dt');
      return run(s, w, 300, [], dt).map((x) => x.e);
    };
    const fine = go(1 / 32), coarse = go(1 / 4);
    expect(coarse.map((e) => e.type)).toEqual(fine.map((e) => e.type));
    expect(JSON.stringify(coarse)).toBe(JSON.stringify(fine));
  }, 60000);
});
