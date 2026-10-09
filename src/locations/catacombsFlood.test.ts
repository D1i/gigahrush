import { describe, expect, it } from 'vitest';
import {
  advanceRemote, CATACOMBS, createFlood, createLungs, floodCycle, floodLevel, floodOrd, floodWarn, FLOOD_PHASES, forceFlood, fromWire,
  phasesSince, reviveLungs, stepFlood, stepLungs, toWire, untilRise, wadeMul, WADE,
  type FloodPhase, type FloodState, type Lungs, type LungsEvent,
} from './catacombsFlood';

const C = CATACOMBS;
/** Шаг — двоичная дробь: время в фазе копится без ошибок округления. */
const DT = 1 / 64;
const total = (c: Record<FloodPhase, number>) => c.calm + c.warn + c.rise + c.peak + c.ebb;
const clone = (s: FloodState): FloodState => ({ ...s });

/** Часы в начале фазы ph цикла n (через forceFlood — как QA). */
function at(seed: string, n: number, ph: FloodPhase): FloodState {
  const s = createFlood(seed);
  s.n = n;
  s.phase = ph;
  s.t = 0;
  s.dur = floodCycle(seed, n)[ph];
  return s;
}

/** Прогон дыхания шагами dt: события с моментами. */
function breathe(l: Lungs, T: number, under: boolean, dt = 0.1, t0 = 0): { at: number; e: LungsEvent }[] {
  const out: { at: number; e: LungsEvent }[] = [];
  const steps = Math.round(T / dt);
  for (let k = 0; k < steps; k++) for (const e of stepLungs(l, dt, under)) out.push({ at: t0 + (k + 1) * dt, e });
  return out;
}

describe('часы наводнения', () => {
  it('длительности — по сиду, в диапазонах; первый штиль короче', () => {
    expect(floodCycle('мир', 3)).toEqual(floodCycle('мир', 3));
    const firsts = new Set(['a', 'b', 'c', 'd', 'e', 'f'].map((s) => floodCycle(s, 0).calm.toFixed(3)));
    expect(firsts.size).toBeGreaterThan(4);
    expect(floodCycle('мир', 1).calm).not.toBe(floodCycle('мир', 2).calm);
    for (const seed of ['мир', 'x', 'катакомбы/7']) {
      for (let n = 0; n < 60; n++) {
        const c = floodCycle(seed, n);
        const r = n === 0 ? C.firstCalmS : C.calmS;
        expect(c.calm).toBeGreaterThanOrEqual(r[0]);
        expect(c.calm).toBeLessThanOrEqual(r[1]);
        expect([c.warn, c.rise, c.peak, c.ebb]).toEqual([20, 32, 25, 40]);
      }
    }
    expect(C.firstCalmS).toEqual([70, 110]);
    expect(C.calmS).toEqual([110, 200]);
    const s = createFlood('мир');
    expect(s).toEqual({ seed: 'мир', n: 0, phase: 'calm', t: 0, dur: floodCycle('мир', 0).calm });
    // простой JSON
    expect(JSON.parse(JSON.stringify(s))).toEqual(s);
  });

  it('один большой шаг проходит все фазы по порядку; итог не зависит от дробления dt', () => {
    const c0 = floodCycle('x', 0);
    const big = createFlood('x');
    expect(stepFlood(big, total(c0) + 1)).toEqual(['warn', 'rise', 'peak', 'ebb', 'calm']);
    expect(big).toMatchObject({ n: 1, phase: 'calm', dur: floodCycle('x', 1).calm });
    expect(big.t).toBeCloseTo(1, 9);
    // два цикла и кусок третьего одним шагом
    const c1 = floodCycle('x', 1);
    const two = createFlood('x');
    expect(stepFlood(two, total(c0) + total(c1) + c0.warn)).toEqual(['warn', 'rise', 'peak', 'ebb', 'calm', 'warn', 'rise', 'peak', 'ebb', 'calm']);
    expect(two.n).toBe(2);
    // мелкими шагами — те же события и то же место
    const fine = createFlood('x');
    const ev: FloodPhase[] = [];
    const T = total(c0) + 1;
    for (let t = 0; t < T - 1e-9; t += DT) ev.push(...stepFlood(fine, Math.min(DT, T - t)));
    expect(ev).toEqual(['warn', 'rise', 'peak', 'ebb', 'calm']);
    expect(fine.n).toBe(1);
    expect(fine.phase).toBe('calm');
    expect(fine.t).toBeCloseTo(1, 6);
    // мусор — ничего
    const s = createFlood('x');
    expect(stepFlood(s, NaN)).toEqual([]);
    expect(stepFlood(s, -5)).toEqual([]);
    expect(stepFlood(s, Infinity)).toEqual([]);
    expect(s).toEqual(createFlood('x'));
  });

  it('уровень: штиль 0.06, пик 2.0 (±2 см, ниже убежища), подъём/спад монотонны, непрерывен на стыках', () => {
    for (const ph of ['calm', 'warn'] as FloodPhase[]) {
      const s = at('мир', 2, ph);
      for (let t = 0; t <= s.dur; t += 1) expect(floodLevel({ ...s, t })).toBe(0.06);
    }
    const peak = at('мир', 2, 'peak');
    expect(floodLevel(peak)).toBeCloseTo(2.0, 12);
    expect(floodLevel({ ...peak, t: peak.dur })).toBeCloseTo(2.0, 12);
    let lo = Infinity, hi = -Infinity;
    for (let t = 0; t <= peak.dur; t += DT) {
      const v = floodLevel({ ...peak, t });
      lo = Math.min(lo, v);
      hi = Math.max(hi, v);
    }
    expect(hi).toBeLessThanOrEqual(C.peakM + C.peakWobbleM + 1e-12);
    expect(lo).toBeGreaterThanOrEqual(C.peakM - C.peakWobbleM - 1e-12);
    expect(hi - lo).toBeGreaterThan(0.01); // дышит
    expect(hi).toBeLessThan(C.refugeM);
    // подъём не убывает, спад не растёт
    const rise = at('мир', 2, 'rise'), ebb = at('мир', 2, 'ebb');
    for (let t = DT; t <= rise.dur; t += DT) expect(floodLevel({ ...rise, t })).toBeGreaterThanOrEqual(floodLevel({ ...rise, t: t - DT }));
    for (let t = DT; t <= ebb.dur; t += DT) expect(floodLevel({ ...ebb, t })).toBeLessThanOrEqual(floodLevel({ ...ebb, t: t - DT }));
    expect(floodLevel(rise)).toBeCloseTo(0.06, 12);
    expect(floodLevel({ ...rise, t: rise.dur })).toBeCloseTo(2.0, 12);
    expect(floodLevel({ ...ebb, t: ebb.dur })).toBeCloseTo(0.06, 12);
    // на стыках: конец фазы = начало следующей
    for (let i = 0; i < FLOOD_PHASES.length; i++) {
      const a = at('мир', 4, FLOOD_PHASES[i]);
      const end = floodLevel({ ...a, t: a.dur });
      const b = clone(a);
      b.t = a.dur;
      expect(stepFlood(b, 1e-12)).toEqual([FLOOD_PHASES[(i + 1) % 5]]);
      expect(b.phase).toBe(FLOOD_PHASES[(i + 1) % 5]);
      expect(floodLevel(b)).toBeCloseTo(end, 9);
    }
    // прогон трёх циклов мелким шагом: ни одного скачка
    const s = createFlood('прогон');
    let prev = floodLevel(s), maxJump = 0;
    const T = total(floodCycle('прогон', 0)) + total(floodCycle('прогон', 1)) + total(floodCycle('прогон', 2));
    for (let t = 0; t < T; t += DT) {
      stepFlood(s, DT);
      const v = floodLevel(s);
      maxJump = Math.max(maxJump, Math.abs(v - prev));
      prev = v;
    }
    expect(s.n).toBe(3);
    // подъём: наибольшая скорость 1.5 · 1.94 / 32 ≈ 0.09 м/с → ≈ 0.0014 м за шаг
    expect(maxJump).toBeLessThan(0.002);
  });

  it('floodWarn: 0 в штиль, слабый предвестник в конце штиля, к 1 за предупреждение, 1 в подъём/пик, спадает с водой', () => {
    const calm = at('w', 1, 'calm');
    expect(floodWarn(calm)).toBe(0);
    expect(floodWarn({ ...calm, t: calm.dur - C.foreS - 0.5 })).toBe(0);
    expect(floodWarn({ ...calm, t: calm.dur - C.foreS / 2 })).toBeGreaterThan(0);
    expect(floodWarn({ ...calm, t: calm.dur })).toBeCloseTo(C.foreWarn, 12);
    const warn = at('w', 1, 'warn');
    expect(floodWarn(warn)).toBeCloseTo(C.foreWarn, 12);
    for (let t = DT; t <= warn.dur; t += DT) expect(floodWarn({ ...warn, t })).toBeGreaterThan(floodWarn({ ...warn, t: t - DT }));
    expect(floodWarn({ ...warn, t: warn.dur })).toBeCloseTo(1, 12);
    for (const ph of ['rise', 'peak'] as FloodPhase[]) {
      const s = at('w', 1, ph);
      for (let t = 0; t <= s.dur; t += 1) expect(floodWarn({ ...s, t })).toBe(1);
    }
    const ebb = at('w', 1, 'ebb');
    expect(floodWarn(ebb)).toBeCloseTo(1, 12);
    expect(floodWarn({ ...ebb, t: ebb.dur / 2 })).toBeCloseTo(0.5, 9);
    expect(floodWarn({ ...ebb, t: ebb.dur })).toBeCloseTo(0, 12);
    // прогон: в пределах 0…1 и без скачков
    const s = createFlood('w');
    let prev = floodWarn(s);
    for (let t = 0; t < total(floodCycle('w', 0)) + 30; t += DT) {
      stepFlood(s, DT);
      const v = floodWarn(s);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
      expect(Math.abs(v - prev)).toBeLessThan(0.01);
      prev = v;
    }
  });

  it('untilRise: обратный отсчёт до подъёма; 0, пока вода идёт и стоит; со спада — до подъёма следующего цикла', () => {
    const c0 = floodCycle('u', 0), c1 = floodCycle('u', 1);
    const s = createFlood('u');
    expect(untilRise(s)).toBeCloseTo(c0.calm + c0.warn, 9);
    // отсчёт идёт ровно со временем через штиль и предупреждение
    const T0 = untilRise(s);
    let el = 0;
    while (s.phase !== 'rise') {
      stepFlood(s, Math.min(1, untilRise(s)));
      el += 1;
      if ((s.phase as FloodPhase) !== 'rise') expect(untilRise(s) + Math.min(el, T0)).toBeCloseTo(T0, 6);
    }
    expect(s.t).toBeCloseTo(0, 9); // подъём начался ровно тогда, когда отсчёт дошёл до 0
    expect(untilRise(s)).toBe(0);
    stepFlood(s, c0.rise + 1);
    expect(s.phase).toBe('peak');
    expect(untilRise(s)).toBe(0);
    stepFlood(s, c0.peak + 10 - 1);
    expect(s.phase).toBe('ebb');
    expect(s.t).toBeCloseTo(10, 9);
    expect(untilRise(s)).toBeCloseTo(c0.ebb - 10 + c1.calm + c1.warn, 9);
    // столько (+ допуск плавающей точки) — и начинается подъём цикла 1
    const ev = stepFlood(s, untilRise(s) + 1e-9);
    expect(ev).toEqual(['calm', 'warn', 'rise']);
    expect(s.n).toBe(1);
  });

  it('forceFlood (QA): сразу предупреждение; со спада — предупреждение следующего цикла', () => {
    const s = createFlood('qa');
    stepFlood(s, 5);
    expect(forceFlood(s)).toEqual(['warn']);
    expect(s).toMatchObject({ n: 0, phase: 'warn', t: 0, dur: C.warnS });
    expect(untilRise(s)).toBe(C.warnS);
    forceFlood(s, 'ebb');
    expect(s).toMatchObject({ n: 0, phase: 'ebb', dur: C.ebbS });
    expect(forceFlood(s, 'warn')).toEqual(['warn']);
    expect(s.n).toBe(1);
  });
});

describe('вброд', () => {
  it('wadeMul: 1 мельче 0.25, ~0.75 до 0.7, ~0.55 до 1.2, 0.4 глубже; монотонно и без скачков', () => {
    for (const d of [0, 0.06, 0.2, 0.25]) expect(wadeMul(d)).toBe(1);
    for (const d of [0.4, 0.5, 0.7]) expect(wadeMul(d)).toBeCloseTo(0.75, 9);
    for (const d of [0.85, 1.0, 1.2]) expect(wadeMul(d)).toBeCloseTo(0.55, 9);
    for (const d of [1.3, 1.6, 2.0, 50]) expect(wadeMul(d)).toBeCloseTo(0.4, 9);
    expect(wadeMul(NaN)).toBe(1);
    expect(wadeMul(-1)).toBe(1);
    let prev = wadeMul(0);
    for (let d = 0.001; d < 3; d += 0.001) {
      const v = wadeMul(d);
      expect(v).toBeLessThanOrEqual(prev + 1e-12);
      expect(prev - v).toBeLessThan(0.01);
      prev = v;
    }
    // узлы упорядочены
    for (let i = 1; i < WADE.length; i++) expect(WADE[i][0]).toBeGreaterThan(WADE[i - 1][0]);
  });
});

describe('дыхание под водой', () => {
  it('12 с под водой — choke, ещё 10 с — утонул; hurt раз в секунду', () => {
    const l = createLungs();
    expect(l).toMatchObject({ breath: 1, hp: 100, dead: false, cause: null });
    expect(JSON.parse(JSON.stringify(l))).toEqual(l);
    const ev = breathe(l, 30, true);
    expect(ev[0]).toEqual({ at: 0.1, e: 'gasp' });
    const choke = ev.find((e) => e.e === 'choke')!;
    expect(choke.at).toBeGreaterThan(11.95);
    expect(choke.at).toBeLessThan(12.15);
    const dead = ev.find((e) => e.e === 'dead')!;
    expect(dead.at).toBeGreaterThan(21.95);
    expect(dead.at).toBeLessThan(22.15);
    const hurts = ev.filter((e) => e.e === 'hurt');
    expect(hurts.length).toBe(10);
    expect(hurts[0].at).toBeCloseTo(choke.at + 0.1, 6);
    for (let i = 1; i < hurts.length; i++) expect(hurts[i].at - hurts[i - 1].at).toBeCloseTo(1, 6);
    expect(l).toMatchObject({ dead: true, cause: 'drown', hp: 0, breath: 0 });
    // мёртвый — шаги пустые
    expect(stepLungs(l, 1, false)).toEqual([]);
    expect(stepLungs(l, 1, true)).toEqual([]);
  });

  it('один большой шаг — все события по порядку, как мелкими шагами', () => {
    const l = createLungs();
    expect(stepLungs(l, 30, true)).toEqual(['gasp', 'choke', ...Array(10).fill('hurt'), 'dead']);
    // половина утопления одним шагом — 5 тактов hurt, hp 50
    const m = createLungs();
    expect(stepLungs(m, C.breathS + 4.5, true)).toEqual(['gasp', 'choke', 'hurt', 'hurt', 'hurt', 'hurt', 'hurt']);
    expect(m.hp).toBeCloseTo(55, 9);
    // мелкими шагами — то же
    const f = createLungs();
    breathe(f, C.breathS + 4.5, true, DT);
    expect(f.hp).toBeCloseTo(55, 6);
    expect(f.breath).toBe(0);
  });

  it('всплытие: громкий вдох после ≥ 3 с под водой, воздух возвращается за ~3 с', () => {
    const l = createLungs();
    breathe(l, 5, true);
    expect(l.breath).toBeCloseTo(1 - 5 / 12, 6);
    const up = breathe(l, 2, false);
    expect(up[0]).toEqual({ at: 0.1, e: 'breathe' });
    expect(up.length).toBe(1);
    expect(l.breath).toBe(1);
    // нырок на 2 с — без громкого вдоха
    breathe(l, 2, true);
    expect(stepLungs(l, 0.1, false)).toEqual([]);
    // от нуля до полного — за refillS
    const z = createLungs();
    breathe(z, C.breathS + 0.5, true);
    expect(z.breath).toBe(0);
    breathe(z, 1.5, false, DT);
    expect(z.breath).toBeCloseTo(0.5, 6);
    breathe(z, 1.5, false, DT);
    expect(z.breath).toBeCloseTo(1, 6);
    // снова под воду без воздуха — сразу хрип
    const w = createLungs();
    breathe(w, C.breathS + 1, true);
    stepLungs(w, 0, false);
    expect(stepLungs(w, 0.1, true)).toEqual(['gasp', 'choke', 'hurt']);
  });

  it('заживление: через 4 с без урона, +3 HP/с, не выше 100', () => {
    const l = createLungs();
    breathe(l, C.breathS + 2, true, DT); // 2 с утопления
    expect(l.hp).toBeCloseTo(80, 6);
    breathe(l, 4, false, DT);
    expect(l.hp).toBeCloseTo(80, 6); // ещё рано
    breathe(l, 1, false, DT);
    expect(l.hp).toBeCloseTo(83, 6);
    // заживление точно по времени: одним шагом — то же
    const b = createLungs();
    breathe(b, C.breathS + 2, true, DT);
    stepLungs(b, 5, false);
    expect(b.hp).toBeCloseTo(83, 6);
    breathe(l, 60, false);
    expect(l.hp).toBe(100);
  });

  it('«Ещё раз»: hp 100, полный воздух, 6 с неуязвимости', () => {
    const l = createLungs();
    stepLungs(l, 30, true);
    expect(l.dead).toBe(true);
    reviveLungs(l);
    expect(l).toMatchObject({ hp: 100, breath: 1, dead: false, cause: null, grace: C.graceS });
    // под водой сразу: 6 с воздух не убывает
    const ev = breathe(l, C.graceS, true, DT);
    expect(ev.map((e) => e.e)).toEqual(['gasp']);
    expect(l.breath).toBe(1);
    expect(l.hp).toBe(100);
    expect(l.grace).toBe(0);
    // дальше — как обычно: 12 с до хрипа
    const more = breathe(l, C.breathS + 0.5, true, 0.1, C.graceS);
    const choke = more.find((e) => e.e === 'choke')!;
    expect(choke.at).toBeGreaterThan(C.graceS + C.breathS - 0.05);
    expect(choke.at).toBeLessThan(C.graceS + C.breathS + 0.15);
    // неуязвимость, кончившаяся посреди шага, — остаток шага уже по правилам
    const g = createLungs();
    reviveLungs(g);
    stepLungs(g, C.graceS + 6, true);
    expect(g.breath).toBeCloseTo(0.5, 9);
  });
});

describe('кооп: срез часов', () => {
  it('toWire / fromWire — туда-обратно; мусор — штиль цикла 0', () => {
    const s = createFlood('сеть');
    for (const dt of [0, 33.3, 61.7, 40, 17.25, 80, 222.2]) {
      stepFlood(s, dt);
      const w = toWire(s);
      expect(w.length).toBe(3);
      const r = fromWire('сеть', JSON.parse(JSON.stringify(w)));
      expect(r.phase).toBe(s.phase);
      expect(r.n).toBe(s.n);
      expect(r.dur).toBe(s.dur);
      expect(Math.abs(r.t - s.t)).toBeLessThanOrEqual(0.005 + 1e-9);
      expect(Math.abs(floodLevel(r) - floodLevel(s))).toBeLessThan(0.002);
    }
    expect(fromWire('сеть', null as unknown as [number, number, number])).toEqual(createFlood('сеть'));
    expect(fromWire('сеть', ['x', NaN, 'y'] as unknown as [number, number, number])).toEqual(createFlood('сеть'));
    const r = fromWire('сеть', [99, 2, 1e9]);
    expect(r).toMatchObject({ phase: 'ebb', n: 2, t: C.ebbS, dur: C.ebbS });
  });

  it('advanceRemote: клиент сам проходит стыки фаз и совпадает с хостом; события — по floodOrd без повторов', () => {
    const host = createFlood('кооп');
    stepFlood(host, floodCycle('кооп', 0).calm - 3);
    const cli = fromWire('кооп', toWire(host));
    let seen = floodOrd(cli);
    const heard: FloodPhase[] = [];
    // хост рассылает раз в 0.1 с, но срез доходит с опозданием на 0.25 с — клиент между срезами бежит вперёд
    const lag: FloodState[] = [];
    for (let k = 0; k < 64 * 60; k++) {
      stepFlood(host, DT);
      if (k % 6 === 0) lag.push(clone(host));
      advanceRemote(cli, DT);
      if (lag.length > 3) Object.assign(cli, fromWire('кооп', toWire(lag.shift()!)));
      heard.push(...phasesSince(seen, cli));
      seen = Math.max(seen, floodOrd(cli));
    }
    expect(heard).toEqual(['warn', 'rise', 'peak']);
    expect(cli.phase).toBe(host.phase);
    expect(Math.abs(floodLevel(cli) - floodLevel(host))).toBeLessThan(0.05);
    // без срезов клиент ведёт те же часы, что хост
    const a = fromWire('кооп', toWire(host)), b = fromWire('кооп', toWire(host));
    advanceRemote(a, 500);
    stepFlood(b, 500);
    expect(a).toEqual(b);
    expect(advanceRemote(a, 1)).toBeUndefined();
    // phasesSince: не больше цикла, мусор — пусто
    expect(phasesSince(floodOrd(b) - 1, b)).toEqual([b.phase]);
    expect(phasesSince(-1e9, b).length).toBe(5);
    expect(phasesSince(NaN, b)).toEqual([]);
    expect(phasesSince(floodOrd(b), b)).toEqual([]);
  });
});
