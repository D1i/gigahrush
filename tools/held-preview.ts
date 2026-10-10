// Превью предмета в руке (src/view3d/heldItem.ts) и предметов на полу (src/view3d/worldItems.ts) — настоящие классы
// игры, модели лута — общий PropModels сцены (src/view3d/itemLooks.ts: lootModels).
//  • Комната 4 × 2.6 × 6 м (пол — доски, стены — побелка), камера от первого лица на 1.6 м (fov 1.15, minZ 0.05 — как
//    BlockoutViewer), свет сцены — hemi ('hemi': по нему sceneLitness) тусклый (?lit=0.25) или темно (?lit=0.03).
//  • window.__show(запрос) — без перезагрузки (swiftshader медленный):
//      held=<id>  — предмет в руке (горит, если светится: П-2 и керосинка включены, «Жучок» качнули, зиппа горит),
//                   match=<id коробка> — горящая спичка; side=-1 — левой рукой; gest=eat|drink|… — кадр посреди жеста;
//                   walk=1 — на ходу (фаза шага); pitch=° — взгляд вниз (по умолчанию 8)
//      floor=1    — предметы на полу сеткой 6 × 4 (стопки: копейки 40, батарейки 4, лампочки 3…), взгляд вниз;
//                   eye=1 — глазами игрока издалека (мелочь видна?), held=… — с чем в руке
//    lit=… — свет сцены 0…0.85 (по умолчанию 0.25).
// Скриншоты: node tools/held-preview-shots.mjs
import { Engine } from '@babylonjs/core/Engines/engine';
import { Scene } from '@babylonjs/core/scene';
import { UniversalCamera } from '@babylonjs/core/Cameras/universalCamera';
import { HemisphericLight } from '@babylonjs/core/Lights/hemisphericLight';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture';
import { Texture } from '@babylonjs/core/Materials/Textures/texture';
import { Color3, Color4 } from '@babylonjs/core/Maths/math.color';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import type { WorldDrop } from '../src/gen4d/stream';
import type { Slot } from '../src/game/hotbar';
import { lightOf, newHandTr, pump, type HandTr } from '../src/game/itemUse';
import { HeldItem, type HeldGesture } from '../src/view3d/heldItem';
import { WorldItems } from '../src/view3d/worldItems';
import { LOOK_ITEMS, lootModels } from '../src/view3d/itemLooks';

const D = Math.PI / 180;
const canvas = document.getElementById('c') as HTMLCanvasElement;
const engine = new Engine(canvas, true, { preserveDrawingBuffer: true, stencil: true });
const scene = new Scene(engine);
scene.clearColor = new Color4(0, 0, 0, 1);
scene.ambientColor = new Color3(0, 0, 0);
const hemi = new HemisphericLight('hemi', new Vector3(0.1, 1, -0.2), scene);
hemi.groundColor = new Color3(0.25, 0.24, 0.22);
hemi.specular = Color3.Black();

const cam = new UniversalCamera('fps', new Vector3(0, 1.6, -1), scene);
cam.fov = 1.15;
cam.minZ = 0.05;
cam.maxZ = 100;
scene.activeCamera = cam;

// ── комната ──
function tex(name: string, draw: (g: CanvasRenderingContext2D, s: number) => void, u: number, v: number): DynamicTexture {
  const t = new DynamicTexture(name, { width: 512, height: 512 }, scene, true);
  draw(t.getContext() as unknown as CanvasRenderingContext2D, 512);
  t.update();
  t.wrapU = t.wrapV = Texture.WRAP_ADDRESSMODE;
  t.uScale = u;
  t.vScale = v;
  return t;
}
let seed = 7;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const boards = tex('floor', (g, s) => {
  for (let i = 0; i < 8; i++) {
    const k = 0.8 + rnd() * 0.25;
    g.fillStyle = `rgb(${Math.round(120 * k)},${Math.round(84 * k)},${Math.round(52 * k)})`;
    g.fillRect(0, (i * s) / 8, s, s / 8);
    g.fillStyle = 'rgba(30,18,10,0.7)';
    g.fillRect(0, (i * s) / 8, s, 3);
    for (let j = 0; j < 30; j++) {
      g.fillStyle = `rgba(60,40,20,${0.08 + rnd() * 0.1})`;
      g.fillRect(rnd() * s, (i * s) / 8 + rnd() * (s / 8), 40 + rnd() * 120, 1.5);
    }
  }
}, 2, 3);
const plaster = tex('wall', (g, s) => {
  g.fillStyle = '#b9b4a6';
  g.fillRect(0, 0, s, s);
  for (let j = 0; j < 400; j++) {
    g.fillStyle = `rgba(${rnd() > 0.5 ? '255,255,255' : '60,55,45'},${0.04 + rnd() * 0.05})`;
    g.fillRect(rnd() * s, rnd() * s, 4 + rnd() * 20, 4 + rnd() * 20);
  }
  g.fillStyle = '#4c5a49';
  g.fillRect(0, s * 0.62, s, s * 0.38);
}, 2, 1);
const mat = (name: string, t: DynamicTexture) => {
  const m = new StandardMaterial(name, scene);
  m.diffuseTexture = t;
  m.specularColor = new Color3(0.03, 0.03, 0.03);
  return m;
};
const W = 4, H = 2.6, Z0 = -2, Z1 = 4;
const floor = MeshBuilder.CreateGround('floor', { width: W, height: Z1 - Z0 }, scene);
floor.position.z = (Z0 + Z1) / 2;
floor.material = mat('floorMat', boards);
const ceil = MeshBuilder.CreatePlane('ceil', { width: W, height: Z1 - Z0 }, scene);
ceil.rotation.x = -Math.PI / 2;
ceil.position.set(0, H, (Z0 + Z1) / 2);
ceil.material = mat('ceilMat', tex('c', (g, s) => ((g.fillStyle = '#d6d2c6'), g.fillRect(0, 0, s, s)), 1, 1));
const wallMat = mat('wallMat', plaster);
for (const [x, z, ry, w] of [[0, Z1, 0, W], [-W / 2, (Z0 + Z1) / 2, -Math.PI / 2, Z1 - Z0], [W / 2, (Z0 + Z1) / 2, Math.PI / 2, Z1 - Z0], [0, Z0, Math.PI, W]] as const) {
  const p = MeshBuilder.CreatePlane('wall', { width: w, height: H }, scene);
  p.position.set(x, H / 2, z);
  p.rotation.y = ry;
  p.material = wallMat;
  p.checkCollisions = true;
}
floor.checkCollisions = true;

// ── предметы ──
const held = new HeldItem({ scene, fps: cam }, { sound: () => false });
const items = new WorldItems(scene, { camera: () => cam });
const PILE: Record<string, number> = { it_kopeyki: 40, it_batteries: 4, it_bulb: 3, it_sticker: 3, it_radiolamp: 2, it_wick: 2, it_matches: 40 };
const drops: WorldDrop[] = [];
LOOK_ITEMS.forEach((id, k) => {
  const c = k % 6, r = Math.floor(k / 6);
  const d: WorldDrop = { id: `r1:L${k}`, item: id, inst: 'r1', x: (c - 2.5) * 0.55, y: 0, z: 0.3 + r * 0.6, yaw: Math.PI + (c - 2.5) * 0.15 };
  if (PILE[id]) d.n = PILE[id];
  if (id === 'it_flashlight') {
    d.on = true;
    d.yaw = 0.4;
  }
  drops.push(d);
});
drops.push({ id: 'p2tube', item: 'it_flashlight', inst: 'r1', x: 1.6, y: 0, z: 3.0, yaw: Math.PI + 0.5, u: 1 });

const w = window as unknown as { __held?: unknown; __show?: (q: string) => Promise<unknown> };

/** Ячейка и свет «как в игре» для предмета в руке. */
function handOf(id: string | null, match: string | null): { slot: Slot | null; tr: HandTr } {
  let tr = newHandTr();
  tr.t = 10;
  if (match) tr.match = { item: match, left: 5, sel: 0 };
  if (!id) return { slot: null, tr };
  const slot: Slot = { item: id };
  if (id === 'it_flashlight' || id === 'it_zippo') slot.on = true;
  if (PILE[id]) slot.n = PILE[id];
  if (id === 'it_bug_flash') {
    tr = pump(slot, tr).tr;
    tr = pump(slot, { ...tr, t: tr.t + 0.4 }).tr;
    tr = pump(slot, { ...tr, t: tr.t + 0.4 }).tr;
  }
  return { slot, tr };
}

async function show(qs: string) {
  engine.stopRenderLoop();
  const q = new URLSearchParams(qs);
  hemi.intensity = Number(q.get('lit') ?? 0.25);
  const isFloor = q.get('floor') === '1';
  const id = q.get('held');
  const match = q.get('match');
  const { slot, tr } = handOf(id, match);
  const ctx = { sprinting: false, moving: q.get('walk') === '1', inWater: false };
  const light = lightOf(slot, ctx, tr);
  items.sync(isFloor ? [...drops] : []);
  // камера
  const pitch = Number(q.get('pitch') ?? (isFloor ? (q.get('eye') === '1' ? 22 : 52) : 8)) * D;
  if (isFloor && q.get('eye') !== '1') cam.position.set(0, 1.6, -0.9);
  else if (isFloor) cam.position.set(0.2, 1.6, -1.8);
  else cam.position.set(0, 1.6, -1);
  cam.rotation.set(pitch, Number(q.get('yaw') ?? 0) * D, 0);
  const side = q.get('side') === '-1' ? -1 : 1;
  const walk = q.get('walk') === '1';
  held.set(slot, light, { match });
  // кадры: жест — до середины, иначе — устояться
  const g = q.get('gest') as HeldGesture | null;
  for (let i = 0; i < 40; i++) {
    if (g && i === 20) held.gesture(g);
    if (g && i > 20 + Math.round(({ eat: 0.45, drink: 0.55, strike: 0.15, pump: 0.11, reload: 0.4 }[g] ?? 0.3) * 30)) break;
    held.set(slot, lightOf(slot, ctx, tr), { match });
    held.update(1 / 30, { speed: walk ? 1.4 : 0, sprint: 0, crawl: 0, side });
    scene.render();
  }
  for (let i = 0; i < 3; i++) scene.render();
  return { shown: held.shown, visible: held.visible, light: light ? `${light.kind} ${light.intensity.toFixed(2)}` : null, items: items.size, lit: items.litIds };
}

void (async () => {
  // модели лута: общий PropModels сцены (грузится при первом обращении)
  const src = lootModels(scene);
  for (let i = 0; i < 600 && !src.get('p_loot_kopeyki'); i++) await new Promise((r) => setTimeout(r, 100));
  await scene.whenReadyAsync();
  w.__show = show;
  w.__held = await show(location.search.slice(1) || 'held=it_flashlight');
})();
addEventListener('resize', () => engine.resize());
