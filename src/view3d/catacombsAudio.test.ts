import { afterEach, describe, expect, it } from 'vitest';
import { CATACOMBS, FLOOD_PHASES, type FloodPhase } from '../locations/catacombsFlood';
import {
  CATACOMBS_SOUND_KEY,
  CatacombsAudio,
  churnEvery,
  dripEvery,
  floodK,
  heartbeat,
  layerTargets,
  nextIn,
  pipeEvery,
  pipeKind,
  ratEvery,
  stepInterval,
  stepKind,
  stepLoudness,
  tunnelImpulse,
  UNDER_HZ,
  type LayerIn,
} from './catacombsAudio';

const base: LayerIn = { warn: 0, phase: 'calm', level: CATACOMBS.calmM, depth: CATACOMBS.calmM, under: false, crawling: false, dead: false };

describe('звук катакомб: чистые функции', () => {
  it('floodK: лужи — 0, пик — 1, мусор — без NaN', () => {
    expect(floodK(CATACOMBS.calmM)).toBe(0);
    expect(floodK(CATACOMBS.peakM)).toBe(1);
    expect(floodK(5)).toBe(1);
    expect(floodK(NaN)).toBe(0);
    expect(floodK(1.03)).toBeCloseTo(0.5, 2);
  });

  it('шаги: вид по глубине (лужи штиля — мокрый камень), ползком — свои', () => {
    expect(stepKind(CATACOMBS.calmM, false)).toBe('stone');
    expect(stepKind(0.2, false)).toBe('splash');
    expect(stepKind(0.6, false)).toBe('wade');
    expect(stepKind(1.1, false)).toBe('deep');
    expect(stepKind(1.8, false)).toBe('swim');
    expect(stepKind(0, true)).toBe('crawl');
    expect(stepKind(0.06, true)).toBe('crawlWet');
    expect(stepKind(NaN, false)).toBe('stone');
  });

  it('шаги: темп растёт со скоростью, глубже — реже, ползком — в своих пределах', () => {
    let prev = Infinity;
    for (const v of [0.3, 0.8, 1.5, 2.5, 4]) {
      const t = stepInterval(v, 0, false);
      expect(t).toBeGreaterThanOrEqual(0.32);
      expect(t).toBeLessThanOrEqual(0.8);
      expect(t).toBeLessThanOrEqual(prev);
      prev = t;
      expect(stepInterval(v, 0.6, false)).toBeGreaterThan(t);
      expect(stepInterval(v, 1.2, false)).toBeGreaterThan(stepInterval(v, 0.6, false));
    }
    expect(stepInterval(1.5, 1, false)).toBeCloseTo(stepInterval(1.5, 0, false) * 1.6, 6);
    for (const v of [0.05, 0.5, 1, 3]) {
      const c = stepInterval(v, 0, true);
      expect(c).toBeGreaterThanOrEqual(0.3);
      expect(c).toBeLessThanOrEqual(0.95);
    }
    expect(Number.isFinite(stepInterval(NaN, NaN, false))).toBe(true);
    expect(stepLoudness(0)).toBe(0.5);
    expect(stepLoudness(100)).toBe(1.2);
  });

  it('слои: штиль — пустота хода и капель, ни рокота, ни потока', () => {
    const k = layerTargets(base);
    expect(k.room).toBeGreaterThan(0);
    expect(k.rumble).toBe(0);
    expect(k.flow).toBe(0);
    expect(k.uw).toBe(0);
    expect(k.lap).toBe(0); // лужи по щиколотку не плещут
    expect(k.roar).toBeLessThan(0.01); // далёкая вода — еле-еле
    expect(k.muffleHz).toBeGreaterThan(10000);
  });

  it('слои: угроза растёт — рокот, рёв (ярче) и сквозняк громче; поток — только когда вода пошла', () => {
    const lo = layerTargets({ ...base, phase: 'warn', warn: 0.2 });
    const hi = layerTargets({ ...base, phase: 'warn', warn: 1 });
    expect(hi.rumble).toBeGreaterThan(lo.rumble);
    expect(hi.roar).toBeGreaterThan(lo.roar);
    expect(hi.roarHz).toBeGreaterThan(lo.roarHz);
    expect(hi.draft).toBeGreaterThan(lo.draft);
    expect(hi.flow).toBe(0);
    const rise = layerTargets({ ...base, phase: 'rise', warn: 1, level: 1, depth: 1 });
    const peak = layerTargets({ ...base, phase: 'peak', warn: 1, level: CATACOMBS.peakM, depth: 0 });
    expect(rise.flow).toBeGreaterThan(0);
    expect(peak.flow).toBeGreaterThan(rise.flow * 0.9); // пик — максимум уровня
    expect(peak.roarHz).toBeGreaterThan(hi.roarHz); // вода рядом — рёв ярче
    expect(peak.lap).toBeGreaterThan(0); // игрок на сухой площадке — вода плещет о стены внизу
    // спад: поток уходит вместе с водой, струи стекают
    const ebbEarly = layerTargets({ ...base, phase: 'ebb', warn: 0.9, level: 1.8 });
    const ebbLate = layerTargets({ ...base, phase: 'ebb', warn: 0.1, level: 0.2 });
    expect(ebbLate.flow).toBeLessThan(ebbEarly.flow);
    expect(ebbLate.rumble).toBeLessThan(ebbEarly.rumble);
    expect(ebbEarly.trickle).toBeGreaterThan(layerTargets(base).trickle);
  });

  it('слои: под водой — «мир» глухо (~400 Гц), гудение, без плеска; мёртвый — тишина', () => {
    const u = layerTargets({ ...base, phase: 'peak', warn: 1, level: 2, depth: 2, under: true });
    expect(u.muffleHz).toBe(UNDER_HZ);
    expect(u.uw).toBeGreaterThan(0);
    expect(u.lap).toBe(0);
    expect(u.wet).toBeLessThan(layerTargets(base).wet);
    const d = layerTargets({ ...base, phase: 'peak', warn: 1, level: 2, depth: 2, under: true, dead: true });
    expect(d).toMatchObject({ room: 0, rumble: 0, roar: 0, flow: 0, draft: 0, lap: 0, trickle: 0, uw: 0 });
    // по воде у ног — плеск, глубже — громче
    expect(layerTargets({ ...base, depth: 0.5 }).lap).toBeGreaterThan(0);
    expect(layerTargets({ ...base, depth: 1.2 }).lap).toBeGreaterThan(layerTargets({ ...base, depth: 0.5 }).lap);
    // мусор в кадре не даёт NaN
    const junk = layerTargets({ ...base, warn: NaN, level: NaN, depth: NaN, phase: 'oops' as FloodPhase });
    for (const v of Object.values(junk)) expect(Number.isFinite(v)).toBe(true);
  });

  it('интервалы: капель чаще с угрозой и на спаде; трубы чаще перед водой; крысы уходят от воды', () => {
    const mid = (r: readonly [number, number]) => (r[0] + r[1]) / 2;
    expect(mid(dripEvery('warn', 1))).toBeLessThan(mid(dripEvery('calm', 0)));
    expect(mid(dripEvery('ebb', 0.5))).toBeLessThan(mid(dripEvery('warn', 1)));
    expect(mid(pipeEvery('warn', 1))).toBeLessThan(mid(pipeEvery('calm', 0)));
    expect(ratEvery('rise')).toBeNull();
    expect(ratEvery('peak')).toBeNull();
    expect(mid(ratEvery('warn')!)).toBeLessThan(mid(ratEvery('calm')!));
    expect(churnEvery('calm', 0.06)).toBeNull();
    expect(churnEvery('warn', 0.06)).toBeNull();
    expect(churnEvery('ebb', 1)).not.toBeNull();
    expect(mid(churnEvery('peak', 2)!)).toBeLessThan(mid(churnEvery('rise', 0.4)!)); // выше вода — чаще бурлит
    for (const ph of FLOOD_PHASES) {
      for (const r of [dripEvery(ph, 0.5), pipeEvery(ph, 0.5)]) {
        expect(r[0]).toBeGreaterThan(0);
        expect(r[1]).toBeGreaterThanOrEqual(r[0]);
        expect(nextIn(r, 0)).toBe(r[0]);
        expect(nextIn(r, 0.999)).toBeLessThanOrEqual(r[1]);
        expect(nextIn(r, NaN)).toBe(r[0]);
      }
    }
  });

  it('трубы: в штиль — стук и скрип, без «вздохов»; перед водой — бульканье и вздохи', () => {
    const kinds = (ph: FloodPhase) => new Set(Array.from({ length: 100 }, (_, i) => pipeKind(ph, i / 100)));
    expect(kinds('calm').has('sigh')).toBe(false);
    expect(kinds('calm').has('knock')).toBe(true);
    expect(kinds('warn').has('gurgle')).toBe(true);
    expect(kinds('warn').has('sigh')).toBe(true);
  });

  it('сердце: над водой при полном воздухе не слышно; под водой — глухо; воздух < 0.3 — чаще и громче', () => {
    expect(heartbeat(false, 1, 100)).toBeNull();
    const calm = heartbeat(true, 0.8, 100)!;
    const panic = heartbeat(true, 0.1, 100)!;
    const last = heartbeat(true, 0, 100)!;
    expect(calm.every).toBeCloseTo(0.95, 6);
    expect(panic.every).toBeLessThan(calm.every);
    expect(last.every).toBeLessThan(panic.every);
    expect(last.every).toBeGreaterThanOrEqual(0.38);
    expect(panic.k).toBeGreaterThan(calm.k);
    expect(heartbeat(false, 1, 20)).not.toBeNull(); // мало здоровья — слышно и над водой
    expect(heartbeat(true, 0, 0)).toBeNull(); // мёртв
  });

  it('отклик хода: 2 канала, конечный, затухает к концу', () => {
    let seed = 1;
    const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const sr = 8000;
    const ir = tunnelImpulse(sr, 2, rand);
    expect(ir).toHaveLength(2);
    for (const ch of ir) {
      expect(ch.length).toBe(sr * 2);
      let head = 0;
      let tail = 0;
      for (let i = 0; i < ch.length; i++) {
        expect(Number.isFinite(ch[i])).toBe(true);
        if (i < ch.length * 0.1) head += ch[i] * ch[i];
        if (i > ch.length * 0.9) tail += ch[i] * ch[i];
      }
      expect(tail).toBeLessThan(head * 0.01);
    }
  });
});

describe('звук катакомб: класс без AudioContext (node)', () => {
  it('создаётся без браузера, включён по умолчанию; до start() update/cue ничего не ломают', () => {
    const a = new CatacombsAudio();
    expect(a.on).toBe(true);
    expect(CATACOMBS_SOUND_KEY).toBe('room-forge/catacombs-sound');
    const f = { dt: 0.016, inside: true, warn: 0.5, phase: 'warn' as const, level: 0.06, depth: 0.06, under: false, moving: true, speed: 1.4, crawling: false, breath: 1, hp: 100 };
    a.update(f);
    a.update({ ...f, dt: NaN, under: true, breath: 0.1, hp: 0 });
    for (const k of ['warn', 'rise', 'peak', 'ebb', 'calm', 'gasp', 'choke', 'hurt', 'dead', 'breathe', 'climb', 'clink'] as const) a.cue(k);
    expect(a.counters.cue).toBe(0); // до start() — тишина
    a.start(); // без window — тихо ничего не делает
    expect(a.running).toBe(false);
    a.setSound(false);
    expect(a.on).toBe(false);
    a.dispose();
    a.dispose();
    a.start();
    a.update(f);
  });

  describe('сохранение в localStorage', () => {
    const g = globalThis as unknown as { localStorage?: unknown };
    afterEach(() => {
      delete g.localStorage;
    });
    const stub = (init: Record<string, string>) => {
      const m = new Map(Object.entries(init));
      g.localStorage = { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
      return m;
    };

    it("'0' — выключено, всё остальное (и пусто) — включено; setSound пишет '1'/'0'", () => {
      stub({ [CATACOMBS_SOUND_KEY]: '0' });
      expect(new CatacombsAudio().on).toBe(false);
      const m = stub({});
      const b = new CatacombsAudio();
      expect(b.on).toBe(true);
      b.setSound(false);
      expect(m.get(CATACOMBS_SOUND_KEY)).toBe('0');
      expect(new CatacombsAudio().on).toBe(false);
      b.setSound(true);
      expect(m.get(CATACOMBS_SOUND_KEY)).toBe('1');
      expect(new CatacombsAudio().on).toBe(true);
    });
  });
});
