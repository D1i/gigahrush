// Двери (docs/DOORS.md): каталог и выбор, модели, слоты в ядре (закрытый и открытый выход — один слот: бесшовность),
// куски портального рендера, адаптер Babylon.
import { describe, expect, it } from 'vitest';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine';
import { Scene } from '@babylonjs/core/scene';
import { TAG_LEN } from '../data/roomBuilder';
import { buildBabylonBlockout, poseDoor } from './babylon';
import { buildBlockoutModel } from './core';
import {
  DOOR_CAS_GAP, DOOR_GAP, DOOR_OV, DOOR_STYLE_BY_ID, DOOR_STYLES, chooseHinge, doorFlip, doorGeometry, doorStyleFor, leafHere, leafWidth, restAngle,
  type DoorPart,
} from './doors';
import { buildPiece } from './pieces';
import type { BlockoutOptions, DoorSlot, RunConnector, RunExport, RunInstance, Side } from './types';

// ───────────────────────── каталог и выбор ─────────────────────────

describe('каталог дверей', () => {
  it('id уникальны, замены закрытых — есть и не сквозные', () => {
    expect(new Set(DOOR_STYLES.map((s) => s.id)).size).toBe(DOOR_STYLES.length);
    for (const s of DOOR_STYLES) {
      if (s.seeThrough) {
        const alt = DOOR_STYLE_BY_ID.get(s.closedAlt ?? '');
        expect(alt, s.id).toBeTruthy();
        expect(alt!.seeThrough).toBeFalsy();
      }
      expect(s.colors.length).toBeGreaterThan(0);
      expect(s.rest).toBeGreaterThanOrEqual(60);
      expect(s.rest).toBeLessThanOrEqual(110);
    }
  });

  it('у пары направленных меток полотно ровно с одной стороны; у каждой метки комнат есть закрытая дверь', () => {
    for (const tag of Object.keys(TAG_LEN)) {
      const closed = doorStyleFor(tag, [], true, 'x/' + tag);
      expect(closed, tag).toBeTruthy();
      expect(closed!.seeThrough, tag).toBeFalsy();
      if (!tag.includes('>')) continue;
      const [a, b] = tag.split('>');
      expect(leafHere(tag) !== leafHere(`${b}>${a}`), tag).toBe(true);
      expect(doorFlip(tag)).toBe(!leafHere(tag));
    }
  });

  it('проходы (ходы, марши, секции коридора) — без двери, закрытые — дверь локации', () => {
    for (const tag of ['basement', 'barn', 'stair', 'corridor']) expect(doorStyleFor(tag, [], false, 'a/b'), tag).toBeNull();
    expect(doorStyleFor('basement', ['прихожая'], true, 'a/b')?.id).toBe('basement_metal');
    expect(doorStyleFor('stair', ['подвал', 'хаб'], true, 'a/b')?.id).toBe('basement_metal');
    expect(doorStyleFor('stair', ['сарай', 'хаб'], true, 'a/b')?.id).toBe('barn_plank');
    expect(doorStyleFor('stair', ['лестница'], true, 'a/b')?.id).toBe('tambour');
    expect(doorStyleFor('storage>basement', ['кладовка', 'подвал'], false, 'a/b')?.id).toBe('storage_lattice');
    expect(doorStyleFor('storage>basement', ['кладовка', 'подвал'], true, 'a/b')?.id).toBe('basement_metal');
    expect(doorStyleFor('hall>kitchen', ['прихожая'], false, 'a/b')?.id).toBe('int_do');
    // особые биомы — свои закрытые двери
    expect(doorStyleFor('hall>room', ['снег'], true, 'a/b')?.id).toBe('snow_iced');
    expect(doorStyleFor('corridor', ['завод'], true, 'a/b')?.id).toBe('factory_hermetic');
    // проход цеха: открытый — без двери, закрытый — ворота
    expect(doorStyleFor('factory', ['завод'], false, 'a/b')).toBeNull();
    expect(doorStyleFor('factory', ['завод'], true, 'a/b')?.id).toBe('factory_gate');
    expect(doorStyleFor('stair', ['погреб'], true, 'a/b')?.id).toBe('cellar_low');
  });

  it('вариант и петли — детерминированы по месту; петли — со стороны, где есть стена', () => {
    expect(doorStyleFor('apt>landing', [], true, 'i7/c2')).toBe(doorStyleFor('apt>landing', [], true, 'i7/c2'));
    const ids = new Set(Array.from({ length: 60 }, (_, i) => doorStyleFor('apt>landing', [], true, `i${i}/c`)!.id));
    expect(ids.size).toBeGreaterThan(1);
    expect(chooseHinge('a/b', [0, 1.5])).toBe('right');
    expect(chooseHinge('a/b', [1.5, 0])).toBe('left');
    expect(chooseHinge('a/b', [1, 1])).toBe(chooseHinge('a/b', null));
  });

  it('угол покоя: 60…110°, у стены вплотную к петлям — не больше 90°', () => {
    for (const s of DOOR_STYLES) {
      for (let i = 0; i < 20; i++) {
        const a = restAngle(s, `s${i}`, 0.9, 1.5);
        expect(a).toBeGreaterThanOrEqual(60);
        expect(a).toBeLessThanOrEqual(110);
        expect(restAngle(s, `s${i}`, 0.9, 0)).toBeLessThanOrEqual(90);
      }
    }
  });
});

// ───────────────────────── модели ─────────────────────────

/** Боксы полотна в координатах двери при закрытом полотне (угол 0). */
const leafInDoor = (parts: DoorPart[], axis: [number, number], y0: number): DoorPart[] =>
  parts.map((p) => ({ ...p, c: [p.c[0] + axis[0], p.c[1] + y0, p.c[2] + axis[1]] }));
/** Габарит бокса по оси (с поворотом rz в плоскости двери). */
const ext = (p: DoorPart, ax: 0 | 1 | 2): [number, number] => {
  if (ax === 2 || !p.rz) return [p.c[ax] - p.s[ax] / 2, p.c[ax] + p.s[ax] / 2];
  const c = Math.abs(Math.cos(p.rz)), s = Math.abs(Math.sin(p.rz));
  const h = ax === 0 ? (p.s[0] * c + p.s[1] * s) / 2 : (p.s[0] * s + p.s[1] * c) / 2;
  return [p.c[ax] - h, p.c[ax] + h];
};

describe('модели дверей', () => {
  const widths = [0.5, 0.7, 0.9, 1.1, 1.3];
  it('каждая дверь строится; закрытое полотно перекрывает проём с запасом; ничто не заходит дальше середины стены', () => {
    for (const style of DOOR_STYLES) {
      for (const W of style.id === 'factory_gate' ? [2.4, 3.0] : widths) {
        for (const hinge of ['left', 'right'] as const) {
          for (const role of ['exit', 'dead'] as const) {
            const H = 2.1;
            const g = doorGeometry({ style, widthM: W, heightM: H, hinge, role, leaf: true, seed: `${style.id}/${W}/${hinge}` });
            expect(g.leaves.length, style.id).toBe(style.leaves);
            const all = [...g.frame];
            let x0 = Infinity, x1 = -Infinity, top = 0, bottom = Infinity;
            for (const lf of g.leaves) {
              expect(Math.abs(lf.axis[0])).toBeCloseTo(W / 2 + DOOR_OV, 9);
              expect(lf.axis[1]).toBeCloseTo(-(DOOR_GAP + style.thick), 9);
              expect(lf.width).toBeCloseTo(leafWidth(style, W), 9);
              const body = leafInDoor(lf.parts, lf.axis, lf.y0);
              all.push(...body);
              if (lf.handle) all.push(...leafInDoor(lf.handle.parts.map((p) => ({ ...p, c: [p.c[0] + lf.handle!.pivot[0], p.c[1] + lf.handle!.pivot[1], p.c[2] + lf.handle!.pivot[2]] as [number, number, number] })), lf.axis, lf.y0));
              // тело полотна (сплошная часть у грани) — от петель на ширину полотна
              const sx = lf.hinge === 'left' ? 1 : -1;
              x0 = Math.min(x0, lf.axis[0], lf.axis[0] + sx * lf.width);
              x1 = Math.max(x1, lf.axis[0], lf.axis[0] + sx * lf.width);
              top = Math.max(top, lf.y0 + lf.height);
              bottom = Math.min(bottom, lf.y0);
            }
            for (const p of all) {
              for (const v of [...p.c, ...p.s]) expect(Number.isFinite(v), style.id).toBe(true);
              expect(p.s.every((v) => v > 0), style.id).toBe(true);
              expect(/^#[0-9a-f]{6}$/.test(p.color), `${style.id} ${p.color}`).toBe(true);
              // за грань стены — не дальше середины стены 0.1 м (портальная плоскость)
              expect(ext(p, 2)[1], style.id).toBeLessThanOrEqual(0.05);
            }
            // полотно закрывает проём по ширине; по высоте — до верха проёма (над низкой дверью — заполнение)
            expect(x0).toBeLessThanOrEqual(-W / 2);
            expect(x1).toBeGreaterThanOrEqual(W / 2);
            if (style.leafH) expect(top).toBeLessThan(H);
            else expect(top).toBeGreaterThanOrEqual(H);
            if (bottom > 0) {
              // гермодверь: под полотном комингс перед проёмом
              const sill = g.frame.find((p) => ext(p, 1)[0] <= 0 && ext(p, 1)[1] >= bottom - 0.005 && ext(p, 0)[0] <= -W / 2);
              expect(sill, style.id).toBeTruthy();
            }
            if (style.leafH) {
              // заполнение над низкой дверью закрывает проём до верха
              const fill = g.frame.filter((p) => ext(p, 1)[0] >= top - 1e-6 && ext(p, 0)[0] <= -W / 2 && ext(p, 0)[1] >= W / 2);
              expect(Math.max(...fill.map((p) => ext(p, 1)[1]))).toBeGreaterThanOrEqual(H);
            }
            // заколоченная — доски перед полотном (самозакрывающаяся общаги заперта без досок: её распахивает рука;
            // metro: глухая стена с панно — не дверь, без досок; catacombs: закладка и решётка лаза — тоже)
            if (role === 'dead') expect(g.frame.some((p) => p.rz && p.s[0] > W), style.id).toBe(!style.selfClosing && style.look !== 'blind' && style.look !== 'bricked' && style.look !== 'grate');
          }
        }
      }
    }
  });

  it('наличник обрезается стеной до угла; без полотна — только наличник', () => {
    const st = DOOR_STYLE_BY_ID.get('int_dg')!;
    const free = doorGeometry({ style: st, widthM: 0.9, heightM: 2.1, hinge: 'left', role: 'open', leaf: false, seed: 's' });
    expect(free.leaves.length).toBe(0);
    const left = (g: typeof free) => Math.min(...g.frame.map((p) => ext(p, 0)[0]));
    expect(left(free)).toBeCloseTo(-0.45 - DOOR_CAS_GAP - st.casing!.w, 6);
    const cut = doorGeometry({ style: st, widthM: 0.9, heightM: 2.1, hinge: 'left', role: 'open', leaf: false, seed: 's', space: [0.03, 1] });
    expect(left(cut)).toBeGreaterThanOrEqual(-0.45 - 0.03 - 1e-9);
  });

  it('полотно с «чужой» стороны пары — стороны меняются (номер квартиры смотрит на площадку)', () => {
    const st = DOOR_STYLE_BY_ID.get('apt_dermantin')!;
    const plate = (tag: string) => {
      const lf = doorGeometry({ style: st, widthM: 1, heightM: 2.1, hinge: 'left', role: 'exit', leaf: true, seed: 's', tag }).leaves[0];
      // латунная табличка номера — на высоте 1.72
      return lf.parts.find((p) => Math.abs(p.c[1] - 1.72) < 1e-6 && p.color === '#b39257')!;
    };
    expect(plate('apt>landing').c[2]).toBeGreaterThan(st.thick); // в прихожей — номер с обратной стороны
    expect(plate('landing>apt').c[2]).toBeLessThan(0); // на площадке — номер к игроку
  });
});

// ───────────────────────── слоты в ядре ─────────────────────────

const rows = (x0: number, y0: number, w: number, h: number): string[] => Array.from({ length: h }, (_, j) => `${y0 + j}:${x0}-${x0 + w - 1}`);
const segLine = (side: Side, cx: number, cy: number, len: number): [number, number, number, number] =>
  side === 'N' ? [cx, cy, cx + len, cy] : side === 'S' ? [cx, cy + 1, cx + len, cy + 1] : side === 'W' ? [cx, cy, cx, cy + len] : [cx + 1, cy, cx + 1, cy + len];
const conn = (id: string, side: Side, cx: number, cy: number, len: number, tag: string, extra: Partial<RunConnector> = {}): RunConnector =>
  ({ id, cx, cy, side, len, tag, name: id, line: segLine(side, cx, cy, len), linkedTo: null, ...extra }) as RunConnector;
const inst = (id: string, x0: number, w: number, h: number, connectors: RunConnector[], tags: string[] = []): RunInstance => ({
  id, roomId: 'r_' + id, roomName: id, roomTags: tags, rot: 0, dx: 0, dy: 0, depth: 0, parent: null,
  bbox: { x0, y0: 0, x1: x0 + w, y1: h }, cells: rows(x0, 0, w, h), doors: [], connectors, decor: [], spots: [], tier: null, danger: 0, dangerAcc: 0, loot: [],
});
const runOf = (instances: RunInstance[], links: RunExport['links'] = []): RunExport => ({
  format: 'room-forge-run', version: 1, seed: 't', cellM: 0.1, settings: { gap: 1 }, props: [], items: [], instances, links, openConnectors: [],
});
const OPTS: Partial<BlockoutOptions> = { doors: true, deadEnds: 'wall' };
const slotOf = (doors: DoorSlot[] | undefined, inst: string, c: string) => doors?.find((d) => d.inst === inst && d.connector === c);

/** Прихожая A (3×4 м) с выходом на восток (apt>landing), площадка B за стеной 0.1 м. */
function scene(state: 'exit' | 'opened' | 'linked' | 'dead' | 'cut' | 'arrival', cy = 10) {
  const extra: Partial<RunConnector> = state === 'exit' ? { exit: true } : state === 'opened' ? { opened: true } : state === 'cut' ? { cut: true } : state === 'arrival' ? { arrival: true } : {};
  const a = inst('A', 0, 30, 40, [conn('ca', 'E', 29, cy, 10, 'apt>landing', extra)], ['прихожая']);
  const linked = state === 'opened' || state === 'linked';
  const b = inst('B', 31, 30, 40, [conn('cb', 'W', 31, cy, 10, 'landing>apt')], ['лестница']);
  const links = linked ? [{ a: { inst: 'A', connector: 'ca' }, b: { inst: 'B', connector: 'cb' } }] : [];
  return runOf(linked ? [a, b] : [a], links);
}

describe('слоты дверей в ядре', () => {
  it('без опции doors — модель как раньше (поля нет)', () => {
    expect(buildBlockoutModel(scene('exit'), { deadEnds: 'wall' }).doors).toBeUndefined();
  });

  it('закрытый выход и тот же выход, открытый игроком, — один слот: меняются только роль и угол', () => {
    const m0 = buildBlockoutModel(scene('exit'), OPTS);
    const m1 = buildBlockoutModel(scene('opened'), OPTS);
    const s0 = slotOf(m0.doors, 'A', 'ca')!, s1 = slotOf(m1.doors, 'A', 'ca')!;
    expect(s0.role).toBe('exit');
    expect(s0.leaf).toBe(true);
    expect(s0.angle).toBe(0);
    expect(s1.role).toBe('opened');
    const { role: _r0, angle: _a0, ...g0 } = s0;
    const { role: _r1, angle: a1, ...g1 } = s1;
    expect(g1).toEqual(g0);
    const st = DOOR_STYLE_BY_ID.get(s1.style)!;
    expect(a1).toBe(restAngle(st, s1.seed, s1.widthM, s1.hinge === 'left' ? s1.space[0] : s1.space[1]));
    // грань стены со стороны A: x = 3.0 м, нормаль — на запад (в комнату)
    expect(s0.line).toEqual([3, 1, 3, 2]);
    expect(s0.normal).toEqual([-1, 0]);
    expect(s0.widthM).toBeCloseTo(1, 9);
    expect(s0.heightM).toBeCloseTo(2.1, 9);
    // площадка: метка landing>apt — полотно у прихожей, у площадки только наличник
    const b = slotOf(m1.doors, 'B', 'cb')!;
    expect(b.role).toBe('open');
    expect(b.leaf).toBe(false);
  });

  it('связанный проход: полотно — по своей стороне пары, распахнуто', () => {
    const m = buildBlockoutModel(scene('linked'), OPTS);
    const a = slotOf(m.doors, 'A', 'ca')!;
    expect(a.role).toBe('open');
    expect(a.leaf).toBe(true);
    expect(a.angle).toBeGreaterThanOrEqual(60);
  });

  it('тупик: панель → заколоченная дверь, стена → двери нет; нераскрытая (cut, open) — проход; приход — закрыт', () => {
    expect(slotOf(buildBlockoutModel(scene('dead'), { doors: true, deadEnds: 'panel' }).doors, 'A', 'ca')?.role).toBe('dead');
    expect(slotOf(buildBlockoutModel(scene('dead'), OPTS).doors, 'A', 'ca')).toBeUndefined();
    expect(slotOf(buildBlockoutModel(scene('cut'), { doors: true, deadEnds: 'wall', cutEnds: 'open' }).doors, 'A', 'ca')?.role).toBe('open');
    // срезанная подпрогоном связь при панелях (башня слоёв: «дверь в другой слой») — панель, не дверь
    expect(slotOf(buildBlockoutModel(scene('cut'), { doors: true, deadEnds: 'panel', cutEnds: 'panel' }).doors, 'A', 'ca')).toBeUndefined();
    const ar = slotOf(buildBlockoutModel(scene('arrival'), OPTS).doors, 'A', 'ca')!;
    expect(ar.role).toBe('arrival');
    expect(ar.angle).toBe(0);
  });

  it('стена до угла: дверь в углу — петли с другой стороны', () => {
    // выход у самого северного угла восточной стены: слева (если смотреть из комнаты на восток) — север
    const m = buildBlockoutModel(scene('exit', 0), OPTS);
    const s = slotOf(m.doors, 'A', 'ca')!;
    expect(s.space[0]).toBe(0);
    expect(s.space[1]).toBeCloseTo(1.5, 9);
    expect(s.hinge).toBe('right');
  });

  it('куски портального рендера: у каждой комнаты — свои слоты, те же, что в модели целиком', () => {
    const run = scene('opened');
    const whole = buildBlockoutModel(run, { ...OPTS, ownership: true });
    for (const id of ['A', 'B']) {
      const p = buildPiece(run, id, OPTS);
      expect(p.doors?.every((d) => d.inst === id)).toBe(true);
      expect(p.doors).toEqual(whole.doors?.filter((d) => d.inst === id));
    }
  });
});

// ───────────────────────── адаптер Babylon ─────────────────────────

class FakeCanvas {
  constructor(public width: number, public height: number) {}
  getContext() {
    const store: Record<string | symbol, unknown> = {};
    return new Proxy(store, { get: (t, k) => (k in t ? t[k] : () => undefined), set: (t, k, v) => ((t[k] = v), true) });
  }
}
(globalThis as any).OffscreenCanvas ??= FakeCanvas;

describe('двери в Babylon', () => {
  it('закрытый выход — подвижное полотно с ручкой вместо панели; поза — из doorPose; poseDoor поворачивает', () => {
    const engine = new NullEngine();
    const sc = new Scene(engine);
    const model = buildBlockoutModel(scene('exit'), { ...OPTS });
    const bo = buildBabylonBlockout(sc, model, { finishes: false });
    expect(bo.deadEnds.length).toBe(0);
    expect(bo.doors.length).toBe(1);
    const dm = bo.doorLeaves.get('A/ca')!;
    expect(dm.leaves.length).toBe(1);
    const lf = dm.leaves[0];
    expect(lf.mesh.rotation.y).toBeCloseTo(lf.yaw, 9);
    poseDoor(dm, 90, 1);
    expect(lf.mesh.rotation.y).toBeCloseTo(lf.yaw + (lf.geo.sign * Math.PI) / 2, 9);
    if (lf.handle && lf.geo.handle?.kind === 'lever') expect(Math.abs(lf.handle.rotation.z)).toBeGreaterThan(0.5);
    bo.dispose();
    // кусок, построенный посреди анимации, — сразу в позе анимации
    const bo2 = buildBabylonBlockout(sc, model, { finishes: false, doorPose: () => ({ angle: 45, handle: 0.5 }) });
    const lf2 = bo2.doorLeaves.get('A/ca')!.leaves[0];
    expect(lf2.mesh.rotation.y).toBeCloseTo(lf2.yaw + (lf2.geo.sign * Math.PI) / 4, 9);
    // закрытое полотно — перед стеной: ось петель на грани (x = 3.0 м) минус зазор и толщина (в комнату — на запад)
    const st = DOOR_STYLE_BY_ID.get(bo2.doorLeaves.get('A/ca')!.slot.style)!;
    expect(lf2.mesh.position.x).toBeCloseTo(3 - DOOR_GAP - st.thick, 6);
    bo2.dispose();
    // без опции doors — панель, как раньше
    const bo3 = buildBabylonBlockout(sc, buildBlockoutModel(scene('exit'), { deadEnds: 'panel' }), { finishes: false });
    expect(bo3.deadEnds.length).toBe(1);
    expect(bo3.doors.length).toBe(0);
    bo3.dispose();
    sc.dispose();
    engine.dispose();
  });

  it('распахнутые полотна проходов — в общем меше (без отдельных мешей), коллизий у дверей нет', () => {
    const engine = new NullEngine();
    const sc = new Scene(engine);
    const bo = buildBabylonBlockout(sc, buildBlockoutModel(scene('linked'), OPTS), { finishes: false, collisions: true });
    expect(bo.doorLeaves.size).toBe(0);
    expect(bo.doors.length).toBe(1);
    expect(bo.doors[0].checkCollisions).toBe(false);
    bo.dispose();
    sc.dispose();
    engine.dispose();
  });
});
