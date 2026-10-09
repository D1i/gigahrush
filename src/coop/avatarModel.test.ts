/// <reference types="node" />
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine';
import { Scene } from '@babylonjs/core/scene';
import { UniversalCamera } from '@babylonjs/core/Cameras/universalCamera';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { AvatarModels, COAT_TINTS, HEAD_CRAWL, coatTint, postureWeights, type BodyPose } from './avatarModel';

const T = { timeout: 30000 };
// модель — data: URL (в Node загрузчик не читает пути vite)
const glb = () =>
  'data:model/gltf-binary;base64,' + readFileSync(fileURLToPath(new URL('./assets/bandaged_man.glb', import.meta.url))).toString('base64');

function scene() {
  const engine = new NullEngine();
  const sc = new Scene(engine);
  sc.activeCamera = new UniversalCamera('fps', new Vector3(0, 1.6, -3), sc);
  return { engine, sc };
}

/** Кадр сцены: анимации, затем поза (как в presence: onBeforeRender — после анимаций). */
function frame(sc: Scene, f: () => void) {
  sc.animate();
  f();
}

describe('веса позы', () => {
  it('стоя на месте — Idle_Standing, на ходу — Walk', () => {
    expect(postureWeights(1.6, 0).w.Idle_Standing).toBeCloseTo(1);
    expect(postureWeights(1.6, 1.4).w.Walk).toBeCloseTo(1);
    expect(postureWeights(1.6, 1.4).squash).toBe(1);
  });
  it('на четвереньках — Crawl, лёжа — сплюснут, скрючившись — между', () => {
    const c = postureWeights(0.5, 0.5);
    expect(c.w.Crawl).toBeCloseTo(1);
    expect(c.squash).toBeCloseTo(0.5 / HEAD_CRAWL);
    expect(postureWeights(0.22, 0).squash).toBeLessThan(0.4);
    const h = postureWeights(1.1, 0);
    expect(h.crawl).toBeGreaterThan(0.4);
    expect(h.crawl).toBeLessThan(0.7);
    expect(h.squash).toBe(1);
  });
  it('веса в сумме 1', () => {
    for (const eye of [0.22, 0.5, 0.9, 1.1, 1.6])
      for (const v of [0, 0.2, 0.5, 2]) {
        const w = postureWeights(eye, v).w;
        expect(w.Idle_Standing + w.Walk + w.Idle_Crawl + w.Crawl).toBeCloseTo(1);
      }
  });
  it('шинель: первый — как в наборе, второй — иначе, по кругу', () => {
    expect(coatTint(0).equals(COAT_TINTS[0])).toBe(true);
    expect(coatTint(undefined).equals(COAT_TINTS[0])).toBe(true);
    expect(coatTint(1).equals(COAT_TINTS[0])).toBe(false);
    expect(coatTint(COAT_TINTS.length + 1)).toBe(coatTint(1));
  });
});

describe('модель игрока', () => {
  it('грузится, копии со своим скелетом и клипами; шинель второго — другого цвета', T, async () => {
    const { engine, sc } = scene();
    const models = new AvatarModels(sc, glb());
    await models.loaded;
    expect(models.error).toBeNull();
    expect(models.ready).toBe(true);
    const a = models.make('a', 0)!;
    const b = models.make('b', 1)!;
    expect(a.meshes.length).toBe(8);
    expect(a.meshes.every((m) => !!m.skeleton)).toBe(true);
    expect(a.meshes[0].skeleton).not.toBe(b.meshes[0].skeleton);
    expect(Object.keys(a.weights).sort()).toEqual(['Crawl', 'Idle_Crawl', 'Idle_Standing', 'Walk']);
    // шинель — своя у второго, остальное — общее
    const coatA = a.meshes.find((m) => /Field wool/.test(m.material!.name))!.material!;
    const coatB = b.meshes.find((m) => /Field wool/.test(m.material!.name))!.material!;
    expect(coatA).not.toBe(coatB);
    const c0 = models.coatColor(0)!, c1 = models.coatColor(1)!;
    expect(c0.equals(c1)).toBe(false);
    // «слегка»: не дальше 0.1 по каналу
    expect(Math.max(Math.abs(c0.r - c1.r), Math.abs(c0.g - c1.g), Math.abs(c0.b - c1.b))).toBeLessThan(0.1);
    const linenA = a.meshes.find((m) => /Aged linen/.test(m.material!.name))!.material!;
    const linenB = b.meshes.find((m) => /Aged linen/.test(m.material!.name))!.material!;
    expect(linenA).toBe(linenB);
    expect(sc.materials.some((m) => m.getClassName() === 'PBRMaterial')).toBe(false);
    // 8 материалов набора + сукно и швы шинели второго
    expect(sc.materials.length).toBe(10);
    a.dispose();
    b.dispose();
    models.dispose();
    engine.dispose();
  });

  it('поза: голова у глаз — стоя над ногами, ползком впереди и низко; руки по бокам', T, async () => {
    const { engine, sc } = scene();
    const models = new AvatarModels(sc, glb());
    await models.loaded;
    const a = models.make('a', 0)!;
    a.setEnabled(true);
    const stand: BodyPose = { x: 2, y: 1.6, z: 3, eye: 1.6, yaw: Math.PI / 2, pitch: 0, speed: 0 };
    for (let i = 0; i < 5; i++) frame(sc, () => a.update(stand));
    const h = a.head.getAbsolutePosition();
    expect(h.y).toBeGreaterThan(1.45);
    expect(h.y).toBeLessThan(1.8);
    expect(Math.hypot(h.x - 2, h.z - 3)).toBeLessThan(0.15);
    // взгляд вдоль +X (yaw π/2): правая рука — к −Z (вправо от взгляда в Babylon — (cos yaw, −sin yaw))
    const r = a.handPos('R'), l = a.handPos('L');
    expect(r.z).toBeLessThan(l.z);
    expect(r.y).toBeLessThan(1.2);
    const crawl: BodyPose = { ...stand, eye: 0.5, y: 0.5 };
    for (let i = 0; i < 5; i++) frame(sc, () => a.update(crawl));
    const c = a.head.getAbsolutePosition();
    expect(c.y).toBeLessThan(0.75);
    expect(Math.hypot(c.x - 2, c.z - 3)).toBeLessThan(0.2);
    // ползком руки — на полу, впереди ног
    expect(a.handPos('R').y).toBeLessThan(0.25);
    expect(a.handPos('R').x).toBeGreaterThan(a.root.position.x);
    a.dispose();
    models.dispose();
    engine.dispose();
  });
});
