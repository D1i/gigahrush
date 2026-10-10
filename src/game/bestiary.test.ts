import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  applyBestiary, beastById, beasts, changedCount, cloneBestiary, defineBeast, fillText, fmtKnob, knobDefault, knobValue,
  parseBestiary, readPath, setLobbyBestiary, setLocalBestiary, stepDigits, withKnob, withoutBeast, writePath,
} from './bestiary';
import { emptyProject, parseProject, serializeProject } from '../model/serialize';
import '../data/bestiaryEntries';
import { OBSHAGA } from '../locations/obshaga';
import { CATACOMBS } from '../locations/catacombsFlood';

// тестовое существо: число, пара [от, до], вложенная доля, плюс ручка с битым путём
const FX = { a: 1, r: [2, 5], deep: { x: 0.5 }, other: 9 };
const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
defineBeast({
  id: 'fx',
  name: 'Проба',
  biome: 'тест',
  kind: 'явление',
  danger: 1,
  summary: 'a = {a}, r = {r.0}–{r.1}, x = {deep.x} %, other = {other}, нет = {nope}',
  behaviour: [],
  config: FX,
  knobs: [
    { key: 'a', label: 'A', min: 0, max: 10, step: 0.5 },
    { key: 'r.0', label: 'R от', min: 0, max: 10, step: 1, range: 'R' },
    { key: 'r.1', label: 'R до', min: 0, max: 10, step: 1, range: 'R' },
    { key: 'deep.x', label: 'X', min: 0, max: 1, step: 0.05, pct: true },
    { key: 'nope', label: 'нет такого', min: 0, max: 1, step: 0.1 },
  ],
});
warn.mockRestore();

afterEach(() => {
  setLocalBestiary(undefined);
  applyBestiary(undefined);
});

describe('реестр и дефолты', () => {
  it('дефолты — снимок при регистрации; ручка с битым путём отброшена', () => {
    const b = beastById('fx')!;
    expect(b.knobs.map((k) => k.key)).toEqual(['a', 'r.0', 'r.1', 'deep.x']);
    expect(b.knobs.map((k) => knobDefault('fx', k.key))).toEqual([1, 2, 5, 0.5]);
    FX.a = 7;
    FX.r[0] = 4;
    expect(knobDefault('fx', 'a')).toBe(1);
    expect(knobDefault('fx', 'r.0')).toBe(2);
    expect(knobValue('fx', 'a')).toBe(7);
    applyBestiary(undefined);
    expect(FX).toEqual({ a: 1, r: [2, 5], deep: { x: 0.5 }, other: 9 });
    expect(knobDefault('fx', 'nope')).toBeNaN();
    expect(knobValue('nope', 'a')).toBeNaN();
  });

  it('повторная регистрация того же id не перечитывает изменённый конфиг', () => {
    FX.a = 3;
    defineBeast({ ...beastById('fx')! });
    expect(knobDefault('fx', 'a')).toBe(1);
    applyBestiary(undefined);
    expect(FX.a).toBe(1);
  });

  it('реальные записи: ручки ведут к числам, дефолты в рамках, тексты без висячих {ключей}', () => {
    const real = beasts().filter((b) => b.id !== 'fx');
    expect(real.map((b) => b.id)).toEqual(['smile', 'hand', 'dorm', 'grabber', 'lift', 'flood', 'escalator']);
    for (const b of real) {
      const keys = new Set<string>();
      for (const k of b.knobs) {
        const d = knobDefault(b.id, k.key);
        expect(Number.isFinite(d), `${b.id}.${k.key}`).toBe(true);
        expect(d, `${b.id}.${k.key} ≥ min`).toBeGreaterThanOrEqual(k.min);
        expect(d, `${b.id}.${k.key} ≤ max`).toBeLessThanOrEqual(k.max);
        expect(k.min).toBeLessThan(k.max);
        expect(k.step).toBeGreaterThan(0);
        if (k.pct) expect(k.min >= 0 && k.max <= 1, `${b.id}.${k.key} доля`).toBe(true);
        expect(keys.has(k.key), `${b.id}.${k.key} дубль`).toBe(false);
        keys.add(k.key);
        // пара [от, до] — подряд
        if (k.range && k.key.endsWith('.0')) expect(b.knobs[b.knobs.indexOf(k) + 1]?.key).toBe(k.key.slice(0, -1) + '1');
      }
      for (const t of [b.summary, ...b.behaviour.map((s) => s.text), ...(b.counters ?? [])]) expect(fillText(b, t), b.id).not.toMatch(/\{/);
      if (!b.knobs.length) expect(b.note, `${b.id}: где настраивается`).toBeTruthy();
    }
  });

  it('рука: копии на загрузке (LANTERN_R, GRAB_R, POKE_R, POKE_STAND, POKE_MAX) — не ручки', () => {
    const keys = beastById('hand')!.knobs.map((k) => k.key);
    for (const k of ['lanternR', 'lanternLightR', 'grabR', 'pokeR', 'pokeStandM', 'pokeMaxM']) expect(keys).not.toContain(k);
    expect(keys).toEqual(expect.arrayContaining(['handSpeedK', 'retreatK', 'emergeS', 'dragSpeed', 'pokeDmg', 'pokePeriodS', 'firstLitS.0', 'darkS.1']));
  });
});

describe('пути', () => {
  it('readPath / writePath: вложенные поля и индекс массива', () => {
    const o = { a: { b: [1, 2, { c: 3 }] }, s: 'x' };
    expect(readPath(o, 'a.b.1')).toBe(2);
    expect(readPath(o, 'a.b.2.c')).toBe(3);
    expect(readPath(o, 'a.b.5')).toBeUndefined();
    expect(readPath(o, 's')).toBeUndefined();
    expect(writePath(o, 'a.b.0', 10)).toBe(true);
    expect(o.a.b[0]).toBe(10);
    // новых полей ручка не заводит, строку числом не затирает
    expect(writePath(o, 'a.z', 1)).toBe(false);
    expect(writePath(o, 's', 1)).toBe(false);
    expect(writePath(o, 'q.w', 1)).toBe(false);
    expect(o).toEqual({ a: { b: [10, 2, { c: 3 }] }, s: 'x' });
  });
});

describe('applyBestiary', () => {
  it('пишет правки, остальное — к дефолтам; негодное — дефолт', () => {
    applyBestiary({ fx: { a: 3, 'r.1': 7 } });
    expect(FX).toEqual({ a: 3, r: [2, 7], deep: { x: 0.5 }, other: 9 });
    applyBestiary({ fx: { 'deep.x': 0.2, a: 99 } });
    expect(FX).toEqual({ a: 1, r: [2, 5], deep: { x: 0.2 }, other: 9 });
    applyBestiary(undefined);
    expect(FX).toEqual({ a: 1, r: [2, 5], deep: { x: 0.5 }, other: 9 });
  });

  it('живой конфиг реальной записи', () => {
    applyBestiary({ hand: { handSpeedK: 0.9, 'darkS.1': 120 }, flood: { breathS: 20 } });
    expect(OBSHAGA.handSpeedK).toBe(0.9);
    expect(OBSHAGA.darkS[1]).toBe(120);
    expect(CATACOMBS.breathS).toBe(20);
    applyBestiary(undefined);
    expect(OBSHAGA.handSpeedK).toBe(0.5);
    expect(OBSHAGA.darkS[1]).toBe(75);
    expect(CATACOMBS.breathS).toBe(12);
  });

  it('кооп: пока идёт лобби, действуют его числа; конец лобби — снова свои', () => {
    const lobby = {}, stranger = {};
    setLocalBestiary({ fx: { a: 4 } });
    expect(FX.a).toBe(4);
    setLobbyBestiary(lobby, { fx: { a: 6 } });
    expect(FX.a).toBe(6);
    setLocalBestiary({ fx: { a: 5 } });
    expect(FX.a).toBe(6);
    setLobbyBestiary(stranger, null);
    expect(FX.a).toBe(6);
    setLobbyBestiary(lobby, null);
    expect(FX.a).toBe(5);
    setLobbyBestiary(lobby, undefined);
    expect(FX.a).toBe(1);
    setLobbyBestiary(lobby, null);
    expect(FX.a).toBe(5);
  });
});

describe('правки в проекте', () => {
  it('parseBestiary: только известные ручки, конечные числа в рамках; дефолт не хранится', () => {
    expect(parseBestiary(undefined)).toBeUndefined();
    expect(parseBestiary([1])).toBeUndefined();
    expect(parseBestiary({ fx: 3 })).toBeUndefined();
    expect(
      parseBestiary({
        fx: { a: 99, 'r.0': '3', 'deep.x': null, nope: 0.5, zzz: 1, 'r.1': 1e400 },
        ghost: { a: 1 },
      }),
    ).toBeUndefined();
    expect(parseBestiary({ fx: { a: 1, 'r.0': 2 } })).toBeUndefined();
    expect(parseBestiary({ fx: { a: 10, 'r.0': 3.4, 'r.1': -0.5, 'deep.x': 0.25 } })).toEqual({ fx: { a: 10, 'r.0': 3, 'deep.x': 0.25 } });
  });

  it('withKnob / withoutBeast / changedCount', () => {
    let o = withKnob(undefined, 'fx', 'a', 3);
    expect(o).toEqual({ fx: { a: 3 } });
    o = withKnob(o, 'fx', 'r.1', 50);
    expect(o).toEqual({ fx: { a: 3, 'r.1': 10 } });
    expect(changedCount(o, 'fx')).toBe(2);
    expect(withKnob(o, 'fx', 'a', 1)).toEqual({ fx: { 'r.1': 10 } });
    expect(withKnob(o, 'fx', 'zzz', 1)).toBe(o);
    expect(withoutBeast(o, 'fx', ['a'])).toEqual({ fx: { 'r.1': 10 } });
    expect(withoutBeast(o, 'fx')).toBeUndefined();
    expect(withKnob(withKnob(undefined, 'fx', 'a', 3), 'fx', 'a', 1)).toBeUndefined();
    // не мутирует
    expect(o).toEqual({ fx: { a: 3, 'r.1': 10 } });
  });

  it('сериализация: туда-обратно, пустое не пишется', () => {
    const p = emptyProject();
    const j0 = serializeProject(p);
    expect('bestiary' in j0).toBe(false);
    expect('bestiary' in parseProject(JSON.parse(JSON.stringify(j0)))).toBe(false);
    p.bestiary = { fx: { a: 3 }, smile: { stareS: 7, 'peek1DistM.1': 22 } };
    const j = JSON.parse(JSON.stringify(serializeProject(p)));
    expect(j.bestiary).toEqual({ fx: { a: 3 }, smile: { stareS: 7, 'peek1DistM.1': 22 } });
    expect(parseProject(j).bestiary).toEqual(p.bestiary);
    // мусор в сохранении — отброшен, проект грузится
    j.bestiary = { smile: { stareS: 'много', aimCircle: 5 }, hand: { lanternR: 3 } };
    expect('bestiary' in parseProject(j)).toBe(false);
    expect(cloneBestiary({ fx: {} })).toBeUndefined();
  });
});

describe('показ', () => {
  it('знаки по шагу, проценты, подстановка в текст', () => {
    expect([stepDigits(1), stepDigits(0.5), stepDigits(0.05), stepDigits(0.0001), stepDigits(10)]).toEqual([0, 1, 2, 4, 0]);
    expect(fmtKnob({ step: 0.05 }, 0.35)).toBe('0,35');
    expect(fmtKnob({ step: 0.01, pct: true }, 0.12)).toBe('12');
    expect(fmtKnob({ step: 0.0001, pct: true }, 0.001)).toBe('0,1');
    const b = beastById('fx')!;
    expect(fillText(b, b.summary)).toBe('a = 1, r = 2–5, x = 50 %, other = 9, нет = {nope}');
    applyBestiary({ fx: { a: 2.5 } });
    expect(fillText(b, '{a}')).toBe('2,5');
  });
});
