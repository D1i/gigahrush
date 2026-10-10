// Погреб (./cellarWalk.ts) на NullEngine: поза (./posture.ts) и контроллер погреба над синтетическим ходом из боксов —
// ход 0.6 м (x −2…0), щель 0.4 м (x 0…1.5), снова ход 0.6 м (x 1.5…3). Камера двигается вручную (без коллизий
// Babylon); кадр — наблюдатели onAfterCheckInputs камеры и onBeforeRender сцены. Тело-эллипс по взгляду, поворот в щели
// упирается, «боком» — медленнее и без бега, подсказка «повернись боком», выход — к круглому плавно, обвал: засыпало,
// напарник откопал.
import { describe, expect, it } from 'vitest';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine';
import { Scene } from '@babylonjs/core/scene';
import { UniversalCamera } from '@babylonjs/core/Cameras/universalCamera';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import type { RunInstance } from '../blockout/types';
import type { CollapseSite } from '../locations/snowCollapse';
import { BODY, HINT_SLIT, SIDE_SPEED, bodyExtents } from '../locations/cellarSqueeze';
import { POSES, Posture, RISE_S } from './posture';
import { CellarWalk, probeFree, type CellarWalkHost } from './cellarWalk';

const DEG = Math.PI / 180;

function world(fps = 60) {
  const engine = new NullEngine();
  const scene = new Scene(engine);
  engine.getDeltaTime = () => 1000 / fps;
  const floor = MeshBuilder.CreateGround('floor', { width: 30, height: 30 }, scene);
  floor.checkCollisions = true;
  floor.computeWorldMatrix(true);
  /** стена-бокс x0..x1, z0..z1, высота 0…2.2 */
  const wall = (x0: number, x1: number, z0: number, z1: number) => {
    const m = MeshBuilder.CreateBox('wall', { width: x1 - x0, height: 2.2, depth: z1 - z0 }, scene);
    m.position.set((x0 + x1) / 2, 1.1, (z0 + z1) / 2);
    m.checkCollisions = true;
    m.computeWorldMatrix(true);
  };
  for (const s of [1, -1]) {
    wall(-2, 0, s > 0 ? 0.3 : -0.6, s > 0 ? 0.6 : -0.3);
    wall(0, 1.5, s > 0 ? 0.2 : -0.6, s > 0 ? 0.6 : -0.2);
    wall(1.5, 3, s > 0 ? 0.3 : -0.6, s > 0 ? 0.6 : -0.3);
  }
  const cam = new UniversalCamera('fps', new Vector3(-1, POSES.stand.eye + 0.012, 0), scene);
  cam.ellipsoid = new Vector3(0.3, 0.85, 0.3);
  cam.ellipsoidOffset = new Vector3(0, 0.1, 0);
  cam.speed = 0.22;
  scene.activeCamera = cam;
  const P = new Posture(scene, cam, () => true);
  const inst = (tags: string[]) => ({ id: 'r', roomTags: tags, connectors: [], bbox: { x0: -30, y0: -6, x1: 40, y1: 6 } }) as unknown as RunInstance;
  const st = {
    room: { id: 'r', inst: inst(['погреб', 'ход', 'щель']) },
    site: null as CollapseSite | null,
    collapsed: [] as CollapseSite[],
  };
  const host: CellarWalkHost = {
    room: () => st.room,
    pickSite: () => st.site,
    collapse: (s) => void st.collapsed.push(s),
    digProgress: () => null,
    dig: () => {},
    torch: () => false,
    live: () => true,
  };
  const W = new CellarWalk({ scene, fps: cam, posture: P }, host, 'test');
  /** n кадров; go — ход камеры за кадр (x, z) */
  const tick = (n: number, gx = 0, gz = 0) => {
    for (let i = 0; i < n; i++) {
      cam.position.x += gx;
      cam.position.z += gz;
      cam.onAfterCheckInputsObservable.notifyObservers(cam);
      scene.onBeforeRenderObservable.notifyObservers(scene);
    }
  };
  return { scene, cam, P, W, st, inst, tick };
}

describe('погреб: тело-эллипс и поворот в тесноте', () => {
  it('в погребе — эллипс по взгляду (ход 0.6 — поворот свободен)', () => {
    const w = world();
    w.tick(3);
    expect(w.P.body).toEqual({ a: BODY.a, b: BODY.b });
    expect(w.cam.ellipsoid.x).toBeCloseTo(0.23, 6);
    expect(w.cam.ellipsoid.z).toBeCloseTo(0.13, 6);
    w.cam.rotation.y = Math.PI / 2;
    w.tick(1);
    expect(w.cam.rotation.y).toBeCloseTo(Math.PI / 2, 9);
    expect(w.cam.ellipsoid.x).toBeCloseTo(0.13, 6);
    expect(w.cam.ellipsoid.z).toBeCloseTo(0.23, 6);
  });

  it('лучи вокруг: в щели ширина 0.4, в ходе 0.6', () => {
    const w = world();
    const f = probeFree(w.scene, 0.75, 0, [0.85, 1.3], 0.23, 0.13);
    const mid = f.z.find((s) => s.off === 0)!;
    expect(mid.pos + mid.neg).toBeCloseTo(0.4, 3);
    const g = probeFree(w.scene, -1, 0, [0.85, 1.3], 0.23, 0.13);
    const m2 = g.z.find((s) => s.off === 0)!;
    expect(m2.pos + m2.neg).toBeCloseTo(0.6, 3);
  });

  it('в щели: повернуться лицом вдоль нельзя — поворот упирается у ~50°, тело влезает; назад — свободно', () => {
    const w = world();
    w.cam.position.x = 0.75;
    w.tick(3);
    w.cam.rotation.y = Math.PI / 2;
    w.tick(1);
    const y = w.cam.rotation.y;
    expect(y).toBeGreaterThan(45 * DEG);
    expect(y).toBeLessThan(53 * DEG);
    w.tick(1);
    expect(w.cam.ellipsoid.z).toBeLessThanOrEqual(0.2 + 1e-6);
    // мышью дальше — стоит на месте, без дрожи
    for (let i = 0; i < 10; i++) {
      w.cam.rotation.y += 2 * DEG;
      w.tick(1);
      expect(w.cam.rotation.y).toBeCloseTo(y, 4);
    }
    // назад к стене — сразу
    w.cam.rotation.y = 0.1;
    w.tick(1);
    expect(w.cam.rotation.y).toBeCloseTo(0.1, 9);
  });

  it('прижат к стене в щели: поворот отодвигает от неё, внутрь стены тело не уходит', () => {
    const w = world();
    // лицом к +Z, грудь у стены (до неё 0.2 − 0.069 = 0.131)
    w.cam.position.set(0.75, w.cam.position.y, 0.069);
    w.tick(3);
    w.cam.rotation.y = 30 * DEG;
    w.tick(2);
    const e = bodyExtents(BODY.a, BODY.b, w.cam.rotation.y);
    expect(w.cam.position.z + e.z).toBeLessThanOrEqual(0.2 + 1e-6);
    expect(w.cam.position.z - e.z).toBeGreaterThanOrEqual(-0.2 - 1e-6);
  });
});

describe('погреб: боком', () => {
  it('идёт вдоль щели — боком: скорость ×SIDE_SPEED, бег нельзя (side); вышел в ход 0.6 — прямо', () => {
    const w = world();
    w.cam.position.x = 0.2;
    w.tick(3);
    w.tick(10, 0.01);
    expect(w.P.side).toBe(true);
    expect(w.W.squeezing).toBe(true);
    expect(w.cam.speed).toBeCloseTo(POSES.stand.speed * SIDE_SPEED, 6);
    // дошёл до хода 0.6
    w.cam.position.x = 1.9;
    w.tick(10, 0.01);
    expect(w.P.side).toBe(false);
    expect(w.cam.speed).toBeCloseTo(POSES.stand.speed, 6);
  });

  it('грудью вперёд в щель не пройти (коллизии Babylon пропустили бы углом) — боком проходит', () => {
    const w = world();
    w.cam.position.x = -0.5;
    w.cam.rotation.y = Math.PI / 2; // лицом вдоль (+X)
    w.tick(3);
    w.tick(80, 0.01);
    // до щели (x = 0) плечи не доходят: тело 0.46 поперёк, щель 0.4
    expect(w.cam.position.x).toBeLessThan(-0.04);
    expect(w.cam.position.x).toBeGreaterThan(-0.2);
    // лицом к стене — проходит
    w.cam.rotation.y = 0;
    w.tick(2);
    w.tick(150, 0.01);
    expect(w.cam.position.x).toBeGreaterThan(1.2);
    expect(w.P.side).toBe(true);
  });

  it('давит W в щель грудью вперёд — «Не пролезть — повернись боком»', () => {
    const w = world();
    w.cam.position.x = -0.08;
    w.cam.rotation.y = Math.PI / 2; // лицом к щели (+X)
    w.tick(3);
    (w.W as unknown as { fwd: Set<string> }).fwd.add('KeyW');
    w.tick(30);
    expect(w.W.hudNow.hint).toBe(HINT_SLIT);
  });

  it('вышел из погреба — тело к круглому плавно (за RISE_S), без рывка', () => {
    const w = world();
    w.tick(3);
    expect(w.cam.ellipsoid.x).toBeCloseTo(0.23, 6);
    w.st.room = { id: 'r2', inst: w.inst(['подвал']) };
    w.tick(1);
    expect(w.P.body).toBeNull();
    let prevX = w.cam.ellipsoid.x, prevZ = w.cam.ellipsoid.z, maxStep = 0;
    for (let i = 0; i < Math.ceil(RISE_S * 60) + 5; i++) {
      w.tick(1);
      maxStep = Math.max(maxStep, Math.abs(w.cam.ellipsoid.x - prevX), Math.abs(w.cam.ellipsoid.z - prevZ));
      prevX = w.cam.ellipsoid.x;
      prevZ = w.cam.ellipsoid.z;
    }
    expect(maxStep).toBeLessThan(0.02);
    expect(w.cam.ellipsoid.x).toBeCloseTo(0.3, 6);
    expect(w.cam.ellipsoid.z).toBeCloseTo(0.3, 6);
    expect(w.P.rising).toBe(false);
  });
});

describe('погреб: обвал', () => {
  it('метры по узкому ходу → треск 2 с → обвал (мир — host.collapse); у места — засыпан, напарник откопал', () => {
    const w = world();
    w.tick(3);
    w.st.site = { inst: 'r', connector: 'n', x: -1.3, y: 0 };
    w.W.collapse.next = w.W.collapse.crawled + 0.05;
    w.tick(10, 0.01);
    expect(w.W.collapse.phase).toBe('warn');
    w.tick(130);
    expect(w.st.collapsed).toHaveLength(1);
    expect(w.W.buried).toBe(true);
    expect(w.P.frozen).toBe(true);
    expect(w.W.hudNow.buried).toBe(0);
    expect(w.W.hudNow.prompt).toMatch(/откапываться/);
    for (let i = 0; i < 4; i++) w.W.mateDig();
    expect(w.W.buried).toBe(false);
    w.tick(1);
    expect(w.P.frozen).toBe(false);
    const c = w.cam.position;
    expect(Math.hypot(c.x - -1.3, c.z - 0)).toBeGreaterThanOrEqual(1.1);
    // пыль после обвала — туман сжался
    expect(w.scene.fogEnd).toBeLessThan(4.5);
  });
});
