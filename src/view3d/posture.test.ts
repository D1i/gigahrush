// Поза от первого лица (./posture.ts) на NullEngine: камера двигается вручную (без коллизий Babylon), кадр — наблюдатель
// onBeforeRender позы. Лёжа под кровать (коллайдер — плита от 0.30 м, metadata.cover), «здесь не встать» под ней,
// выполз — снова на четвереньки; подъём: за RISE_S от времени (а не кадров), опора своя до конца, эллипсоид не выше
// места над головой, упёрся — назад ниже; под стол — на четвереньках.
import { describe, expect, it } from 'vitest';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine';
import { Scene } from '@babylonjs/core/scene';
import { UniversalCamera } from '@babylonjs/core/Cameras/universalCamera';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { NOTE_FLAT, NOTE_LOW, POSES, PRONE, Posture, RISE_S, type Pose } from './posture';

function world(fps = 60) {
  const engine = new NullEngine();
  const scene = new Scene(engine);
  engine.getDeltaTime = () => 1000 / fps;
  const floor = MeshBuilder.CreateGround('floor', { width: 30, height: 30 }, scene);
  floor.checkCollisions = true;
  floor.computeWorldMatrix(true);
  const cam = new UniversalCamera('fps', new Vector3(0, POSES.stand.eye + 0.012, 0), scene);
  cam.ellipsoid = new Vector3(0.3, 0.85, 0.3);
  cam.ellipsoidOffset = new Vector3(0, 0.1, 0);
  scene.activeCamera = cam;
  const P = new Posture(scene, cam, () => true);
  const notes: (string | null)[] = [];
  const poses: Pose[] = [];
  P.onChange = (p, n) => {
    poses.push(p);
    notes.push(n);
  };
  /** плита (укрытие или потолок): x0..x1, z0..z1, низ y0, верх y1 */
  const slab = (name: string, x0: number, x1: number, z0: number, z1: number, y0: number, y1: number, md: object | null): Mesh => {
    const m = MeshBuilder.CreateBox(name, { width: x1 - x0, height: y1 - y0, depth: z1 - z0 }, scene);
    m.position.set((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
    m.checkCollisions = true;
    m.isVisible = false;
    m.metadata = md;
    m.computeWorldMatrix(true);
    return m;
  };
  /** n кадров; go — ход за кадр по x (и «намерение» камеры туда же) */
  const tick = (n: number, go = 0, each?: () => void) => {
    const intent = cam.movement?.panDeltaCurrentFrame ?? cam.cameraDirection;
    for (let i = 0; i < n; i++) {
      intent.set(go, 0, 0);
      cam.position.x += go;
      scene.onBeforeRenderObservable.notifyObservers(scene);
      each?.();
    }
    intent.set(0, 0, 0);
  };
  /** верх эллипсоида над ногами: ellipsoidOffset.y = lift + 2·ell.y − eye ⇒ верх = offset + eye */
  const topOf = () => cam.ellipsoidOffset.y + P.eye;
  return { scene, cam, P, notes, poses, slab, tick, topOf };
}

describe('поза: лёжа под кровать', () => {
  it('ползёшь к кровати — ложится, под ней under = bed, C — «здесь не встать»; выполз — на четвереньки', () => {
    const w = world();
    const { P, cam } = w;
    // кровать: x 0.5…2.5, плита 0.30…0.50
    w.slab('bed', 0.5, 2.5, -0.45, 0.45, 0.3, 0.5, { kind: 'prop', cover: 'bed', clear: 0.3 });
    P.set('crawl');
    w.tick(90);
    expect(P.pose).toBe('crawl');
    expect(P.flat).toBe(false);
    expect(P.eye).toBeCloseTo(POSES.crawl.eye, 1);
    // стоит рядом (0.4 м до края, не ползёт к ней) — не ложится
    cam.position.x = 0.1;
    w.tick(10);
    expect(P.flat).toBe(false);
    // ползёт к кровати: ближе 0.45 м — лёжа (эллипсоид сразу низкий, под плиту)
    w.tick(2, 0.01);
    expect(P.flat).toBe(true);
    expect(cam.ellipsoid.y).toBeCloseTo(PRONE.ell[1], 6);
    expect(w.topOf()).toBeLessThan(0.3 - P.feet);
    expect(w.notes.filter((n) => n === NOTE_FLAT)).toHaveLength(1);
    // под кровать (до x = 1.2) — глаз под плитой, under = bed
    w.tick(110, 0.01);
    expect(cam.position.x).toBeGreaterThan(1.1);
    expect(P.under).toBe('bed');
    expect(cam.position.y).toBeLessThan(0.3);
    expect(P.feet).toBeCloseTo(0.012, 2);
    // C под кроватью — нельзя
    w.notes.length = 0;
    expect(P.toggle()).toBe(false);
    expect(w.notes).toEqual([NOTE_LOW]);
    expect(P.pose).toBe('crawl');
    expect(P.flat).toBe(true);
    // выползает назад: пока ближе 0.3 м к краю — лёжа; дальше — подъём на четвереньки
    w.tick(110, -0.01);
    expect(cam.position.x).toBeLessThan(0.15);
    expect(P.under).toBe(null);
    expect(P.flat).toBe(false);
    w.tick(60);
    expect(P.rising).toBe(false);
    expect(P.eye).toBeCloseTo(POSES.crawl.eye, 1);
    expect(cam.ellipsoid.y).toBeCloseTo(POSES.crawl.ell[1], 6);
    // ещё раз под кровать за тот же заход на четвереньки — без надписи
    w.notes.length = 0;
    w.tick(40, 0.01);
    expect(P.flat).toBe(true);
    expect(w.notes).toEqual([]);
  });

  it('под стол (плита от 0.62) — на четвереньках, не лёжа; under = table', () => {
    const w = world();
    const { P, cam } = w;
    w.slab('table', 0.5, 1.5, -0.4, 0.4, 0.62, 0.75, { kind: 'prop', cover: 'table', clear: 0.62 });
    P.set('crawl');
    w.tick(90);
    w.tick(100, 0.01);
    expect(cam.position.x).toBeGreaterThan(0.9);
    expect(P.flat).toBe(false);
    expect(P.under).toBe('table');
    expect(P.toggle()).toBe(false);
    expect(P.pose).toBe('crawl');
  });
});

describe('поза: подъём', () => {
  const rise = (fps: number) => {
    const w = world(fps);
    const { P, cam } = w;
    P.set('crawl');
    w.tick(fps * 2);
    cam.rotation.x = 0.9; // смотрел в пол
    expect(P.toggle()).toBe(true);
    expect(P.pose).toBe('stand');
    let frames = 0;
    let prevEye = P.eye;
    let maxJump = 0;
    while (P.rising && frames < fps * 3) {
      expect(cam.applyGravity).toBe(false); // своя опора, пока встаёт
      w.tick(1);
      frames++;
      maxJump = Math.max(maxJump, P.eye - prevEye);
      prevEye = P.eye;
    }
    return { w, P, cam, sec: frames / fps, maxJump };
  };

  it('за RISE_S при 30, 60 и 144 к/с; гравитация — только когда встал; взгляд — к горизонту', () => {
    for (const fps of [30, 60, 144]) {
      const { P, cam, sec, maxJump, w } = rise(fps);
      expect(Math.abs(sec - RISE_S)).toBeLessThanOrEqual(1.5 / fps + 1e-9);
      // без рывка: за кадр глаз поднимается не больше, чем при самой крутой части smoothstep (1.5 × путь / RISE_S)
      expect(maxJump).toBeLessThanOrEqual((1.5 * (POSES.stand.eye - POSES.crawl.eye) * (1 / fps)) / RISE_S + 0.01);
      w.tick(1);
      expect(cam.applyGravity).toBe(true);
      expect(P.eye).toBeCloseTo(POSES.stand.eye, 3); // + затухающий толчок хода
      expect(cam.ellipsoid.asArray()).toEqual(POSES.stand.ell);
      expect(Math.abs(cam.rotation.x)).toBeLessThan(0.3);
    }
  });

  it('эллипсоид не выше места над головой; упёрся — назад на четвереньки с «здесь не встать»', () => {
    const w = world();
    const { P, cam } = w;
    P.set('crawl');
    w.tick(120);
    expect(P.toggle()).toBe(true);
    w.tick(8);
    // сверху опустилась плита: низ на 1.0 м (кусок пересобрался, вылез под полку)
    w.slab('shelf', -2, 2, -2, 2, 1.0, 1.1, null);
    w.notes.length = 0;
    let maxTop = 0;
    w.tick(40, 0, () => {
      if (P.rising) maxTop = Math.max(maxTop, P.feet + w.topOf());
    });
    expect(maxTop).toBeGreaterThan(0.9);
    expect(maxTop).toBeLessThanOrEqual(1.0);
    expect(P.rising).toBe(false);
    expect(P.pose).toBe('crawl');
    expect(w.notes).toEqual([NOTE_LOW]);
    expect(cam.applyGravity).toBe(false);
    expect(cam.ellipsoid.y).toBeCloseTo(POSES.crawl.ell[1], 6);
  });

  it('у стены встаёт, отходя от неё плавно (эллипсоид растёт вширь 0.25 → 0.3)', () => {
    const w = world();
    const { P, cam } = w;
    // стена x ≥ 0.25 (вплотную к эллипсоиду четверенек)
    w.slab('wall', 0.25, 0.5, -3, 3, 0, 2.6, null);
    P.set('crawl');
    w.tick(120);
    expect(P.toggle()).toBe(true);
    let maxStep = 0;
    let x = cam.position.x;
    w.tick(60, 0, () => {
      maxStep = Math.max(maxStep, Math.abs(cam.position.x - x));
      x = cam.position.x;
    });
    expect(P.pose).toBe('stand');
    expect(P.rising).toBe(false);
    expect(cam.position.x).toBeLessThanOrEqual(0.25 - POSES.stand.ell[0] + 0.01);
    expect(cam.position.x).toBeGreaterThan(-0.08);
    expect(maxStep).toBeLessThan(0.01);
  });
});
