// Игровой цикл: заход в комнату (опасность, порог, этаж), подбор, сохранение.
import { describe, expect, it } from 'vitest';
import type { RunExport } from '../blockout/types';
import { generateRun } from '../gen/generate';
import { exportRunJSON } from '../gen/world';
import { presetRuns, presets } from './runs.test-util';
import { enterRoom, gameKey, loadGame, newGame, pickupsLeft, pickupsOf, readGame, saveGame, takePickup, writeGame } from './state';
import type { GameEvent, Pickup } from './types';

const p = presets();
const rx = exportRunJSON(p, generateRun(p, { seed: 'game-state', count: 40 })) as RunExport;
const KEY = 'world-test';

describe('newGame', () => {
  it('пустое состояние мира', () => {
    expect(newGame(KEY)).toEqual({
      format: 'room-forge-game', version: 1, worldKey: KEY, inventory: {}, taken: [], visited: [], danger: 0, overLimit: false, minFloor: 0,
    });
    expect(gameKey(KEY)).toBe('room-forge/game/world-test');
  });
});

describe('enterRoom', () => {
  it('первый заход начисляет опасность тира, повторный — нет', () => {
    const s = newGame(KEY);
    const inst = rx.instances.find((i) => i.danger > 0)!;
    const ev = enterRoom(s, rx, inst.id, 0);
    expect(ev).toEqual([{ type: 'enter', inst: inst.id, tierId: inst.tier, dangerAdd: inst.danger, danger: inst.danger, first: true }]);
    expect(s.visited).toEqual([inst.id]);
    expect(enterRoom(s, rx, inst.id, 0)).toEqual([{ type: 'enter', inst: inst.id, tierId: inst.tier, dangerAdd: 0, danger: inst.danger, first: false }]);
    expect(s.danger).toBe(inst.danger);
    expect(s.visited).toEqual([inst.id]);
  });

  it('обход всех комнат по разу (и по второму кругу): опасность = сумма danger экземпляров', () => {
    const s = newGame(KEY);
    for (let k = 0; k < 2; k++) for (const i of rx.instances) enterRoom(s, rx, i.id, 0);
    expect(s.danger).toBeCloseTo(rx.instances.reduce((a, i) => a + i.danger, 0), 9);
    expect(s.visited.length).toBe(rx.instances.length);
    expect(s.overLimit).toBe(false); // порог 0 — нет порога
  });

  it('порог: событие один раз, когда опасность стала БОЛЬШЕ лимита', () => {
    const s = newGame(KEY);
    const total = rx.instances.reduce((a, i) => a + i.danger, 0);
    expect(total).toBeGreaterThan(10);
    const limit = 10;
    const all: GameEvent[] = [];
    let crossedAt = -1;
    rx.instances.forEach((i, n) => {
      const before = s.danger;
      const ev = enterRoom(s, rx, i.id, limit);
      all.push(...ev);
      if (before <= limit && s.danger > limit && crossedAt < 0) {
        crossedAt = n;
        expect(ev[1]).toEqual({ type: 'danger-limit', danger: s.danger, limit });
      }
    });
    expect(crossedAt).toBeGreaterThanOrEqual(0);
    expect(all.filter((e) => e.type === 'danger-limit').length).toBe(1);
    expect(s.overLimit).toBe(true);
    // ровно на пороге — ещё не горит
    const t = newGame(KEY);
    t.danger = limit - rx.instances[0].danger;
    expect(enterRoom(t, rx, rx.instances[0].id, limit).some((e) => e.type === 'danger-limit')).toBe(false);
  });

  it('этаж: minFloor — самый нижний посещённый; неизвестная комната — без событий', () => {
    const copy = JSON.parse(JSON.stringify(rx)) as RunExport;
    copy.instances[3].floor = -2;
    copy.instances[5].floor = -1;
    const s = newGame(KEY);
    enterRoom(s, copy, copy.instances[3].id, 100);
    enterRoom(s, copy, copy.instances[5].id, 100);
    expect(s.minFloor).toBe(-2);
    expect(enterRoom(s, copy, 'нет-такой', 100)).toEqual([]);
    expect(s.visited.length).toBe(2);
  });
});

describe('takePickup', () => {
  it('инвентарь растёт, повторно не подбирается', () => {
    const s = newGame(KEY);
    const pk: Pickup = { id: 'i0:loot:0', inst: 'i0', itemId: 'it_kopeyki', count: 4, x: 1, y: 1, z: 0, from: 'tier' };
    expect(takePickup(s, pk)).toEqual([{ type: 'pickup', pickupId: 'i0:loot:0', itemId: 'it_kopeyki', count: 4 }]);
    expect(takePickup(s, { ...pk, id: 'i0:loot:1', count: 2 })).toHaveLength(1);
    expect(takePickup(s, pk)).toEqual([]);
    expect(s.inventory).toEqual({ it_kopeyki: 6 });
    expect(s.taken).toEqual(['i0:loot:0', 'i0:loot:1']);
  });

  it('подобрать всё во всех комнатах = totals прогона (лут + по 1 за предмет на споте)', () => {
    for (const [name, run] of presetRuns(p).slice(0, 2)) {
      const s = newGame(KEY);
      for (const i of run.instances) {
        enterRoom(s, run, i.id, 0);
        for (const pk of pickupsLeft(s, run, i)) takePickup(s, pk);
        expect(pickupsLeft(s, run, i), name).toEqual([]);
      }
      const totals = run.totals as Record<string, number>;
      const want = Object.fromEntries(Object.entries(totals).filter(([, v]) => v > 0));
      expect(s.inventory, name).toEqual(want);
      expect(s.taken.length).toBe(run.instances.reduce((a, i) => a + pickupsOf(run, i).length, 0));
    }
  });
});

describe('сохранение', () => {
  it('saveGame → loadGame: то же состояние', () => {
    const s = newGame(KEY);
    for (const i of rx.instances.slice(0, 10)) {
      enterRoom(s, rx, i.id, 20);
      for (const pk of pickupsOf(rx, i)) takePickup(s, pk);
    }
    s.minFloor = -3;
    const back = loadGame(saveGame(s), KEY);
    expect(back).toEqual(s);
    expect(back).not.toBe(s);
  });

  it('битое, чужое и другой мир — null', () => {
    expect(loadGame('', KEY)).toBeNull();
    expect(loadGame('{oops', KEY)).toBeNull();
    expect(loadGame('null', KEY)).toBeNull();
    expect(loadGame('[1,2]', KEY)).toBeNull();
    expect(loadGame(JSON.stringify({ ...newGame(KEY), format: 'room-forge-world' }), KEY)).toBeNull();
    expect(loadGame(JSON.stringify({ ...newGame(KEY), version: 2 }), KEY)).toBeNull();
    expect(loadGame(saveGame(newGame('другой')), KEY)).toBeNull();
  });

  it('мусор в полях чистится поштучно', () => {
    const raw = {
      format: 'room-forge-game', version: 1, worldKey: KEY,
      inventory: { a: 3, b: -1, c: 'x', d: NaN, e: 0, f: 1.5 },
      taken: ['p1', 'p1', 5, null, 'p2'],
      visited: 'i0',
      danger: 'много',
      overLimit: 'yes',
      minFloor: 4,
    };
    expect(loadGame(JSON.stringify(raw), KEY)).toEqual({
      ...newGame(KEY), inventory: { a: 3, f: 1.5 }, taken: ['p1', 'p2'], visited: [], danger: 0, overLimit: false, minFloor: 0,
    });
    // без worldKey — привязывается к запрошенному миру
    const { worldKey: _w, ...noKey } = newGame(KEY);
    expect(loadGame(JSON.stringify(noKey), KEY)).toEqual(newGame(KEY));
  });

  it('localStorage: writeGame / readGame (нет хранилища — новая игра, без исключений)', () => {
    const mem = new Map<string, string>();
    const g = globalThis as { localStorage?: unknown };
    const had = 'localStorage' in g;
    const prev = g.localStorage;
    try {
      delete g.localStorage;
      expect(readGame(KEY)).toEqual(newGame(KEY));
      expect(writeGame(newGame(KEY))).toBe(false);
      g.localStorage = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v) };
      const s = newGame(KEY);
      s.danger = 7;
      expect(writeGame(s)).toBe(true);
      expect(mem.has(gameKey(KEY))).toBe(true);
      expect(readGame(KEY)).toEqual(s);
      mem.set(gameKey(KEY), 'мусор');
      expect(readGame(KEY)).toEqual(newGame(KEY));
    } finally {
      if (had) g.localStorage = prev;
      else delete g.localStorage;
    }
  });
});
