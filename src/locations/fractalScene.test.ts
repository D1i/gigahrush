// «Фрактальная станция», чистые части сцены (SCENE, tmp/metro-wip/FRACTAL.md §5): копии, видимость копий, эхо шагов,
// ориентация граней, yaw напарника — в соглашении физики.
import { describe, expect, it } from 'vitest';
import { echoDelay, windGain } from './fractalAudio';
import { lineOfSight, mateImage, nearestImage, SHIFTS, SightMask, sightMask, yawFwd } from './fractalCopies';
import { ALL, DROP_MAX, escDrop, FAR, LIGHT_FAR, LIGHT_R, NEAR, RING3, orientIndices } from './fractalView';
import { frFadeK, frWidenS } from './fractalFade';
import { collapsePose, createEscWorld, startCollapse, stepEscWorld } from './fractalEsc';
import { ESC } from './metroEscalator';
import { AXIS_VEC, AXES6, type V3 } from './fractalAxes';
import { FR_HANGING_PROPS, VX, buildFractalCell, footVox, vidx, voxAt, type FractalCell } from './fractalCell';
import { axisIdx, opp } from './fractalAxes';
import { bodyPose, camPose, createBody } from './fractalPhysics';

/** Ячейка-коробка P³: пусто, кроме стены x = wall (вся плоскость, кроме дыры [h0, h1)² по y, z). */
function boxCell(P: number, wall: number, h0 = 0, h1 = 0): FractalCell {
  const vox = new Uint8Array(P * P * P);
  for (let y = 0; y < P; y++) for (let z = 0; z < P; z++) if (!(y >= h0 && y < h1 && z >= h0 && z < h1)) vox[vidx(P, wall, y, z)] = VX.SLAB;
  return { P, vox } as unknown as FractalCell;
}

describe('fractal scene: копии', () => {
  it('ближние 27 (своя — первая), дальние 98, все 125 — без повторов', () => {
    expect(NEAR.length).toBe(27);
    expect(NEAR[0]).toEqual([0, 0, 0]);
    expect(FAR.length).toBe(98);
    expect(new Set(ALL.map((k) => k.join(','))).size).toBe(125);
    for (const k of FAR) expect(Math.max(...k.map(Math.abs))).toBe(2);
    expect(SHIFTS.length).toBe(26);
    expect(SHIFTS.some((k) => k[0] === 0 && k[1] === 0 && k[2] === 0)).toBe(false);
  });

  it('ближайший образ точки — в полупериоде', () => {
    expect(nearestImage([50, 3, 27], [2, 3, 27], 54)).toEqual([-4, 3, 27]);
    expect(nearestImage([10, 10, 10], [10, 10, 10], 54)).toEqual([10, 10, 10]);
    const p = nearestImage([-100, 160, 7], [5, 5, 5], 54);
    for (let a = 0; a < 3; a++) expect(Math.abs(p[a] - 5)).toBeLessThanOrEqual(27);
  });
});

describe('fractal scene: прямая видимость (DDA по вокселям, мир периодичен)', () => {
  const P = 54;
  it('стена закрывает, дыра в ней — нет; луч через границу ячейки — по модулю', () => {
    const c = boxCell(P, 30, 20, 34);
    expect(lineOfSight(c, [10.5, 5.5, 5.5], [40.5, 5.5, 5.5])).toBe(false);
    expect(lineOfSight(c, [10.5, 25.5, 25.5], [40.5, 26.5, 27.5])).toBe(true);
    // вдоль стены (не пересекает её)
    expect(lineOfSight(c, [10.5, 5.5, 5.5], [10.5, 45.5, 50.5])).toBe(true);
    // сдвиг на −P по x: стена x = 30 − 54 = −24 между −30 и −10
    expect(lineOfSight(c, [-10.5, 5.5, 5.5], [-30.5, 5.5, 5.5])).toBe(false);
    // диагональ мимо стены через дыру и в соседнюю копию (x > P)
    expect(lineOfSight(c, [25.5, 25.5, 25.5], [70.5, 30.5, 29.5])).toBe(true);
  });
  it('подложка сломанного эскалатора — пусто', () => {
    const c = boxCell(P, 54 - 1, 0, 0);
    c.vox.fill(0);
    c.vox[vidx(P, 20, 5, 5)] = VX.ESC0 + 3;
    expect(lineOfSight(c, [15.5, 5.5, 5.5], [25.5, 5.5, 5.5])).toBe(false);
    expect(lineOfSight(c, [15.5, 5.5, 5.5], [25.5, 5.5, 5.5], new Set([3]))).toBe(true);
  });
});

describe('fractal scene: эскалатор заслоняет копии (маска взгляда)', () => {
  it('луч поперёк наклона над ступенями: по вокселям — открыт, с маской — закрыт; сломан — открыт', () => {
    const c = buildFractalCell('t1');
    const e = c.esc.find((x) => x.kind === 'main')!;
    const u = AXIS_VEC[e.up], f = AXIS_VEC[e.fwd];
    const r: V3 = [u[1] * f[2] - u[2] * f[1], u[2] * f[0] - u[0] * f[2], u[0] * f[1] - u[1] * f[0]];
    const s = e.run / 2, h = s * Math.tan(Math.PI / 6) + 0.5;
    const at = (b: number): V3 => [0, 1, 2].map((k) => e.o[k] + r[k] * b + u[k] * h + f[k] * s) as V3;
    const a = at(-e.width / 2 - 1.6), b = at(e.width / 2 + 1.6);
    const m = sightMask(c);
    // над серединой наклона воксели пусты (наклон — не воксели)
    expect(lineOfSight(c, a, b)).toBe(true);
    expect(lineOfSight(c, a, b, undefined, m)).toBe(false);
    const broken = new Set([e.i]);
    expect(lineOfSight(c, a, b, broken, sightMask(c, broken))).toBe(true);
  });
});

describe('fractal scene: эхо и ветер', () => {
  it('задержка эха 2·d/343 в [0.08, 0.4]', () => {
    expect(echoDelay(34.3)).toBeCloseTo(0.2, 5);
    expect(echoDelay(1)).toBe(0.08);
    expect(echoDelay(500)).toBe(0.4);
    expect(echoDelay(null)).toBe(0.4);
  });
  it('ветер из ниши: у ниши — полный, дальше 90 м — нет, монотонно', () => {
    expect(windGain(0)).toBe(1);
    expect(windGain(95)).toBe(0);
    expect(windGain(20)).toBeGreaterThan(windGain(60));
  });
});

describe('fractal scene: ориентация граней мешера', () => {
  it('обход наоборот — переворачивается, верный — остаётся', () => {
    // квад в плоскости y = 0, нормаль +Y
    const pos = [0, 0, 0, 1, 0, 0, 1, 0, 1, 0, 0, 1];
    const nrm = [0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0];
    // лицевая Babylon: cross(p1 − p0, p2 − p0) против нормали
    const good = [0, 1, 2, 0, 2, 3];
    const cr = (i: number[]) => {
      const a = i[0] * 3, b = i[1] * 3, c = i[2] * 3;
      const u = [pos[b] - pos[a], pos[b + 1] - pos[a + 1], pos[b + 2] - pos[a + 2]], v = [pos[c] - pos[a], pos[c + 1] - pos[a + 1], pos[c + 2] - pos[a + 2]];
      return u[2] * v[0] - u[0] * v[2]; // y-компонента
    };
    expect(cr(good)).toBeLessThan(0);
    expect([...orientIndices(pos, nrm, good)]).toEqual(good);
    const bad = [0, 2, 1, 0, 3, 2];
    expect([...orientIndices(pos, nrm, bad)]).toEqual(good);
    const u32 = orientIndices(pos, nrm, new Uint32Array(bad));
    expect(u32).toBeInstanceOf(Uint32Array);
  });
});

describe('fractal scene: yaw напарника = соглашение физики', () => {
  it('yawFwd(up, yaw) совпадает со взглядом тела (bodyPose.fwd, camPose.fwd при pitch 0)', () => {
    for (const up of AXES6) {
      for (const yaw of [0, 0.7, -2.1, Math.PI]) {
        const b = createBody({ at: [27, 27, 27], up, fwd: up === 2 || up === 3 ? 4 : 2 }, [0, 0, 0]);
        b.yaw = yaw;
        b.pitch = 0;
        const f = yawFwd(up, yaw);
        const bp = bodyPose(b).fwd, cp = camPose(b).fwd;
        for (let a = 0; a < 3; a++) {
          expect(f[a]).toBeCloseTo(bp[a], 6);
          expect(f[a]).toBeCloseTo(cp[a], 6);
        }
        // в плоскости пола
        const U = AXIS_VEC[up] as V3;
        expect(Math.abs(f[0] * U[0] + f[1] * U[1] + f[2] * U[2])).toBeLessThan(1e-9);
      }
    }
  });
});

// FIX (ревью): напарник — образ у МОИХ ступней (раньше уползал на 2P), маска взгляда — правка по срыву без пересборки P³,
// сорвавшийся эскалатор падает до DROP_MAX, а не пропадает на 12.5 м.
describe('fractal scene: образ напарника', () => {
  const P = 54;
  const me: V3 = [27, 27, 27];
  it('уходит от меня в одну сторону на 3P — образ всегда у моих ступней (≤ P/2 + 2), равен ему по модулю P', () => {
    let prev: V3 | null = null, old: V3 | null = null, oldMax = 0;
    for (let d = 0; d <= 3 * P; d += 0.3) {
      const feet: V3 = [me[0] + d, me[1], me[2]];
      const img = mateImage(feet, prev, me, P);
      expect(Math.abs(img[0] - me[0])).toBeLessThanOrEqual(P / 2 + 2 + 1e-9);
      const k = (img[0] - feet[0]) / P;
      expect(Math.abs(k - Math.round(k))).toBeLessThan(1e-9);
      prev = img;
      // как было: ближайший к прошлой позе — уползает
      const o = nearestImage(nearestImage(feet, me, P), old ?? nearestImage(feet, me, P), P);
      old = o;
      oldMax = Math.max(oldMax, Math.abs(o[0] - me[0]));
    }
    expect(oldMax).toBeGreaterThan(2 * P);
  });
  it('на границе полупериода (±0.5 м) образ не дёргается туда-сюда', () => {
    let prev: V3 | null = null, flips = 0, last: number | null = null;
    for (let i = 0; i < 100; i++) {
      const feet: V3 = [me[0] + P / 2 + (i % 2 ? 0.5 : -0.5), me[1], me[2]];
      const img = mateImage(feet, prev, me, P);
      if (last !== null && Math.abs(img[0] - last) > 3) flips++;
      last = img[0];
      prev = img;
    }
    expect(flips).toBe(0);
  });
  it('первый пакет — ближайший к моим ступням образ', () => {
    expect(mateImage([27 + 2 * 54 + 5, 27 - 54, 27], null, me, P)).toEqual([32, 27, 27]);
  });
});

describe('fractal scene: маска взгляда правится по срыву', () => {
  const c = buildFractalCell('t1');
  const order = c.esc.filter((e) => e.kind !== 'exit').map((e) => e.i).sort((a, b) => ((a * 7919) % 13) - ((b * 7919) % 13));
  /** Число несовпавших вокселей (toEqual на P³ медленный). */
  const diff = (a: Uint8Array, b: Uint8Array): number => {
    let n = a.length === b.length ? 0 : Infinity;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) n++;
    return n;
  };
  it('после каждого срыва (в разном порядке) — та же маска, что полная сборка; без перемен — ничего', () => {
    const sm = new SightMask(c);
    expect(diff(sm.m, sightMask(c))).toBe(0);
    const broken = new Set<number>();
    for (const i of order) {
      broken.add(i);
      sm.sync(broken);
      expect(sm.ver).toBe(broken.size);
      expect(diff(sm.m, sightMask(c, broken))).toBe(0);
    }
    sm.sync(broken);
    expect(sm.ver).toBe(broken.size);
    // убыль (восстановление) — полная пересборка, тоже совпадает
    const fewer = new Set(order.slice(0, 2));
    sm.sync(fewer);
    expect(diff(sm.m, sightMask(c, fewer))).toBe(0);
    // собранная сразу со сломанными
    expect(diff(new SightMask(c, fewer).m, sightMask(c, fewer))).toBe(0);
  });
  it('срыв — дёшево: правка ≪ полной сборки (было 27–33 мс в кадре срыва)', () => {
    const sm = new SightMask(c);
    const broken = new Set<number>();
    let worst = 0;
    for (const i of order) {
      broken.add(i);
      const t0 = performance.now();
      sm.sync(broken);
      worst = Math.max(worst, performance.now() - t0);
    }
    const t1 = performance.now();
    sightMask(c, broken);
    const full = performance.now() - t1;
    expect(worst).toBeLessThan(Math.max(3, full / 4));
  });
});

describe('fractal scene: падение сорвавшегося эскалатора', () => {
  it('после конца стадии fall (≈ 12.5 м) падает дальше до DROP_MAX и только тогда прячется; без скачков', () => {
    const c = buildFractalCell('t1');
    const i = c.esc.findIndex((e) => e.kind === 'main');
    const w = createEscWorld(c, 't1');
    expect(startCollapse(w, i, 0, true)).toBe(true);
    const dt = 1 / 60;
    let tau: number | null = null, t = 0, hiddenAt = -1, prev = 0, maxShown = 0, jump = 0, brokenAt = -1;
    for (let n = 0; n < 60 * 12; n++) {
      stepEscWorld(w, dt, { rideStart: null, near: [] });
      t += dt;
      const pose = collapsePose(w, i);
      if (!pose && brokenAt < 0 && w.broken.has(i)) brokenAt = t;
      const o = escDrop(pose, w.broken.has(i), tau, dt);
      tau = o.tau;
      if (o.hidden) {
        if (hiddenAt < 0) hiddenAt = t;
        continue;
      }
      expect(hiddenAt).toBe(-1);
      maxShown = Math.max(maxShown, o.drop);
      jump = Math.max(jump, Math.abs(o.drop - prev));
      prev = o.drop;
    }
    const fall0 = ESC.shudderS + ESC.runawayS;
    // стадия fall кончилась раньше, чем конструкция ушла на DROP_MAX
    expect(brokenAt).toBeGreaterThan(0);
    expect(brokenAt).toBeLessThan(fall0 + Math.sqrt((2 * DROP_MAX) / 9.8));
    expect(maxShown).toBeGreaterThan(DROP_MAX - 1);
    expect(hiddenAt).toBeCloseTo(fall0 + Math.sqrt((2 * DROP_MAX) / 9.8), 1);
    // кадр — не больше g·τ·dt (+ запас)
    expect(jump).toBeLessThan(9.8 * Math.sqrt((2 * DROP_MAX) / 9.8) * dt + 0.05);
  });
  it('сломан без срыва в кадре (вошёл, а он уже сломан) — спрятан сразу', () => {
    const o = escDrop(null, true, null, 1 / 60);
    expect(o.hidden).toBe(true);
    expect(escDrop(null, false, null, 1 / 60).hidden).toBe(false);
  });
});

// LOOK (tmp/metro-wip/notes-fr-look.md): своя кривая света вместо тумана, расширение нитей «струн», кольца копий, кессоны
describe('fractal look: угасание света и нити струн', () => {
  const f = { x: 18, y: 125, z: 194, w: 262 };
  it('до x — полная яркость, дальше монотонно вниз, к w — ноль; без обрезки (w ≤ z) — не ноль', () => {
    expect(frFadeK(0, f)).toBe(1);
    expect(frFadeK(18, f)).toBe(1);
    let prev = 1;
    for (let d = 20; d <= 300; d += 5) {
      const k = frFadeK(d, f);
      expect(k).toBeLessThanOrEqual(prev + 1e-12);
      prev = k;
    }
    expect(frFadeK(262, f)).toBe(0);
    expect(frFadeK(1000, { x: 30, y: 120, z: 0, w: 0 })).toBeGreaterThan(0);
    // струны тессеракта видны на много ячеек: в 3 ячейках (162 м) — не меньше 1/4
    expect(frFadeK(162, f)).toBeGreaterThan(0.25);
  });
  it('нить не тоньше доли пикселя: вблизи как есть (1), вдали — расширение ∝ дальности', () => {
    const px = 0.6 * (2 * Math.tan(1.15 / 2)) / 1000;
    expect(frWidenS(0.075, 10, px)).toBe(1);
    expect(frWidenS(0.075, 300, px)).toBeCloseTo((300 * px) / 0.075, 9);
    expect(frWidenS(0.075, 300, px) / frWidenS(0.075, 200, px)).toBeCloseTo(1.5, 9);
  });
  it('кольца: силуэты |k| = 3 (218), огни 2 ≤ |k| ≤ LIGHT_R — без ближних 27', () => {
    expect(RING3).toHaveLength(7 ** 3 - 5 ** 3);
    expect(LIGHT_FAR).toHaveLength((2 * LIGHT_R + 1) ** 3 - 27);
    expect(LIGHT_FAR.every((k) => Math.max(...k.map(Math.abs)) >= 2)).toBe(true);
  });
});

describe('fractal look: кессоны на гранях станции 18', () => {
  it('висят на оболочке (за ними SHELL1, перед ними пусто), ≥ 3 граней, не больше 4 на грань', () => {
    for (const seed of ['t1', 'fa1', 'look-fa1', 's7']) {
      const c = buildFractalCell(seed);
      expect(FR_HANGING_PROPS.has('p_metro_light')).toBe(true);
      const cof = c.props.filter((p) => p.id === 'p_metro_light');
      expect(cof.length, seed).toBeGreaterThanOrEqual(6);
      const faces = new Map<number, number>();
      for (const p of cof) {
        const back = footVox(p.at, p.up), front = footVox(p.at, opp(p.up));
        expect(voxAt(c, back[0], back[1], back[2]), seed).toBe(VX.SHELL1);
        expect(voxAt(c, front[0], front[1], front[2]), seed).toBe(VX.AIR);
        expect(axisIdx(p.fwd)).not.toBe(axisIdx(p.up));
        faces.set(p.up, (faces.get(p.up) ?? 0) + 1);
      }
      expect(faces.size, seed).toBeGreaterThanOrEqual(3);
      for (const n of faces.values()) expect(n).toBeLessThanOrEqual(4);
    }
  });
});
