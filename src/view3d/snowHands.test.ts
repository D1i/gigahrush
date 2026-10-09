// Руки ползком (./snowHands.ts) на NullEngine: на четвереньках — как было (handPose), лёжа — по-пластунски (ниже, шире,
// пальцы внутрь, рукав вбок к локтю, ход короче); переход — за FLAT_BLEND_S от времени, в обе стороны. Поза (./posture.ts)
// передаёт рукам «лёжа» сама: под кроватью руки — по-пластунски.
import { describe, expect, it } from 'vitest';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine';
import { Scene } from '@babylonjs/core/scene';
import { UniversalCamera } from '@babylonjs/core/Cameras/universalCamera';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import type { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { CrawlHands, FLAT_BLEND_S, flatPose, handPose } from './snowHands';
import { POSES, Posture } from './posture';

function rig() {
  const engine = new NullEngine();
  const scene = new Scene(engine);
  const cam = new UniversalCamera('fps', new Vector3(0, 0.5, 0), scene);
  scene.activeCamera = cam;
  const hands = new CrawlHands(scene, cam);
  const node = (side: -1 | 1) => scene.getTransformNodeByName(`snow:hand${side}`) as TransformNode;
  /** рукава (по порядку рук: левая, правая) */
  const sleeves = scene.meshes.filter((m) => m.name === 'snow:sleeve');
  return { scene, cam, hands, node, sleeves };
}

/** n кадров по 1/60 с, фаза — постоянная */
const run = (h: CrawlHands, n: number, phase: number, flat: boolean) => {
  for (let i = 0; i < n; i++) h.update(phase, 1, 1 / 60, flat);
};

describe('руки ползком: лёжа — по-пластунски', () => {
  it('на четвереньках — поза handPose, как была (руки вышли, дыхание — доли мм)', () => {
    const { hands, node } = rig();
    const ph = 0.7;
    run(hands, 240, ph, false);
    const breathe = 0.006 * Math.sin((240 / 60) * 1.7);
    for (const side of [-1, 1] as const) {
      const p = handPose(ph + (side > 0 ? Math.PI : 0), side, breathe);
      const n = node(side);
      expect(n.position.x).toBeCloseTo(p.x, 6);
      expect(n.position.y).toBeCloseTo(p.y, 6);
      expect(n.position.z).toBeCloseTo(p.z, 6);
      expect(n.rotation.y).toBeCloseTo(-side * 0.12, 6);
      expect(n.rotation.z).toBeCloseTo(side * 0.15, 6);
    }
  });

  it('лёжа — ниже, шире, пальцы внутрь, рукав вбок (короче, к локтю); ход короче; переход за FLAT_BLEND_S в обе стороны', () => {
    const { hands, node, sleeves } = rig();
    // упёртые (sin p < 0) и в воздухе — по обеим фазам
    for (const ph of [-Math.PI / 2, Math.PI / 2]) {
      run(hands, 240, ph, false);
      const fours = ([-1, 1] as const).map((s) => {
        const { x, y, z } = node(s).position;
        return { x, y, z, yaw: node(s).rotation.y };
      });
      const armFours = sleeves.map((m) => m.scaling.y);
      run(hands, Math.ceil((FLAT_BLEND_S * 60) / 2), ph, true);
      // на полпути — между позами
      const mid = node(1).position.x;
      run(hands, Math.ceil(FLAT_BLEND_S * 60), ph, true);
      ([-1, 1] as const).forEach((s, i) => {
        const n = node(s), want = flatPose(ph + (s > 0 ? Math.PI : 0), s);
        expect(n.position.x).toBeCloseTo(want.x, 6);
        expect(n.position.z).toBeCloseTo(want.z, 6);
        expect(n.position.y).toBeLessThanOrEqual(fours[i].y + 0.013); // + дыхание (±6 мм) между снимками
        expect(Math.abs(n.position.x)).toBeGreaterThan(Math.abs(fours[i].x));
        expect(-s * n.rotation.y).toBeGreaterThan(-s * fours[i].yaw + 0.1); // пальцы внутрь сильнее
        expect(sleeves[i].scaling.y).toBeLessThan(armFours[i]); // рукав — до локтя, не до плеча
        // рукав от запястья — вбок наружу (локти в стороны), а не вниз
        const d = sleeves[i].position.subtract(n.position);
        expect(s * d.x).toBeGreaterThan(Math.abs(d.y));
      });
      expect(Math.abs(mid)).toBeGreaterThan(Math.abs(fours[1].x) + 1e-3);
      expect(Math.abs(mid)).toBeLessThan(Math.abs(node(1).position.x) - 1e-3);
      // обратно — за то же время, к позе на четвереньках
      run(hands, Math.ceil(FLAT_BLEND_S * 60) + 1, ph, false);
      expect(node(1).position.x).toBeCloseTo(fours[1].x, 6);
      expect(node(1).position.z).toBeCloseTo(fours[1].z, 6);
    }
    // по всему циклу лёжа — не выше и шире; ход вперёд-назад короче
    const ps = Array.from({ length: 64 }, (_, i) => (i / 64) * Math.PI * 2);
    for (const p of ps) {
      expect(flatPose(p, 1).y).toBeLessThanOrEqual(handPose(p, 1).y + 1e-9);
      expect(flatPose(p, 1).x).toBeGreaterThan(handPose(p, 1).x);
    }
    const span = (pose: typeof handPose) => {
      const z = ps.map((p) => pose(p, 1).z);
      return Math.max(...z) - Math.min(...z);
    };
    expect(span(flatPose)).toBeLessThan(span(handPose) * 0.75);
  });

  it('поза передаёт «лёжа»: под кроватью руки — по-пластунски, выполз — снова на четвереньках', () => {
    const engine = new NullEngine();
    const scene = new Scene(engine);
    engine.getDeltaTime = () => 1000 / 60;
    const floor = MeshBuilder.CreateGround('floor', { width: 30, height: 30 }, scene);
    floor.checkCollisions = true;
    floor.computeWorldMatrix(true);
    const bed = MeshBuilder.CreateBox('bed', { width: 2, height: 0.2, depth: 0.9 }, scene);
    bed.position.set(1.5, 0.4, 0);
    bed.checkCollisions = true;
    bed.metadata = { kind: 'prop', cover: 'bed', clear: 0.3 };
    bed.computeWorldMatrix(true);
    const cam = new UniversalCamera('fps', new Vector3(0, POSES.stand.eye + 0.012, 0), scene);
    cam.ellipsoid = new Vector3(0.3, 0.85, 0.3);
    cam.ellipsoidOffset = new Vector3(0, 0.1, 0);
    scene.activeCamera = cam;
    const P = new Posture(scene, cam, () => true);
    const intent = cam.movement?.panDeltaCurrentFrame ?? cam.cameraDirection;
    const tick = (n: number, go = 0) => {
      for (let i = 0; i < n; i++) {
        intent.set(go, 0, 0);
        cam.position.x += go;
        scene.onBeforeRenderObservable.notifyObservers(scene);
      }
      intent.set(0, 0, 0);
    };
    const yaw = () => (scene.getTransformNodeByName('snow:hand1') as TransformNode).rotation.y;
    P.set('crawl');
    tick(90);
    expect(yaw()).toBeCloseTo(-0.12, 6);
    tick(130, 0.01); // под кровать
    expect(P.flat).toBe(true);
    expect(yaw()).toBeLessThan(-0.2);
    tick(130, -0.01); // выполз
    expect(P.flat).toBe(false);
    tick(30);
    expect(yaw()).toBeCloseTo(-0.12, 6);
    P.dispose();
  });
});
