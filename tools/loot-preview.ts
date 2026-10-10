// Превью моделей лута (src/view3d/assets/loot_props.glb через настоящий PropModels + applyLootGlass — как в игре).
//  • Раскладка: клетки 6 × 4 на полу в сетке 10 см (толстые линии — 1 м); в клетке — модель в натуральную величину
//    (ближе к камере), за ней та же ×3, на полу подпись: id, имя, габарит, мм. Перед моделей — −Z (к камере).
//    Отдельная клетка — П-2 ×3 с удлинением тубуса на точке LOOT_ANCHORS.flashlight.tubeExt. Оранжевые точки на
//    моделях ×3 — LOOT_ANCHORS (стекло, лампочка, пламя).
//    ?view=0..7 — ряд r = view >> 1, половина view & 1 (по 3 клетки); 8 — обзор сверху; 9 — последний ряд сзади;
//    10 — натуральная величина глазами игрока (1.65 м); ?cell=k — крупно клетка k (22 — П-2 с удлинением), ?az / ?el —
//    откуда смотреть (градусы от переда вправо / вверх), ?zoom — множитель расстояния; ?dark=1 — темно, свет у камеры; ?glass=0 — без applyLootGlass.
//  • ?icon=1 — режим значков (tools/make-loot-icons.mjs): холст 384 × 384, прозрачный фон, window.__lootIcon(id) ставит
//    предмет в начало координат, кадрирует ортокамерой (вид ICON_VIEW) и отдаёт PNG data:-адресом.
// Скриншоты: node tools/loot-preview-shots.mjs
import { Engine } from '@babylonjs/core/Engines/engine';
import { Scene } from '@babylonjs/core/scene';
import { UniversalCamera } from '@babylonjs/core/Cameras/universalCamera';
import { Camera } from '@babylonjs/core/Cameras/camera';
import { HemisphericLight } from '@babylonjs/core/Lights/hemisphericLight';
import { DirectionalLight } from '@babylonjs/core/Lights/directionalLight';
import { PointLight } from '@babylonjs/core/Lights/pointLight';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture';
import { Color3, Color4 } from '@babylonjs/core/Maths/math.color';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { VertexBuffer } from '@babylonjs/core/Buffers/buffer';
import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import { PropModels } from '../src/view3d/propModels';
import { LOOT_ANCHORS, LOOT_MODEL_ITEMS, LOOT_PROPS_URL, applyLootGlass, lootPropId } from '../src/view3d/lootAssets';
import { lootDef } from '../src/data/itemsLoot';

const q = new URLSearchParams(location.search);
const ICON = q.get('icon') === '1';
const dark = q.get('dark') === '1';
if (ICON) document.body.classList.add('icon');
const D = Math.PI / 180;

const canvas = document.getElementById('c') as HTMLCanvasElement;
const engine = new Engine(canvas, true, { preserveDrawingBuffer: true, stencil: true });
const scene = new Scene(engine);
scene.clearColor = ICON ? new Color4(0, 0, 0, 0) : new Color4(0.105, 0.115, 0.11, 1);
scene.ambientColor = new Color3(0, 0, 0);
// мягкий свет: небо сверху + ключевой спереди-слева-сверху (к модели — на +X, вниз, на +Z)
const hemi = new HemisphericLight('hemi', new Vector3(0.1, 1, -0.2), scene);
hemi.intensity = dark ? 0.03 : 0.6;
hemi.groundColor = new Color3(0.3, 0.29, 0.28);
hemi.specular = Color3.Black();
const sun = new DirectionalLight('sun', new Vector3(0.55, -0.7, 0.45), scene);
sun.intensity = dark ? 0 : 0.5;
sun.specular = new Color3(0.3, 0.3, 0.3);

const cam = new UniversalCamera('cam', new Vector3(0, 1.5, -3), scene);
cam.fov = 1.0;
cam.minZ = 0.01;
if (dark) {
  const lamp = new PointLight('lamp', Vector3.Zero(), scene);
  lamp.parent = cam;
  lamp.position.set(0.15, -0.1, 0);
  lamp.intensity = 1.2;
  lamp.range = 6;
  lamp.diffuse = new Color3(1, 0.85, 0.65);
}

const props = new PropModels(scene, [LOOT_PROPS_URL]);
const w = window as unknown as {
  __loot?: unknown;
  __lootItems?: string[];
  __lootIcon?: (id: string) => Promise<string>;
  __lootView?: (s: string) => Promise<void>;
};

/** Клон шаблона предмета (включённый). */
function place(id: string, x: number, z: number, s: number): Mesh | null {
  const tpl = props.get(lootPropId(id) ?? '');
  if (!tpl) return null;
  const v = tpl.clone(`loot:${id}:${s}`, null, false);
  v.setEnabled(true);
  v.isVisible = true;
  v.position.set(x, 0, z);
  v.scaling.setAll(s);
  return v;
}
/** Габарит шаблона, м: [w, h, d]. */
function sizeOf(id: string): [number, number, number] {
  const bb = props.get(lootPropId(id) ?? '')!.getBoundingInfo().boundingBox;
  return [0, 1, 2].map((a) => bb.maximum.asArray()[a] - bb.minimum.asArray()[a]) as [number, number, number];
}

// ───────────────────────── раскладка ─────────────────────────
const COLS = 6, CW = 1.3, CD = 1.7;
/** где в клетке стоит ×3 (z от начала клетки) */
const BIG_Z = 0.3;
const cellOf = (k: number) => ({ cx: ((k % COLS) - (COLS - 1) / 2) * CW, cz: Math.floor(k / COLS) * CD });

function floor() {
  const W = 12, H = 10;
  const g = MeshBuilder.CreateGround('floor', { width: W, height: H }, scene);
  g.position.set(0, 0, 2.2);
  const t = new DynamicTexture('grid', { width: 512, height: 512 }, scene, true);
  const c = t.getContext() as CanvasRenderingContext2D;
  c.fillStyle = '#5d5f5c';
  c.fillRect(0, 0, 512, 512);
  c.strokeStyle = '#7b7d78';
  c.lineWidth = 3;
  for (let k = 0; k <= 10; k++) {
    c.beginPath();
    c.moveTo(k * 51.2, 0);
    c.lineTo(k * 51.2, 512);
    c.moveTo(0, k * 51.2);
    c.lineTo(512, k * 51.2);
    c.stroke();
  }
  c.strokeStyle = '#2f312e';
  c.lineWidth = 10;
  c.strokeRect(0, 0, 512, 512);
  t.update();
  t.uScale = W;
  t.vScale = H;
  const m = new StandardMaterial('floor', scene);
  m.diffuseTexture = t;
  m.specularColor = Color3.Black();
  g.material = m;
}

function label(text: string[], x: number, z: number) {
  const p = MeshBuilder.CreatePlane(`lbl:${text[0]}`, { width: 1.24, height: 0.24 }, scene);
  p.rotation.x = Math.PI / 2;
  p.position.set(x, 0.002, z);
  const t = new DynamicTexture(`lbl:${text[0]}`, { width: 1024, height: 198 }, scene, true);
  const c = t.getContext() as CanvasRenderingContext2D;
  c.fillStyle = '#1d1f1e';
  c.fillRect(0, 0, 1024, 198);
  c.fillStyle = '#f2ead6';
  c.font = 'bold 52px Arial';
  c.fillText(text[0], 18, 66);
  c.font = '44px Arial';
  c.fillStyle = '#c9c1ac';
  c.fillText(text[1], 18, 128);
  c.fillText(text[2] ?? '', 18, 182);
  t.update();
  const m = new StandardMaterial(`lbl:${text[0]}`, scene);
  m.diffuseTexture = t;
  m.emissiveColor = new Color3(0.5, 0.5, 0.5);
  m.specularColor = Color3.Black();
  p.material = m;
}

/** Оранжевые точки LOOT_ANCHORS на клоне ×s. */
function marks(id: string, v: Mesh, s: number) {
  const a = (LOOT_ANCHORS as Record<string, Record<string, readonly number[]>>)[id.slice(3)];
  if (!a) return;
  for (const [k, p] of Object.entries(a)) {
    if (k.endsWith('Dir') || k === 'tubeExt') continue;
    const b = MeshBuilder.CreateSphere(`mark:${id}:${k}`, { diameter: 0.006 * s, segments: 6 }, scene);
    const m = new StandardMaterial(`mark:${k}`, scene);
    m.emissiveColor = new Color3(1, 0.45, 0.05);
    m.disableLighting = true;
    // поверх стекла — видно и внутри колбы
    m.disableDepthWrite = true;
    b.renderingGroupId = 1;
    b.material = m;
    b.position.set(v.position.x + p[0] * s, p[1] * s, v.position.z + p[2] * s);
  }
}

const VIEWS: [number, number, number, number, number, number][] = [];
for (let r = 0; r < 4; r++)
  for (let h = 0; h < 2; h++) {
    const x = (h ? 1 : -1) * 1.5 * CW, z = r * CD;
    VIEWS.push([x + 0.55, 1.35, z - 2.5, x, 0.2, z + 0.1]);
  }
VIEWS.push([0.8, 6.5, -4.5, 0, 0, 2.4]); // 8 — обзор
VIEWS.push([-1.2, 1.4, 3 * CD + 2.6, -1.0, 0.2, 3 * CD]); // 9 — последний ряд сзади
VIEWS.push([-1.95, 1.65, -1.55, -1.95, 0, -0.45]); // 10 — натуральная величина глазами игрока

/** Камера по параметрам запроса (view / cell / az / el); window.__lootView(запрос) — без перезагрузки страницы. */
function aim(p: URLSearchParams) {
  if (p.has('cell')) {
    // крупно клетка k: ×3 и ×1 вместе, 3/4 спереди-справа (?az, ?el — градусы; az 180 — сзади)
    const k = Number(p.get('cell'));
    const id = LOOT_MODEL_ITEMS[k] ?? 'it_flashlight';
    const { cx, cz } = cellOf(k);
    const s = sizeOf(id);
    const m3 = 3 * Math.max(...s);
    const az = Number(p.get('az') ?? 32) * D, el = Number(p.get('el') ?? 24) * D;
    // цель — середина между ×3 и ×1 (×1 стоит перед ×3 справа, см. layout)
    const t = new Vector3(cx + 0.5 * s[0], 1.2 * s[1], BIG_Z + cz - 1.5 * s[2]);
    const dist = ((m3 * 1.0 + 0.03) / 0.6) * Number(p.get('zoom') ?? 1);
    cam.position.copyFrom(t.add(new Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el)).scale(dist)));
    cam.setTarget(t);
    return;
  }
  const v = VIEWS[Number(p.get('view') ?? 0)] ?? VIEWS[0];
  cam.position.set(v[0], v[1], v[2]);
  cam.setTarget(new Vector3(v[3], v[4], v[5]));
}

async function layout() {
  floor();
  const sizes: Record<string, number[]> = {};
  LOOT_MODEL_ITEMS.forEach((id, k) => {
    const { cx, cz } = cellOf(k);
    const s = sizeOf(id);
    sizes[id] = s.map((v) => +(v * 1000).toFixed(1));
    // ×1 — вплотную перед ×3, правее (видно в крупном плане клетки)
    place(id, cx + s[0], cz + BIG_Z - 2 * s[2] - 0.03, 1);
    const big = place(id, cx, cz + BIG_Z, 3);
    if (big) marks(id, big, 3);
    const d = lootDef(id);
    label([id, d?.name ?? '', `${s.map((v) => (v * 1000).toFixed(0)).join(' × ')} мм (×1 и ×3)`], cx, cz - 0.78);
  });
  // П-2 с удлинением тубуса (×3): удлинение — низом-центром в точку tubeExt
  {
    const k = LOOT_MODEL_ITEMS.length;
    const { cx, cz } = cellOf(k);
    const f = place('it_flashlight', cx, cz + 0.3, 3)!;
    marks('it_flashlight', f, 3);
    const e = place('it_tube_ext', 0, 0, 3)!;
    const t = LOOT_ANCHORS.flashlight.tubeExt;
    e.position.set(f.position.x + t[0] * 3, t[1] * 3, f.position.z + t[2] * 3);
    label(['П-2 + удлинение', 'tube_ext на LOOT_ANCHORS', 'flashlight.tubeExt'], cx, cz - 0.78);
  }
  aim(q);
  engine.runRenderLoop(() => scene.render());
  await scene.whenReadyAsync();
  await new Promise((res) => setTimeout(res, 600));
  return sizes;
}

// ───────────────────────── значки ─────────────────────────
/** Вид значка [азимут от переда (−Z) вправо, высота], градусы. По умолчанию — 3/4 спереди-справа чуть сверху. */
const ICON_VIEW: Record<string, [number, number]> = {
  it_kopeyki: [0, 64],
  it_sticker: [0, 64],
  it_wick: [20, 50],
  it_flashlight: [62, 22],
  it_tube_ext: [78, 30],
  it_bread: [28, 32],
  it_bulb: [30, 14],
  it_batteries: [30, 18],
};
let shown: Mesh | null = null;

async function icon(id: string): Promise<string> {
  shown?.dispose(false, false);
  shown = place(id, 0, 0, 1);
  if (!shown) throw new Error(`нет модели ${id}`);
  const [az, el] = ICON_VIEW[id] ?? [30, 24];
  const dir = new Vector3(Math.sin(az * D) * Math.cos(el * D), Math.sin(el * D), -Math.cos(az * D) * Math.cos(el * D));
  shown.computeWorldMatrix(true);
  const bb = shown.getBoundingInfo().boundingBox;
  const c = bb.centerWorld.clone();
  cam.position.copyFrom(c.add(dir.scale(3)));
  cam.setTarget(c);
  cam.computeWorldMatrix();
  // кадр — по вершинам (плотно), квадрат с полями
  const view = cam.getViewMatrix(true);
  const pos = shown.getVerticesData(VertexBuffer.PositionKind)!;
  const wm = shown.getWorldMatrix();
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (let i = 0; i < pos.length; i += 3) {
    const p = Vector3.TransformCoordinates(Vector3.TransformCoordinates(new Vector3(pos[i], pos[i + 1], pos[i + 2]), wm), view);
    x0 = Math.min(x0, p.x);
    x1 = Math.max(x1, p.x);
    y0 = Math.min(y0, p.y);
    y1 = Math.max(y1, p.y);
  }
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, half = (Math.max(x1 - x0, y1 - y0) / 2) * 1.12;
  cam.orthoLeft = cx - half;
  cam.orthoRight = cx + half;
  cam.orthoBottom = cy - half;
  cam.orthoTop = cy + half;
  await scene.whenReadyAsync();
  scene.render();
  scene.render();
  return canvas.toDataURL('image/png');
}

void (async () => {
  await props.loaded;
  const glass = q.get('glass') === '0' ? 0 : applyLootGlass(scene);
  if (ICON) {
    cam.mode = Camera.ORTHOGRAPHIC_CAMERA;
    cam.minZ = 0.01;
    cam.maxZ = 10;
    w.__lootIcon = icon;
    w.__lootItems = [...LOOT_MODEL_ITEMS];
    w.__loot = { models: props.size, error: props.error, glass };
    return;
  }
  const sizes = await layout();
  w.__lootView = async (s: string) => {
    // для скриншотов: цикл отрисовки стоп (swiftshader медленный), кадр — по запросу; холст хранит последний кадр
    engine.stopRenderLoop();
    aim(new URLSearchParams(s));
    scene.render();
    scene.render();
  };
  w.__loot = { models: props.size, error: props.error, glass, sizes };
})();
addEventListener('resize', () => engine.resize());
