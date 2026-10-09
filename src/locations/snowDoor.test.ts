import { describe, expect, it } from 'vitest';
import {
  arriveSnowDoor, buriedWhite, createSnowDoor, digSnowDoor, normDigs, openSnowDoor, snowDoorPlace, snowDoorPrompt,
  snowDoorView, stepSnowDoor, SNOWDOOR_CRACK_S, SNOWDOOR_DIGS, SNOWDOOR_DOOR_S, SNOWDOOR_FALL_S, SNOWDOOR_PROMPT,
  SNOWDOOR_RISE_S, SNOWDOOR_WHITE, type SnowDoorEvent, type SnowDoorState,
} from './snowDoor';

function run(s: SnowDoorState, sec: number, dt = 1 / 60): SnowDoorEvent[] {
  const out: SnowDoorEvent[] = [];
  for (let t = 0; t < sec - 1e-9; t += dt) out.push(...stepSnowDoor(s, dt));
  return out;
}

/** Дойти до «засыпало». */
function bury(digs = 4): SnowDoorState {
  const s = createSnowDoor(digs);
  openSnowDoor(s);
  run(s, SNOWDOOR_DOOR_S + SNOWDOOR_CRACK_S + SNOWDOOR_FALL_S + 0.1);
  return s;
}

describe('дверь в снег', () => {
  it('нажатий — из розыгрыша, мусор — по умолчанию', () => {
    expect(createSnowDoor(5).need).toBe(5);
    expect(normDigs(0)).toBe(1);
    expect(normDigs(1000)).toBe(60);
    expect(normDigs(NaN)).toBe(SNOWDOOR_DIGS);
    expect(normDigs('7')).toBe(SNOWDOOR_DIGS);
  });

  it('E → дверь → треск → обвал → засыпало', () => {
    const s = createSnowDoor(4);
    expect(snowDoorPrompt(s, true)).toBe(SNOWDOOR_PROMPT);
    expect(snowDoorPrompt(s, false)).toBeNull();
    expect(stepSnowDoor(s, 1)).toEqual([]);
    expect(openSnowDoor(s)).toEqual([{ type: 'open' }]);
    expect(openSnowDoor(s)).toEqual([]);
    expect(snowDoorView(s).frozen).toBe(true);
    expect(snowDoorPrompt(s, true)).toBeNull();
    const ev = run(s, SNOWDOOR_DOOR_S + SNOWDOOR_CRACK_S + SNOWDOOR_FALL_S + 0.1);
    expect(ev.map((e) => e.type)).toEqual(['crack', 'fall', 'buried']);
    expect(s.phase).toBe('buried');
    const v = snowDoorView(s);
    expect(v.white).toBeCloseTo(SNOWDOOR_WHITE);
    expect(v.lie).toBe(1);
    expect(v.frozen).toBe(true);
    expect(snowDoorPrompt(s, false)).toBe('Засыпало! E — выкапываться (0/4)');
    // засыпанный ждёт нажатий — время не выводит
    expect(run(s, 10)).toEqual([]);
    expect(s.phase).toBe('buried');
  });

  it('треск: виньетка и тряска растут; обвал: пелена 0 → 1', () => {
    const s = createSnowDoor();
    openSnowDoor(s);
    run(s, SNOWDOOR_DOOR_S + 0.02);
    expect(s.phase).toBe('crack');
    const a = snowDoorView(s);
    run(s, SNOWDOOR_CRACK_S * 0.8);
    const b = snowDoorView(s);
    expect(b.crack!).toBeGreaterThan(a.crack!);
    expect(b.shake).toBeGreaterThan(a.shake);
    expect(b.white).toBeNull();
    run(s, SNOWDOOR_CRACK_S * 0.2 + 0.02);
    expect(s.phase).toBe('fall');
    expect(snowDoorView(s).white!).toBeLessThan(0.2);
    run(s, SNOWDOOR_FALL_S * 0.9);
    expect(snowDoorView(s).white!).toBeGreaterThan(0.8);
  });

  it('каждое нажатие убирает часть пелены; последнее — descend', () => {
    const s = bury(4);
    let white = snowDoorView(s).white!;
    for (let k = 1; k < 4; k++) {
      expect(digSnowDoor(s)).toEqual([{ type: 'dig', dug: k, need: 4 }]);
      const w = snowDoorView(s).white!;
      expect(w).toBeLessThan(white);
      white = w;
      expect(snowDoorPrompt(s, false)).toBe(`Засыпало! E — выкапываться (${k}/4)`);
    }
    expect(digSnowDoor(s).map((e) => e.type)).toEqual(['dig', 'descend']);
    expect(s.phase).toBe('out');
    expect(digSnowDoor(s)).toEqual([]); // лишние нажатия — ничего
    expect(snowDoorView(s).white).toBeCloseTo(buriedWhite(4, 4));
    expect(snowDoorView(s).frozen).toBe(true);
    // ждёт перехода
    expect(run(s, 5)).toEqual([]);
  });

  it('выбрался: пелена спадает, подъём из лёжа, потом покой', () => {
    const s = bury(1);
    digSnowDoor(s);
    arriveSnowDoor(s, true);
    expect(s.phase).toBe('rise');
    const v0 = snowDoorView(s);
    expect(v0.lie).toBe(1);
    run(s, SNOWDOOR_RISE_S * 0.7);
    const v1 = snowDoorView(s);
    expect(v1.white!).toBeLessThan(0.01);
    expect(v1.lie).toBeLessThan(v0.lie);
    expect(v1.frozen).toBe(true);
    run(s, SNOWDOOR_RISE_S * 0.15);
    expect(snowDoorView(s).frozen).toBe(false);
    expect(run(s, SNOWDOOR_RISE_S).map((e) => e.type)).toEqual(['done']);
    expect(s.phase).toBe('idle');
    expect(snowDoorView(s).white).toBeNull();
  });

  it('засыпать до дверей нельзя: нажатия вне «засыпало» — ничего', () => {
    const s = createSnowDoor(2);
    expect(digSnowDoor(s)).toEqual([]);
    openSnowDoor(s);
    expect(digSnowDoor(s)).toEqual([]);
    arriveSnowDoor(s, true);
    expect(s.phase).toBe('open');
  });

  it('место двери: середина проёма на грани стены и нормаль внутрь', () => {
    // метка на северной стене: клетки x 10…18, строка y 5 → линия y = 0.5 м, внутрь — вниз по плану (+y)
    const n = snowDoorPlace({ id: 'snowdoor', cx: 10, cy: 5, side: 'N', len: 9 }, 0.1);
    expect(n.x).toBeCloseTo(1.45);
    expect(n.y).toBeCloseTo(0.5);
    expect(n.widthM).toBeCloseTo(0.9);
    expect([n.nx, n.ny]).toEqual([0, 1]);
    const s = snowDoorPlace({ id: 'snowdoor', cx: 10, cy: 5, side: 'S', len: 9 }, 0.1);
    expect(s.y).toBeCloseTo(0.6);
    expect(s.ny).toBe(-1);
    const w = snowDoorPlace({ id: 'snowdoor', cx: 3, cy: 20, side: 'W', len: 10 }, 0.1);
    expect(w.x).toBeCloseTo(0.3);
    expect(w.y).toBeCloseTo(2.5);
    expect([w.nx, w.ny, w.widthM]).toEqual([1, 0, 1]);
    const e = snowDoorPlace({ id: 'snowdoor', cx: 3, cy: 20, side: 'E', len: 10 }, 0.1);
    expect(e.x).toBeCloseTo(0.4);
    expect(e.nx).toBe(-1);
  });
});
