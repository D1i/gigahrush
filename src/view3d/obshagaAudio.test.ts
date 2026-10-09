import { afterEach, describe, expect, it } from 'vitest';
import { ambientTargets, breathPeriod, OBSHAGA_SOUND_KEY, ObshagaAudio, panOf, smoothLevel, stepInterval, stepLoudness } from './obshagaAudio';

describe('звук общаги: чистые функции', () => {
  it('шаги: темп растёт со скоростью, в воде реже, всегда в разумных пределах', () => {
    let prev = Infinity;
    for (const v of [0.3, 0.8, 1.5, 2.5, 4, 12]) {
      const t = stepInterval(v, false);
      expect(t).toBeGreaterThanOrEqual(0.32);
      expect(t).toBeLessThanOrEqual(0.8);
      expect(t).toBeLessThanOrEqual(prev);
      prev = t;
      expect(stepInterval(v, true)).toBeCloseTo(t * 1.4, 6);
    }
    expect(stepInterval(NaN, false)).toBeLessThanOrEqual(0.8); // мусор из кадра не ломает
    expect(stepLoudness(0)).toBe(0.5);
    expect(stepLoudness(100)).toBe(1.2);
  });

  it('дыхание: в темноте и на ходу чаще, в пределах 2.4…5 с', () => {
    expect(breathPeriod(1, 0)).toBeLessThan(breathPeriod(0, 0));
    expect(breathPeriod(0.5, 2)).toBeLessThan(breathPeriod(0.5, 0));
    for (const d of [-1, 0, 1, 5]) for (const v of [0, 3]) expect(breathPeriod(d, v)).toBeGreaterThanOrEqual(2.4);
    expect(breathPeriod(0, 0)).toBeLessThanOrEqual(5);
  });

  it('smoothLevel: вверх и вниз с разной постоянной, tau ≤ 0 — мгновенно, цель не перелетается', () => {
    expect(smoothLevel(1, 0, 0.016, 1, 0)).toBe(0);
    const up = smoothLevel(0, 1, 0.1, 0.5, 0.01);
    const down = smoothLevel(1, 0, 0.1, 0.5, 0.01);
    expect(up).toBeGreaterThan(0);
    expect(up).toBeLessThan(0.3); // вверх медленно
    expect(down).toBeLessThan(0.001); // вниз почти мгновенно
    expect(smoothLevel(0.4, 0.4, 1, 1, 1)).toBeCloseTo(0.4, 9);
  });

  it('panOf: справа от взгляда +, слева −, спереди 0 (yaw Babylon: вперёд = (sin yaw, cos yaw))', () => {
    const l = { x: 0, z: 0, yaw: 0 };
    expect(panOf(l, { x: 5, z: 0 })).toBeCloseTo(1, 6);
    expect(panOf(l, { x: -5, z: 0 })).toBeCloseTo(-1, 6);
    expect(panOf(l, { x: 0, z: 5 })).toBeCloseTo(0, 6);
    // повернулись на +90° (смотрим в +x): источник в +x — впереди, в −z — справа
    const r = { x: 0, z: 0, yaw: Math.PI / 2 };
    expect(panOf(r, { x: 5, z: 0 })).toBeCloseTo(0, 6);
    expect(panOf(r, { x: 0, z: -5 })).toBeCloseTo(1, 6);
    expect(panOf(l, { x: 0, z: 0 })).toBe(0);
  });

  it('фон: свет есть — гул, трубки, жизнь за стенами; блэкаут — тишина кроме дыхания и тона', () => {
    const base = { tubes: 1, dead: false, inWater: false, lantern: false };
    const lit = ambientTargets({ ...base, humK: 1 });
    const dark = ambientTargets({ ...base, humK: 0 });
    expect(lit.mains).toBeGreaterThan(0);
    expect(lit.tube).toBeGreaterThan(0);
    expect(lit.dorm).toBe(true);
    expect(dark.mains).toBe(0);
    expect(dark.tube).toBe(0);
    expect(dark.hiss).toBe(0);
    expect(dark.dorm).toBe(false);
    expect(dark.breath).toBeGreaterThan(lit.breath); // в темноте своё дыхание слышнее
    expect(dark.tone).toBeGreaterThan(0);
    expect(dark.creakEvery[1]).toBeLessThan(lit.creakEvery[0] + 1); // в темноте скрипы чаще
    // трубки только там, где есть трубки
    expect(ambientTargets({ ...base, tubes: 0, humK: 1 }).tube).toBe(0);
  });

  it('фон: лампа шипит только в руках, вода плещет только в воде, мёртвый — полная тишина', () => {
    const base = { humK: 0, tubes: 0, dead: false, inWater: false, lantern: false };
    expect(ambientTargets(base).lantern).toBe(0);
    expect(ambientTargets({ ...base, lantern: true }).lantern).toBeGreaterThan(0);
    expect(ambientTargets(base).lap).toBe(0);
    expect(ambientTargets({ ...base, inWater: true }).lap).toBeGreaterThan(0);
    const dead = ambientTargets({ ...base, humK: 1, tubes: 1, inWater: true, lantern: true, dead: true });
    expect(dead).toMatchObject({ mains: 0, tube: 0, hiss: 0, tone: 0, breath: 0, lantern: 0, lap: 0, dorm: false });
  });
});

describe('звук общаги: класс без AudioContext (node)', () => {
  it('создаётся без браузера, включён по умолчанию, методы до start() ничего не ломают', () => {
    const a = new ObshagaAudio();
    expect(a.enabled).toBe(true);
    expect(OBSHAGA_SOUND_KEY).toBe('room-forge/obshaga-sound');
    a.setEnabled(false);
    expect(a.enabled).toBe(false);
    const L = { x: 0, y: 1.6, z: 0, yaw: 0 };
    a.update(0.016, { inBiome: true, light: 1, tubes: 0.5, moving: true, speed: 1.5, inWater: false, lantern: false, listener: L, dead: false });
    a.flickerTick(0.5);
    a.blackout();
    a.lightsBack();
    a.doorOpen(L);
    a.doorClose(L);
    a.doorBlocked(L);
    a.pickupLantern();
    a.grab();
    a.drag(0.5);
    a.death();
    a.start(); // без window — тихо ничего не делает
    expect(a.running).toBe(false);
    a.dispose();
    a.dispose();
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

    it("'0' — выключено, всё остальное (и пусто) — включено; setEnabled пишет '1'/'0'", () => {
      stub({ [OBSHAGA_SOUND_KEY]: '0' });
      expect(new ObshagaAudio().enabled).toBe(false);
      stub({});
      const a = new ObshagaAudio();
      expect(a.enabled).toBe(true);
      const m = stub({});
      const b = new ObshagaAudio();
      b.setEnabled(false);
      expect(m.get(OBSHAGA_SOUND_KEY)).toBe('0');
      expect(new ObshagaAudio().enabled).toBe(false);
      b.setEnabled(true);
      expect(m.get(OBSHAGA_SOUND_KEY)).toBe('1');
      expect(new ObshagaAudio().enabled).toBe(true);
    });
  });
});
