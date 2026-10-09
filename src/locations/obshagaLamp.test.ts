// Керосиновая лампа, стоящая на полу (src/locations/obshaga.ts: KEROLAMP_ITEM, floorLanterns): лежащие предметы
// «Прогулки» (WorldDrop: мировая Babylon — X = план x, Z = −план y) → точки поля в плане; поле защищает стоящего рядом
// (рука упирается в край поля и не хватает) и освещает руку; отошёл от лампы — хватает.
import { describe, expect, it } from 'vitest';
import {
  createHand, floorLanterns, inLanternLight, isProtected, stepHand, GRAB_R, KEROLAMP_ITEM, LANTERN_LIGHT_R, LANTERN_R,
  type HandEvent, type HandInput, type HandPlayer, type Pt,
} from './obshaga';

const DT = 1 / 64;
const DOOR: Pt = { x: 0, y: -2, room: 'r1' };
const MOUTH: Pt = { x: 0, y: 0, room: 'c' };
const drop = (id: string, item: string, inst: string, x: number, z: number) => ({ id, item, inst, x, y: 0.02, z, yaw: 0.3 });
const inp = (o: Partial<HandInput> = {}): HandInput => ({ lightsOn: false, seen: false, goal: null, players: [], lanterns: [], playerSpeed: 4, ...o });
const player = (x: number): HandPlayer => ({ id: 'p1', p: { x, y: 0, room: 'c' }, protected: false, sees: false });

/** Рука, вылезшая до проёма (никто не смотрит). */
function emerged(seed: string) {
  const h = createHand(seed, DOOR, MOUTH);
  for (let k = 0; k < 400 && h.phase === 'emerging'; k++) stepHand(h, DT, inp());
  expect(h.phase).toBe('stalking');
  return h;
}

describe('лампа на полу', () => {
  it('лежащие лампы → точки поля в плане (y = −Z, комната — inst); прочие предметы и комнаты не из плана — нет', () => {
    const drops = [drop('a', KEROLAMP_ITEM, 'c', 2, -3), drop('b', 'it_flashlight', 'c', 1, -1), drop('c', KEROLAMP_ITEM, 'flat', 5, -5)];
    expect(floorLanterns(drops)).toEqual([{ x: 2, y: 3, room: 'c' }, { x: 5, y: 5, room: 'flat' }]);
    expect(floorLanterns(drops, (r) => r === 'c')).toEqual([{ x: 2, y: 3, room: 'c' }]);
    expect(floorLanterns([])).toEqual([]);
  });

  it('поле стоящей лампы: защищает строго ближе LANTERN_R, освещает руку ближе LANTERN_LIGHT_R', () => {
    const lamps = floorLanterns([drop('a', KEROLAMP_ITEM, 'c', 10, -1)]);
    expect(isProtected({ x: 10 + LANTERN_R - 0.01, y: 1 }, lamps)).toBe(true);
    expect(isProtected({ x: 10 + LANTERN_R + 0.01, y: 1 }, lamps)).toBe(false);
    expect(inLanternLight({ x: 10 - LANTERN_LIGHT_R + 0.1, y: 1 }, lamps)).toBe(true);
    expect(inLanternLight({ x: 10 - LANTERN_LIGHT_R - 0.1, y: 1 }, lamps)).toBe(false);
  });

  it('рука не хватает стоящего у лампы на полу (упирается в край поля); лампа далеко — хватает', () => {
    // лампа на полу в 2.5 м за игроком: кисть упирается в поле в 0.5 м от него
    const at = { x: 8.5, y: 0 };
    const near = floorLanterns([drop('l', KEROLAMP_ITEM, 'c', 11, -0.5)]);
    const h = emerged('пол');
    for (let k = 0; k < 64 * 10; k++) expect(stepHand(h, DT, inp({ goal: at, players: [player(at.x)], lanterns: near }))).toEqual([]);
    expect(Math.hypot(h.tip.x - at.x, h.tip.y - at.y)).toBeLessThan(GRAB_R);
    expect(h.phase).toBe('stalking');
    // та же лампа унесена далеко — тот же игрок без защиты: хватка
    const far = floorLanterns([drop('l', KEROLAMP_ITEM, 'c', 40, -0.5)]);
    const h2 = emerged('пол2');
    const ev: HandEvent[] = [];
    for (let k = 0; k < 64 * 10 && !ev.some((e) => e.type === 'grab'); k++) ev.push(...stepHand(h2, DT, inp({ goal: at, players: [player(at.x)], lanterns: far })));
    expect(ev.some((e) => e.type === 'grab')).toBe(true);
  });
});
