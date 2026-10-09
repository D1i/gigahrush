// Предметы на полу (./worldItems.ts) на NullEngine: сборка по списку (новые / пропавшие / сдвинутые), без изменений —
// без работы, видимость по комнатам, свет горящих фонарей (не больше двух), выбор предмета под взглядом, подсветка;
// фонарь в руке (./flashlight.ts): свет только в руке, предел источников у материалов поднят.
import { describe, expect, it, vi } from 'vitest';

/** на загруженной машине (параллельные сессии, tsc) сцена NullEngine собирается медленно — не 5 с по умолчанию */
const T = { timeout: 30000 };
import { NullEngine } from '@babylonjs/core/Engines/nullEngine';
import { Scene } from '@babylonjs/core/scene';
import { UniversalCamera } from '@babylonjs/core/Cameras/universalCamera';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { CreateBox } from '@babylonjs/core/Meshes/Builders/boxBuilder';
import { CreateCylinder } from '@babylonjs/core/Meshes/Builders/cylinderBuilder';
import { MultiMaterial } from '@babylonjs/core/Materials/multiMaterial';
import { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial';
import { PointLight } from '@babylonjs/core/Lights/pointLight';
import { SpotLight } from '@babylonjs/core/Lights/spotLight';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import type { WorldDrop } from '../gen4d/stream';
import { FLASHLIGHT_ITEM, WorldItems, dropPose, itemLook } from './worldItems';
import { KEROLAMP_ITEM } from '../locations/obshaga';
import { Flashlight, FlashlightModel, LIGHT_SLOTS } from './flashlight';
import { LANTERN_COLOR } from './obshagaScene';

function setup() {
  const engine = new NullEngine();
  const scene = new Scene(engine);
  const cam = new UniversalCamera('fps', new Vector3(0, 1.6, 0), scene);
  scene.activeCamera = cam;
  return { engine, scene, cam };
}

const drop = (id: string, item: string, x: number, z: number, o: Partial<WorldDrop> = {}): WorldDrop => ({ id, item, inst: 'r1', x, y: 0, z, yaw: 0, ...o });
const dropMeshes = (scene: Scene) => scene.meshes.filter((m) => m.name.startsWith('drop:') && !m.name.endsWith('Tpl') && m.name !== 'drop:glow');

describe('WorldItems.sync', () => {
  it('строит, удаляет, двигает на месте; тот же массив / та же версия — без работы', T, () => {
    const { scene } = setup();
    const items = new WorldItems(scene);
    const a = [drop('a', FLASHLIGHT_ITEM, 0, 1), drop('b', 'it_canned', 1, 1), drop('c', 'it_unknown', -1, 1)];
    expect(items.sync(a, 1)).toBe(true);
    expect(items.size).toBe(3);
    expect(items.stats).toEqual({ created: 3, disposed: 0, updated: 0 });
    const n0 = dropMeshes(scene).length;
    expect(n0).toBeGreaterThan(3);
    // та же версия (даже с другим массивом) и тот же массив — ничего
    expect(items.sync([...a], 1)).toBe(false);
    expect(items.sync(a)).toBe(false);
    expect(items.stats).toEqual({ created: 3, disposed: 0, updated: 0 });
    // равный по полям новый объект — не перестраивается
    expect(items.sync(a.map((d) => ({ ...d })), 2)).toBe(false);
    expect(items.stats).toEqual({ created: 3, disposed: 0, updated: 0 });
    // b пропал, a сдвинут и включён, d новый
    const b2 = [{ ...a[0], x: 2, on: true }, a[2], drop('d', 'it_bandage', 0, -1)];
    expect(items.sync(b2, 3)).toBe(true);
    expect(items.stats).toEqual({ created: 4, disposed: 1, updated: 1 });
    expect(items.has('b')).toBe(false);
    expect(items.has('d')).toBe(true);
    const root = scene.getTransformNodeByName('drop:a')!;
    expect(root.position.x).toBe(2);
    // другой предмет под тем же id — пересборка
    items.sync([{ ...b2[0], item: 'it_matches' }, b2[1], b2[2]], 4);
    expect(items.stats).toEqual({ created: 5, disposed: 2, updated: 1 });
    // всё убрали
    items.sync([], 5);
    expect(items.size).toBe(0);
    expect(dropMeshes(scene).length).toBe(0);
    items.dispose();
    scene.dispose();
  });

  it('видимость по roomShown и shown; свет — у двух ближайших горящих фонарей', T, () => {
    const { scene } = setup();
    let hidden = new Set<string>();
    let on = true;
    const items = new WorldItems(scene, { roomShown: (inst) => !hidden.has(inst), shown: () => on });
    items.sync([
      drop('f1', FLASHLIGHT_ITEM, 0, 2, { on: true }),
      drop('f2', FLASHLIGHT_ITEM, 0, 4, { on: true }),
      drop('f3', FLASHLIGHT_ITEM, 0, 9, { on: true }),
      drop('f4', FLASHLIGHT_ITEM, 0, 3, { on: true, inst: 'r2' }),
      drop('box', 'it_canned', 1, 1),
    ]);
    items.update();
    const enabled = (id: string) => scene.getTransformNodeByName('drop:' + id)!.isEnabled();
    expect(enabled('f1') && enabled('f4') && enabled('box')).toBe(true);
    expect(items.litCount).toBe(2);
    expect(scene.lights.filter((l) => l.name.startsWith('drop:lamp')).length).toBe(2);
    // комната r2 не видна — её фонарь не светит и не виден
    hidden = new Set(['r2']);
    items.sync([]); // (новый массив — тот же набор не важен для видимости)
    items.sync([
      drop('f1', FLASHLIGHT_ITEM, 0, 2, { on: true }),
      drop('f2', FLASHLIGHT_ITEM, 0, 4, { on: true }),
      drop('f4', FLASHLIGHT_ITEM, 0, 3, { on: true, inst: 'r2' }),
    ]);
    items.update();
    expect(enabled('f4')).toBe(false);
    expect(enabled('f1')).toBe(true);
    const lamp = scene.lights.find((l) => l.name.startsWith('drop:lamp') && l.intensity > 0)!;
    expect(lamp).toBeTruthy();
    // shown() = false — ничего не видно
    on = false;
    items.update();
    expect(enabled('f1')).toBe(false);
    items.dispose();
    expect(scene.lights.some((l) => l.name.startsWith('drop:lamp'))).toBe(false);
    scene.dispose();
  });

  it('nearest: в конусе взгляда и рядом под ногами; highlight меняет и возвращает материалы', T, () => {
    const { scene } = setup();
    const items = new WorldItems(scene);
    items.sync([drop('ahead', 'it_canned', 0, 1.1), drop('behind', 'it_bandage', 0, -1.2), drop('far', 'it_matches', 0, 3)]);
    items.update();
    const eye = new Vector3(0, 1.6, 0);
    // смотрит вперёд и вниз
    const down = new Vector3(0, -0.8, 1).normalize();
    expect(items.nearest(eye, down)?.id).toBe('ahead');
    // смотрит назад и вниз
    expect(items.nearest(eye, new Vector3(0, -0.8, -1).normalize())?.id).toBe('behind');
    // смотрит в потолок — далеко от конуса; ближе 0.6 м нет никого
    expect(items.nearest(eye, new Vector3(0, 1, 0))).toBeNull();
    // под ногами — в любую сторону
    items.sync([drop('feet', 'it_canned', 0.3, 0.2)]);
    items.update();
    expect(items.nearest(eye, new Vector3(0, 1, 0))?.id).toBe('feet');
    // стена между глазом и предметом
    items.sync([drop('walled', 'it_canned', 0, 1.1)]);
    items.update();
    expect(items.nearest(eye, down)?.id).toBe('walled');
    const wall = CreateBox('wall', { width: 2, height: 3, depth: 0.1 }, scene);
    wall.position.set(0, 1.5, 0.6);
    wall.checkCollisions = true;
    wall.computeWorldMatrix(true);
    expect(items.nearest(eye, down)).toBeNull();
    wall.dispose();
    // подсветка: свой материал, снятие — исходный
    const box = scene.getMeshByName('drop:walled:box')!;
    const orig = box.material;
    items.highlight('walled');
    expect(items.highlighted).toBe('walled');
    expect(box.material).not.toBe(orig);
    items.update();
    items.highlight(null);
    expect(box.material).toBe(orig);
    items.dispose();
    scene.dispose();
  });

  it('подсвеченный фонарь включили (тот же id) — линза горит и под подсветкой, и после неё', T, () => {
    const { scene } = setup();
    const items = new WorldItems(scene);
    items.sync([drop('f', FLASHLIGHT_ITEM, 0, 1, { on: false })]);
    items.highlight('f');
    const lens = scene.getMeshByName('drop:f:flash:lens')!;
    expect(lens.material!.name).toBe('flash:lensOff:hl');
    items.sync([drop('f', FLASHLIGHT_ITEM, 0, 1, { on: true })]);
    expect(items.highlighted).toBe('f');
    expect(lens.material!.name).toBe('flash:lensOn:hl');
    items.highlight(null);
    expect(lens.material!.name).toBe('flash:lensOn');
    items.dispose();
    scene.dispose();
  });

  it('dispose: копии подсветки (и подматериалы MultiMaterial) удалены, исходные материалы моделей — целы', T, () => {
    const { scene } = setup();
    const a = new StandardMaterial('mA', scene);
    const b = new StandardMaterial('mB', scene);
    const mm = new MultiMaterial('mMulti', scene);
    mm.subMaterials = [a, b];
    const multiTpl = CreateBox('tplMulti', { size: 0.2 }, scene);
    multiTpl.material = mm;
    const pbr = new PBRMaterial('mPbr', scene);
    const pbrTpl = CreateBox('tplPbr', { size: 0.2 }, scene);
    pbrTpl.material = pbr;
    for (const t of [multiTpl, pbrTpl]) t.setEnabled(false);
    const tpl: Record<string, Mesh> = { it_multi: multiTpl, it_pbr: pbrTpl };
    const items = new WorldItems(scene, { itemModel: (i) => tpl[i] ?? null });
    items.sync([drop('m', 'it_multi', 0, 1), drop('p', 'it_pbr', 0.5, 1)]);
    items.update();
    items.highlight('m');
    expect(scene.getMeshByName('drop:m:model')!.material!.name).toBe('mMulti:hl');
    expect(scene.materials.some((m) => m.name === 'mA:hl')).toBe(true);
    items.highlight('p');
    // не Standard — как есть (своя копия не делается)
    expect(scene.getMeshByName('drop:p:model')!.material).toBe(pbr);
    items.dispose();
    for (const m of [a, b, pbr]) expect(scene.materials.includes(m)).toBe(true);
    expect(scene.multiMaterials.includes(mm)).toBe(true);
    expect(scene.materials.some((m) => m.name.endsWith(':hl'))).toBe(false);
    expect(scene.multiMaterials.some((m) => m.name.endsWith(':hl'))).toBe(false);
    expect(multiTpl.material).toBe(mm);
    expect(pbrTpl.material).toBe(pbr);
    scene.dispose();
  });
});

describe('Керосиновая лампа на полу (ITEM_LOOKS)', () => {
  /** «летучая мышь» 0.35 м: пивот — центр низа */
  const lampTpl = (scene: Scene) => {
    const m = CreateCylinder('tplLamp', { height: 0.35, diameter: 0.2 }, scene);
    m.position.y = 0.175;
    m.bakeCurrentTransformIntoVertices();
    m.setEnabled(false);
    return m;
  };
  const lamps = (scene: Scene) => scene.lights.filter((l) => l.name.startsWith('drop:lamp') && l.isEnabled() && l.intensity > 0);

  it('стоит, светит тёплым точечным с дрожью; on: false — не светит; модель догрузилась — коробка пересобрана', T, async () => {
    expect(itemLook(KEROLAMP_ITEM)).toMatchObject({ pose: 'stand', light: { kind: 'point' } });
    expect(itemLook(FLASHLIGHT_ITEM)).toMatchObject({ pose: 'lie', light: { kind: 'spot' } });
    expect(itemLook('it_canned').light).toBeNull();
    const { scene } = setup();
    let tpl: Mesh | null = null;
    const items = new WorldItems(scene, { itemModel: (i) => (i === KEROLAMP_ITEM ? tpl : null) });
    const k: WorldDrop = { id: 'k', item: KEROLAMP_ITEM, inst: 'r1', x: 0, y: 0, z: 1.5, yaw: 0 };
    // модели ещё нет (наборы PropModels грузятся) — коробка, но светит
    items.sync([k]);
    items.update();
    expect(scene.getMeshByName('drop:k:box')).toBeTruthy();
    expect(items.litIds).toEqual(['k']);
    // догрузилась — через MODEL_RETRY_MS коробка пересобрана моделью
    tpl = lampTpl(scene);
    const real = performance.now.bind(performance);
    const spy = vi.spyOn(performance, 'now').mockImplementation(() => real() + 5000);
    items.update();
    expect(scene.getMeshByName('drop:k:box')).toBeNull();
    const model = scene.getMeshByName('drop:k:model')!;
    expect(model).toBeTruthy();
    // стоит: не повёрнута, низ — на полу, высота — своя
    const pose = scene.getTransformNodeByName('drop:k:pose')!;
    expect(pose.rotation.x).toBe(0);
    expect(pose.rotation.z).toBe(0);
    model.computeWorldMatrix(true);
    const bb = model.getBoundingInfo().boundingBox;
    expect(bb.minimumWorld.y).toBeCloseTo(0, 3);
    expect(bb.maximumWorld.y).toBeCloseTo(0.35, 3);
    items.update();
    const [l] = lamps(scene);
    expect(l).toBeInstanceOf(PointLight);
    expect(l.diffuse.equals(LANTERN_COLOR)).toBe(true);
    expect((l as PointLight).position.y).toBeCloseTo(0.15, 3);
    expect((l as PointLight).position.z).toBeCloseTo(1.5, 3);
    // дрожь пламени
    const seen = new Set<number>();
    for (let i = 0; i < 4; i++) {
      await new Promise((r) => setTimeout(r, 35));
      items.update();
      seen.add(Math.round(l.intensity * 1e4));
    }
    expect(seen.size).toBeGreaterThan(1);
    for (const v of seen) expect(v / 1e4).toBeGreaterThan(0.6);
    // погашена — не светит
    items.sync([{ ...k, on: false }]);
    items.update();
    expect(items.litCount).toBe(0);
    spy.mockRestore();
    items.dispose();
    scene.dispose();
  });

  it('предел источников — общий с фонарями: светят два ближайших; вид источника — по предмету', T, () => {
    const { scene } = setup();
    const tpl = lampTpl(scene);
    const items = new WorldItems(scene, { itemModel: (i) => (i === KEROLAMP_ITEM ? tpl : null) });
    const lamp = (id: string, z: number): WorldDrop => ({ id, item: KEROLAMP_ITEM, inst: 'r1', x: 0, y: 0, z, yaw: 0 });
    items.sync([drop('f1', FLASHLIGHT_ITEM, 0, 2, { on: true }), lamp('k1', 3), drop('f2', FLASHLIGHT_ITEM, 0, 5, { on: true })]);
    items.update();
    expect(items.litIds.sort()).toEqual(['f1', 'k1']);
    expect(lamps(scene).length).toBe(2);
    expect(lamps(scene).some((l) => l instanceof PointLight)).toBe(true);
    expect(lamps(scene).some((l) => l instanceof SpotLight)).toBe(true);
    // лампу унесли дальше — светят два фонаря; включённых источников — не больше двух
    items.sync([drop('f1', FLASHLIGHT_ITEM, 0, 2, { on: true }), lamp('k1', 9), drop('f2', FLASHLIGHT_ITEM, 0, 5, { on: true })]);
    items.update();
    expect(items.litIds.sort()).toEqual(['f1', 'f2']);
    expect(scene.lights.filter((l) => l.name.startsWith('drop:lamp') && l.isEnabled()).length).toBeLessThanOrEqual(2);
    items.dispose();
    scene.dispose();
  });
});

describe('Лежащий фонарь: свет', () => {
  it('пятно на полу: источник над линзой, луч — вниз к полу перед фонарём', T, () => {
    const { scene } = setup();
    const items = new WorldItems(scene);
    items.sync([drop('f', FLASHLIGHT_ITEM, 0, 1, { on: true })]);
    items.update();
    const l = scene.lights.find((x) => x.name.startsWith('drop:lamp') && x.isEnabled()) as SpotLight;
    expect(l).toBeInstanceOf(SpotLight);
    expect(l.position.y).toBeGreaterThan(0.1);
    // не вскользь: ось — к полу под 10…35°
    expect(l.direction.y).toBeLessThan(-Math.sin((10 * Math.PI) / 180));
    expect(l.direction.y).toBeGreaterThan(-Math.sin((35 * Math.PI) / 180));
    expect(l.direction.z).toBeGreaterThan(0.8);
    // ось луча — на пол в 0.5…1.8 м перед фонарём (z = 1)
    const t = -l.position.y / l.direction.y;
    const hitZ = l.position.z + l.direction.z * t;
    expect(hitZ).toBeGreaterThan(1.5);
    expect(hitZ).toBeLessThan(2.8);
    // сам фонарь — вне конуса (не пересвечен сверху)
    const toBody = new Vector3(0, 0.02, 1).subtract(l.position).normalize();
    expect(Vector3.Dot(toBody, l.direction)).toBeLessThan(Math.cos(0.6));
    // светлая полоса на полу от линзы вперёд — пока горит; стена впереди — короче, не сквозь неё
    const pool = scene.getMeshByName('drop:f:pool')!;
    expect(pool.isEnabled()).toBe(true);
    const pb = pool.getBoundingInfo().boundingBox;
    expect(pb.minimumWorld.z).toBeGreaterThan(1.05);
    expect(pb.maximumWorld.z).toBeGreaterThan(1.4);
    expect(pb.maximumWorld.y).toBeLessThan(0.01);
    items.sync([drop('f', FLASHLIGHT_ITEM, 0, 1, { on: false })]);
    expect(pool.isEnabled()).toBe(false);
    const wall = CreateBox('wall', { width: 2, height: 3, depth: 0.1 }, scene);
    wall.position.set(0, 1.5, 1.35);
    wall.checkCollisions = true;
    wall.computeWorldMatrix(true);
    items.sync([drop('f', FLASHLIGHT_ITEM, 0, 1, { on: true })]);
    expect(pool.isEnabled()).toBe(true);
    expect(pool.getBoundingInfo().boundingBox.maximumWorld.z).toBeLessThan(1.3);
    items.dispose();
    expect(scene.meshes.some((m) => m.name.includes('pool'))).toBe(false);
    scene.dispose();
  });
});

describe('WorldItems и портальный рендер', () => {
  it('меши — поставщиком по комнатам (PORTAL_LAYER), у проёма — и с соседом; подбор — только из своей комнаты и соседей', T, () => {
    const { scene } = setup();
    // r1: пол x 0…4, план y 0…4 (Babylon z 0…−4); проём в r2 на x = 4, план y 1…2; r9 — другой слой W в том же месте
    const piece = (id: string, floor: { x0: number; y0: number; x1: number; y1: number }[], portals: unknown[]) => ({ id, floor, portals });
    const pieces = new Map<string, unknown>([
      ['r1', piece('r1', [{ x0: 0, y0: 0, x1: 4, y1: 4 }], [{ to: 'r2', shiftB: null, axis: 'x', at: 4, dir: 1, rect: { x0: 3.9, y0: 1, x1: 4.1, y1: 2 } }])],
      ['r2', piece('r2', [{ x0: 4, y0: 0, x1: 8, y1: 4 }], [{ to: 'r1', shiftB: null, axis: 'x', at: 4, dir: -1, rect: { x0: 3.9, y0: 1, x1: 4.1, y1: 2 } }])],
      ['r9', piece('r9', [{ x0: 0, y0: 0, x1: 4, y1: 4 }], [])],
    ]);
    const portal = {
      isActive: true,
      current: 'r1',
      lastRooms: new Set(['r1', 'r2']),
      extraProviders: new Set<(room: string) => readonly unknown[] | undefined>(),
      cache: { peek: (id: string) => pieces.get(id) ?? null },
    };
    const items = new WorldItems(scene, { portal: () => portal as never });
    items.sync([
      { id: 'door', item: 'it_canned', inst: 'r1', x: 3.8, y: 0, z: -1.5, yaw: 0 },
      { id: 'mid', item: FLASHLIGHT_ITEM, inst: 'r1', x: 1, y: 0, z: -1, yaw: 0, on: true },
      { id: 'ghost', item: 'it_canned', inst: 'r9', x: 1, y: 0, z: -1.6, yaw: 0 },
    ]);
    items.update();
    expect(portal.extraProviders.size).toBe(1);
    const [prov] = portal.extraProviders;
    const names = (room: string) => (prov(room) ?? []).map((m) => (m as { name: string }).name);
    expect(names('r1').some((n) => n.startsWith('drop:door:'))).toBe(true);
    expect(names('r1').some((n) => n.startsWith('drop:mid:'))).toBe(true);
    // у проёма — и с соседом; посреди комнаты — нет
    expect(names('r2').some((n) => n.startsWith('drop:door:'))).toBe(true);
    expect(names('r2').some((n) => n.startsWith('drop:mid:'))).toBe(false);
    expect(names('r9').some((n) => n.startsWith('drop:ghost:'))).toBe(true);
    const m = scene.getMeshByName('drop:door:box')!;
    expect(m.layerMask).toBe(0x10000000);
    // горящий фонарь в нарисованной комнате — светит
    expect(items.litCount).toBe(1);
    // подбор: «призрак» другого слоя W стоит рядом в 3D, но его комната — не своя и не соседняя
    const eye = new Vector3(1, 1.6, -1.2);
    expect(items.nearest(eye, new Vector3(0, -1, 0))?.id).toBe('mid');
    portal.current = 'r9';
    expect(items.nearest(eye, new Vector3(0, -1, 0))?.id).toBe('ghost');
    // рендер выключен — поставщик снят
    portal.isActive = false;
    items.update();
    expect(portal.extraProviders.size).toBe(0);
    expect(m.layerMask).toBe(0x0fffffff);
    items.dispose();
    scene.dispose();
  });

  it('сосед другого слоя W на месте текущей: его предмет по эту сторону проёма не достать и не светит; за швом — не светит', T, () => {
    const { scene, cam } = setup();
    // r1: пол x 0…4; проём в r2 на x = 4 (план y 1…2); r2 — другой слой W: пол x 2…8 — в 3D заходит на r1 (x 2…4);
    // r3 — за швом (нарисована сдвинутой), но её место прогона — тоже здесь
    const piece = (id: string, floor: { x0: number; y0: number; x1: number; y1: number }[], portals: unknown[]) => ({ id, floor, portals });
    const door = { axis: 'x', at: 4, rect: { x0: 3.9, y0: 1, x1: 4.1, y1: 2 } };
    const pieces = new Map<string, unknown>([
      ['r1', piece('r1', [{ x0: 0, y0: 0, x1: 4, y1: 4 }], [{ to: 'r2', shiftB: null, dir: 1, ...door }, { to: 'r3', shiftB: new Vector3(20, 0, 0), axis: 'y', at: 0, dir: -1, rect: { x0: 1, y0: -0.1, x1: 2, y1: 0.1 } }])],
      ['r2', piece('r2', [{ x0: 2, y0: 0, x1: 8, y1: 4 }], [{ to: 'r1', shiftB: null, dir: -1, ...door }])],
      ['r3', piece('r3', [{ x0: 0, y0: 0, x1: 4, y1: 4 }], [])],
    ]);
    const portal = {
      isActive: true,
      current: 'r1',
      lastRooms: new Set(['r1', 'r2', 'r3']),
      extraProviders: new Set<(room: string) => readonly unknown[] | undefined>(),
      cache: { peek: (id: string) => pieces.get(id) ?? null },
    };
    cam.position.set(3.4, 1.6, -1.5);
    const items = new WorldItems(scene, { portal: () => portal as never });
    items.sync([
      // в r2, но по эту сторону проёма — в 3D внутри r1 (отсечено, не видно)
      { id: 'inside', item: FLASHLIGHT_ITEM, inst: 'r2', x: 3, y: 0, z: -2.6, yaw: 0, on: true },
      // в r2 за проёмом
      { id: 'beyond', item: FLASHLIGHT_ITEM, inst: 'r2', x: 4.8, y: 0, z: -1.5, yaw: Math.PI / 2, on: true },
      // за швом: источник встал бы на место прогона r3, а нарисована она сдвинутой
      { id: 'seam', item: FLASHLIGHT_ITEM, inst: 'r3', x: 3, y: 0, z: -0.8, yaw: 0, on: true },
    ]);
    items.update();
    const eye = new Vector3(3.4, 1.6, -1.5);
    // «inside» — в 0.8 м под рукой, но не виден; «beyond» — за проёмом
    expect(items.nearest(eye, new Vector3(1, -1.2, 0).normalize())?.id).toBe('beyond');
    expect(items.nearest(eye, new Vector3(-0.3, -1, -0.8).normalize())).toBeNull();
    expect(items.litIds).toEqual(['beyond']);
    // текущая — r2 (перешёл): её предмет на месте r1 — свой
    portal.current = 'r2';
    expect(items.nearest(eye, new Vector3(-0.3, -1, -0.8).normalize())?.id).toBe('inside');
    items.update();
    expect(items.litIds.sort()).toEqual(['beyond', 'inside']);
    items.dispose();
    scene.dispose();
  });
});

describe('dropPose', () => {
  it('0.7 м вперёд на пол; стена ближе — ближе; без пола — у ног', T, () => {
    const { scene, cam } = setup();
    cam.position.set(0, 1.6, 0);
    cam.setTarget(new Vector3(0, 1.6, 5));
    cam.computeWorldMatrix();
    const floor = CreateBox('floor', { width: 10, height: 0.2, depth: 10 }, scene);
    floor.position.y = -0.1;
    floor.checkCollisions = true;
    floor.metadata = { kind: 'floor', inst: 'room7' };
    floor.computeWorldMatrix(true);
    const p = dropPose(scene, cam, { inst: 'cur', eye: 1.6 })!;
    expect(p.inst).toBe('room7');
    expect(p.z).toBeCloseTo(0.7, 5);
    expect(p.x).toBeCloseTo(0, 5);
    expect(p.y).toBeCloseTo(0, 5);
    expect(p.yaw).toBeCloseTo(0, 5);
    const wall = CreateBox('wall', { width: 4, height: 3, depth: 0.2 }, scene);
    wall.position.set(0, 1.5, 0.6);
    wall.checkCollisions = true;
    wall.computeWorldMatrix(true);
    const q = dropPose(scene, cam, { inst: 'cur', eye: 1.6 })!;
    expect(q.z).toBeLessThan(0.4);
    expect(q.z).toBeGreaterThanOrEqual(0);
    wall.dispose();
    floor.dispose();
    const r = dropPose(scene, cam, { inst: 'cur', eye: 1.6 })!;
    expect(r.inst).toBe('cur');
    expect(r.y).toBeCloseTo(0, 5);
    scene.dispose();
  });

  it('стена вскользь — от неё по нормали на след; впереди нет пола — под ноги', T, () => {
    const { scene, cam } = setup();
    cam.position.set(0, 1.6, 0);
    // взгляд на 30° вправо от стены x = 0.4 (вдоль неё)
    cam.setTarget(new Vector3(Math.sin(Math.PI / 6) * 5, 1.6, Math.cos(Math.PI / 6) * 5));
    cam.computeWorldMatrix();
    const floor = CreateBox('floor', { width: 10, height: 0.2, depth: 10 }, scene);
    floor.position.y = -0.1;
    const wall = CreateBox('wall', { width: 0.1, height: 3, depth: 10 }, scene);
    wall.position.set(0.45, 1.5, 0);
    for (const m of [floor, wall]) {
      m.checkCollisions = true;
      m.computeWorldMatrix(true);
    }
    const p = dropPose(scene, cam, { inst: 'cur', eye: 1.6, item: FLASHLIGHT_ITEM })!;
    // центр — не ближе следа фонаря (0.12) с зазором к стене; вперёд — по взгляду
    expect(0.4 - p.x).toBeGreaterThanOrEqual(itemLook(FLASHLIGHT_ITEM).foot + 0.04 - 1e-6);
    expect(p.z).toBeGreaterThan(0.4);
    expect(p.y).toBeCloseTo(0, 5);
    wall.dispose();
    floor.dispose();
    // пол — только под ногами (провал впереди): под ноги, не в воздухе
    const pad = CreateBox('pad', { width: 0.6, height: 0.2, depth: 0.6 }, scene);
    pad.position.y = -0.15;
    pad.checkCollisions = true;
    pad.computeWorldMatrix(true);
    const q = dropPose(scene, cam, { inst: 'cur', eye: 1.6 })!;
    expect(q.x).toBeCloseTo(0, 5);
    expect(q.z).toBeCloseTo(0, 5);
    expect(q.y).toBeCloseTo(-0.05, 5);
    scene.dispose();
  });
});

describe('FlashlightModel', () => {
  it('отпускает свой набор: старый набор пересобран — новые модели не теряют материалы', T, () => {
    const { scene } = setup();
    const a = new FlashlightModel(scene, 'a');
    // шаблоны набора удалены извне — следующая модель заводит новый набор
    scene.getMeshByName('flash:body')!.dispose();
    const b = new FlashlightModel(scene, 'b');
    a.dispose();
    expect(scene.materials.includes(b.lens.material!)).toBe(true);
    expect(scene.meshes.includes(scene.getMeshByName('flash:lens')!)).toBe(true);
    b.dispose();
    expect(scene.materials.some((m) => m.name.startsWith('flash:'))).toBe(false);
    scene.dispose();
  });
});

describe('Flashlight', () => {
  it('свет — только в руке и включённым; предел источников у материалов поднят (и у новых)', T, async () => {
    const { scene, cam } = setup();
    const before = new StandardMaterial('room', scene);
    expect(before.maxSimultaneousLights).toBe(4);
    const f = new Flashlight(scene, cam, { sound: () => false });
    expect(before.maxSimultaneousLights).toBe(LIGHT_SLOTS);
    const after = new StandardMaterial('later', scene);
    await new Promise((r) => setTimeout(r, 5));
    expect(after.maxSimultaneousLights).toBe(LIGHT_SLOTS);
    const m = { speed: 1.4, sprint: 0, crawl: 0 };
    f.update(0.016, m);
    expect(f.light.isEnabled()).toBe(false);
    f.setHeld(true);
    expect(f.light.isEnabled()).toBe(true);
    for (let i = 0; i < 30; i++) f.update(0.016, m);
    expect(f.light.intensity).toBe(0);
    f.setOn(true);
    expect(f.on).toBe(true);
    for (let i = 0; i < 40; i++) f.update(0.016, m);
    expect(f.light.intensity).toBeGreaterThan(1);
    const held = scene.getTransformNodeByName('flash:held')!;
    expect(held.isEnabled()).toBe(true);
    // на четвереньках модель уходит из кадра, свет остаётся
    for (let i = 0; i < 80; i++) f.update(0.016, { speed: 0.5, sprint: 0, crawl: 1 });
    expect(held.isEnabled()).toBe(false);
    expect(f.light.intensity).toBeGreaterThan(1);
    f.setHeld(false);
    expect(f.light.isEnabled()).toBe(false);
    expect(f.on).toBe(true);
    f.dispose();
    expect(scene.meshes.some((x) => x.name.startsWith('flash:'))).toBe(false);
    scene.dispose();
  });
});
