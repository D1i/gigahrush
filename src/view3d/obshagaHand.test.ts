// Рука общаги (./obshagaHand.ts): ось из следа, куски по комнатам, профиль сечения, пальцы, кожа — чистые функции;
// и HandMesh на NullEngine, ведомый настоящей механикой (src/locations/obshaga.ts).
import { describe, expect, it } from 'vitest';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine';
import { Scene } from '@babylonjs/core/scene';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { VertexBuffer } from '@babylonjs/core/Buffers/buffer';
import { createHand, handView, stepHand, type HandInput, type HandState, type Pt } from '../locations/obshaga';
import {
  HAND, HandMesh, armLook, armSection, crawlGait, fingerDefs, planAt, projectArc, roomRuns, skinTexels, solveFinger, spineSamples, trailArcs,
  type ArmSection, type RoomRun, type SpinePt,
} from './obshagaHand';
import { PORTAL_LAYER } from './portal';

const DIMS = { corridorW: 2, ceilH: 2.5, doorW: 0.8, doorH: 2.05 };
const sec = (): ArmSection => ({ w: 0, h: 0, bottom: 0, pinch: 0, crease: 0, knob: 0, far: 0, tendon: 0 });

/** След как у механики: точка за дверью, дальше через 0.25 м по ломаной. */
function trailAlong(pts: [number, number][], rooms: (i: number) => string | undefined): Pt[] {
  const out: Pt[] = [{ x: pts[0][0], y: pts[0][1], room: rooms(0) }];
  for (let k = 1; k < pts.length; k++) {
    const [ax, ay] = pts[k - 1], [bx, by] = pts[k];
    const L = Math.hypot(bx - ax, by - ay);
    for (let s = 0.25; s <= L + 1e-9; s += 0.25) out.push({ x: ax + ((bx - ax) * s) / L, y: ay + ((by - ay) * s) / L, room: rooms(out.length) });
  }
  return out;
}

describe('ось руки', () => {
  it('прореживание: точки через 0.4 м пути от двери, за дверью — продолжение вглубь комнаты; прежние точки не сдвигаются', () => {
    const trail = trailAlong([[0, 2], [0, 0], [6, 0]], (i) => (i === 0 ? 'room' : 'c'));
    const arcs: number[] = [];
    const L = trailArcs(trail, arcs);
    expect(L).toBeCloseTo(8, 6);
    const out: SpinePt[] = [];
    const n = spineSamples(trail, arcs, 0, 1, 0.4, 3.2, L - 2.2, out);
    expect(out[0].s).toBeCloseTo(-3.2, 9);
    expect(out[n - 1].s).toBeLessThanOrEqual(L - 2.2 + 1e-9);
    for (let i = 1; i < n; i++) expect(out[i].s - out[i - 1].s).toBeCloseTo(0.4, 9);
    // за дверью — по back (вглубь комнаты, +y), с комнатой trail[0]
    expect(out[0].x).toBeCloseTo(0, 9);
    expect(out[0].y).toBeCloseTo(2 + 3.2, 9);
    expect(out[0].room).toBe('room');
    // на следе: s = 3 → (1, 0), комната — конца отрезка
    const k = out.findIndex((p) => Math.abs(p.s - 2.8) < 1e-9);
    expect(out[k].x).toBeCloseTo(0.8, 9);
    expect(out[k].y).toBeCloseTo(0, 9);
    expect(out[k].room).toBe('c');
    // рука выросла — прежние точки те же (кэш мировых координат)
    const longer = trailAlong([[0, 2], [0, 0], [9, 0]], (i) => (i === 0 ? 'room' : 'c'));
    const arcs2: number[] = [];
    const out2: SpinePt[] = [];
    spineSamples(longer, arcs2, 0, 1, 0.4, 3.2, trailArcs(longer, arcs2) - 2.2, out2);
    for (let i = 0; i < n; i++) {
      expect(out2[i].x).toBe(out[i].x);
      expect(out2[i].y).toBe(out[i].y);
      expect(out2[i].room).toBe(out[i].room);
    }
  });

  it('проём на пути: на следе — точно; впереди кончика (рука не доросла) — дальше длины', () => {
    const trail = trailAlong([[0, 2], [0, 0], [6, 0]], () => 'c');
    const arcs: number[] = [];
    trailArcs(trail, arcs);
    expect(projectArc(trail, arcs, { x: 0, y: 1 })).toBeCloseTo(1, 9);
    const short = trailAlong([[0, 2], [0, 1.5]], () => 'c');
    const a2: number[] = [];
    trailArcs(short, a2);
    expect(projectArc(short, a2, { x: 0, y: 1 })).toBeCloseTo(1, 9);
    expect(Number.isNaN(projectArc([{ x: 0, y: 2 }, { x: 0, y: 2 }], [0, 0], { x: 0, y: 1 }))).toBe(true);
    const p = { x: 0, y: 0 };
    planAt(trail, arcs, 0, 1, -1, p);
    expect(p).toEqual({ x: 0, y: 3 });
    planAt(trail, arcs, 0, 1, 4, p);
    expect(p.x).toBeCloseTo(2, 9);
  });

  it('куски по комнатам: непрерывные участки, с заходом в соседей', () => {
    const out: RoomRun[] = [];
    const n = roomRuns(['a', 'a', 'a', 'b', 'b', 'c'], 6, 1, out);
    expect(n).toBe(3);
    expect(out.slice(0, n)).toEqual([
      { room: 'a', from: 0, to: 2, a: 0, b: 3 },
      { room: 'b', from: 3, to: 4, a: 2, b: 5 },
      { room: 'c', from: 5, to: 5, a: 4, b: 5 },
    ]);
  });
});

describe('сечение руки', () => {
  const look = armLook(1);
  it('у кисти — предплечье ~1.75 × 1.9 на полу; дальше — до потолка, но не выше его', () => {
    const s = armSection(4.6, 20, look, DIMS, sec());
    expect(s.w).toBeGreaterThan(1.6);
    expect(s.w).toBeLessThan(1.95);
    expect(s.h).toBeGreaterThan(1.7);
    expect(s.h).toBeLessThan(2.1);
    expect(s.bottom).toBeCloseTo(HAND.floorGap, 2);
    for (let d = 6; d < 45; d += 0.37) {
      const u = armSection(d, 30, look, DIMS, sec());
      expect(u.w).toBeLessThanOrEqual(DIMS.corridorW - 0.08 + 1e-9);
      expect(u.bottom + u.h).toBeLessThanOrEqual(DIMS.ceilH - 0.12 + 1e-9);
      expect(u.h).toBeGreaterThan(1.95);
    }
  });

  it('проём: сжата косяками (уже двери, не выше её), у двери тоньше (~1.2), запястье уже и приподнято', () => {
    const p = armSection(10, 0, look, DIMS, sec());
    expect(p.pinch).toBe(1);
    expect(p.w).toBeLessThanOrEqual(DIMS.doorW - 0.08 + 1e-9);
    expect(p.bottom + p.h).toBeLessThanOrEqual(DIMS.doorH);
    const near = armSection(10, 0.45, look, DIMS, sec());
    expect(near.w).toBeGreaterThan(1.05);
    expect(near.w).toBeLessThan(1.45);
    const wrist = armSection(HAND.wristD, 20, look, DIMS, sec());
    expect(wrist.w).toBeLessThan(1.5);
    expect(wrist.bottom).toBeGreaterThan(0.25);
  });
});

describe('пальцы', () => {
  it('Ньютон доводит кончик до цели по всему шагу (кончик на полу и спереди, и сзади); палец выгнут вверх', () => {
    for (let variant = 0; variant < 1; variant += 0.0731) {
      for (const [i, fd] of fingerDefs(variant, 2).fingers.entries()) {
        const ik = { a: NaN, b: NaN };
        for (let k = 0; k <= 1.0001; k += 0.05) {
          // как в HandMesh.buildHand: плоскость пальца — от основания к цели (вперёд и вбок)
          const u = Math.hypot(fd.front - k * (fd.front - fd.back) - fd.bf, fd.tl - fd.bl);
          const v = fd.r1 + 0.05 - fd.by;
          const err = solveFinger(fd.lens, fd.wts, u, v, ik);
          expect(err, `вариант ${variant.toFixed(2)}, палец ${i}, k ${k.toFixed(2)}`).toBeLessThan(2e-3);
          expect(ik.a).toBeGreaterThan(Math.atan2(v, u) - 1e-6);
        }
      }
    }
  });

  it('перебор: опорный палец неподвижен в мире (кончик уходит назад ровно на путь кисти), потом перенос вперёд', () => {
    const g = { k: 0, lift: 0 };
    for (const fd of fingerDefs(0.3, 2).fingers) {
      const tipF = (crawl: number) => fd.front - crawlGait(crawl / HAND.crawlCycle, g, fd.stance).k * (fd.front - fd.back);
      for (let c = 0.05; c < fd.stance * HAND.crawlCycle - 0.06; c += 0.05) {
        // кисть сдвинулась на 0.05 м — кончик относительно кисти на 0.05 м назад
        expect(tipF(c + 0.05) - tipF(c)).toBeCloseTo(-0.05, 9);
        expect(g.lift).toBe(0);
      }
      crawlGait((fd.stance + 1) / 2, g, fd.stance);
      expect(g.lift).toBeGreaterThan(0.99);
    }
  });

  it('кончики крайних пальцев — у стен, не в них; левая рука — зеркальна', () => {
    let left = 0, right = 0;
    for (let v = 0; v < 1; v += 0.037) {
      const d = fingerDefs(v, 2);
      for (const f of d.fingers) expect(Math.abs(f.tl)).toBeLessThanOrEqual(1 - f.r1 - 0.05 + 1e-9);
      const thumb = d.fingers[4];
      expect(Math.sign(thumb.bl)).toBe(d.right ? 1 : -1);
      if (d.right) right++;
      else left++;
    }
    expect(left).toBeGreaterThan(0);
    expect(right).toBeGreaterThan(0);
  });
});

describe('кожа', () => {
  it('бледная серо-жёлтая (#B9B2A0) с вариациями, бесшовна по краям, детерминирована', () => {
    const S = 64;
    const a = skinTexels(S, 3), b = skinTexels(S, 3);
    expect(a.color).toEqual(b.color);
    let r = 0, g = 0, bl = 0, lo = 255, hi = 0;
    for (let i = 0; i < S * S; i++) {
      r += a.color[i * 4];
      g += a.color[i * 4 + 1];
      bl += a.color[i * 4 + 2];
      lo = Math.min(lo, a.color[i * 4]);
      hi = Math.max(hi, a.color[i * 4]);
    }
    r /= S * S;
    g /= S * S;
    bl /= S * S;
    expect(Math.abs(r - 0xb9)).toBeLessThan(25);
    expect(Math.abs(g - 0xb2)).toBeLessThan(25);
    expect(Math.abs(bl - 0xa0)).toBeLessThan(25);
    expect(hi - lo).toBeGreaterThan(30);
    // шов: соседние через край текселы различаются не больше, чем соседние внутри
    let edge = 0, inner = 0;
    for (let y = 0; y < S; y++) {
      edge += Math.abs(a.color[(y * S + S - 1) * 4] - a.color[y * S * 4]);
      inner += Math.abs(a.color[(y * S + S / 2) * 4] - a.color[(y * S + S / 2 - 1) * 4]);
    }
    expect(edge).toBeLessThan(inner * 2.5 + S * 2);
    // нормали — в основном «вверх» (z > 0.5)
    let up = 0;
    for (let i = 0; i < S * S; i++) if (a.normal[i * 4 + 2] > 191) up++;
    expect(up / (S * S)).toBeGreaterThan(0.9);
  });
});

// ── HandMesh на NullEngine ──

const toWorld = (p: Pt) => new Vector3(p.x, 0, -p.y);
const DOORWAY: Pt = { x: 2, y: 1, room: 'c' };

function run(h: HandState, input: HandInput, mesh: HandMesh, until: (h: HandState) => boolean, t0 = 0, max = 4000): number {
  let t = t0;
  for (let i = 0; i < max && !until(h); i++) {
    stepHand(h, 1 / 30, input);
    t += 1 / 30;
    mesh.update(handView(h), toWorld, t, DOORWAY);
  }
  return t;
}

describe('HandMesh', () => {
  it('рука из двери по коридору: куски по комнатам (слой порталов), кисть, коллайдеры; < 20 тыс. вершин на 45 м', () => {
    const engine = new NullEngine();
    const scene = new Scene(engine);
    const mesh = new HandMesh(scene, { corridorW: 2, ceilH: 2.5 });
    const h = createHand('t1', { x: 2, y: 2.2, room: 'room' }, { x: 2, y: 0, room: 'c' });
    const input: HandInput = { lightsOn: false, seen: false, goal: { x: 10, y: 0, room: 'c' }, players: [], lanterns: [], playerSpeed: 3 };
    run(h, input, mesh, (s) => s.phase === 'stalking' && s.tip.x >= 10 - 1e-6);
    const rooms = mesh.byRoom();
    expect([...rooms.keys()].sort()).toEqual(['c', 'room']);
    for (const list of rooms.values()) for (const m of list) {
      expect(m.layerMask).toBe(PORTAL_LAYER);
      expect(m.isEnabled()).toBe(true);
      expect(m.getTotalVertices()).toBeGreaterThan(0);
    }
    // кисть — и в комнате кончика
    const hand = rooms.get('c')!.find((m) => m.name === 'obshaga:hand');
    expect(hand).toBeTruthy();
    const cols = mesh.colliders();
    let nCol = 0;
    for (const list of cols.values()) for (const b of list) {
      nCol++;
      expect(b.checkCollisions).toBe(true);
      expect(b.isVisible).toBe(false);
    }
    expect(nCol).toBeGreaterThan(4);
    // коридор перекрыт: коробки у кончика шире 1.5 м
    const near = cols.get('c')!.filter((b) => Math.abs(b.position.x - 6) < 2);
    expect(near.some((b) => b.scaling.x > 1.5)).toBe(true);

    // до упора — 45 м: вершин меньше 20 тыс.
    input.goal = { x: 80, y: 0, room: 'c' };
    const t0 = performance.now();
    let frames = 0;
    run(h, input, mesh, (s) => {
      frames++;
      return handView(s).length >= 44.99;
    });
    const per = (performance.now() - t0) / frames;
    const st = mesh.stats();
    expect(st.arm + st.hand).toBeLessThan(20000);
    expect(per).toBeLessThan(15);
    console.log(`рука 45 м: ${st.arm} + ${st.hand} вершин, ${st.meshes} мешей, ${st.colliders} коллайдеров; кадр в движении ~${per.toFixed(2)} мс`);
    mesh.dispose();
    scene.dispose();
    engine.dispose();
  });

  it('замершая — ни одной записи в буферы и ни одного вызова toWorld; невидимая — пустые карты, меши выключены', () => {
    const engine = new NullEngine();
    const scene = new Scene(engine);
    const mesh = new HandMesh(scene, { layerMask: 1 });
    const h = createHand('t2', { x: 2, y: 2.2, room: 'room' }, { x: 2, y: 0, room: 'c' });
    const input: HandInput = { lightsOn: false, seen: false, goal: { x: 7, y: 0, room: 'c' }, players: [], lanterns: [], playerSpeed: 3 };
    const t = run(h, input, mesh, (s) => s.phase === 'stalking' && s.tip.x >= 7 - 1e-6);
    input.seen = true;
    stepHand(h, 1 / 30, input);
    const v = handView(h);
    expect(v.frozen).toBe(true);
    mesh.update(v, toWorld, t + 0.1, DOORWAY);
    const hand = [...mesh.byRoom().get('c')!].find((m) => m.name === 'obshaga:hand')!;
    const before = Float32Array.from(hand.getVerticesData(VertexBuffer.PositionKind)!);
    let calls = 0, writes = 0;
    const counting = (p: Pt) => {
      calls++;
      return toWorld(p);
    };
    const all = [...mesh.byRoom().values()].flat();
    for (const m of all) {
      const orig = m.updateVerticesData.bind(m);
      m.updateVerticesData = ((...a: Parameters<typeof orig>) => {
        writes++;
        return orig(...a);
      }) as typeof m.updateVerticesData;
    }
    for (let k = 1; k <= 20; k++) {
      stepHand(h, 1 / 30, input);
      mesh.update(handView(h), counting, t + 0.1 + k / 30, DOORWAY);
    }
    expect(calls).toBe(0);
    expect(writes).toBe(0);
    expect(Float32Array.from(hand.getVerticesData(VertexBuffer.PositionKind)!)).toEqual(before);

    // не видят и стоит — пальцы подёргиваются (кисть пересчитывается), труба руки — нет
    input.seen = false;
    input.goal = null;
    for (let k = 1; k <= 30; k++) {
      stepHand(h, 1 / 30, input);
      mesh.update(handView(h), counting, t + 2 + k / 30, DOORWAY);
    }
    expect(writes).toBeGreaterThan(0);

    // свет — рука исчезла
    input.lightsOn = true;
    stepHand(h, 1 / 30, input);
    mesh.update(handView(h), toWorld, t + 5, DOORWAY);
    expect(mesh.byRoom().size).toBe(0);
    expect(mesh.colliders().size).toBe(0);
    for (const m of all) expect(m.isEnabled()).toBe(false);
    mesh.dispose();
    scene.dispose();
    engine.dispose();
  });

  it('хватает: кулак — полость перед кистью на уровне пояса; отпустила/исчезла — null', () => {
    const engine = new NullEngine();
    const scene = new Scene(engine);
    const mesh = new HandMesh(scene);
    const h = createHand('t3', { x: 2, y: 2.2, room: 'room' }, { x: 2, y: 0, room: 'c' });
    const input: HandInput = { lightsOn: false, seen: false, goal: { x: 8, y: 0, room: 'c' }, players: [], lanterns: [], playerSpeed: 3 };
    let t = run(h, input, mesh, (s) => s.phase === 'stalking' && s.tip.x >= 8 - 1e-6);
    expect(mesh.fistCenter()).toBeNull();
    input.players = [{ id: 'p', p: { x: 9, y: 0, room: 'c' }, protected: false, sees: false }];
    t = run(h, input, mesh, (s) => s.phase === 'grabbing', t);
    t = run(h, input, mesh, () => false, t, 8);
    const fc = mesh.fistCenter();
    expect(fc).not.toBeNull();
    const tip = toWorld(h.tip);
    // перед кистью (по ходу — к +x), на уровне пояса
    expect(fc!.x - tip.x).toBeGreaterThan(0.2);
    expect(fc!.y).toBeGreaterThan(0.5);
    expect(fc!.y).toBeLessThan(1.5);
    mesh.update(null, toWorld, t + 1);
    expect(mesh.fistCenter()).toBeNull();
    mesh.dispose();
    scene.dispose();
    engine.dispose();
  });
});
