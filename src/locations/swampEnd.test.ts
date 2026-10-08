import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SWAMP, END_EMERGE_S, END_LOOK_S, END_PRESS_S, END_STEP_S, END_SWITCH_S, END_TITLE_S, END_UNDER_S,
  endPose, endTitles, newSwamp, normSwamp, rollSwamp, swampRule,
} from './swampEnd';

describe('финал «Болото на крыше»: спецификация и розыгрыш', () => {
  it('разбор: чужое — null, мусор — по умолчанию, диапазон упорядочен', () => {
    expect(normSwamp(null)).toBeNull();
    expect(normSwamp({ kind: 'lift' })).toBeNull();
    expect(normSwamp({ kind: 'swamp' })).toEqual(DEFAULT_SWAMP);
    const s = normSwamp({ kind: 'swamp', toothS: -3, unit: [90000, 12], darkness: 7 })!;
    expect(s.toothS).toBe(0.5);
    expect(s.unit).toEqual([12, 90000]);
    expect(s.darkness).toBe(1);
    expect(normSwamp(newSwamp())).toEqual(newSwamp());
  });

  it('розыгрыш детерминирован по ключу, номер части — в диапазоне', () => {
    const a = rollSwamp(DEFAULT_SWAMP, 'сид|адрес'), b = rollSwamp(DEFAULT_SWAMP, 'сид|адрес');
    expect(a).toEqual(b);
    expect(a.unit).toBeGreaterThanOrEqual(10000);
    expect(a.unit).toBeLessThanOrEqual(99999);
    const units = new Set(Array.from({ length: 30 }, (_, k) => rollSwamp(DEFAULT_SWAMP, `k${k}`).unit));
    expect(units.size).toBeGreaterThan(20);
    expect(endTitles(a).lines.join(' ')).toContain(String(a.unit));
    expect(swampRule()).toMatch(/зуб/);
  });
});

describe('финал: сценарий камеры', () => {
  const T = Array.from({ length: Math.ceil((END_TITLE_S + 1) * 60) }, (_, k) => k / 60);

  it('фазы идут по порядку: шаг → давит → под грязью → всплытие → ползком → смотришь → титры → конец', () => {
    const order = ['step', 'press', 'under', 'emerge', 'crawl', 'look', 'title', 'done'];
    let last = 0;
    for (const t of T) {
      const k = order.indexOf(endPose(t).phase);
      expect(k).toBeGreaterThanOrEqual(last);
      last = k;
    }
    expect(last).toBe(order.length - 1);
    expect(endPose(END_STEP_S / 2).phase).toBe('step');
    expect(endPose((END_STEP_S + END_PRESS_S) / 2).phase).toBe('press');
    expect(endPose(END_LOOK_S + 0.1).phase).toBe('title');
  });

  it('зуб вдавливает: глаз уходит под грязь, грязь на глазах и темнота доходят до полной', () => {
    const p0 = endPose(0);
    expect(p0.place).toBe('roof');
    expect(p0.y).toBeGreaterThan(1.5);
    const pEnd = endPose(END_PRESS_S - 1e-3);
    expect(pEnd.y).toBeLessThan(-0.3);
    expect(pEnd.mud).toBeGreaterThan(0.95);
    expect(pEnd.gear).toBeGreaterThan(0.95);
    // смотрит вверх на зуб посреди давки
    expect(Math.max(...T.filter((t) => t > END_STEP_S && t < END_PRESS_S).map((t) => endPose(t).pitch))).toBeGreaterThan(0.6);
    expect(endPose((END_PRESS_S + END_UNDER_S) / 2).dark).toBeGreaterThan(0.95);
  });

  it('место меняется только в полной темноте', () => {
    for (const t of T) {
      const p = endPose(t), q = endPose(t + 1 / 60);
      if (p.place !== q.place) {
        expect(p.dark).toBeGreaterThan(0.99);
        expect(q.dark).toBeGreaterThan(0.99);
        expect(t + 1 / 60).toBeGreaterThanOrEqual(END_SWITCH_S - 1e-9);
      }
    }
    expect(endPose(END_SWITCH_S - 0.01).place).toBe('roof');
    expect(endPose(END_SWITCH_S + 0.01).place).toBe('base');
  });

  it('у части: всплываешь (голова над водой), ползёшь вперёд к берегу, к титрам прожектор слепит', () => {
    const e = endPose(END_EMERGE_S - 0.01);
    expect(e.place).toBe('base');
    expect(e.y).toBeGreaterThan(0.2);
    expect(e.mud).toBeLessThan(0.05);
    expect(e.dark).toBeLessThan(0.05);
    let z = -1;
    for (const t of T.filter((t) => t >= END_EMERGE_S)) {
      const p = endPose(t);
      expect(p.z).toBeGreaterThanOrEqual(z - 1e-9);
      z = p.z;
    }
    expect(z).toBeGreaterThan(2.5);
    const end = endPose(END_TITLE_S + 5);
    expect(end.phase).toBe('done');
    expect(end.title).toBe(1);
    expect(end.glare).toBeGreaterThan(0.5);
    expect(endPose(END_LOOK_S - 0.5).title).toBe(0);
  });

  it('поза без скачков (кроме смены места в темноте)', () => {
    for (const t of T) {
      const p = endPose(t), q = endPose(t + 1 / 60);
      if (p.place !== q.place) continue;
      expect(Math.abs(q.y - p.y)).toBeLessThan(0.12);
      expect(Math.abs(q.pitch - p.pitch)).toBeLessThan(0.12);
      expect(Math.abs(q.mud - p.mud)).toBeLessThan(0.12);
      expect(Math.abs(q.dark - p.dark)).toBeLessThan(0.12);
    }
  });
});
