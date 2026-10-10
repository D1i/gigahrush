// Тело «Фрактальной станции» (./fractalPhysics.ts, FRACTAL.md §4.4): кадр и кватернионы в соглашении Babylon, стойка
// и ходьба, поворот гравитации упором в стену (и отказы: низкая стена, угол, теснота), падение с обёрткой и ударом,
// 500 случайных сходов без rescue, обёртка вдоль пилона, выход только в выходной копии, детерминизм.
import { describe, expect, it } from 'vitest';
import { Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector';
import { AXES6, AXIS_VEC, FRAME, axisIdx, axisSign, opp, type Axis6, type V3 } from './fractalAxes';
import { axisRay, buildFractalCell, solidAt, standable, type FractalCell } from './fractalCell';
import { createEscWorld } from './fractalEsc';
import {
  boxFree, camPose, createBody, FRP, placeBody, qrot, quatFromBasis, rightOf, slerp, stepBody, yawToward,
  type FrBody, type FrEnv, type FrEvent, type FrInput,
} from './fractalPhysics';

const cell = buildFractalCell('t1');
const P = cell.P;
const envOf = (c: FractalCell = cell): FrEnv => ({ cell: c, esc: createEscWorld(c, 't1') });
const NO: FrInput = { fwd: 0, side: 0, run: false, dYaw: 0, dPitch: 0, use: false };
const W: FrInput = { ...NO, fwd: 1 };
const DT = 1 / 60;

const dot = (a: readonly number[], b: readonly number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: readonly number[], b: readonly number[]): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = (a: readonly number[]) => Math.hypot(a[0], a[1], a[2]);
const deg = (a: readonly number[], b: readonly number[]) => (Math.acos(Math.max(-1, Math.min(1, dot(a, b) / len(a) / len(b)))) * 180) / Math.PI;

/** Тело в точке (ступни), гравитация up, лицом вдоль fwd (ось), ячейка c. */
function bodyAt(at: V3, up: Axis6, fwd: Axis6, c: V3 = [0, 0, 0]): FrBody {
  return createBody({ at, up, fwd }, c);
}

/** Гонять шагами 1/60 с; события с отметкой времени. */
function run(env: FrEnv, b: FrBody, inp: FrInput, s: number, stop?: (e: FrEvent, t: number) => boolean): { ev: FrEvent[]; at: number[] } {
  const ev: FrEvent[] = [], at: number[] = [];
  const n = Math.round(s / DT);
  for (let i = 0; i < n; i++) {
    let done = false;
    for (const e of stepBody(env, b, inp, DT)) {
      ev.push(e);
      at.push((i + 1) * DT);
      if (stop?.(e, (i + 1) * DT)) done = true;
    }
    if (done) break;
  }
  return { ev, at };
}

/** Тело свободно (бокс по ступням и up). */
function free(env: FrEnv, b: FrBody): boolean {
  const ua = axisIdx(b.up), us = axisSign(b.up);
  const lo: V3 = [0, 0, 0], hi: V3 = [0, 0, 0];
  for (let k = 0; k < 3; k++) {
    if (k === ua) { lo[k] = us > 0 ? b.pos[k] : b.pos[k] - FRP.h; hi[k] = us > 0 ? b.pos[k] + FRP.h : b.pos[k]; }
    else { lo[k] = b.pos[k] - FRP.half; hi[k] = b.pos[k] + FRP.half; }
  }
  return boxFree(env, lo, hi);
}

/** Воксель — место ступни (GEN: он и следующий по up пусты, предыдущий твёрд). */
const stand = standable;

/** Расстояние вдоль −up от ступней до статичного твёрдого (axisRay GEN; точка — чуть внутрь тела). */
function dropAt(c: FractalCell, feet: V3, up: Axis6): number {
  const p: V3 = [feet[0], feet[1], feet[2]];
  p[axisIdx(up)] += axisSign(up) * 1e-6;
  return axisRay(c, p, opp(up), 3 * c.P) ?? Infinity;
}

/** Копия ячейки с правкой вокселей. */
function withVox(c: FractalCell, edit: (set: (x: number, y: number, z: number, v: number) => void) => void): FractalCell {
  const vox = c.vox.slice();
  const m = (i: number) => ((i % P) + P) % P;
  edit((x, y, z, v) => { vox[m(x) + P * (m(y) + P * m(z))] = v; });
  return { ...c, vox };
}

/** Точка p — в габарите эскалатора (наклон, площадка), расширенном на m м. */
function nearEsc(c: FractalCell, p: readonly number[], m: number): boolean {
  return c.esc.some((e) => {
    const U = AXIS_VEC[e.up], F = AXIS_VEC[e.fwd], R = AXIS_VEC[rightOf(e.up, e.fwd)];
    const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    for (const s of [0, e.run]) for (const a of [-e.width / 2, e.width / 2]) for (const h of [0, e.rise + 2])
      for (let k = 0; k < 3; k++) {
        const v = e.o[k] + F[k] * s + R[k] * a + U[k] * h;
        lo[k] = Math.min(lo[k], v, e.top.lo[k]);
        hi[k] = Math.max(hi[k], v, e.top.hi[k]);
      }
    return [0, 1, 2].every((k) => p[k] >= lo[k] - m && p[k] <= hi[k] + m);
  });
}

/** Полоса пола up +Y длиной n м вдоль +X/+Z с высотой 2 м, вдали от эскалаторов (ступни — центр вокселя). */
function strip(c: FractalCell, n: number, dir: 0 | 4): V3 {
  const D = AXIS_VEC[dir];
  for (let z = 2; z < P - 2; z++)
    for (let x = 2; x < P - 2; x++) {
      let ok = true;
      for (let i = -1; i <= n + 1 && ok; i++) {
        const xx = x + D[0] * i, zz = z + D[2] * i;
        for (let w = -1; w <= 1 && ok; w++) {
          const wx = xx + (dir === 4 ? w : 0), wz = zz + (dir === 0 ? w : 0);
          ok = stand(c, wx, 1, wz, 2) && !solidAt(c, wx, 3, wz) && !nearEsc(c, [wx + 0.5, 1.5, wz + 0.5], 2);
        }
      }
      if (ok) return [x + 0.5, 1, z + 0.5];
    }
  throw new Error('нет полосы');
}

/** Угол пола атриума (гравитация up) и стены плиты по направлению d (d ⊥ up), сдвиг вдоль третьей оси — t (воксель). */
interface Wall { up: Axis6; d: Axis6; t: number }
const tAxis = (w: Wall) => 3 - axisIdx(w.up) - axisIdx(w.d);
/** Мир: h м над полом (вдоль up), dd м от плоскости стены (против d), вдоль третьей оси — tt. */
function wpt(w: Wall, h: number, dd: number, tt: number): V3 {
  const p: V3 = [0, 0, 0], us = axisSign(w.up), ds = axisSign(w.d);
  p[axisIdx(w.up)] = (us > 0 ? 1 : P - 1) + us * h;
  p[axisIdx(w.d)] = (ds > 0 ? P - 1 : 1) - ds * dd;
  p[tAxis(w)] = tt;
  return p;
}
/** Воксель: слой hi над полом, слой di перед стеной (−1 — сама стена), ti вдоль третьей оси. */
const wvox = (w: Wall, hi: number, di: number, ti: number): V3 => wpt(w, hi + 0.5, di + 0.5, ti + 0.5).map(Math.floor) as V3;

/** Стена плиты с чистым подъёмом от пола на 4 слоя (full — до противоположной плиты), вдали от эскалаторов. */
function findWall(c: FractalCell, full: boolean): Wall {
  for (const up of AXES6)
    for (const d of AXES6) {
      if (axisIdx(d) === axisIdx(up)) continue;
      for (let t = 3; t < P - 3; t++) {
        const w: Wall = { up, d, t };
        const hMax = full ? P - 3 : 4;
        let ok = true;
        for (let h = -1; h <= hMax + 1 && ok; h++)
          for (let dt = -1; dt <= 1 && ok; dt++) {
            const tt = t + dt;
            if (h < 0 || h > hMax) { ok = !full && h > hMax ? true : solidAt(c, ...wvox(w, h, 1, tt)); continue; }
            ok = solidAt(c, ...wvox(w, h, -1, tt)) && [0, 1, 2, 3].every((di) => !solidAt(c, ...wvox(w, h, di, tt))) &&
              !nearEsc(c, wpt(w, h + 0.5, 0.5, tt + 0.5), 2.5);
          }
        if (ok) return w;
      }
    }
  throw new Error('нет чистой стены');
}
const WALL = findWall(cell, false);

/** n случайных стоячих точек × сход в 4 стороны (3 с ходьбы, потом — до приземления): счётчики. */
function wander(c: FractalCell, n: number, seed0: number) {
  const env = envOf(c), Pc = c.P;
  let seed = seed0;
  const rnd = () => ((seed = (Math.imul(seed, 1103515245) + 12345) >>> 0) / 4294967296);
  const st = { pts: 0, falls: 0, turns: 0, maxFall: 0, rescues: 0, outside: 0, hanging: 0 };
  while (st.pts < n) {
    const x = Math.floor(rnd() * Pc), y = Math.floor(rnd() * Pc), z = Math.floor(rnd() * Pc), up = AXES6[Math.floor(rnd() * 6)];
    if (!stand(c, x, y, z, up)) continue;
    st.pts++;
    const U = AXIS_VEC[up];
    const at: V3 = [x + 0.5 - U[0] * 0.5, y + 0.5 - U[1] * 0.5, z + 0.5 - U[2] * 0.5];
    for (let d = 0; d < 4; d++) {
      const b = bodyAt(at, up, FRAME[up].fwd);
      b.yaw += (d * Math.PI) / 2;
      let airFrom = NaN;
      for (let i = 0; i < 3 * 60 || (b.ground === 'air' && i < 12 * 60); i++) {
        if (b.ground !== 'air') {
          const ua = axisIdx(b.up);
          airFrom = b.cell[ua] * Pc + b.pos[ua];
        }
        for (const e of stepBody(env, b, i < 3 * 60 ? W : NO, DT)) {
          if (e.k === 'rescue') st.rescues++;
          if (e.k === 'turn') st.turns++;
          if (e.k === 'land' && !Number.isNaN(airFrom)) {
            const ua = axisIdx(b.up);
            st.maxFall = Math.max(st.maxFall, (airFrom - (b.cell[ua] * Pc + b.pos[ua])) * axisSign(b.up));
            st.falls++;
            airFrom = NaN;
          }
        }
        if (b.ground !== 'air' && !b.turn) airFrom = NaN;
        for (let k = 0; k < 3; k++) if (!(b.pos[k] >= 0 && b.pos[k] < Pc)) st.outside++;
      }
      if (b.ground === 'air') st.hanging++;
    }
  }
  return st;
}

describe('кадр: соглашение Babylon (LH, right = up × fwd)', () => {
  it('FRAME: right = up × fwd, оси ортогональны', () => {
    for (const u of AXES6) {
      const { right, fwd } = FRAME[u];
      expect(cross(AXIS_VEC[u], AXIS_VEC[fwd]).map((x) => x + 0)).toEqual(AXIS_VEC[right].map((x) => x + 0));
      expect(rightOf(u, fwd)).toBe(right);
    }
  });

  it('camPose: базис ортонормален, right = up × fwd, q переводит X/Y/Z в right/up/fwd и совпадает с Babylon', () => {
    for (const u of AXES6)
      for (const yaw of [0, 0.7, -2.1, 3])
        for (const pitch of [0, 0.5, -1.2, 1.45]) {
          const b = bodyAt([10, 10, 10], u, FRAME[u].fwd);
          b.yaw = yaw;
          b.pitch = pitch;
          const c = camPose(b);
          for (const v of [c.right, c.up, c.fwd]) expect(len(v)).toBeCloseTo(1, 9);
          expect(dot(c.right, c.up)).toBeCloseTo(0, 9);
          expect(dot(c.right, c.fwd)).toBeCloseTo(0, 9);
          expect(dot(c.up, c.fwd)).toBeCloseTo(0, 9);
          const r = cross(c.up, c.fwd);
          for (let k = 0; k < 3; k++) expect(r[k]).toBeCloseTo(c.right[k], 9);
          const qx = qrot(c.q, [1, 0, 0]), qy = qrot(c.q, [0, 1, 0]), qz = qrot(c.q, [0, 0, 1]);
          for (let k = 0; k < 3; k++) {
            expect(qx[k]).toBeCloseTo(c.right[k], 9);
            expect(qy[k]).toBeCloseTo(c.up[k], 9);
            expect(qz[k]).toBeCloseTo(c.fwd[k], 9);
          }
          const bq = Quaternion.RotationQuaternionFromAxis(new Vector3(...c.right), new Vector3(...c.up), new Vector3(...c.fwd));
          const d = Math.abs(bq.x * c.q[0] + bq.y * c.q[1] + bq.z * c.q[2] + bq.w * c.q[3]);
          expect(d).toBeCloseTo(1, 6);
          // Babylon поворачивает Z камеры в fwd
          const z = new Vector3(0, 0, 1).applyRotationQuaternion(new Quaternion(...c.q));
          expect(z.x).toBeCloseTo(c.fwd[0], 6);
          expect(z.y).toBeCloseTo(c.fwd[1], 6);
          expect(z.z).toBeCloseTo(c.fwd[2], 6);
          // взгляд вверх при pitch > 0
          expect(dot(c.fwd, AXIS_VEC[u])).toBeCloseTo(Math.sin(pitch), 9);
        }
  });

  it('yawToward: взгляд в плоскости пола вдоль заданной оси; slerp — концы и норма', () => {
    for (const u of AXES6)
      for (const f of AXES6) {
        if (axisIdx(f) === axisIdx(u)) continue;
        const b = bodyAt([5, 5, 5], u, f);
        const c = camPose(b);
        expect(deg(c.fwd, AXIS_VEC[f])).toBeLessThan(1e-6);
      }
    const a = quatFromBasis([1, 0, 0], [0, 1, 0], [0, 0, 1]), q = quatFromBasis([0, 0, -1], [0, 1, 0], [1, 0, 0]);
    expect(slerp(a, q, 0)[3]).toBeCloseTo(a[3], 9);
    const m = slerp(a, q, 0.5);
    expect(Math.hypot(...m)).toBeCloseTo(1, 9);
    expect(deg(qrot(m, [0, 0, 1]), [Math.SQRT1_2, 0, Math.SQRT1_2])).toBeLessThan(1e-6);
  });
});

describe('стойка и ходьба', () => {
  it('стоя на полу 10 с без ввода — не сдвинулся, ground floor', () => {
    const env = envOf();
    const at = strip(cell, 4, 0);
    const b = bodyAt(at, 2, 0);
    const { ev } = run(env, b, NO, 10);
    expect(ev).toEqual([]);
    expect(b.ground).toBe('floor');
    for (let k = 0; k < 3; k++) expect(b.pos[k]).toBeCloseTo(at[k], 9);
  });

  it('ходьба 5 с вперёд вдоль полосы — путь ≈ walk·5 (±10 %), шаги звучат', () => {
    const env = envOf();
    const at = strip(cell, 17, 0);
    const b = bodyAt(at, 2, 0);
    const { ev } = run(env, b, W, 5);
    const path = b.pos[0] - at[0];
    expect(path).toBeGreaterThan(FRP.walk * 5 * 0.9);
    expect(path).toBeLessThan(FRP.walk * 5 * 1.1);
    expect(b.pos[1]).toBe(1);
    expect(b.ground).toBe('floor');
    expect(ev.filter((e) => e.k === 'step').length).toBeGreaterThan(15);
  });
});

/** Стоит на полу вплотную к стене плиты (WALL), лицом в неё. */
function atWall(w: Wall = WALL): FrBody {
  return bodyAt(wpt(w, 0, FRP.half, w.t + 0.5), w.up, w.d);
}

describe('поворот гравитации', () => {
  it('упор в стену плиты: через 0.2 с — turn, ещё через 0.55 с — up = opp(d), тело свободно, взгляд — старый up', () => {
    const env = envOf();
    const w = WALL;
    const b = atWall();
    const { ev, at } = run(env, b, W, 1.2, (e) => e.k === 'turned');
    const iTurn = ev.findIndex((e) => e.k === 'turn'), iDone = ev.findIndex((e) => e.k === 'turned');
    expect(iTurn).toBeGreaterThanOrEqual(0);
    expect(ev[iTurn]).toEqual({ k: 'turn', from: w.up, to: opp(w.d) });
    expect(at[iTurn]).toBeGreaterThanOrEqual(FRP.pushHold - 1e-9);
    expect(at[iTurn]).toBeLessThan(FRP.pushHold + 3 * DT);
    expect(at[iDone] - at[iTurn]).toBeGreaterThan(FRP.turnS - 2 * DT);
    expect(at[iDone] - at[iTurn]).toBeLessThan(FRP.turnS + 2 * DT);
    expect(b.up).toBe(opp(w.d));
    // ступни — на плоскости стены, у старого пола (0.3 над ним: старый пол — стена за спиной), третья ось — та же
    const want = wpt(w, FRP.half, 0, w.t + 0.5);
    for (let k = 0; k < 3; k++) expect(b.pos[k]).toBeCloseTo(want[k], 9);
    expect(free(env, b)).toBe(true);
    expect(deg(camPose(b).fwd, AXIS_VEC[w.up])).toBeLessThan(1);
    // устоял на новом полу
    const r2 = run(env, b, NO, 1);
    expect(r2.ev.filter((e) => e.k === 'land' || e.k === 'rescue')).toEqual([]);
    expect(b.ground).toBe('floor');
  });

  it('во время поворота ввод заморожен, глаз идёт по дуге в свободном месте, кадр — плавно (slerp)', () => {
    const env = envOf();
    const b = atWall();
    run(env, b, W, 0.3, (e) => e.k === 'turn');
    expect(b.turn).not.toBeNull();
    const o = wpt(WALL, 0, 0, 0), ua = axisIdx(WALL.up), da = axisIdx(WALL.d);
    let prev = camPose(b).fwd, maxStep = 0, minCorner = Infinity;
    for (let i = 0; i < 40 && b.turn; i++) {
      stepBody(env, b, { ...W, dYaw: 0.3, dPitch: 0.3 }, DT);
      const c = camPose(b);
      maxStep = Math.max(maxStep, deg(prev, c.fwd));
      prev = c.fwd;
      // глаз — не в твёрдом и не ближе 0.25 м к стене/полу
      expect(solidAt(cell, Math.floor(c.eye[0]), Math.floor(c.eye[1]), Math.floor(c.eye[2]))).toBe(false);
      const h = (c.eye[ua] - o[ua]) * axisSign(WALL.up), dd = (o[da] - c.eye[da]) * axisSign(WALL.d);
      minCorner = Math.min(minCorner, h, dd);
    }
    expect(b.turn).toBeNull();
    expect(maxStep).toBeLessThan(12);
    expect(minCorner).toBeGreaterThan(0.25);
    expect(b.pitch).toBe(0);
  });

  it('pitch сохраняется', () => {
    const env = envOf();
    const b = atWall();
    b.pitch = 0.4;
    run(env, b, W, 1.2, (e) => e.k === 'turned');
    expect(b.up).toBe(opp(WALL.d));
    expect(b.pitch).toBeCloseTo(0.4, 9);
    // взгляд: старый up · cos + новый up · sin
    const U0 = AXIS_VEC[WALL.up], U1 = AXIS_VEC[opp(WALL.d)];
    expect(deg(camPose(b).fwd, [0, 1, 2].map((k) => U0[k] * Math.cos(0.4) + U1[k] * Math.sin(0.4)))).toBeLessThan(1);
  });

  it('упор в низкую (1 м) площадку — поворота нет', () => {
    const w = WALL;
    const c = withVox(cell, (set) => { for (let t = w.t - 2; t <= w.t + 2; t++) set(...wvox(w, 0, 0, t), 7); });
    const env = envOf(c);
    const b = bodyAt(wpt(w, 0, 1 + FRP.half, w.t + 0.5), w.up, w.d);
    const p0 = [...b.pos];
    const { ev } = run(env, b, W, 2);
    expect(ev.some((e) => e.k === 'turn')).toBe(false);
    expect(b.up).toBe(w.up);
    for (let k = 0; k < 3; k++) expect(b.pos[k]).toBeCloseTo(p0[k], 6);
  });

  it('упор под углом 60° — поворота нет (скользит вдоль стены)', () => {
    const env = envOf();
    const b = atWall();
    const p0 = [...b.pos];
    // скользим к середине стены (не в угол — там упор в соседнюю стену под 30°, это уже поворот)
    const ta0 = tAxis(WALL), side = cross(AXIS_VEC[WALL.up], AXIS_VEC[WALL.d])[ta0];
    b.yaw += (((WALL.t < P / 2 ? 1 : -1) * side * 60) * Math.PI) / 180;
    const { ev } = run(env, b, W, 1.2);
    expect(ev.some((e) => e.k === 'turn')).toBe(false);
    expect(b.up).toBe(WALL.up);
    const ta = tAxis(WALL), da = axisIdx(WALL.d);
    expect(b.pos[da]).toBeCloseTo(p0[da], 6);
    expect(Math.abs(b.pos[ta] - p0[ta])).toBeGreaterThan(1);
  });

  it('поворот в узком месте (свободно < 1.7 м от стены) — отказ, тело на месте', () => {
    const w = WALL;
    // стена за спиной — слой в 1 м от стены (свободно 1 м)
    const c = withVox(cell, (set) => { for (let h = 0; h < 5; h++) for (let t = w.t - 4; t <= w.t + 4; t++) set(...wvox(w, h, 1, t), 7); });
    const env = envOf(c);
    const b = atWall();
    const p0 = [...b.pos];
    const { ev } = run(env, b, W, 1.5);
    expect(ev.some((e) => e.k === 'turn')).toBe(false);
    expect(b.up).toBe(w.up);
    for (let k = 0; k < 3; k++) expect(b.pos[k]).toBeCloseTo(p0[k], 6);
    expect(b.push).toBeLessThan(FRP.pushHold);
  });

  it('два поворота подряд — стоишь на «потолке» (up против старого), тело свободно', () => {
    const w = findWall(cell, true);
    const env = envOf();
    const b = atWall(w);
    run(env, b, W, 1.2, (e) => e.k === 'turned');
    expect(b.up).toBe(opp(w.d));
    // вверх по стене до противоположной плиты
    const r = run(env, b, W, 30, (e) => e.k === 'turned');
    expect(r.ev.some((e) => e.k === 'rescue')).toBe(false);
    expect(b.up).toBe(opp(w.up));
    expect(b.pos[axisIdx(w.up)]).toBe(axisSign(w.up) > 0 ? P - 1 : 1);
    expect(free(env, b)).toBe(true);
  });
});


describe('падение и обёртка', () => {
  it('сход с обода дыры плиты: падение вниз в повтор, land с v ≤ √(2·g·P), приземление там, где предсказал луч', () => {
    const env = envOf();
    // пол y = 1 у обода дыры x ∈ [18, 36): идём +X в дыру
    const z = 27;
    const b = bodyAt([16.5, 1, z + 0.5], 2, 0);
    const ev: FrEvent[] = [];
    for (let i = 0; i < 180 && b.ground !== 'air'; i++) ev.push(...stepBody(env, b, W, DT));
    expect(b.ground).toBe('air');
    const feet: V3 = [b.pos[0], b.pos[1], b.pos[2]];
    // дальше без ввода — снос по воздуху мал; предсказание — по точке приземления
    const r = run(env, b, NO, 6, (e) => e.k === 'land');
    const all = [...ev, ...r.ev];
    const land = all.find((e) => e.k === 'land') as Extract<FrEvent, { k: 'land' }>;
    expect(land).toBeDefined();
    expect(land.v).toBeLessThanOrEqual(Math.sqrt(2 * FRP.g * P));
    expect(all.some((e) => e.k === 'wrap')).toBe(true);
    expect(b.cell[1]).toBe(-1);
    expect(b.ground).toBe('floor');
    const pred = dropAt(cell, [b.pos[0], feet[1], b.pos[2]], 2);
    const fell = feet[1] - (b.pos[1] - P);
    expect(Math.abs(fell - pred)).toBeLessThan(0.1);
    expect(land.power).toBe(land.v < FRP.landSoft ? 0 : land.v < FRP.landHard ? 1 : 2);
    expect(b.stun).toBeGreaterThan(0);
    expect(b.shake).toBeGreaterThan(0);
  });

  it('свободное падение без хода — точно по лучу вдоль −up (все 6 гравитаций)', () => {
    const env = envOf();
    let checked = 0;
    for (const up of AXES6) {
      // точка над дырой плиты по оси up: две другие координаты = 21.5 (над станцией 18, вне её дыр и пилонов)
      const at: V3 = [21.5, 21.5, 21.5];
      const ua = axisIdx(up);
      at[ua] = axisSign(up) > 0 ? 1 : 53;
      const b = bodyAt(at, up, FRAME[up].fwd);
      if (!free(env, b)) continue;
      const pred = dropAt(cell, at, up);
      const r = run(env, b, NO, 6, (e) => e.k === 'land');
      const land = r.ev.find((e) => e.k === 'land');
      expect(land).toBeDefined();
      const abs0 = at[ua], abs1 = b.cell[ua] * P + b.pos[ua];
      expect(Math.abs((abs0 - abs1) * axisSign(up) - pred)).toBeLessThan(0.1);
      checked++;
    }
    expect(checked).toBeGreaterThanOrEqual(4);
  });

  it('500 случайных стоячих точек × сход в 4 стороны (по 3 с ходьбы): никогда rescue, падение ≤ P', () => {
    const st = wander(cell, 500, 7);
    expect(st.rescues).toBe(0);
    expect(st.outside).toBe(0);
    expect(st.hanging).toBe(0);
    expect(st.maxFall).toBeLessThanOrEqual(P);
    expect(st.falls).toBeGreaterThan(50);
    expect(st.turns).toBeGreaterThan(50);
  }, 60_000);

  it('P = 81: 100 случайных точек × 4 стороны — тоже без rescue, падение ≤ P', () => {
    const c81 = buildFractalCell('t81', { P: 81 });
    const st = wander(c81, 100, 11);
    expect(st.rescues).toBe(0);
    expect(st.outside).toBe(0);
    expect(st.hanging).toBe(0);
    expect(st.maxFall).toBeLessThanOrEqual(81);
    expect(st.falls + st.turns).toBeGreaterThan(20);
  }, 60_000);

  it('обёртка: вдоль пилона три перехода копии подряд — cell ±1, pos ∈ [0, P)', () => {
    const env = envOf();
    // пилон вдоль X; его верх (up +Y) свободен по x ∈ [36, 54 + 17)
    const corner = [[18, 18], [34, 18], [18, 34], [34, 34]].find(([y0, z0]) => {
      for (let x = 36; x < P + 17; x++)
        for (let dz = 0; dz < 2; dz++) if (!stand(cell, x, y0 + 2, z0 + dz, 2)) return false;
      return true;
    });
    expect(corner).toBeDefined();
    const [y0, z0] = corner!;
    const b = bodyAt([37, y0 + 2, z0 + 1], 2, 0);
    const wraps: V3[] = [];
    const leg = (yawTo: Axis6, s: number) => {
      b.yaw = yawToward(2, yawTo);
      for (const e of run(env, b, W, s).ev) {
        expect(e.k).not.toBe('rescue');
        expect(e.k).not.toBe('land');
        if (e.k === 'wrap') wraps.push(e.d);
      }
      for (let k = 0; k < 3; k++) expect(b.pos[k] >= 0 && b.pos[k] < P).toBe(true);
      expect(b.ground).toBe('floor');
    };
    leg(0, 8);    // 37 → ~61: в копию +1
    expect(b.cell).toEqual([1, 0, 0]);
    leg(1, 4);    // назад: в копию 0
    expect(b.cell).toEqual([0, 0, 0]);
    leg(0, 4);    // снова вперёд: в копию +1
    expect(b.cell).toEqual([1, 0, 0]);
    expect(wraps).toEqual([[1, 0, 0], [-1, 0, 0], [1, 0, 0]]);
  });
});

describe('выход, страховки, детерминизм', () => {
  /** Перед нишей выхода на площадке, лицом в нишу. */
  function beforeNiche(c: V3): FrBody {
    const ex = cell.exit, ua = axisIdx(ex.up), us = axisSign(ex.up);
    const at: V3 = [0, 0, 0];
    for (let k = 0; k < 3; k++) at[k] = (ex.trigger.lo[k] + ex.trigger.hi[k]) / 2;
    at[ua] = us > 0 ? ex.arch.lo[ua] : ex.arch.hi[ua];
    const F = AXIS_VEC[ex.facing];
    for (let k = 0; k < 3; k++) at[k] += F[k] * 2.5;
    return bodyAt(at, ex.up, opp(ex.facing), c);
  }

  it('выход: в нишу в выходной копии (0,0,0) — exit (один раз), в (1,0,0) — нет', () => {
    const env = envOf();
    const b = beforeNiche([0, 0, 0]);
    const r = run(env, b, W, 3);
    expect(r.ev.filter((e) => e.k === 'exit')).toHaveLength(1);
    const b2 = beforeNiche([1, 0, 0]);
    const r2 = run(env, b2, W, 3);
    expect(r2.ev.some((e) => e.k === 'exit')).toBe(false);
  });

  it('тело в твёрдом: выталкивает вдоль up ≤ 3 м, иначе rescue', () => {
    const env = envOf();
    const b = bodyAt(wpt(WALL, -0.5, 2.5, WALL.t + 0.5), WALL.up, WALL.d);   // ступни в плите пола
    const r = run(env, b, NO, 0.2);
    expect(r.ev.some((e) => e.k === 'rescue')).toBe(false);
    expect(free(env, b)).toBe(true);
    // глубоко в ядре 1/27 (сплошное 2 м) нет — но в толще: проверка «не вытолкнуть»
    const deep = withVox(cell, (set) => { for (let h = 0; h < 8; h++) for (let di = 0; di < 5; di++) for (let t = WALL.t - 1; t <= WALL.t + 1; t++) set(...wvox(WALL, h, di, t), 7); });
    const env2 = envOf(deep);
    const b2 = bodyAt(wpt(WALL, 1, 2.5, WALL.t + 0.5), WALL.up, WALL.d);
    const r2 = run(env2, b2, NO, 0.1);
    expect(r2.ev.some((e) => e.k === 'rescue')).toBe(true);
  });

  it('в воздухе дольше airMaxS — rescue', () => {
    const empty = withVox(cell, (set) => { for (let y = 0; y < P; y++) set(40, y, 40, 0); });
    void empty;
    // столб пустоты не нужен: подменяем часы воздуха
    const env = envOf();
    const b = bodyAt([21.5, 1, 21.5], 2, 4);
    b.ground = 'air';
    b.airT = FRP.airMaxS - 0.01;
    const r = run(env, b, NO, 0.1);
    expect(r.ev.some((e) => e.k === 'rescue')).toBe(true);
  });

  it('детерминизм: одинаковые вводы → одинаковые тела (600 шагов)', () => {
    const go = () => {
      const env = envOf();
      const at = strip(cell, 6, 0);
      const b = bodyAt(at, 2, 0);
      placeBody(b, at, 2, 0.3);
      let s = 99;
      const rnd = () => ((s = (Math.imul(s, 1103515245) + 12345) >>> 0) / 4294967296);
      const evs: string[] = [];
      for (let i = 0; i < 600; i++) {
        const inp: FrInput = { fwd: rnd() < 0.8 ? 1 : 0, side: rnd() < 0.3 ? rnd() * 2 - 1 : 0, run: rnd() < 0.3, dYaw: (rnd() - 0.5) * 0.08, dPitch: (rnd() - 0.5) * 0.02, use: false };
        for (const e of stepBody(env, b, inp, DT)) evs.push(e.k);
      }
      return { b: JSON.stringify(b), evs: evs.join(',') };
    };
    const a = go(), b = go();
    expect(a.b).toBe(b.b);
    expect(a.evs).toBe(b.evs);
  });
});
