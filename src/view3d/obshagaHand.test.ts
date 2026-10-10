// Рука общаги (./obshagaHand.ts): ось из следа, куски по комнатам, профиль сечения, пальцы, кожа — чистые функции;
// и HandMesh на NullEngine, ведомый настоящей механикой (src/locations/obshaga.ts).
import { describe, expect, it } from 'vitest';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine';
import { Scene } from '@babylonjs/core/scene';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { VertexBuffer } from '@babylonjs/core/Buffers/buffer';
import { createHand, handView, POKE_STAND, rectGap, stepHand, type HandInput, type HandState, type HandView, type Pt, type Rect } from '../locations/obshaga';
import {
  BED_LIFT, HAND, HandMesh, armLook, armSection, bedLift, crawlGait, fingerDefs, floorAngle, liftY, planAt, pokeBend, projectArc, rayRect, roomRuns,
  skinTexels, solveFinger, spineSamples, trailArcs, type ArmSection, type RoomRun, type SpinePt,
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

  it('тычок под кровать: два звена доходят до начала дальних фаланг, сустав — над прямой; не достаёт — по прямой', () => {
    const out = { a: 0, b: 0 };
    for (const [u, v] of [[0.7, -0.5], [1.2, -0.52], [0.05, -0.5], [0.4, -0.3]]) {
      pokeBend(0.54, 0.87, u, v, out);
      expect(0.54 * Math.cos(out.a) + 0.87 * Math.cos(out.b)).toBeCloseTo(u, 6);
      expect(0.54 * Math.sin(out.a) + 0.87 * Math.sin(out.b)).toBeCloseTo(v, 6);
      expect(out.a).toBeGreaterThan(Math.atan2(v, u));
    }
    pokeBend(0.54, 0.87, 3, -0.5, out);
    expect(out.a).toBeCloseTo(Math.atan2(-0.5, 3), 9);
    expect(out.b).toBeCloseTo(out.a, 9);
  });

  it('пол: фаланга выше пола не трогается; ниже — поднимается к горизонту в свою сторону (вперёд / назад), ветвь угла та же', () => {
    // конец и так не ниже — как есть (и через 2π)
    expect(floorAngle(-0.5, 0.6, 0.5, 0.1)).toBe(-0.5);
    expect(floorAngle(-0.5 - 2 * Math.PI, 0.6, 0.5, 0.1)).toBe(-0.5 - 2 * Math.PI);
    // вперёд-вниз в пол: ровно до высоты clr, вперёд
    let th = floorAngle(-1.2, 0.3, 0.5, 0.1);
    expect(0.3 + 0.5 * Math.sin(th)).toBeCloseTo(0.1, 9);
    expect(Math.cos(th)).toBeGreaterThan(0);
    // назад-вниз: к горизонту назад (конец остаётся сзади)
    th = floorAngle(-2.2, 0.3, 0.5, 0.1);
    expect(0.3 + 0.5 * Math.sin(th)).toBeCloseTo(0.1, 9);
    expect(Math.cos(th)).toBeLessThan(0);
    // та же ветвь: −2.2 − 2π → результат − 2π
    expect(floorAngle(-2.2 - 2 * Math.PI, 0.3, 0.5, 0.1)).toBeCloseTo(th - 2 * Math.PI, 9);
    // начало у самого пола — фаланга торчит вверх
    expect(floorAngle(-0.3, -0.6, 0.5, 0.1)).toBeCloseTo(Math.PI / 2, 9);
  });

  it('луч до прямоугольника плана: вход, изнутри — 0, мимо и назад — ∞', () => {
    const r = { x0: 2, y0: -1, x1: 3, y1: 1 };
    expect(rayRect(0, 0, 1, 0, r)).toBeCloseTo(2, 9);
    expect(rayRect(0, 0, 0.96, 0.28, r)).toBeCloseTo(2 / 0.96, 9);
    expect(rayRect(0, 0, Math.SQRT1_2, Math.SQRT1_2, r)).toBe(Infinity);
    expect(rayRect(2.5, 0, 1, 0, r)).toBe(0);
    expect(rayRect(0, 0, -1, 0, r)).toBe(Infinity);
    expect(rayRect(0, 2, 1, 0, r)).toBe(Infinity);
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

describe('кровати под рукой', () => {
  it('поле высот: в рамке — выше матраса, у торцов — выше спинок, снаружи — гладкий спуск к полу (без ступеней)', () => {
    expect(BED_LIFT.top).toBeGreaterThan(0.5);
    expect(BED_LIFT.board).toBeGreaterThan(0.95);
    for (const b of [{ x0: 3, y0: 0.85, x1: 4.9, y1: 1.65 }, { x0: -0.4, y0: 2, x1: 0.4, y1: 3.9 }]) {
      const h = (x: number, y: number) => bedLift(b.x0, b.y0, b.x1, b.y1, x, y);
      const cx = (b.x0 + b.x1) / 2, cy = (b.y0 + b.y1) / 2;
      const alongX = b.x1 - b.x0 > b.y1 - b.y0;
      expect(h(cx, cy)).toBe(BED_LIFT.top);
      // спинки — полосы у коротких сторон, во всю ширину кровати
      for (const s of [-1, 1]) for (const w of [-0.38, 0, 0.38]) {
        const x = alongX ? cx + s * ((b.x1 - b.x0) / 2 - 0.03) : cx + w;
        const y = alongX ? cy + w : cy + s * ((b.y1 - b.y0) / 2 - 0.03);
        expect(h(x, y)).toBe(BED_LIFT.board);
      }
      // от середины наружу по 1 см: в рамке не ниже матраса, дальше ramp — пол, перепад на сантиметр — не больше 5.5 см
      for (let a = 0; a < Math.PI * 2; a += 0.3) {
        const dx = Math.cos(a), dy = Math.sin(a);
        let prev = h(cx, cy);
        for (let s = 0.01; s < 2; s += 0.01) {
          const x = cx + dx * s, y = cy + dy * s;
          const v = h(x, y);
          expect(Math.abs(v - prev)).toBeLessThan(0.055);
          prev = v;
          const g = rectGap({ x, y }, b);
          if (g === 0) expect(v).toBeGreaterThanOrEqual(BED_LIFT.top);
          if (g >= BED_LIFT.ramp) expect(v).toBe(0);
        }
      }
    }
  });

  it('подъём по высоте: низ — целиком, к потолку — на нет; монотонно, не ниже поля', () => {
    const top = 2.42;
    for (const g of [0, 0.2, BED_LIFT.top, BED_LIFT.board]) {
      let prev = -Infinity;
      for (let y = 0; y <= 2.6; y += 0.005) {
        const v = liftY(y, g, top);
        expect(v).toBeGreaterThan(prev);
        prev = v;
        if (y <= BED_LIFT.lift) expect(v).toBeCloseTo(y + g, 9);
        if (y >= top) expect(v).toBe(y);
        else expect(v).toBeGreaterThanOrEqual(g);
      }
    }
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

  it('кровать известна: на подходе и в тычке ничего ниже пола и в плите кровати; над её рамкой — только указательный, ниже 0.2 м', { timeout: 60000 }, () => {
    // кровать x 9.5… (рамка план), игрок под ней; рука ползёт к нему из коридора, механика держит кончик снаружи зоны
    const cases: { bed: Rect; p: Pt; under: number }[] = [
      // длинным боком к руке, игрок 0.4 вглубь (кончик встаёт на POKE_R от игрока, дальше зоны)
      { bed: { x0: 9.5, y0: -1, x1: 10.3, y1: 0.9 }, p: { x: 9.9, y: 0, room: 'c' }, under: 0.05 },
      // и 0.7 вглубь, вбок от оси руки
      { bed: { x0: 9.5, y0: -1, x1: 10.3, y1: 0.9 }, p: { x: 10.2, y: 0.5, room: 'c' }, under: 0.3 },
      // торцом: кончик — на границе зоны (POKE_STAND), игрок 0.8 вглубь
      { bed: { x0: 9.5, y0: -0.4, x1: 11.4, y1: 0.4 }, p: { x: 10.3, y: 0, room: 'c' }, under: 0.3 },
    ];
    const hands = new Set<boolean>();
    for (const seed of ['t4', 'a', 'd', 'k']) {
      for (const c of cases) {
        const engine = new NullEngine();
        const scene = new Scene(engine);
        const mesh = new HandMesh(scene);
        const h = createHand(seed, { x: 2, y: 2.2, room: 'room' }, { x: 2, y: 0, room: 'c' });
        const input: HandInput = { lightsOn: false, seen: false, goal: { x: 4, y: 0, room: 'c' }, players: [], lanterns: [], playerSpeed: 3 };
        let t = run(h, input, mesh, (s) => s.tip.x >= 4 - 1e-6);
        input.goal = c.p;
        input.players = [{ id: 'p', p: c.p, protected: false, sees: false, sheltered: true, cover: c.bed }];
        const m = mesh as unknown as { right: boolean; grids: { base: number; rows: number; cols: number }[] };
        const hand = [...mesh.byRoom().get('c')!].find((x) => x.name === 'obshaga:hand')!;
        const what = `${seed}, кровать ${JSON.stringify(c.bed)}, игрок ${c.p.x}/${c.p.y}`;
        let pokes = 0, under = -Infinity, minY = Infinity;
        for (let k = 0; k < 170; k++) {
          stepHand(h, 1 / 30, input);
          t += 1 / 30;
          mesh.update(handView(h), toWorld, t, DOORWAY);
          if (h.poke) pokes++;
          expect(rectGap(h.tip, c.bed), what).toBeGreaterThanOrEqual(POKE_STAND - 1e-6);
          const tip = mesh.pokeTip();
          if (tip) {
            under = Math.max(under, tip.x - c.bed.x0);
            if (tip.x > c.bed.x0) expect(tip.y, what).toBeLessThanOrEqual(0.2);
          }
          if (k % 2) continue;
          const pos = hand.getVerticesData(VertexBuffer.PositionKind)!;
          m.grids.forEach((G, gi) => {
            // указательный (тычущий палец) и его ноготь — сетки 1 и 1 + 5
            const index = gi === 1 || gi === 6;
            for (let v = G.base; v < G.base + G.rows * (G.cols + 1); v++) {
              const x = pos[v * 3], y = pos[v * 3 + 1], py = -pos[v * 3 + 2];
              minY = Math.min(minY, y);
              const inBed = x > c.bed.x0 && x < c.bed.x1 && py > c.bed.y0 && py < c.bed.y1;
              if (!inBed) continue;
              expect(index, `${what}: сетка ${gi} над кроватью, высота ${y.toFixed(2)}`).toBe(true);
              expect(y > 0.3 && y < 0.5, `${what}: указательный в плите кровати, высота ${y.toFixed(3)}`).toBe(false);
            }
          });
        }
        hands.add(m.right);
        expect(minY, what).toBeGreaterThan(-0.01);
        expect(pokes, what).toBeGreaterThan(30);
        // палец уходит под кровать — к игроку
        expect(under, what).toBeGreaterThan(c.under);
        mesh.dispose();
        scene.dispose();
        engine.dispose();
      }
    }
    // и правые, и левые руки
    expect(hands.size).toBe(2);
  });

  it('пол: ползёт, встаёт и тычет без кровати (указательный — с разгона позы) — ни одна вершина кисти не ниже пола', { timeout: 30000 }, () => {
    for (const [seed, d] of [['t4', 1.7], ['a', 0.6], ['d', 2.2], ['k', 1.2]] as const) {
      const engine = new NullEngine();
      const scene = new Scene(engine);
      const mesh = new HandMesh(scene);
      const h = createHand(seed, { x: 2, y: 2.2, room: 'room' }, { x: 2, y: 0, room: 'c' });
      const input: HandInput = { lightsOn: false, seen: false, goal: { x: 9, y: 0, room: 'c' }, players: [], lanterns: [], playerSpeed: 3 };
      const hand = () => [...mesh.byRoom().get('c')!].find((x) => x.name === 'obshaga:hand')!;
      let minY = Infinity, t = 0;
      const scan = () => {
        const pos = hand().getVerticesData(VertexBuffer.PositionKind)!;
        for (let v = 1; v < pos.length; v += 3) minY = Math.min(minY, pos[v]);
      };
      // ползёт (перебор пальцами, кончики и ногти у пола)
      t = run(h, input, mesh, (s) => s.tip.x >= 5 - 1e-6);
      for (let k = 0; k < 60 && h.tip.x < 9 - 1e-6; k++) {
        stepHand(h, 1 / 30, input);
        t += 1 / 30;
        mesh.update(handView(h), toWorld, t, DOORWAY);
        scan();
      }
      expect(minY, `${seed}: ползёт`).toBeGreaterThan(-0.01);
      // встал, игрок под кроватью (кровать неизвестна) в d м: тычок — и разгон позы
      minY = Infinity;
      input.goal = null;
      input.players = [{ id: 'p', p: { x: h.tip.x + d, y: 0, room: 'c' }, protected: false, sees: false, sheltered: true }];
      const m = mesh as unknown as { yaw: number; grids: { base: number; rows: number; cols: number }[] };
      let reach = 0, side = 0;
      for (let k = 0; k < 70; k++) {
        stepHand(h, 1 / 30, input);
        t += 1 / 30;
        mesh.update(handView(h), toWorld, t, DOORWAY);
        scan();
        if (k < 12) continue;
        // поза упора: всё, кроме указательного (сетки 1 и 6), — в круге 1.2 м у кончика спереди; сзади (ладонь,
        // запястье) — не шире 1.2 м в стороны (POKE_STAND 1.3 — запретная зона кончика у кровати)
        const pos = hand().getVerticesData(VertexBuffer.PositionKind)!;
        const o = toWorld(h.tip), fx = Math.cos(m.yaw), fz = Math.sin(m.yaw);
        m.grids.forEach((G, gi) => {
          if (gi === 1 || gi === 6) return;
          for (let v = G.base; v < G.base + G.rows * (G.cols + 1); v++) {
            const dx = pos[v * 3] - o.x, dz = pos[v * 3 + 2] - o.z;
            const f = dx * fx + dz * fz, l = -dx * fz + dz * fx;
            if (f > -0.5) reach = Math.max(reach, Math.hypot(dx, dz));
            else side = Math.max(side, Math.abs(l));
          }
        });
      }
      expect(h.poke).toBe('p');
      expect(minY, `${seed}: тычет в ${d} м`).toBeGreaterThan(-0.01);
      expect(reach, `${seed}: упор`).toBeLessThan(1.2);
      expect(side, `${seed}: ладонь`).toBeLessThan(1.2);
      expect(reach).toBeLessThan(POKE_STAND);
      mesh.dispose();
      scene.dispose();
      engine.dispose();
    }
  });

  it('тычет под кровать: указательный под сеткой (< 0.3 м) к игроку, выпад и назад; и под взглядом; перестала — null', () => {
    const engine = new NullEngine();
    const scene = new Scene(engine);
    const mesh = new HandMesh(scene);
    const h = createHand('t4', { x: 2, y: 2.2, room: 'room' }, { x: 2, y: 0, room: 'c' });
    const bed: Pt = { x: 9, y: 0, room: 'c' };
    const input: HandInput = { lightsOn: false, seen: false, goal: bed, players: [{ id: 'p', p: bed, protected: false, sees: false, sheltered: true }], lanterns: [], playerSpeed: 3 };
    let t = run(h, input, mesh, (s) => s.poke !== null);
    expect(mesh.pokeTip()).toBeNull();
    t = run(h, input, mesh, () => false, t, 30);
    expect(mesh.pokeTip()).not.toBeNull();
    // смотрят — рука замерла, а палец бьёт: за полтора цикла кончик у пола, ходит вперёд-назад, на ударе — у игрока
    input.seen = true;
    const hand = [...mesh.byRoom().get('c')!].find((m) => m.name === 'obshaga:hand')!;
    let minD = Infinity, maxD = 0, maxY = -Infinity, minY = Infinity;
    const before = Float32Array.from(hand.getVerticesData(VertexBuffer.PositionKind)!);
    for (let k = 0; k < 64; k++) {
      stepHand(h, 1 / 30, input);
      t += 1 / 30;
      mesh.update(handView(h), toWorld, t, DOORWAY);
      const p = mesh.pokeTip()!;
      const d = Math.hypot(p.x - bed.x, p.z + bed.y);
      minD = Math.min(minD, d);
      maxD = Math.max(maxD, d);
      maxY = Math.max(maxY, p.y);
      minY = Math.min(minY, p.y);
    }
    expect(h.frozen).toBe(true);
    expect(handView(h).poke).toBe('p');
    expect(Float32Array.from(hand.getVerticesData(VertexBuffer.PositionKind)!)).not.toEqual(before);
    expect(maxY).toBeLessThan(0.3);
    expect(minY).toBeGreaterThan(0.05);
    expect(minD).toBeGreaterThan(0.15);
    expect(minD).toBeLessThan(0.6);
    expect(maxD - minD).toBeGreaterThan(0.3);
    // свет — рука исчезла, тычка нет
    input.lightsOn = true;
    stepHand(h, 1 / 30, input);
    mesh.update(handView(h), toWorld, t + 1, DOORWAY);
    expect(mesh.pokeTip()).toBeNull();
    mesh.dispose();
    scene.dispose();
    engine.dispose();
  });
});

// ── кровати под рукой и вытянутый палец: вид руки без механики (кончик стоит, где поставила бы механика) ──

/** Вид тычущей руки: след по ломаной (комната 'r', кончик — конец следа), игрок at под кроватью bed, фаза тычка u. */
function standView(pts: [number, number][], at: Pt, bed: Rect, u: number, variant: number): HandView {
  const trail = trailAlong(pts, () => 'r');
  const tip = trail[trail.length - 1], a = trail[trail.length - 2];
  const base = handView(createHand('v', trail[0], trail[1]));
  return {
    ...base,
    phase: 'stalking', visible: true, tip: { ...tip }, heading: Math.atan2(tip.y - a.y, tip.x - a.x), trail, length: trailArcs(trail, []),
    emerge01: 1, frozen: false, blocked: false, variant, poke: 'p', pokeAt: at, poke01: u, bed,
  };
}

/** Вершины меша в плане: (x, y = −z, высота). */
function eachVertex(m: { getVerticesData(k: string): ArrayLike<number> | null }, from: number, to: number, fn: (x: number, y: number, h: number) => void) {
  const pos = m.getVerticesData(VertexBuffer.PositionKind)!;
  for (let v = from; v < to; v++) fn(pos[v * 3], -pos[v * 3 + 2], pos[v * 3 + 1]);
}

const inRect = (r: Rect, x: number, y: number) => x > r.x0 && x < r.x1 && y > r.y0 && y < r.y1;
/** у торца кровати (спинка; длинная сторона — по x или по y), м */
const atEnd = (r: Rect, x: number, y: number, w: number) =>
  r.x1 - r.x0 > r.y1 - r.y0 ? x < r.x0 + w || x > r.x1 - w : y < r.y0 + w || y > r.y1 - w;

/** Правая и левая рука (варианты пальцев). */
const VARIANTS = (() => {
  const out: number[] = [];
  for (const want of [true, false]) for (let v = 0.05; v < 1; v += 0.05) if (fingerDefs(v, 2).right === want) {
    out.push(v);
    break;
  }
  return out;
})();

describe('HandMesh: кровати под рукой, вытянутый палец', () => {
  it('проход 1.7 м между кроватями: кисть и предплечье на соседней кровати — поверх матраса и спинок; под целью — только указательный, под сеткой', { timeout: 60000 }, () => {
    // кровати длинными боками к проходу (y −0.85 … 0.85); кончик — в POKE_STAND от цели, в 0.4 м от соседней
    const cases: { name: string; pts: [number, number][]; at: Pt; target: Rect; other: Rect }[] = [
      // пришла вдоль прохода, кисть доворачивает к цели: ладонь и бок предплечья — над соседней
      { name: 'вдоль', pts: [[-3, -0.46], [4.5, -0.46]], at: { x: 5.6, y: 1.25, room: 'r' }, target: { x0: 4.4, y0: 0.85, x1: 6.3, y1: 1.65 }, other: { x0: 2.6, y0: -1.65, x1: 4.5, y1: -0.85 } },
      // переползла через соседнюю (не цель — не преграда): рука лежит на ней поперёк
      { name: 'поперёк', pts: [[-2, -4.96], [3.5, -4.96], [3.5, -0.46]], at: { x: 3.7, y: 1.25, room: 'r' }, target: { x0: 2.6, y0: 0.85, x1: 4.5, y1: 1.65 }, other: { x0: 2.6, y0: -1.65, x1: 4.5, y1: -0.85 } },
    ];
    for (const c of cases) for (const variant of VARIANTS) {
      const engine = new NullEngine();
      const scene = new Scene(engine);
      const mesh = new HandMesh(scene);
      const m = mesh as unknown as { grids: { base: number; rows: number; cols: number }[] };
      const beds = [c.other, c.target];
      const what = `${c.name}, вариант ${variant.toFixed(2)}`;
      let handOver = 0, armOver = 0, minY = Infinity, under = 0;
      for (let k = 0; k < 50; k++) {
        const v = standView(c.pts, c.at, c.target, ((k / 30) / 1.4) % 1, variant);
        expect(rectGap(v.tip, c.target), what).toBeGreaterThanOrEqual(POKE_STAND - 1e-6);
        mesh.update(v, toWorld, k / 30, null, beds);
        if (k % 3) continue;
        const list = [...mesh.byRoom().get('r')!];
        const hand = list.find((x) => x.name === 'obshaga:hand')!;
        m.grids.forEach((G, gi) => {
          const index = gi === 1 || gi === 6;
          eachVertex(hand, G.base, G.base + G.rows * (G.cols + 1), (x, y, h) => {
            minY = Math.min(minY, h);
            if (inRect(c.other, x, y)) {
              handOver++;
              expect(h, `${what}: сетка ${gi} в соседней кровати`).toBeGreaterThanOrEqual(0.5);
              if (atEnd(c.other, x, y, 0.05)) expect(h, `${what}: сетка ${gi} в спинке`).toBeGreaterThanOrEqual(0.95);
            }
            if (inRect(c.target, x, y)) {
              expect(index, `${what}: сетка ${gi} над целью, высота ${h.toFixed(2)}`).toBe(true);
              expect(h, `${what}: указательный в матрасе цели`).toBeLessThanOrEqual(0.29);
              under++;
            }
          });
        });
        for (const arm of list) {
          if (arm === hand) continue;
          eachVertex(arm, 0, arm.getTotalVertices(), (x, y, h) => {
            minY = Math.min(minY, h);
            for (const b of beds) if (inRect(b, x, y)) {
              if (b === c.other) armOver++;
              expect(h, `${what}: рука в кровати`).toBeGreaterThanOrEqual(0.5);
              if (atEnd(b, x, y, 0.05)) expect(h, `${what}: рука в спинке`).toBeGreaterThanOrEqual(0.95);
            }
          });
        }
      }
      expect(minY, what).toBeGreaterThan(-0.01);
      // сцена та, что нужна: кисть и рука лежат на соседней, палец — под целью
      expect(handOver, what).toBeGreaterThan(100);
      expect(armOver, what).toBeGreaterThan(100);
      expect(under, what).toBeGreaterThan(20);
      mesh.dispose();
      scene.dispose();
      engine.dispose();
    }
  });

  it('кровать в нише (оба длинных бока у стен), игрок глубоко от торца: палец вытягивается до него — под сеткой, под спинкой, ничего в матрасе', { timeout: 60000 }, () => {
    const bed: Rect = { x0: 5, y0: -0.4, x1: 6.9, y1: 0.4 };
    // кончик — в POKE_STAND от торца (и как ставит навигация, + 0.08); игрок — 1.6 и 1.65 м от торца
    for (const [stand, deep] of [[1.3, 1.6], [1.38, 1.65], [1.3, 1.85]]) for (const variant of VARIANTS) {
      const engine = new NullEngine();
      const scene = new Scene(engine);
      const mesh = new HandMesh(scene);
      const m = mesh as unknown as { grids: { base: number; rows: number; cols: number }[] };
      const tipX = bed.x0 - stand;
      const at: Pt = { x: bed.x0 + deep, y: 0, room: 'r' };
      const what = `кончик в ${stand} м, игрок в ${deep} м, вариант ${variant.toFixed(2)}`;
      let minD = Infinity, maxIn = 0, minY = Infinity;
      for (let k = 0; k < 75; k++) {
        mesh.update(standView([[tipX - 6.75, 0], [tipX, 0]], at, bed, ((k / 30) / 1.4) % 1, variant), toWorld, k / 30, null, [bed]);
        const tip = mesh.pokeTip()!;
        expect(tip, what).not.toBeNull();
        if (inRect(bed, tip.x, -tip.z)) expect(tip.y, `${what}: кончик в кровати`).toBeLessThanOrEqual(0.2);
        minD = Math.min(minD, Math.hypot(tip.x - at.x, -tip.z - at.y));
        maxIn = Math.max(maxIn, tip.x - bed.x0);
        const hand = [...mesh.byRoom().get('r')!].find((x) => x.name === 'obshaga:hand')!;
        m.grids.forEach((G, gi) => {
          const index = gi === 1 || gi === 6;
          eachVertex(hand, G.base, G.base + G.rows * (G.cols + 1), (x, y, h) => {
            minY = Math.min(minY, h);
            if (!inRect(bed, x, y)) return;
            expect(index, `${what}: сетка ${gi} над кроватью`).toBe(true);
            expect(h, `${what}: указательный в матрасе`).toBeLessThanOrEqual(0.29);
            // поперечина спинки — на 0.4 м: палец проходит под ней
            if (atEnd(bed, x, y, 0.08)) expect(h, `${what}: указательный в спинке`).toBeLessThan(0.38);
          });
        });
      }
      expect(minY, what).toBeGreaterThan(-0.01);
      // удар — у игрока (на POKE.short 0.3 не доходя), отведён — ближе
      expect(minD, what).toBeLessThan(0.35);
      expect(maxIn, what).toBeGreaterThan(deep - 0.4);
      mesh.dispose();
      scene.dispose();
      engine.dispose();
    }
  });

  it('кровати не под рукой — рука та же до вершины (и без списка, и с пустым)', { timeout: 30000 }, () => {
    const engine = new NullEngine();
    const scene = new Scene(engine);
    const mk = () => new HandMesh(scene);
    const meshes = [mk(), mk(), mk()];
    const lists: (Rect[] | undefined)[] = [undefined, [], [{ x0: 40, y0: 5, x1: 41.9, y1: 5.8 }]];
    const h = createHand('t4', { x: 2, y: 2.2, room: 'room' }, { x: 2, y: 0, room: 'c' });
    const input: HandInput = { lightsOn: false, seen: false, goal: { x: 9, y: 0, room: 'c' }, players: [], lanterns: [], playerSpeed: 3 };
    for (let k = 0; k < 200; k++) {
      stepHand(h, 1 / 30, input);
      if (k === 150) input.players = [{ id: 'p', p: { x: h.tip.x + 1.7, y: 0, room: 'c' }, protected: false, sees: false, sheltered: true }];
      meshes.forEach((mesh, i) => mesh.update(handView(h), toWorld, k / 30, DOORWAY, lists[i]));
      if (k % 20) continue;
      const bufs = meshes.map((mesh) => [...mesh.byRoom().values()].flat().map((x) => Float32Array.from(x.getVerticesData(VertexBuffer.PositionKind)!)));
      expect(bufs[1]).toEqual(bufs[0]);
      expect(bufs[2]).toEqual(bufs[0]);
    }
    for (const mesh of meshes) mesh.dispose();
    scene.dispose();
    engine.dispose();
  });
});
