// Предмет в руке (./heldItem.ts) на NullEngine: модели лута — подменой setLootModels (коробки габаритом модели).
// Что в руке и что видно (сумки — нет, спичка вместо ячейки), смена предмета, свет по виду (луч / огонёк, свободный
// гаснет), пламя, левая рука, жест, модель догрузилась, dispose — всё убрано, общие шаблоны целы.
import { describe, expect, it } from 'vitest';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine';
import { Scene } from '@babylonjs/core/scene';
import { UniversalCamera } from '@babylonjs/core/Cameras/universalCamera';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { CreateBox } from '@babylonjs/core/Meshes/Builders/boxBuilder';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import type { Light } from '../game/itemUse';
import { HeldItem } from './heldItem';
import { LOOK_ITEMS, itemLookOf, setLootModels } from './itemLooks';
import { lootPropId } from './lootAssets';
import { LIGHT_SLOTS } from './flashlight';

const T = { timeout: 30000 };

function setup(ready = { v: true }) {
  const engine = new NullEngine();
  const scene = new Scene(engine);
  const cam = new UniversalCamera('fps', new Vector3(0, 1.6, 0), scene);
  scene.activeCamera = cam;
  const mat = new StandardMaterial('propModel:loot_test', scene);
  const tpls = new Map<string, Mesh>();
  for (const id of LOOK_ITEMS) {
    const sz = itemLookOf(id).size!;
    const b = CreateBox('propModel:' + lootPropId(id), { width: sz[0], height: sz[1], depth: sz[2] }, scene);
    b.position.y = sz[1] / 2;
    b.bakeCurrentTransformIntoVertices();
    b.material = mat;
    b.setEnabled(false);
    tpls.set(lootPropId(id)!, b);
  }
  setLootModels(scene, { get: (id) => (ready.v ? (tpls.get(id) ?? null) : null) });
  const held = new HeldItem({ scene, fps: cam }, { sound: () => false });
  const step = (n: number, m: { speed?: number; side?: -1 | 1; crawl?: number } = {}) => {
    for (let i = 0; i < n; i++) held.update(1 / 60, { speed: m.speed ?? 0, sprint: false, crawl: m.crawl ?? 0, side: m.side });
  };
  return { engine, scene, cam, held, mat, tpls, step, ready };
}

const P2_LIGHT: Light = { kind: 'spot', intensity: 1, range: 18, color: '#ffe2b0' };
const LAMP_LIGHT: Light = { kind: 'point', intensity: 0.8, range: 6, color: '#ffc070' };
const MATCH_LIGHT: Light = { kind: 'point', intensity: 0.5, range: 3.5, color: '#ffad5c' };
const heldMeshes = (scene: Scene) => scene.meshes.filter((m) => m.name.startsWith('held:'));

describe('HeldItem', () => {
  it('П-2 в руке: модель у камеры (группа 1, не подбирается), луч светит; выкл — гаснет; предел источников поднят', T, async () => {
    const { scene, cam, held, step, engine } = setup();
    // материалы, заведённые потом, — тоже (Babylon оповещает на следующем тике)
    const room = new StandardMaterial('room', scene);
    await new Promise((r) => setTimeout(r, 5));
    expect(room.maxSimultaneousLights).toBe(LIGHT_SLOTS);
    held.set({ item: 'it_flashlight', on: true }, P2_LIGHT);
    step(30);
    expect(held.shown).toBe('it_flashlight');
    expect(held.visible).toBe(true);
    const ms = heldMeshes(scene);
    expect(ms.some((m) => m.name === 'held:model')).toBe(true);
    expect(ms.some((m) => m.name === 'held:fist')).toBe(true);
    expect(ms.some((m) => m.name === 'held:lens')).toBe(true);
    for (const m of ms) {
      expect(m.renderingGroupId).toBe(1);
      expect(m.isPickable).toBe(false);
      expect(m.layerMask).toBe(0x0fffffff);
    }
    // справа внизу перед глазом
    const holder = scene.getTransformNodeByName('held:holder')!;
    expect(holder.parent).toBe(cam);
    expect(holder.position.x).toBeGreaterThan(0.1);
    expect(holder.position.y).toBeLessThan(-0.05);
    expect(holder.position.z).toBeGreaterThan(0.25);
    const spot = held.spotLight!;
    expect(spot.isEnabled()).toBe(true);
    expect(spot.intensity).toBeGreaterThan(0.5);
    expect(spot.range).toBe(18);
    // луч — вперёд, к прицелу
    expect(spot.direction.z).toBeGreaterThan(0.9);
    // своя копия материала (свечение «отражённого света» не трогает шаблон)
    const model = scene.getMeshByName('held:model')!;
    expect(model.material!.name).toBe('propModel:loot_test:held');
    // выключил — луч гаснет, модель в руке
    held.set({ item: 'it_flashlight', on: false }, null);
    step(30);
    expect(spot.intensity).toBe(0);
    expect(held.visible).toBe(true);
    held.dispose();
    engine.dispose();
  });

  it('смена предмета: керосинка — огонёк и пламя, луч гаснет и выключается; сумка — ничего; пусто — ничего', T, () => {
    const { scene, held, step, engine } = setup();
    held.set({ item: 'it_flashlight', on: true }, P2_LIGHT);
    step(10);
    held.set({ item: 'it_kerolamp' }, LAMP_LIGHT);
    step(5);
    expect(held.shown).toBe('it_kerolamp');
    expect(scene.getMeshByName('held:lens')).toBeNull();
    const pt = held.pointLight!;
    expect(pt.isEnabled()).toBe(true);
    expect(pt.intensity).toBeGreaterThan(0.8);
    expect(pt.range).toBe(6);
    // огонёк — ближе к глазу, чем пламя (не уходит в стену)
    expect(pt.position.z).toBeLessThanOrEqual(0.16 + 1e-9);
    expect(scene.getMeshByName('held:flame:outer')!.isEnabled()).toBe(true);
    // кисть — за дужку
    expect(scene.getMeshByName('held:fist')).toBeTruthy();
    // луч погашен сразу, выключен — через паузу (без пересборки шейдеров на каждом переключении)
    expect(held.spotLight!.intensity).toBe(0);
    step(120);
    expect(held.spotLight!.isEnabled()).toBe(false);
    // погасла — пламени нет, огонёк 0
    held.set({ item: 'it_kerolamp', on: false }, null);
    step(2);
    expect(scene.getMeshByName('held:flame:outer')!.isEnabled()).toBe(false);
    expect(pt.intensity).toBe(0);
    // сумка в руке не видна
    held.set({ item: 'it_backpack' }, null);
    step(2);
    expect(held.shown).toBeNull();
    expect(heldMeshes(scene).length).toBe(0);
    held.set(null, null);
    step(2);
    expect(held.shown).toBeNull();
    held.dispose();
    engine.dispose();
  });

  it('горящая спичка — в руке спичка (палочка и язычок), а не коробок; догорела — снова коробок', T, () => {
    const { scene, held, step, engine } = setup();
    held.set({ item: 'it_matches', n: 5 }, null);
    step(2);
    expect(held.shown).toBe('it_matches');
    expect(scene.getMeshByName('held:model')).toBeTruthy();
    held.set({ item: 'it_matches', n: 4 }, MATCH_LIGHT, { match: 'it_matches' });
    step(3);
    expect(held.shown).toBe('match:it_matches');
    expect(scene.getMeshByName('held:model')).toBeNull();
    expect(scene.getMeshByName('held:matchStick')).toBeTruthy();
    expect(scene.getMeshByName('held:flame:outer')!.isEnabled()).toBe(true);
    expect(held.pointLight!.intensity).toBeGreaterThan(0.4);
    held.set({ item: 'it_matches', n: 4 }, null, { match: null });
    step(2);
    expect(held.shown).toBe('it_matches');
    expect(scene.getMeshByName('held:matchStick')).toBeNull();
    held.dispose();
    engine.dispose();
  });

  it('левая рука — зеркально; жест «съесть» — ко рту и обратно; на четвереньках — рука спрятана, свет остаётся', T, () => {
    const { scene, held, step, engine } = setup();
    held.set({ item: 'it_bread' }, null);
    step(5);
    const x0 = scene.getTransformNodeByName('held:holder')!.position.x;
    expect(x0).toBeGreaterThan(0.1);
    step(5, { side: -1 });
    expect(held.handSide).toBe(-1);
    const hl = scene.getTransformNodeByName('held:holder')!;
    expect(hl.position.x).toBeLessThan(-0.1);
    step(5, { side: 1 });
    const h = scene.getTransformNodeByName('held:holder')!;
    held.gesture('eat');
    expect(held.gesturing).toBe('eat');
    step(27);
    // посреди жеста — ближе к середине кадра и к лицу
    expect(h.position.x).toBeLessThan(x0 - 0.08);
    expect(h.position.z).toBeLessThan(0.35);
    step(60);
    expect(held.gesturing).toBeNull();
    expect(h.position.x).toBeCloseTo(x0, 1);
    // четвереньки: рука вниз и выключена; луч П-2 — светит
    held.set({ item: 'it_flashlight', on: true }, P2_LIGHT);
    step(120, { crawl: 1 });
    expect(scene.getTransformNodeByName('held:holder')!.isEnabled()).toBe(false);
    expect(held.spotLight!.intensity).toBeGreaterThan(0.5);
    held.dispose();
    engine.dispose();
  });

  it('модель ещё грузится — пусто, свет есть; догрузилась — в руке; предмет без модели — посылка на ладони', T, () => {
    const ready = { v: false };
    const { scene, held, step, engine } = setup(ready);
    held.set({ item: 'it_zippo', on: true }, { kind: 'point', intensity: 0.45, range: 4, color: '#ffb35a' });
    step(3);
    expect(held.shown).toBe('it_zippo');
    expect(held.visible).toBe(false);
    expect(held.pointLight!.intensity).toBeGreaterThan(0.3);
    ready.v = true;
    held.set({ item: 'it_zippo', on: true }, { kind: 'point', intensity: 0.45, range: 4, color: '#ffb35a' });
    step(3);
    expect(held.visible).toBe(true);
    expect(scene.getMeshByName('held:flame:outer')!.isEnabled()).toBe(true);
    held.set({ item: 'it_something_else' }, null);
    step(2);
    expect(scene.getMeshByName('held:parcel')).toBeTruthy();
    held.dispose();
    engine.dispose();
  });

  it('dispose: меши, узлы, свет и свои материалы убраны; шаблоны и их материалы целы', T, () => {
    const { scene, held, step, engine, mat, tpls } = setup();
    held.set({ item: 'it_flashlight', on: true }, P2_LIGHT);
    step(3);
    held.set({ item: 'it_kerolamp' }, LAMP_LIGHT);
    step(3);
    held.set({ item: 'it_matches' }, MATCH_LIGHT, { match: 'it_hunt_matches' });
    step(3);
    held.dispose();
    expect(heldMeshes(scene).length).toBe(0);
    expect(scene.transformNodes.some((n) => n.name.startsWith('held:'))).toBe(false);
    expect(scene.lights.some((l) => l.name.startsWith('held:'))).toBe(false);
    expect(scene.materials.some((m) => m.name.startsWith('held:') || m.name.endsWith(':held'))).toBe(false);
    expect(scene.materials.includes(mat)).toBe(true);
    for (const t of tpls.values()) expect(t.isDisposed()).toBe(false);
    // после dispose — ничего не делает
    held.set({ item: 'it_flashlight', on: true }, P2_LIGHT);
    step(2);
    expect(heldMeshes(scene).length).toBe(0);
    engine.dispose();
  });
});
