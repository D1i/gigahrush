// Комнаты общаги — чистые помощники вида (src/view3d/obshagaRoomsView.ts): хук лута, чья дверь, замок, табличка
// на полотне, место записки, взгляд на записку.
import { describe, expect, it } from 'vitest';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine';
import { Scene } from '@babylonjs/core/scene';
import { itemIconOf, itemLookOf } from './itemLooks';
import type { RunExport, RunInstance } from '../blockout/types';
import { rollRoomLoot } from '../game/loot';
import { DORM, dormIndex } from '../locations/obshagaRooms';
import {
  KEY_ITEM, PLATE_D, PLATE_Y, dormDoor, dormLoot, doorsOfDorm, keyModel, lockAct, noteAimed, noteParts, notePlace, plateLocal, plateSize,
  registerDormLoot, unlockFlag,
} from './obshagaRoomsView';
import type { NavProp, NavRoom, ObshDoor } from './obshagaNav';

function inst(id: string, roomId: string, roomTags: string[]): RunInstance {
  return {
    id, roomId, roomName: roomId, roomTags, rot: 0, dx: 0, dy: 0, depth: 0, parent: null,
    bbox: { x0: 0, y0: 0, x1: 1, y1: 1 }, cells: [], doors: [], connectors: [], decor: [], spots: [],
    tier: null, danger: 0, dangerAcc: 0, loot: [],
  };
}
const cor = (id: string) => inst(id, 'obsh_cor_9', ['общага', 'коридор', 'ход', 'только-биом']);
const dorm = (id: string) => inst(id, 'obsh_room_2', ['общага', 'комната', 'только-биом']);
const kitchen = (id: string) => inst(id, 'obsh_kitchen', ['общага', 'кухня', 'только-биом']);
type Link = RunExport['links'][number];
const link = (a: string, b: string): Link => ({ a: { inst: a, connector: 'c' }, b: { inst: b, connector: 'c' } });

/** Коридор i0 и много жилых комнат за ним (+ кухня i1). */
function world(rooms = 60): RunExport {
  const instances = [cor('i0'), kitchen('i1')];
  const links: Link[] = [link('i0', 'i1')];
  for (let k = 0; k < rooms; k++) {
    instances.push(dorm(`i${k + 2}`));
    links.push(link('i0', `i${k + 2}`));
  }
  return { format: 'room-forge-run', version: 1, seed: 'мир-ключей', cellM: 0.1, settings: { gap: 0 }, props: [], items: [], instances, links, openConnectors: [] } as RunExport;
}

const door = (id: string, o: Partial<ObshDoor> = {}): ObshDoor => {
  const [i, c] = id.split('/');
  return { id, inst: i, conn: c, cor: 'i0', room: i, x: 0, y: 0, nx: 0, ny: 1, z: 0, widthM: 0.9, ...o };
};
const navOf = (doors: ObshDoor[]) => {
  const doorById = new Map(doors.map((d) => [d.id, d] as const));
  const doorsByRoom = new Map<string, ObshDoor[]>();
  for (const d of doors) for (const r of new Set([d.cor, d.room ?? d.cor])) doorsByRoom.set(r, [...(doorsByRoom.get(r) ?? []), d]);
  return { doorById, doorsByRoom };
};

describe('лут: хук комнат общаги', () => {
  it('элитность — tier комнаты, ключ — первым только где meta.key; не жилая и без мира — null', () => {
    const rx = world();
    const metas = dormIndex(rx);
    let keys = 0;
    for (const [id, m] of metas) {
      const r = dormLoot({ inst: id, addr: id, biome: 'obshaga', seed: 1, rx });
      expect(r?.tier).toBe(m.tier);
      if (m.key) {
        keys++;
        expect(r?.force).toEqual([{ item: KEY_ITEM }]);
      } else expect(r?.force).toBeUndefined();
    }
    expect(keys).toBeGreaterThan(0); // в первой незапертой — всегда
    expect(dormLoot({ inst: 'i0', addr: 'i0', biome: 'obshaga', seed: 1, rx })).toBeNull();
    expect(dormLoot({ inst: 'i1', addr: 'i1', biome: 'obshaga', seed: 1, rx })).toBeNull();
    expect(dormLoot({ inst: 'i2', addr: 'i2', biome: 'obshaga', seed: 1, rx: null })).toBeNull();
  });

  it('зарегистрирован при загрузке модуля: розыгрыш комнаты с ключом кладёт ключ первым; повторная регистрация — не вдвое', () => {
    const rx = world();
    const withKey = [...dormIndex(rx).values()].find((m) => m.key)!;
    const spec = { seed: 'мир-ключей', inst: withKey.inst, addr: withKey.inst, biome: 'obshaga', areaM2: 12, tunnels: true, rx };
    const a = rollRoomLoot(spec);
    expect(a[0]).toMatchObject({ item: KEY_ITEM, src: 'force' });
    expect(a.filter((x) => x.src === 'force')).toHaveLength(1);
    const off = registerDormLoot();
    expect(rollRoomLoot(spec)).toEqual(a);
    off();
    expect(rollRoomLoot(spec).some((x) => x.src === 'force')).toBe(false);
    registerDormLoot();
    expect(rollRoomLoot(spec)).toEqual(a);
  });

  it('ключ — в случайной таблице общаги (очень редкий): при высокой элитности иногда выпадает сам', () => {
    let n = 0;
    for (let i = 0; i < 1500; i++) {
      n += rollRoomLoot({ seed: 's', inst: `x${i}`, addr: `a${i}`, biome: 'obshaga', areaM2: 14, tunnels: true, tier: 4, rx: null }).filter((x) => x.item === KEY_ITEM && x.src === 'random').length;
    }
    expect(n).toBeGreaterThan(0);
  });
});

describe('вид ключа', () => {
  it('зарегистрирован: на полу плашмя, модель — латунь и бирка (шаблон выключен, низ — в нуле), значок — svg', () => {
    const look = itemLookOf(KEY_ITEM);
    expect(look.pose).toBe('flat');
    expect(itemIconOf(KEY_ITEM)?.kind).toBe('svg');
    const scene = new Scene(new NullEngine());
    const m = look.model!(scene)!;
    expect(m).toBe(keyModel(scene));
    expect(m.isEnabled()).toBe(false);
    m.computeWorldMatrix(true);
    const { min, max } = m.getHierarchyBoundingVectors(true);
    expect(min.y).toBeCloseTo(0, 3);
    expect(max.y).toBeGreaterThan(0.12);
    expect(max.y).toBeLessThan(0.14);
    expect(max.z - min.z).toBeLessThan(0.02);
    scene.dispose();
  });
});

describe('двери и замки', () => {
  it('dormDoor: дверь жилой комнаты — да; тупик, дверь «в снег», кухня — нет', () => {
    const rx = world(4);
    const metas = dormIndex(rx);
    const nav = navOf([door('i2/d'), door('i0/dead', { cor: 'i0', room: null }), door('i3/snowdoor'), door('i1/k')]);
    expect(dormDoor(nav, metas, 'i2/d')?.meta.inst).toBe('i2');
    expect(dormDoor(nav, metas, 'i0/dead')).toBeNull();
    expect(dormDoor(nav, metas, 'i3/snowdoor')).toBeNull();
    expect(dormDoor(nav, metas, 'i1/k')).toBeNull();
    expect(dormDoor(nav, metas, 'нет')).toBeNull();
    expect(doorsOfDorm(nav, 'i2').map((d) => d.id)).toEqual(['i2/d']);
    expect(doorsOfDorm(nav, 'i3')).toEqual([]);
    expect(doorsOfDorm(nav, 'i0')).toEqual([]);
  });

  it('lockAct: открыта / отперта — обычное E; изнутри — без ключа; снаружи — ключом или «заперто»', () => {
    const L = { locked: true }, O = { locked: false };
    expect(lockAct(O, false, false, false)).toBe('open');
    expect(lockAct(null, false, false, true)).toBe('open');
    expect(lockAct(L, true, false, false)).toBe('open');
    expect(lockAct(L, false, true, false)).toBe('inside');
    expect(lockAct(L, false, false, true)).toBe('key');
    expect(lockAct(L, false, false, false)).toBe('locked');
    expect(unlockFlag('i7/c2')).toBe('unlock:i7/c2');
  });

  it('∞ заперта всегда, в мире есть и запертые, и открытые комнаты', () => {
    const metas = [...dormIndex(world()).values()];
    expect(metas.filter((m) => m.kind === 'inf').every((m) => m.locked)).toBe(true);
    expect(metas.some((m) => m.locked)).toBe(true);
    expect(metas.some((m) => !m.locked)).toBe(true);
    expect(DORM.locked.inf).toBe(1);
  });
});

describe('табличка', () => {
  it('размер растёт с надписью, в пределах; ∞ — шире и выше', () => {
    const a = plateSize('7'), b = plateSize('312'), c = plateSize('741213'), d = plateSize('∞+417');
    expect(a.w).toBeGreaterThanOrEqual(0.1);
    expect(b.w).toBeGreaterThanOrEqual(a.w);
    expect(c.w).toBeGreaterThan(b.w);
    expect(c.w).toBeLessThanOrEqual(0.2);
    expect(d.h).toBeGreaterThan(c.h);
    expect(d.w).toBeLessThanOrEqual(0.21);
  });

  it('на полотне: посередине ширины (у правых петель — отражено), на высоте, с обратной стороны (к коридору)', () => {
    const t = 0.04;
    const l = plateLocal({ hinge: 'left', width: 0.92 }, t, false);
    expect(l).toEqual({ x: 0.46, y: PLATE_Y, z: t + PLATE_D / 2, face: 1 });
    const r = plateLocal({ hinge: 'right', width: 0.92 }, t, false);
    expect(r.x).toBeCloseTo(-0.46);
    expect(r.face).toBe(1);
    // полотно с «чужой» стороны пары — стороны меняются: табличка на лицевой
    const f = plateLocal({ hinge: 'left', width: 0.92 }, t, true);
    expect(f.z).toBeLessThan(0);
    expect(f.face).toBe(-1);
  });
});

describe('записка', () => {
  const prop = (propId: string, x0: number, y0: number, x1: number, y1: number, h: number, cover: NavProp['cover'] = null): NavProp => ({ propId, rect: { x0, y0, x1, y1 }, h, cover });
  const room = (props: NavProp[]): Pick<NavRoom, 'id' | 'props' | 'x0' | 'y0' | 'x1' | 'y1'> => ({ id: 'i5', props, x0: 0, y0: 0, x1: 3, y1: 4 });
  const d = { x: 1.5, y: 4, nx: 0, ny: 1 };

  it('сначала стол, потом тумбочка, потом кровать — в средней части рамки; детерминированно', () => {
    const table = prop('p_obsh_table', 0.2, 0.2, 1.2, 0.8, 0.75, 'table');
    const bed = prop('p_obsh_bed', 2, 0.5, 2.9, 2.5, 0.5, 'bed');
    const stand = prop('p_obsh_nightstand', 1.6, 0.2, 1.9, 0.5, 0.55);
    const a = notePlace(room([bed, stand, table]), [d]);
    expect(a.on).toBe('table');
    expect(a.h).toBe(0.75);
    expect(a.x).toBeGreaterThanOrEqual(0.2 + 0.3 * 1.0 - 1e-9);
    expect(a.x).toBeLessThanOrEqual(1.2 - 0.3 * 1.0 + 1e-9);
    expect(a.y).toBeGreaterThan(0.2);
    expect(a.y).toBeLessThan(0.8);
    expect(notePlace(room([bed, stand, table]), [d])).toEqual(a);
    expect(notePlace(room([bed, stand]), [d]).on).toBe('nightstand');
    expect(notePlace(room([bed]), [d]).on).toBe('bed');
  });

  it('без мебели — на полу в 1.25 м от входа внутрь комнаты (нормаль двери — в коридор)', () => {
    const p = notePlace(room([prop('p_obsh_wardrobe', 0, 0, 0.6, 1, 1.9)]), [d]);
    expect(p.on).toBe('floor');
    expect(p.h).toBe(0);
    expect(p.y).toBeLessThan(4 - 1.25 + 0.16);
    expect(p.y).toBeGreaterThan(4 - 1.25 - 0.16);
    expect(notePlace(room([]), []).on).toBe('floor');
  });

  it('взгляд: рядом и лицом — да; спиной, далеко — нет; прямо под ногами — да', () => {
    const eye = { x: 0, y: 1.6, z: 0 };
    const note = { x: 0, y: 0.78, z: 0.9 };
    const len = Math.hypot(0, -0.82, 0.9);
    expect(noteAimed(eye, { x: 0, y: -0.82 / len, z: 0.9 / len }, note)).toBe(true);
    expect(noteAimed(eye, { x: 0, y: 0, z: -1 }, note)).toBe(false);
    expect(noteAimed(eye, { x: 0, y: -0.6, z: 0.8 }, { x: 0, y: 0.78, z: 2.5 })).toBe(false);
    expect(noteAimed(eye, { x: 1, y: 0, z: 0 }, { x: 0.2, y: 0.5, z: 0.1 })).toBe(true);
  });

  it('текст: приписка «другой рукой» — отдельно', () => {
    expect(noteParts('Кто найдёт — иди в 741213.')).toEqual({ main: 'Кто найдёт — иди в 741213.', alt: null });
    expect(noteParts('741213 — НЕ ТРОГАТЬ, это для комиссии. (ниже другой рукой:) комиссии не будет.')).toEqual({
      main: '741213 — НЕ ТРОГАТЬ, это для комиссии.', alt: 'комиссии не будет.',
    });
  });
});
