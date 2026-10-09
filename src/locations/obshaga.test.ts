import { describe, expect, it } from 'vitest';
import src from './obshaga.ts?raw';
import {
  armLength, blackoutCycle, createBlackout, createDoor, createHand, createObshagaDirector, doorCloseAfter, doorOpenness, expandRect,
  forceBlackout, forceObshagaBlackout, GRAB_R, handView, isProtected, LANTERN_LIGHT_R, LANTERN_R, lightLevel, lightsOn,
  OBSHAGA, obshagaRule, obshagaView, openDoor, openDoorById, pickSpawn, POKE_R, POKE_STAND, pokeReach, rectGap, respawnDelay, spawnDelay, stepBlackout,
  stepDirector, stepDoor, stepDoors, stepHand, withdrawHand,
  type BlackoutEvent, type BlackoutState, type DoorEvent, type HandEvent, type HandInput, type HandPlayer, type HandState,
  type ObshagaEvent, type ObshagaInput, type ObshagaState, type Pt, type Rect, type SpawnCandidate,
} from './obshaga';

/** Шаг и скорость — двоичные дроби: пути кончика точны (0.5 · 4 / 64 = 1/32 м за шаг). */
const DT = 1 / 64;
const V = 4;
/** Коридор вдоль x (y = 0), комнаты — по y < 0: точка за дверью (0, −2), проём (0, 0). */
const DOOR: Pt = { x: 0, y: -2, room: 'r1' };
const MOUTH: Pt = { x: 0, y: 0, room: 'c' };
const FAR: Pt = { x: 30, y: 0, room: 'c' };

const d2 = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);
const inp = (o: Partial<HandInput> = {}): HandInput => ({ lightsOn: false, seen: false, goal: null, players: [], lanterns: [], playerSpeed: V, ...o });
const player = (id: string, x: number, y = 0, prot = false): HandPlayer => ({ id, p: { x, y, room: 'c' }, protected: prot, sees: false });
/** Игрок под кроватью (лёг ползком под низкое укрытие). */
const under = (id: string, x: number, y = 0, room = 'c'): HandPlayer => ({ id, p: { x, y, room }, protected: false, sees: false, sheltered: true });
const HAND_TYPES = new Set(['emerged', 'retreat', 'stalk', 'withdrawn', 'grab', 'drag', 'killed', 'released', 'vanish', 'poke']);
const allHandEvents: HandEvent[] = [];

/** Шаг руки с записью событий (все — в общий журнал для проверки «ни одного звука»). */
function hstep(h: HandState, o: Partial<HandInput> = {}, dt = DT): HandEvent[] {
  const ev = stepHand(h, dt, inp(o));
  allHandEvents.push(...ev);
  return ev;
}

/** Рука, вылезшая до проёма (никто не смотрит). */
function emerged(seed = 'рука'): HandState {
  const h = createHand(seed, DOOR, MOUTH);
  for (let k = 0; k < 400 && h.phase === 'emerging'; k++) hstep(h);
  expect(h.phase).toBe('stalking');
  return h;
}

/** Минимальное расстояние от лампы до ломаной руки (по точкам — они лежат на пути кончика). */
const minPtDist = (h: HandState, l: Pt) => Math.min(...handView(h).trail.map((p) => d2(p, l)));

describe('«Общага»: модуль без движка', () => {
  it('ни Babylon, ни DOM: импорты — только модель и чистые помощники', () => {
    const imports = [...src.matchAll(/^import .* from '([^']+)';$/gm)].map((m) => m[1]);
    expect(imports.sort()).toEqual(['../model/rng', './stairLoop']);
    expect(src).not.toMatch(/@babylonjs|document\.|window\./);
  });

  it('настройки: поле меньше света, захват меньше поля, рука вдвое медленнее игрока', () => {
    expect(LANTERN_R).toBe(OBSHAGA.lanternR);
    expect(LANTERN_LIGHT_R).toBeGreaterThan(LANTERN_R);
    expect(GRAB_R).toBeLessThan(LANTERN_R);
    expect(OBSHAGA.handSpeedK).toBe(0.5);
    expect(OBSHAGA.retreatK).toBeGreaterThan(1);
    expect(obshagaRule()).toContain(`${LANTERN_R} м`);
  });

  it('под кроватью: тычок раз в 1.4 с по 6 из 100 — без передышки убивают за 20–25 с; заживает только без тычков', () => {
    const n = Math.ceil(OBSHAGA.hp / OBSHAGA.pokeDmg);
    const kill = (OBSHAGA.pokeHitU + n - 1) * OBSHAGA.pokePeriodS;
    expect(kill).toBeGreaterThanOrEqual(20);
    expect(kill).toBeLessThanOrEqual(25);
    expect(OBSHAGA.hpRegenDelayS).toBeGreaterThan(OBSHAGA.pokePeriodS);
    // палец достаёт дальше хватки, но не из-за края поля лампы
    expect(POKE_R).toBeGreaterThan(GRAB_R);
    expect(POKE_R).toBeLessThan(LANTERN_R);
    expect(obshagaRule()).toContain('кроват');
  });
});

// ───────────────────────── свет ─────────────────────────

interface Timed { at: number; e: BlackoutEvent }

/** Прогон света шагом dt: события и время начала новой фазы. */
function runLight(b: BlackoutState, T: number, dt: number): Timed[] {
  const out: Timed[] = [];
  for (let t = 0; t < T; t += dt) for (const e of stepBlackout(b, dt)) out.push({ at: b.time - b.t, e });
  return out;
}

describe('«Общага»: свет', () => {
  it('расписание по сиду: первое моргание через 25–45 с, дальше flicker → blackout → lightsBack с длительностями в рамках', () => {
    const b = createBlackout('мир/общага');
    expect(b.phase).toBe('lit');
    expect(lightLevel(b)).toBe(1);
    const log = runLight(b, 700, 1 / 60);
    expect(log.length).toBeGreaterThanOrEqual(6);
    expect(log.slice(0, 3).map((x) => x.e.type)).toEqual(['flicker', 'blackout', 'lightsBack']);
    let expectAt = 0;
    for (let i = 0; i < log.length; i++) {
      const { at, e } = log[i];
      const c = blackoutCycle('мир/общага', e.n);
      if (e.type === 'flicker') {
        expectAt += c.lit;
        expect(c.lit).toBeGreaterThanOrEqual(e.n === 0 ? 25 : 70);
        expect(c.lit).toBeLessThanOrEqual(e.n === 0 ? 45 : 150);
        expect(e.dur).toBe(c.flicker);
        expect(e.dur).toBeGreaterThanOrEqual(2.5);
        expect(e.dur).toBeLessThanOrEqual(4.5);
      } else if (e.type === 'blackout') {
        expectAt += c.flicker;
        expect(e.dur).toBe(c.dark);
        expect(e.dur).toBeGreaterThanOrEqual(45);
        expect(e.dur).toBeLessThanOrEqual(75);
      } else expectAt += c.dark;
      expect(at).toBeCloseTo(expectAt, 6);
      if (e.type === 'lightsBack') expectAt += OBSHAGA.returnS;
    }
    // тот же сид другим шагом — те же события в те же моменты; другой сид — другое расписание
    const coarse = runLight(createBlackout('мир/общага'), 700, 0.37);
    expect(coarse.map((x) => x.e)).toEqual(log.slice(0, coarse.length).map((x) => x.e));
    coarse.forEach((x, i) => expect(x.at).toBeCloseTo(log[i].at, 6));
    const firsts = new Set(['a', 'b', 'c', 'd', 'e'].map((s) => blackoutCycle(s, 0).lit.toFixed(3)));
    expect(firsts.size).toBe(5);
    // длинный dt проходит несколько фаз за шаг, по порядку
    const big = createBlackout('мир/общага');
    expect(stepBlackout(big, 400).map((e) => e.type).slice(0, 4)).toEqual(['flicker', 'blackout', 'lightsBack', 'flicker']);
    // мусорный dt — ничего
    expect(stepBlackout(createBlackout('x'), NaN)).toEqual([]);
    expect(stepBlackout(createBlackout('x'), -1)).toEqual([]);
  });

  it('forceBlackout: из lit — сразу моргание и отключение по обычным длительностям; в темноте — ничего', () => {
    const b = createBlackout('qa');
    stepBlackout(b, 5);
    const f = forceBlackout(b);
    expect(f).toEqual([{ type: 'flicker', n: 0, dur: blackoutCycle('qa', 0).flicker }]);
    expect(b.phase).toBe('flicker');
    expect(forceBlackout(b)).toEqual([]);
    const ev = stepBlackout(b, blackoutCycle('qa', 0).flicker + 0.01);
    expect(ev).toEqual([{ type: 'blackout', n: 0, dur: blackoutCycle('qa', 0).dark }]);
    expect(lightsOn(b)).toBe(false);
    expect(forceBlackout(b)).toEqual([]);
    stepBlackout(b, blackoutCycle('qa', 0).dark);
    expect(b.phase).toBe('return');
    // из возврата — следующий цикл
    expect(forceBlackout(b)).toEqual([{ type: 'flicker', n: 1, dur: blackoutCycle('qa', 1).flicker }]);
    // переопределённая пауза до первого моргания
    const q = createBlackout('qa', { firstLitS: 2 });
    expect(stepBlackout(q, 2.01).map((e) => e.type)).toEqual(['flicker']);
  });

  it('мигает, затем РЕЗКИЙ обрыв: в кадре отключения свет с > 0.5 падает в 0; возврат — вспышка и ровный свет', () => {
    for (const seed of ['s1', 's2', 's3', 's4']) {
      const b = createBlackout(seed, { firstLitS: 1 });
      const levels: number[] = [];
      let cut = false;
      let back = false;
      for (let k = 0; k < 60 * 200 && !back; k++) {
        const before = lightLevel(b);
        const ev = stepBlackout(b, 1 / 60);
        const after = lightLevel(b);
        if (b.phase === 'flicker') levels.push(after);
        if (ev.some((e) => e.type === 'blackout')) {
          expect(before).toBeGreaterThan(0.5);
          expect(after).toBe(0);
          expect(lightsOn(b)).toBe(false);
          cut = true;
        }
        if (b.phase === 'dark') expect(after).toBe(0);
        if (ev.some((e) => e.type === 'lightsBack')) {
          expect(lightsOn(b)).toBe(true);
          expect(after).toBe(1);
          back = true;
        }
      }
      expect(cut && back).toBe(true);
      // настоящее мигание: и провалы, и накал
      expect(levels.filter((l) => l < 0.1).length).toBeGreaterThan(5);
      expect(levels.filter((l) => l > 0.5).length).toBeGreaterThan(5);
      // мигание детерминировано: тот же сид и время — тот же уровень
      stepBlackout(b, OBSHAGA.returnS);
      expect(b.phase).toBe('lit');
      expect(lightLevel(b)).toBe(1);
    }
  });
});

// ───────────────────────── двери ─────────────────────────

/** Шаги двери, пока cond; события со временем. */
function runDoor(d: ReturnType<typeof createDoor>, T: number, look: (t: number) => { seen: boolean; blocked: boolean }) {
  const ev: { t: number; e: DoorEvent }[] = [];
  let t = 0;
  for (; t < T; t += DT) for (const e of stepDoor(d, DT, look(t))) ev.push({ t: t + DT, e });
  return ev;
}
const free = () => ({ seen: false, blocked: false });

describe('«Общага»: двери закрываются сами, пока на них не смотрят', () => {
  it('пауза closeAfter — по сиду, 6–10 с, на каждое открытие своя', () => {
    const all = new Set<string>();
    for (let k = 0; k < 50; k++) {
      const c = doorCloseAfter(`дверь${k}`, 0);
      expect(c).toBeGreaterThanOrEqual(6);
      expect(c).toBeLessThanOrEqual(10);
      all.add(c.toFixed(4));
    }
    expect(all.size).toBeGreaterThan(40);
    expect(createDoor('a').closeAfter).toBe(createDoor('a').closeAfter);
    expect(doorCloseAfter('a', 0)).not.toBe(doorCloseAfter('a', 1));
  });

  it('открыл — распахнулась за 0.8 с, постояла closeAfter, закрылась за 1.4 с (никто не смотрит)', () => {
    const d = createDoor('комната 214');
    expect(stepDoor(d, 1, free())).toEqual([]);
    expect(d.open).toBe(0);
    expect(openDoor(d)).toBe(true);
    expect(openDoor(d)).toBe(false); // уже распахивается
    const ca = d.closeAfter;
    const ev = runDoor(d, 20, free);
    expect(ev.map((x) => x.e)).toEqual(['closing', 'closed']);
    expect(ev[0].t).toBeCloseTo(OBSHAGA.doorOpenS + ca, 1);
    expect(ev[1].t - ev[0].t).toBeCloseTo(OBSHAGA.doorCloseS, 1);
    expect(d.phase).toBe('closed');
    expect(d.open).toBe(0);
  });

  it('под взглядом не закрывается; отвернулся — пошла сразу; посреди хода увидели — замерла и ждёт', () => {
    const d = createDoor('d');
    openDoor(d);
    expect(runDoor(d, 40, () => ({ seen: true, blocked: false }))).toEqual([]);
    expect(d.phase).toBe('open');
    expect(d.open).toBe(1);
    // отвернулся — закрывается в этом же шаге
    expect(stepDoor(d, DT, free())).toEqual(['closing']);
    runDoor(d, 0.5, free);
    const mid = d.open;
    expect(mid).toBeGreaterThan(0.3);
    expect(mid).toBeLessThan(1);
    expect(stepDoor(d, DT, { seen: true, blocked: false })).toEqual(['paused']);
    const ev = runDoor(d, 30, () => ({ seen: true, blocked: false }));
    expect(ev).toEqual([]);
    expect(d.open).toBe(mid);
    expect(d.phase).toBe('paused');
    // отвернулся — дозакрывается за остаток хода
    const rest = runDoor(d, 5, free);
    expect(rest.map((x) => x.e)).toEqual(['closing', 'closed']);
    expect(rest[1].t).toBeCloseTo(mid * OBSHAGA.doorCloseS, 1);
  });

  it('занятый проём не закрывается (и на ходу — пауза); открыть снова можно в любой момент', () => {
    const d = createDoor('d2');
    openDoor(d);
    expect(runDoor(d, 30, () => ({ seen: false, blocked: true }))).toEqual([]);
    expect(d.open).toBe(1);
    expect(stepDoor(d, DT, free())).toEqual(['closing']);
    runDoor(d, 0.3, free);
    expect(stepDoor(d, DT, { seen: false, blocked: true })).toEqual(['paused']);
    // снова открыл посреди закрывания — распахивается, новая пауза
    const opens = d.opens;
    expect(openDoor(d)).toBe(true);
    expect(d.phase).toBe('opening');
    expect(d.opens).toBe(opens + 1);
    runDoor(d, 1, free);
    expect(d.phase).toBe('open');
    expect(d.open).toBe(1);
    // распахнутую — ещё раз: ждёт заново
    runDoor(d, 3, free);
    openDoor(d);
    expect(d.held).toBe(0);
    expect(d.phase).toBe('open');
  });
});

// ───────────────────────── лампа и рука ─────────────────────────

describe('«Общага»: поле лампы', () => {
  it('защищает всех ближе LANTERN_R — и того, кто несёт, и соседа', () => {
    const lamps = [{ x: 0, y: 0 }];
    expect(isProtected({ x: 0, y: 0 }, lamps)).toBe(true);
    expect(isProtected({ x: 2.9, y: 0 }, lamps)).toBe(true);
    expect(isProtected({ x: 3.1, y: 0 }, lamps)).toBe(false);
    expect(isProtected({ x: 3.1, y: 0 }, [...lamps, { x: 5, y: 0 }])).toBe(true);
    expect(isProtected({ x: 0, y: 0 }, [])).toBe(false);
  });
});

describe('«Общага»: рука', () => {
  it('растёт из двери к проёму за emergeS, беззвучно; под взглядом не растёт', () => {
    const h = createHand('рука', DOOR, MOUTH);
    expect(h.phase).toBe('emerging');
    expect(handView(h).emerge01).toBe(0);
    let prev = 0;
    let t = 0;
    const ev: HandEvent[] = [];
    // полсекунды смотрят — ни на миллиметр
    for (let k = 0; k < 32; k++) hstep(h, { seen: true });
    expect(armLength(h)).toBe(0);
    expect(h.frozen).toBe(true);
    while (h.phase === 'emerging' && t < 5) {
      ev.push(...hstep(h));
      t += DT;
      const e = handView(h).emerge01;
      expect(e).toBeGreaterThanOrEqual(prev);
      prev = e;
    }
    expect(ev).toEqual([{ type: 'emerged' }]);
    expect(t).toBeCloseTo(OBSHAGA.emergeS, 1);
    const v = handView(h);
    expect(v.tip).toEqual(MOUTH);
    expect(v.emerge01).toBe(1);
    expect(v.trail[0]).toEqual(DOOR);
    expect(v.length).toBeCloseTo(2, 9);
    // тело — точки через ~0.25 м
    for (let i = 1; i < v.trail.length; i++) expect(d2(v.trail[i - 1], v.trail[i])).toBeLessThanOrEqual(OBSHAGA.trailStepM + 1e-9);
    expect(v.heading).toBeCloseTo(Math.PI / 2, 9);
  });

  it('ползёт ровно 0.5 × скорости игрока, пока не видят; под взглядом — 0', () => {
    const h = emerged();
    const x0 = h.tip.x, L0 = armLength(h);
    for (let k = 0; k < 64; k++) hstep(h, { goal: FAR });
    expect(h.tip.x - x0).toBeCloseTo(0.5 * V * 1, 9);
    expect(armLength(h) - L0).toBeCloseTo(0.5 * V * 1, 9);
    expect(h.tip.room).toBe('c');
    const x1 = h.tip.x, L1 = armLength(h);
    for (let k = 0; k < 128; k++) hstep(h, { goal: FAR, seen: true });
    expect(h.tip.x).toBe(x1);
    expect(armLength(h)).toBe(L1);
    expect(h.frozen).toBe(true);
    expect(handView(h).frozen).toBe(true);
    // другая скорость игрока — другая скорость руки
    for (let k = 0; k < 64; k++) hstep(h, { goal: FAR, playerSpeed: 6 });
    expect(h.tip.x - x1).toBeCloseTo(3, 9);
    expect(h.frozen).toBe(false);
    expect(handView(h).heading).toBeCloseTo(0, 9);
  });

  it('не длиннее armMaxM', () => {
    const h = emerged();
    for (let k = 0; k < 64 * 60; k++) hstep(h, { goal: { x: 100, y: 0 } });
    expect(armLength(h)).toBeLessThanOrEqual(OBSHAGA.armMaxM + 1e-9);
    expect(armLength(h)).toBeGreaterThan(OBSHAGA.armMaxM - 0.01);
  });

  it('в поле лампы не заходит: упирается в границу (и наискось)', () => {
    for (const lamp of [{ x: 10, y: 0 }, { x: 8, y: 2 }, { x: 6, y: -1.5 }]) {
      const h = emerged();
      let blocked = false;
      for (let k = 0; k < 64 * 20; k++) {
        const ev = hstep(h, { goal: FAR, lanterns: [lamp] });
        expect(ev).toEqual([]);
        expect(minPtDist(h, lamp)).toBeGreaterThanOrEqual(LANTERN_R - 1e-9);
        blocked ||= h.blocked;
      }
      expect(blocked).toBe(true);
      expect(h.phase).toBe('stalking');
      expect(d2(h.tip, lamp)).toBeCloseTo(LANTERN_R, 4);
      expect(handView(h).blocked).toBe(true);
    }
  });

  it('идёшь на неё с лампой — втягивается быстрее, чем идёшь; дошёл до двери — уползла целиком', () => {
    const h = emerged();
    const lamp = { x: 14, y: 0 };
    for (let k = 0; k < 64 * 8; k++) hstep(h, { goal: FAR, lanterns: [lamp] });
    expect(h.tip.x).toBeCloseTo(11, 4);
    const ev: HandEvent[] = [];
    let minGap = Infinity;
    // держатель лампы идёт к проёму со скоростью V, потом стоит в проёме
    for (let k = 0; k < 64 * 10 && h.phase !== 'withdrawn'; k++) {
      lamp.x = Math.max(0, lamp.x - V * DT);
      ev.push(...hstep(h, { goal: FAR, lanterns: [lamp] }));
      // пока держатель не дошёл до корня руки (там поле накрывает её по определению)
      if (lamp.x > LANTERN_R + 0.1) minGap = Math.min(minGap, d2(h.tip, lamp));
    }
    expect(ev[0]).toEqual({ type: 'retreat' });
    expect(ev.at(-1)).toEqual({ type: 'withdrawn' });
    // поле ни разу не «проглотило» кисть глубже шага держателя
    expect(minGap).toBeGreaterThan(LANTERN_R - V * DT - 1e-6);
    expect(h.phase).toBe('withdrawn');
    expect(h.trail).toHaveLength(1);
    expect(h.tip).toEqual(DOOR);
    expect(armLength(h)).toBe(0);
    expect(handView(h).visible).toBe(false);
    expect(hstep(h, { goal: FAR })).toEqual([]);
  });

  it('держатель остановился — рука отступила за поле и снова упирается в границу, не уходя', () => {
    const h = emerged();
    const lamp = { x: 14, y: 0 };
    for (let k = 0; k < 64 * 8; k++) hstep(h, { goal: FAR, lanterns: [lamp] });
    const ev: HandEvent[] = [];
    for (let k = 0; k < 64 * 10; k++) {
      lamp.x = Math.max(7, lamp.x - V * DT);
      ev.push(...hstep(h, { goal: FAR, lanterns: [lamp] }));
    }
    expect(ev.some((e) => e.type === 'retreat')).toBe(true);
    expect(ev.some((e) => e.type === 'withdrawn')).toBe(false);
    expect(h.phase).toBe('stalking');
    expect(h.tip.x).toBeCloseTo(4, 4);
    // поле, накрывшее корень руки (лампа в проёме), — уползает целиком
    const h2 = emerged('h2');
    for (let k = 0; k < 64; k++) hstep(h2, { goal: FAR });
    const ev2: HandEvent[] = [];
    for (let k = 0; k < 64 * 5 && h2.phase !== 'withdrawn'; k++) ev2.push(...hstep(h2, { goal: FAR, lanterns: [{ x: 0, y: 0.5 }], seen: true }));
    expect(ev2.map((e) => e.type)).toEqual(['retreat', 'withdrawn']);
  });

  it('лампа у проёма, пока рука вылезала, — втянулась до границы; лампу унесли — дорастает до проёма', () => {
    const h = createHand('e', DOOR, MOUTH);
    for (let k = 0; k < 48; k++) hstep(h);
    expect(h.emerge).toBeCloseTo(0.5, 6);
    const lamp = { x: 0, y: 1.8 };
    const ev: HandEvent[] = [];
    for (let k = 0; k < 64; k++) ev.push(...hstep(h, { lanterns: [lamp] }));
    expect(ev).toEqual([{ type: 'retreat' }, { type: 'stalk' }]);
    expect(h.phase).toBe('emerging');
    expect(h.blocked).toBe(true);
    expect(d2(h.tip, lamp)).toBeCloseTo(LANTERN_R, 4);
    const ev2: HandEvent[] = [];
    for (let k = 0; k < 128 && h.phase === 'emerging'; k++) ev2.push(...hstep(h));
    expect(ev2).toEqual([{ type: 'emerged' }]);
    expect(h.tip).toEqual(MOUTH);
  });

  it('защищённых не хватает: несущий лампу и стоящий в чужом поле', () => {
    // сам защищён (несёт лампу, механике её не передали)
    const h = emerged();
    for (let k = 0; k < 64 * 10; k++) expect(hstep(h, { goal: { x: 6, y: 0 }, players: [player('p1', 6, 0, true)] })).toEqual([]);
    expect(d2(h.tip, { x: 6, y: 0 })).toBeLessThan(1e-9);
    // в поле лампы напарника: кисть упирается в поле в 0.5 м от игрока — и не хватает
    const h2 = emerged('h2');
    const lamp = { x: 11, y: 0 };
    for (let k = 0; k < 64 * 10; k++) expect(hstep(h2, { goal: { x: 8.5, y: 0 }, players: [player('p1', 8.5)], lanterns: [lamp] })).toEqual([]);
    expect(h2.tip.x).toBeCloseTo(8, 4);
    expect(d2(h2.tip, { x: 8.5, y: 0 })).toBeLessThan(GRAB_R);
    expect(h2.phase).toBe('stalking');
  });

  it('невидимая и близко — хватает незащищённого, тащит по следу за дверь (5 м/с) → killed', () => {
    const h = emerged();
    const ev: HandEvent[] = [];
    let t = 0;
    const players = [player('p1', 8), player('p2', 20)];
    for (; t < 30 && h.phase !== 'gone'; t += DT) ev.push(...hstep(h, { goal: { x: 8, y: 0 }, players }));
    const types = ev.map((e) => e.type);
    expect(types[0]).toBe('grab');
    expect(ev[0]).toEqual({ type: 'grab', victim: 'p1' });
    expect(types.at(-1)).toBe('killed');
    expect(ev.at(-1)).toEqual({ type: 'killed', victim: 'p1' });
    const drags = ev.filter((e): e is Extract<HandEvent, { type: 'drag' }> => e.type === 'drag');
    expect(drags.length).toBeGreaterThanOrEqual(8);
    for (let i = 1; i < drags.length; i++) expect(drags[i].progress).toBeGreaterThan(drags[i - 1].progress);
    expect(drags.every((e) => e.victim === 'p1')).toBe(true);
    // схватила, как только кисть подошла на GRAB_R; волокла всю руку со скоростью dragSpeed
    const grabX = 8 - GRAB_R;
    const tGrab = (grabX - 0) / (0.5 * V);
    expect(t).toBeCloseTo(tGrab + (2 + grabX) / OBSHAGA.dragSpeed, 1);
    expect(h.phase).toBe('gone');
    expect(h.victim).toBeNull();
    expect(h.tip).toEqual(DOOR);
    expect(handView(h).dragProgress).toBe(1);
    expect(handView(h).visible).toBe(false);
  });

  it('волочение: кисть с жертвой едет к двери, прогресс растёт, вид — с жертвой', () => {
    const h = emerged();
    for (let k = 0; k < 64 * 10 && h.phase === 'stalking'; k++) hstep(h, { goal: { x: 3, y: 0 }, players: [player('p1', 3)] });
    expect(h.phase).toBe('grabbing');
    const v0 = handView(h);
    expect(v0.victim).toBe('p1');
    expect(v0.dragProgress).toBe(0);
    hstep(h, { players: [player('p1', 3)] }, 0.25);
    const v1 = handView(h);
    expect(v1.length).toBeCloseTo(v0.length - 0.25 * OBSHAGA.dragSpeed, 9);
    expect(v1.dragProgress).toBeCloseTo(0.25 * OBSHAGA.dragSpeed / v0.length, 9);
    // под взглядом всё равно тащит (уже схватила)
    hstep(h, { seen: true }, 0.1);
    expect(handView(h).dragProgress).toBeGreaterThan(v1.dragProgress);
  });

  it('видимая рука не хватает никогда; отвернулись — хватает сразу', () => {
    const h = emerged();
    const players = [player('p1', 0.6)];
    for (let k = 0; k < 64 * 20; k++) expect(hstep(h, { goal: { x: 0.6, y: 0 }, players, seen: true })).toEqual([]);
    expect(h.tip).toEqual(MOUTH);
    expect(hstep(h, { goal: { x: 0.6, y: 0 }, players })).toEqual([{ type: 'grab', victim: 'p1' }]);
  });

  it('из двух рядом — ближайшего; незащищённый за защищённым — только его', () => {
    const h = emerged();
    const ev = hstep(h, { players: [player('far', 1.1), player('near', 0.5), player('safe', 0.1, 0, true)] });
    expect(ev).toEqual([{ type: 'grab', victim: 'near' }]);
  });

  it('свет вернулся — исчезает; схваченного отпускает', () => {
    const h = emerged();
    for (let k = 0; k < 64 * 10 && h.phase === 'stalking'; k++) hstep(h, { goal: { x: 4, y: 0 }, players: [player('p1', 4)] });
    hstep(h, {}, 0.2);
    expect(h.phase).toBe('grabbing');
    expect(hstep(h, { lightsOn: true })).toEqual([{ type: 'released', victim: 'p1' }, { type: 'vanish' }]);
    expect(h.phase).toBe('gone');
    expect(h.victim).toBeNull();
    expect(hstep(h, { lightsOn: true })).toEqual([]);
    const h2 = emerged('h2');
    expect(hstep(h2, { lightsOn: true })).toEqual([{ type: 'vanish' }]);
    const h3 = createHand('h3', DOOR, MOUTH);
    expect(hstep(h3, { lightsOn: true })).toEqual([{ type: 'vanish' }]);
  });

  it('напарник с лампой накрыл руку на волоке — отпускает и уползает', () => {
    const h = emerged();
    for (let k = 0; k < 64 * 10 && h.phase === 'stalking'; k++) hstep(h, { goal: { x: 8, y: 0 }, players: [player('p1', 8)] });
    expect(h.phase).toBe('grabbing');
    const ev = hstep(h, { lanterns: [{ x: 4, y: 1 }] });
    expect(ev).toEqual([{ type: 'released', victim: 'p1' }, { type: 'retreat' }]);
    expect(h.victim).toBeNull();
    expect(h.phase).toBe('retreating');
  });

  /** Шаги руки T секунд с записью событий и их времени. */
  const runFor = (h: HandState, T: number, o: Partial<HandInput> | ((t: number) => Partial<HandInput>)) => {
    const out: { t: number; e: HandEvent }[] = [];
    for (let k = 0, t = 0; t < T - 1e-9; k++, t = k * DT) for (const e of hstep(h, typeof o === 'function' ? o(t) : o)) out.push({ t: t + DT, e });
    return out;
  };
  const pokesOf = <T extends { e: HandEvent }>(ev: T[]) => ev.filter((x) => x.e.type === 'poke');

  it('под кроватью не хватает: подползает на POKE_R и тычет пальцем раз в pokePeriodS (удар — pokeHitU цикла)', () => {
    const h = emerged();
    const players = [under('p1', 6)];
    const ev = runFor(h, 10, { goal: { x: 6, y: 0, room: 'c' }, players });
    expect(ev.some((x) => x.e.type === 'grab')).toBe(false);
    expect(ev.every((x) => x.e.type === 'poke')).toBe(true);
    // дальше POKE_R не ползёт (останов — в пределах шага кисти)
    const d = d2(h.tip, players[0].p);
    expect(d).toBeLessThanOrEqual(POKE_R);
    expect(d).toBeGreaterThan(POKE_R - 0.5 * V * DT - 1e-9);
    expect(h.phase).toBe('stalking');
    // дошла за (6 − 1.8) / 2 м/с = 2.1 с; первый удар — через pokeHitU цикла, дальше — ровно раз в период
    const pk = pokesOf(ev);
    expect(pk.length).toBe(6);
    expect(pk.every((x) => x.e.type === 'poke' && x.e.victim === 'p1')).toBe(true);
    expect(pk[0].t).toBeCloseTo((6 - POKE_R) / (0.5 * V) + OBSHAGA.pokeHitU * OBSHAGA.pokePeriodS, 1);
    for (let i = 1; i < pk.length; i++) expect(pk[i].t - pk[i - 1].t).toBeCloseTo(OBSHAGA.pokePeriodS, 1);
    // вид: кого, куда, фаза
    const v = handView(h);
    expect(v.poke).toBe('p1');
    expect(v.pokeAt).toEqual(players[0].p);
    expect(v.poke01).toBeGreaterThanOrEqual(0);
    expect(v.poke01).toBeLessThan(1);
    // большой шаг — несколько тычков за раз, столько же, сколько мелкими шагами
    const copy = JSON.parse(JSON.stringify(h)) as HandState;
    const big = stepHand(h, 5, inp({ goal: { x: 6, y: 0, room: 'c' }, players }));
    const fine = runFor(copy, 5, { goal: { x: 6, y: 0, room: 'c' }, players });
    expect(big.length).toBeGreaterThanOrEqual(3);
    expect(big.length).toBe(pokesOf(fine).length);
    expect(h.pokeT).toBeCloseTo(copy.pokeT, 6);
  });

  it('палец, что уже достаёт, бьёт и под взглядом; ползти под взглядом — нет; замершую вне досягаемости — не бьёт', () => {
    const h = emerged();
    const players = [under('p1', 6)];
    runFor(h, 3, { goal: { x: 6, y: 0, room: 'c' }, players });
    expect(h.poke).toBe('p1');
    const tip = { ...h.tip };
    const seen = runFor(h, 5, { goal: { x: 6, y: 0, room: 'c' }, players, seen: true });
    expect(pokesOf(seen).length).toBeGreaterThanOrEqual(3);
    expect(seen.every((x) => x.e.type === 'poke')).toBe(true);
    expect(h.tip).toEqual(tip);
    expect(h.frozen).toBe(true);
    expect(handView(h).frozen).toBe(true);
    expect(handView(h).poke).toBe('p1');
    // замерла в 4 м — под кроватью в 4 м не достаёт; залез под кровать в 1.5 м от неё — достаёт и под взглядом
    const h2 = emerged('h2');
    const far = runFor(h2, 4, { goal: { x: 4, y: 0, room: 'c' }, players: [under('p2', 4)], seen: true });
    expect(far).toEqual([]);
    expect(handView(h2).poke).toBeNull();
    const near = runFor(h2, 2, { goal: { x: 1.5, y: 0, room: 'c' }, players: [under('p2', 1.5)], seen: true });
    expect(pokesOf(near).length).toBe(1);
    expect(h2.tip).toEqual(MOUTH);
  });

  it('вылез из-под кровати: в GRAB_R и невидимая — хватает сразу; дальше — подползает и хватает; под взглядом — нет', () => {
    // залез под кровать вплотную к кисти — тычет, не хватает; вылез — хватка в том же шаге
    const h = emerged();
    for (const x of runFor(h, 3, { goal: { x: 0.8, y: 0, room: 'c' }, players: [under('p1', 0.8)] })) expect(x.e.type).toBe('poke');
    expect(h.phase).toBe('stalking');
    expect(hstep(h, { goal: { x: 0.8, y: 0, room: 'c' }, players: [player('p1', 0.8)] })).toEqual([{ type: 'grab', victim: 'p1' }]);
    expect(h.phase).toBe('grabbing');
    expect(handView(h).poke).toBeNull();
    // вылез в 1.8 м: под взглядом — ни тычка, ни хватки; отвернулся — подползла до GRAB_R и схватила
    const h2 = emerged('h2');
    runFor(h2, 3, { goal: { x: 6, y: 0, room: 'c' }, players: [under('p1', 6)] });
    expect(h2.poke).toBe('p1');
    const out = [player('p1', 6)];
    expect(runFor(h2, 2, { goal: { x: 6, y: 0, room: 'c' }, players: out, seen: true })).toEqual([]);
    expect(h2.poke).toBeNull();
    let g: HandEvent[] = [];
    let tg = 0;
    for (let k = 0; k < 64 && !g.length; k++) {
      g = hstep(h2, { goal: { x: 6, y: 0, room: 'c' }, players: out });
      tg = (k + 1) * DT;
    }
    expect(g).toEqual([{ type: 'grab', victim: 'p1' }]);
    expect(tg).toBeCloseTo((POKE_R - GRAB_R) / (0.5 * V), 1);
    // под кроватью — хватает открытого напарника рядом, а не тычет
    const h3 = emerged('h3');
    runFor(h3, 3, { goal: { x: 6, y: 0, room: 'c' }, players: [under('p1', 6)] });
    const mate = hstep(h3, { goal: { x: 6, y: 0, room: 'c' }, players: [under('p1', 6), player('p2', h3.tip.x + 1, 0.3)] });
    expect(mate).toEqual([{ type: 'grab', victim: 'p2' }]);
  });

  it('поле лампы и под кроватью защищает: не тычет; сквозь стену (другая комната) — не тычет, ползёт дальше по пути', () => {
    // лампа рядом с кроватью: рука упёрлась в поле в 1.5 м от игрока — и не бьёт
    const h = emerged();
    const lamp = { x: 7.5, y: 0 };
    expect(runFor(h, 10, { goal: { x: 6, y: 0, room: 'c' }, players: [under('p1', 6)], lanterns: [lamp] })).toEqual([]);
    expect(h.tip.x).toBeCloseTo(4.5, 4);
    expect(h.blocked).toBe(true);
    expect(handView(h).poke).toBeNull();
    // сам с лампой (механике её не передали) и под кроватью — тоже нет
    const h2 = emerged('h2');
    const lampMan = { ...under('p1', 3), protected: true };
    expect(runFor(h2, 5, { goal: { x: 3, y: 0, room: 'c' }, players: [lampMan] })).toEqual([]);
    // под кроватью за стеной (комната r9): рука ползёт до цели в коридоре, не тыча; вползла в комнату — тычет
    const h3 = emerged('h3');
    const behind = [under('p1', 6, 0.9, 'r9')];
    expect(runFor(h3, 4, { goal: { x: 6, y: 0, room: 'c' }, players: behind })).toEqual([]);
    expect(h3.tip).toMatchObject({ x: 6, y: 0, room: 'c' });
    const inRoom = runFor(h3, 2, { goal: { x: 6, y: 0.3, room: 'r9' }, players: behind });
    expect(h3.tip.room).toBe('r9');
    expect(pokesOf(inRoom).length).toBeGreaterThanOrEqual(1);
  });

  it('рамка кровати: зазор по худшей оси, «ближе m» — внутри расширенной на m', () => {
    const r: Rect = { x0: 0, y0: 0, x1: 2, y1: 1 };
    expect(rectGap({ x: 1, y: 0.5 }, r)).toBe(0);
    expect(rectGap({ x: -0.5, y: 0.5 }, r)).toBeCloseTo(0.5, 9);
    expect(rectGap({ x: 3, y: 2.5 }, r)).toBeCloseTo(1.5, 9);
    expect(expandRect(r, 0.3)).toEqual({ x0: -0.3, y0: -0.3, x1: 2.3, y1: 1.3 });
    expect(POKE_STAND).toBe(OBSHAGA.pokeStandM);
    // досягаемость под кровать от её края — на ширину кровати (0.8 м)
    expect(POKE_R - POKE_STAND).toBeGreaterThanOrEqual(0.8);
  });

  it('кровать известна: кончик не заходит ближе pokeStandM к рамке (упор на границе); игрок глубже досягаемости — не тычет', () => {
    // кровать вдоль коридора торцом к руке (x 6…7.9), игрок под ней в 1.2 м от торца
    const bed: Rect = { x0: 6, y0: -0.4, x1: 7.9, y1: 0.4 };
    const deep = { ...under('p1', 7.2), cover: bed };
    const h = emerged();
    expect(runFor(h, 10, { goal: deep.p, players: [deep] })).toEqual([]);
    expect(h.tip.x).toBeCloseTo(6 - POKE_STAND, 5);
    expect(h.tip.x).toBeLessThanOrEqual(6 - POKE_STAND);
    expect(h.blocked).toBe(false);
    expect(handView(h).bed).toEqual(bed);
    expect(handView(h).poke).toBeNull();
    // кровать неизвестна — как раньше: подползла на POKE_R и тычет (кисть легла бы на кровать)
    const h2 = emerged('h2');
    expect(pokesOf(runFor(h2, 10, { goal: deep.p, players: [under('p1', 7.2)] })).length).toBeGreaterThan(3);
    expect(h2.tip.x).toBeGreaterThan(6 - POKE_STAND + 0.2);
    expect(handView(h2).bed).toBeNull();
    // у края кровати (0.3 м вглубь) — тычет, дойдя до POKE_R, снаружи зоны
    const h3 = emerged('h3');
    const edge = { ...under('p1', 6.3), cover: bed };
    expect(pokesOf(runFor(h3, 10, { goal: edge.p, players: [edge] })).length).toBeGreaterThan(3);
    expect(rectGap(h3.tip, bed)).toBeGreaterThanOrEqual(POKE_STAND);
    expect(d2(h3.tip, edge.p)).toBeLessThanOrEqual(POKE_R);
    // далеко от кровати — «рядом» нет
    const h4 = emerged('h4');
    hstep(h4, { goal: null, players: [{ ...under('p1', 20.2), cover: { x0: 20, y0: -0.4, x1: 21.9, y1: 0.4 } }] });
    expect(handView(h4).bed).toBeNull();
  });

  it('залез под кровать рядом с кистью (кончик в зоне): не тычет, глубже не ползёт, наружу — да; вышла — тычет', () => {
    const h = emerged();
    const bed: Rect = { x0: 0.5, y0: -0.4, x1: 2.4, y1: 0.4 };
    const pl = { ...under('p1', 1.0), cover: bed };
    // к игроку — ни шагу (глубже в зону), ни тычка
    expect(runFor(h, 2, { goal: pl.p, players: [pl] })).toEqual([]);
    expect(h.tip).toEqual(MOUTH);
    // наружу (навигация ведёт прочь от кровати) — ползёт; вышла из зоны — тычет, а к цели доползает, только пока палец
    // достаёт (не дальше POKE_R от игрока)
    const ev = runFor(h, 6, { goal: { x: -4, y: 0, room: 'c' }, players: [pl] });
    expect(pokesOf(ev).length).toBeGreaterThanOrEqual(2);
    expect(pokesOf(ev)[0].t).toBeLessThan((POKE_STAND - 0.5 + 0.1) / (0.5 * V) + OBSHAGA.pokeHitU * OBSHAGA.pokePeriodS);
    expect(rectGap(h.tip, bed)).toBeGreaterThanOrEqual(POKE_STAND - 1e-9);
    expect(h.tip.x).toBeCloseTo(1.0 - POKE_R, 1);
    expect(d2(h.tip, pl.p)).toBeLessThanOrEqual(POKE_R);
  });

  it('кровать известна: тыча, доползает до цели навигации (бок кровати), пока палец достаёт; под взглядом — стоит', () => {
    // кровать поперёк хода (x 6…6.8), игрок 0.3 вглубь; цель навигации — в pokeStandM + 0.08 от бока
    const bed: Rect = { x0: 6, y0: -1, x1: 6.8, y1: 0.9 };
    const pl = { ...under('p1', 6.3), cover: bed };
    const goal = { x: 6 - POKE_STAND - 0.08, y: 0, room: 'c' };
    const h = emerged();
    // доползла до POKE_R — тычет; видят — стоит, тычет
    runFor(h, 2.15, { goal, players: [pl] });
    expect(h.poke).toBe('p1');
    const tip = { ...h.tip };
    expect(tip.x).toBeLessThan(goal.x - 0.2);
    expect(pokesOf(runFor(h, 1.5, { goal, players: [pl], seen: true })).length).toBe(1);
    expect(h.tip).toEqual(tip);
    // не видят — тыча, доползает до цели и стоит там
    const ev = runFor(h, 3, { goal, players: [pl] });
    expect(pokesOf(ev).length).toBeGreaterThanOrEqual(2);
    expect(ev.every((x) => x.e.type === 'poke')).toBe(true);
    expect(h.tip.x).toBeCloseTo(goal.x, 6);
    expect(h.poke).toBe('p1');
  });

  it('выпад пальца: 0 у края кровати, замах назад, удар (1) — в pokeHitU, потом медленно отходит; непрерывно по кругу', () => {
    expect(pokeReach(0)).toBeCloseTo(0, 9);
    expect(pokeReach(OBSHAGA.pokeHitU)).toBe(1);
    expect(pokeReach(OBSHAGA.pokeHitU - 0.2)).toBeLessThan(0);
    expect(pokeReach(0.9999)).toBeCloseTo(0, 3);
    expect(pokeReach(NaN)).toBe(0);
    let prev = pokeReach(0);
    for (let u = 0.001; u < 2; u += 0.001) {
      const r = pokeReach(u);
      expect(Math.abs(r - prev)).toBeLessThan(0.05);
      expect(r).toBeGreaterThanOrEqual(-0.2 - 1e-9);
      expect(r).toBeLessThanOrEqual(1);
      prev = r;
    }
  });

  it('рука беззвучна: ни одного звукового события за все прогоны', () => {
    expect(allHandEvents.length).toBeGreaterThan(20);
    for (const e of allHandEvents) expect(HAND_TYPES.has(e.type), e.type).toBe(true);
  });
});

// ───────────────────────── режиссёр ─────────────────────────

/** Двери коридора: d0…d6 по x, точка за дверью — y = −2, проём — y = 0. */
const XS = [-20, -12, -6, 6, 12, 20, 30];
function cands(px: number, o: { seen?: string[]; inField?: string[] } = {}): SpawnCandidate[] {
  return XS.map((x, i) => ({
    id: `d${i}`, door: { x, y: -2, room: `r${i}` }, mouth: { x, y: 0, room: 'c' }, dist: Math.abs(x - px),
    seen: !!o.seen?.includes(`d${i}`), inField: !!o.inField?.includes(`d${i}`),
  }));
}

/** Мир для режиссёра: игроки, лампы, кандидаты; цель руки — ближайший незащищённый игрок. */
interface World { players: HandPlayer[]; lanterns: Pt[]; seen?: boolean; cands?: SpawnCandidate[] }
const dinput = (w: World): ObshagaInput => ({
  players: w.players,
  lanterns: w.lanterns,
  playerSpeed: V,
  spawnCandidates: w.cands ?? cands(w.players[0]?.p.x ?? 0),
  goal: (hv) => {
    const open = w.players.filter((p) => !p.protected && !isProtected(p.p, w.lanterns));
    if (!open.length) return null;
    return open.reduce((a, b) => (d2(a.p, hv.tip) <= d2(b.p, hv.tip) ? a : b)).p;
  },
  seen: w.seen,
});

/** Шаги режиссёра до события type (или T секунд). */
function until(dir: ObshagaState, w: World, type: ObshagaEvent['type'], T = 300): { t: number; ev: ObshagaEvent[] } {
  const ev: ObshagaEvent[] = [];
  let t = 0;
  for (; t < T; t += DT) {
    const e = stepDirector(dir, DT, dinput(w));
    ev.push(...e);
    if (e.some((x) => x.type === type)) return { t: t + DT, ev };
  }
  return { t, ev };
}

describe('«Общага»: режиссёр', () => {
  it('pickSpawn: невидимая, не в поле, путь 4–9 м — сначала сзади и сбоку; иначе ближайшая не ближе 3 м; лампа — не ближе 4.5 м', () => {
    const c = cands(0, { seen: ['d3'], inField: ['d5'] });
    // годны в диапазоне: d2 (6 м); d3 видна; d1, d4 — 12 м, дальше диапазона
    for (let k = 0; k < 20; k++) {
      expect(pickSpawn('s', k, c, [])!.id).toBe('d2');
      expect(pickSpawn('s', k, [...c].reverse(), [])!.id).toBe('d2');
    }
    // две в диапазоне — по сиду обе, порядок кандидатов не важен
    const two = cands(0);
    for (let k = 0; k < 30; k++) expect(pickSpawn('s', k, [...two].reverse(), [])!.id).toBe(pickSpawn('s', k, two, [])!.id);
    expect(new Set(Array.from({ length: 30 }, (_, k) => pickSpawn('s', k, two, [])!.id))).toEqual(new Set(['d2', 'd3']));
    // сзади и сбоку — раньше, чем перед глазами
    const facing = two.map((x) => ({ ...x, facing: x.id === 'd2' ? 0.9 : x.id === 'd3' ? -0.8 : 0 }));
    for (let k = 0; k < 20; k++) expect(pickSpawn('s', k, facing, [])!.id).toBe('d3');
    // перед глазами, но невидима (дальше обзора, за углом) — годится, если другой нет
    expect(pickSpawn('s', 0, facing.map((x) => (x.id === 'd3' ? { ...x, seen: true } : x)), [])!.id).toBe('d2');
    // лампа ближе 4.5 м к двери — не годна (поле 3 м + 1.5); exclude — тоже
    expect(OBSHAGA.spawnLanternM).toBeCloseTo(LANTERN_R + 1.5);
    expect(pickSpawn('s', 0, two, [{ x: 6, y: 4 }])!.id).toBe('d2');
    expect(pickSpawn('s', 0, two, [{ x: 6, y: 5 }])).not.toBeNull();
    expect(pickSpawn('s', 0, two, [], 'd2')!.id).toBe('d3');
    // в диапазоне никого — ближайшая годная, но не ближе 3 м
    const near = cands(0).map((x) => ({ ...x, dist: x.id === 'd2' ? 40 : x.id === 'd3' ? 15 : x.id === 'd4' ? 2 : 22 }));
    expect(pickSpawn('s', 0, near, [])!.id).toBe('d3');
    expect(pickSpawn('s', 0, near.map((x) => (x.id === 'd3' ? { ...x, seen: true } : x)), [])!.dist).toBe(22);
    // все видны — никого
    expect(pickSpawn('s', 0, cands(0, { seen: XS.map((_, i) => `d${i}`) }), [])).toBeNull();
    expect(pickSpawn('s', 0, [], [])).toBeNull();
  });

  it('задержки — по сиду, в рамках: рука через 1–3 с после отключения, следующая — через 2–4 с', () => {
    for (let k = 0; k < 40; k++) {
      expect(spawnDelay('x', k)).toBeGreaterThanOrEqual(1);
      expect(spawnDelay('x', k)).toBeLessThanOrEqual(3);
      expect(respawnDelay('x', k)).toBeGreaterThanOrEqual(2);
      expect(respawnDelay('x', k)).toBeLessThanOrEqual(4);
    }
    expect(spawnDelay('x', 0)).toBe(spawnDelay('x', 0));
    expect(OBSHAGA.firstLitS).toEqual([25, 45]);
  });

  it('withdrawHand: потеряла игроков — уходит сразу (тащила — отпускает), следующая — через 2–4 с из другой двери', () => {
    const dir = createObshagaDirector('ушла', { firstLitS: 0.5 });
    const w: World = { players: [player('p1', 0)], lanterns: [] };
    expect(withdrawHand(dir)).toEqual([]);
    const s1 = until(dir, w, 'spawn', 30).ev.find((x) => x.type === 'spawn') as Extract<ObshagaEvent, { type: 'spawn' }>;
    expect(withdrawHand(dir)).toEqual([{ type: 'withdrawn' }]);
    expect(dir.hand).toBeNull();
    expect(dir.lastDoor).toBe(s1.door);
    expect(dir.spawnIn).toBeCloseTo(respawnDelay(dir.seed, 1), 9);
    const next = until(dir, w, 'spawn', 30);
    expect(next.t).toBeGreaterThanOrEqual(2 - DT);
    expect(next.t).toBeLessThanOrEqual(4 + DT);
    expect((next.ev.find((x) => x.type === 'spawn') as Extract<ObshagaEvent, { type: 'spawn' }>).door).not.toBe(s1.door);
    // тащит — отпускает
    const g = until(dir, w, 'grab', 60);
    expect(g.ev.at(-1)).toEqual({ type: 'grab', victim: 'p1' });
    expect(withdrawHand(dir)).toEqual([{ type: 'released', victim: 'p1' }, { type: 'withdrawn' }]);
  });

  it('отключение → через 1–3 с рука из годной двери; дверь распахивается и не закрывается, пока рука в ней', () => {
    const dir = createObshagaDirector('общага-1');
    const w: World = { players: [player('p1', 0, 0, true)], lanterns: [], cands: cands(0, { seen: ['d4'], inField: ['d5'] }) };
    // при свете рук нет
    const lit = until(dir, w, 'spawn', 20);
    expect(lit.ev).toEqual([]);
    expect(forceObshagaBlackout(dir)).toMatchObject([{ type: 'flicker', n: 0 }]);
    const off = until(dir, w, 'blackout', 10);
    expect(off.ev.map((e) => e.type)).toEqual(['blackout']);
    expect(obshagaView(dir).light).toBe(0);
    const sp = until(dir, w, 'spawn', 20);
    expect(sp.t).toBeGreaterThanOrEqual(1 - DT);
    expect(sp.t).toBeLessThanOrEqual(3 + DT);
    expect(sp.t).toBeCloseTo(spawnDelay(dir.seed, 0), 1);
    const e = sp.ev.find((x) => x.type === 'spawn') as Extract<ObshagaEvent, { type: 'spawn' }>;
    expect(['d2', 'd3']).toContain(e.door);
    expect(dir.handDoor).toBe(e.door);
    expect(dir.hand!.phase).toBe('emerging');
    expect(dir.doors[e.door].phase).toBe('opening');
    // одна рука за раз: дальше спавнов нет
    const more: ObshagaEvent[] = [];
    for (let k = 0; k < 64 * 10; k++) {
      more.push(...stepDirector(dir, DT, dinput(w)));
      stepDoors(dir, DT, new Set(), new Set());
    }
    expect(more.filter((x) => x.type === 'spawn')).toEqual([]);
    expect(doorOpenness(dir, e.door)).toBe(1);
    expect(dir.doors[e.door].phase).toBe('open');
    expect(obshagaView(dir).hand!.visible).toBe(true);
  });

  it('лампа загнала руку — следующая через 2–4 с из ДРУГОЙ двери; свет вернулся — рука исчезла, до следующего отключения рук нет', () => {
    const dir = createObshagaDirector('общага-2', { firstLitS: 0.5 });
    // годны только d0 и d1 (d2, d3 близко; d4… видны) — после ухода руки из одной следующая обязана выйти из другой
    const w: World = { players: [player('p1', 0, 0, true)], lanterns: [], cands: cands(0, { seen: ['d4', 'd5', 'd6'] }).map((c) => (c.id === 'd2' || c.id === 'd3' ? { ...c, seen: true } : c)) };
    const first = until(dir, w, 'spawn', 30);
    const s1 = first.ev.find((x) => x.type === 'spawn') as Extract<ObshagaEvent, { type: 'spawn' }>;
    const c1 = w.cands!.find((c) => c.id === s1.door)!;
    // держатель лампы встал в проём этой двери
    w.lanterns = [{ ...c1.mouth }];
    const wd = until(dir, w, 'withdrawn', 10);
    expect(wd.ev.map((x) => x.type)).toContain('retreat');
    expect(dir.hand).toBeNull();
    expect(dir.lastDoor).toBe(s1.door);
    w.lanterns = [];
    const second = until(dir, w, 'spawn', 30);
    expect(second.t).toBeGreaterThanOrEqual(2 - DT);
    expect(second.t).toBeLessThanOrEqual(4 + DT);
    const s2 = second.ev.find((x) => x.type === 'spawn') as Extract<ObshagaEvent, { type: 'spawn' }>;
    expect(s2.door).not.toBe(s1.door);
    expect(s2.n).toBe(1);
    // свет вернулся — рука исчезла
    const back = until(dir, w, 'lightsBack', 120);
    const types = back.ev.map((x) => x.type);
    expect(types.slice(-2)).toEqual(['lightsBack', 'vanish']);
    expect(dir.hand).toBeNull();
    expect(dir.spawnIn).toBeNull();
    // до следующего отключения — ни одной руки
    const calm = until(dir, w, 'blackout', 200);
    expect(calm.ev.filter((x) => x.type === 'spawn')).toEqual([]);
    expect(calm.ev.at(-1)!.type).toBe('blackout');
    expect(until(dir, w, 'spawn', 20).ev.some((x) => x.type === 'spawn')).toBe(true);
  });

  it('утащила игрока — следующая рука после паузы из другой двери; тащимого свет отпускает', () => {
    const dir = createObshagaDirector('общага-3', { firstLitS: 0.5 });
    const w: World = { players: [player('p1', 0)], lanterns: [] };
    const k = until(dir, w, 'killed', 120);
    const types = k.ev.map((x) => x.type);
    expect(types).toContain('grab');
    expect(types.at(-1)).toBe('killed');
    const s1 = k.ev.find((x) => x.type === 'spawn') as Extract<ObshagaEvent, { type: 'spawn' }>;
    // мёртвого интеграция убирает; новый игрок с лампой
    w.players = [player('p2', 0, 0, true)];
    expect(dir.hand).toBeNull();
    expect(dir.spawnIn).toBeCloseTo(respawnDelay(dir.seed, 1), 9);
    const next = until(dir, w, 'spawn', 30);
    expect(dir.blackout.phase).toBe('dark');
    const s2 = next.ev.find((x) => x.type === 'spawn') as Extract<ObshagaEvent, { type: 'spawn' }>;
    expect(s2.door).not.toBe(s1.door);
    expect(next.t).toBeGreaterThanOrEqual(2 - DT);
    expect(next.t).toBeLessThanOrEqual(4 + DT);
    // тащимого возвращённый свет отпускает
    w.players = [player('p3', 0)];
    const g = until(dir, w, 'grab', 60);
    expect(g.ev.at(-1)).toEqual({ type: 'grab', victim: 'p3' });
    stepBlackout(dir.blackout, dir.blackout.dur - dir.blackout.t - DT / 2);
    expect(stepDirector(dir, DT, dinput(w)).map((e) => e.type)).toEqual(['lightsBack', 'released', 'vanish']);
    expect(dir.hand).toBeNull();
  });

  it('двери режиссёра: открытие по id, закрытые записи удаляются, дверь руки занята', () => {
    const dir = createObshagaDirector('двери');
    expect(doorOpenness(dir, 'a')).toBe(0);
    expect(openDoorById(dir, 'a')).toBe(true);
    expect(openDoorById(dir, 'a')).toBe(false);
    const ev: { id: string; type: DoorEvent }[] = [];
    for (let t = 0; t < 15; t += DT) ev.push(...stepDoors(dir, DT, new Set(), new Set()));
    expect(ev).toEqual([{ id: 'a', type: 'closing' }, { id: 'a', type: 'closed' }]);
    expect(dir.doors).toEqual({});
    // смотрят — стоит; занят — стоит
    openDoorById(dir, 'b');
    for (let t = 0; t < 15; t += DT) expect(stepDoors(dir, DT, new Set(['b']), new Set())).toEqual([]);
    for (let t = 0; t < 2; t += DT) expect(stepDoors(dir, DT, new Set(), new Set(['b']))).toEqual([]);
    dir.handDoor = 'b';
    for (let t = 0; t < 2; t += DT) expect(stepDoors(dir, DT, new Set(), new Set())).toEqual([]);
    dir.handDoor = null;
    expect(stepDoors(dir, DT, new Set(), new Set())).toEqual([{ id: 'b', type: 'closing' }]);
  });

  it('состояние — чистый JSON: снимок → восстановление ведут себя одинаково (рассылка хоста коопа)', () => {
    const dir = createObshagaDirector('кооп', { firstLitS: 0.5 });
    const mk = (): World => ({ players: [player('p1', -3), player('p2', 2, 0, false)], lanterns: [{ x: 9, y: 0 }] });
    const w = mk();
    openDoorById(dir, 'd3');
    // до руки, ползущей в темноте
    until(dir, w, 'spawn', 30);
    for (let k = 0; k < 64 * 2; k++) {
      stepDirector(dir, DT, dinput(w));
      stepDoors(dir, DT, new Set(), new Set());
    }
    expect(dir.hand).not.toBeNull();
    const snap = JSON.stringify(dir);
    const copy = JSON.parse(snap) as ObshagaState;
    expect(JSON.parse(JSON.stringify(copy))).toEqual(JSON.parse(snap));
    // одинаковый сценарий: игроки ходят, второй — с лампой, смотрят по таймеру
    const run = (d: ObshagaState) => {
      const ww = mk();
      const ev: unknown[] = [];
      for (let k = 0; k < 64 * 40; k++) {
        const t = k * DT;
        ww.players[0].p.x = -3 + Math.sin(t * 0.7) * 4;
        ww.lanterns[0].x = 9 - t * 0.3;
        ww.seen = Math.floor(t * 2) % 3 === 0;
        if (k === 300) openDoorById(d, 'd5');
        ev.push(...stepDirector(d, DT, dinput(ww)));
        ev.push(...stepDoors(d, DT, new Set(k % 128 < 30 ? ['d3'] : []), new Set()));
        ev.push(obshagaView(d).light, d.hand ? handView(d.hand).tip : null);
      }
      return ev;
    };
    const a = run(dir), b = run(copy);
    expect(b).toEqual(a);
    expect(JSON.parse(JSON.stringify(copy))).toEqual(JSON.parse(JSON.stringify(dir)));
    // в состоянии нет того, что JSON теряет (Infinity/NaN → null, undefined, функции)
    const walk = (v: unknown): void => {
      if (typeof v === 'number') expect(Number.isFinite(v)).toBe(true);
      else if (v && typeof v === 'object') Object.values(v).forEach(walk);
      else expect(['string', 'boolean', 'object']).toContain(typeof v);
    };
    walk(dir);
  });
});
