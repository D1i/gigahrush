// Превью руки общаги (src/view3d/obshagaHand.ts): коридор 2.0 × 2.5 м с плиткой, сбоку дверь 0.8 × 2.05 в тёмную
// комнату. Рука ведётся настоящей механикой (src/locations/obshaga.ts: createHand → stepHand → handView): вылезает из
// двери (точка за дверью — в 1.2 м за стеной, проём — середина коридора), поворачивает и ползёт к камере в конце
// коридора. Кадры (?view=):
//   lit    — коридор при свете, кончик в tipX (по умолчанию 10 м: 8 м от двери), камера в 13.5 м
//   dark   — только тусклая жёлтая лампа у камеры (радиус 6 м): рука выступает из темноты
//   grab   — игрок в 1 м от кончика: схватила, кулак (капсула «жертвы» в fistCenter)
//   emerge — emerge01 ≈ 0.3: пальцы протискиваются в проём; камера в коридоре смотрит на дверь
//   retreat — лампа рядом: рука втягивается, пальцы вытянуты и скребут пол
//   door   — с дальнего конца коридора: рука выходит из двери, сжатая косяками, и поворачивает прочь
//   top / side / close — отладка формы (сверху без потолка, сбоку без стены, кисть вблизи)
// ?tipX=м, ?yaw=°, ?pitch=°, ?dist=м — кончик и камера; ?dark=1 — темно в любом кадре. Скриншоты:
// node tools/obshaga-hand-preview-shots.mjs
import { Engine } from '@babylonjs/core/Engines/engine';
import { Scene } from '@babylonjs/core/scene';
import { FreeCamera } from '@babylonjs/core/Cameras/freeCamera';
import { HemisphericLight } from '@babylonjs/core/Lights/hemisphericLight';
import { PointLight } from '@babylonjs/core/Lights/pointLight';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture';
import { Texture } from '@babylonjs/core/Materials/Textures/texture';
import { Color3, Color4 } from '@babylonjs/core/Maths/math.color';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import { VertexBuffer } from '@babylonjs/core/Buffers/buffer';
import { createHand, handView, stepHand, type HandInput, type Pt } from '../src/locations/obshaga';
import { HandMesh } from '../src/view3d/obshagaHand';

const q = new URLSearchParams(location.search);
const view = q.get('view') ?? 'lit';
const W = 2.0, CEIL = 2.5, DOOR_X = 2.0, DOOR_W = 0.8, DOOR_H = 2.05, X0 = -1, X1 = 16;
const dark = view === 'dark' || q.get('dark') === '1';

const canvas = document.getElementById('c') as HTMLCanvasElement;
const engine = new Engine(canvas, true, { preserveDrawingBuffer: true, stencil: true });
const scene = new Scene(engine);
scene.clearColor = new Color4(0, 0, 0, 1);
scene.ambientColor = new Color3(0, 0, 0);

// ── текстуры: стена (низ — плитка, крашеная зелёным, верх — побелка), пол (плитка), потолок ──
function canvasTex(name: string, size: number, draw: (g: CanvasRenderingContext2D, s: number) => void): DynamicTexture {
  const t = new DynamicTexture(name, { width: size, height: size }, scene, true);
  draw(t.getContext() as CanvasRenderingContext2D, size);
  t.update();
  t.wrapU = t.wrapV = Texture.WRAP_ADDRESSMODE;
  return t;
}
let seed = 9;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const wallTex = canvasTex('wall', 512, (g, s) => {
  // плитка ниже 1.5 м из 2.5 (текстура — 2 м по ширине × 2.5 по высоте: v снизу вверх)
  g.fillStyle = '#c9c4b2';
  g.fillRect(0, 0, s, s);
  const yTile = s * (1 - 1.5 / 2.5);
  const n = 10;
  const tw = s / n, th = (s - yTile) / 7.5;
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < n; c++) {
      const k = 0.9 + rnd() * 0.15;
      g.fillStyle = `rgb(${Math.round(78 * k)},${Math.round(108 * k)},${Math.round(98 * k)})`;
      g.fillRect(c * tw + 1, yTile + r * th + 1, tw - 2, th - 2);
    }
  }
  g.fillStyle = '#3a3a32';
  g.fillRect(0, yTile - 4, s, 5);
  for (let i = 0; i < 300; i++) {
    g.fillStyle = `rgba(60,50,40,${rnd() * 0.08})`;
    g.fillRect(rnd() * s, rnd() * yTile, 2 + rnd() * 30, 2 + rnd() * 30);
  }
});
const floorTex = canvasTex('floor', 512, (g, s) => {
  const n = 8;
  const t = s / n;
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      const k = 0.85 + rnd() * 0.2;
      const dk = (r + c) % 2 ? 1 : 0.82;
      g.fillStyle = `rgb(${Math.round(150 * k * dk)},${Math.round(110 * k * dk)},${Math.round(80 * k * dk)})`;
      g.fillRect(c * t, r * t, t, t);
      g.strokeStyle = '#2b2219';
      g.lineWidth = 2;
      g.strokeRect(c * t, r * t, t, t);
    }
  }
});
const matCache = new Map<string, StandardMaterial>();
const mat = (name: string, tex: Texture | null, hex: string) => {
  const key = `${tex?.name ?? ''}|${hex}`;
  const got = matCache.get(key);
  if (got) return got;
  const m = new StandardMaterial(name, scene);
  m.diffuseColor = Color3.FromHexString(hex);
  if (tex) m.diffuseTexture = tex;
  m.specularColor = new Color3(0.04, 0.04, 0.04);
  matCache.set(key, m);
  return m;
};
/** повтор текстуры на меше — развёрткой (текстура общая) */
const uvScale = (m: Mesh, u: number, v: number) => {
  const uv = m.getVerticesData(VertexBuffer.UVKind);
  if (!uv) return;
  for (let i = 0; i < uv.length; i += 2) {
    uv[i] *= u;
    uv[i + 1] *= v;
  }
  m.setVerticesData(VertexBuffer.UVKind, uv);
};

// ── коридор вдоль x (план y ∈ [−1, 1] → мир z ∈ [−1, 1]) и комната за дверью (план y ∈ [1, 4.4]) ──
const meshes: Record<string, Mesh[]> = { ceil: [], right: [] };
const wallPlane = (name: string, x0: number, x1: number, z: number, y0: number, y1: number, faceZ: 1 | -1, tag?: string) => {
  const w = x1 - x0, h = y1 - y0;
  const p = MeshBuilder.CreatePlane(name, { width: w, height: h }, scene);
  p.position.set((x0 + x1) / 2, (y0 + y1) / 2, z);
  // плоскость смотрит в −z: развернуть лицом к +z (faceZ = 1) или оставить
  if (faceZ === 1) p.rotation.y = Math.PI;
  p.material = mat('wallM', wallTex, '#ffffff');
  uvScale(p, w / 2, h / 2.5);
  if (tag) meshes[tag].push(p);
  return p;
};
const wallPlaneX = (name: string, z0: number, z1: number, x: number, y0: number, y1: number, faceX: 1 | -1) => {
  const w = z1 - z0, h = y1 - y0;
  const p = MeshBuilder.CreatePlane(name, { width: w, height: h }, scene);
  p.position.set(x, (y0 + y1) / 2, (z0 + z1) / 2);
  p.rotation.y = faceX === 1 ? -Math.PI / 2 : Math.PI / 2;
  p.material = mat('wallM', wallTex, '#ffffff');
  uvScale(p, w / 2, h / 2.5);
  return p;
};
// стена с дверью: план y = +1 → мир z = −1, лицом в коридор (+z)
const zDoorWall = -W / 2;
wallPlane('wl1', X0, DOOR_X - DOOR_W / 2, zDoorWall, 0, CEIL, 1);
wallPlane('wl2', DOOR_X + DOOR_W / 2, X1, zDoorWall, 0, CEIL, 1);
wallPlane('wl3', DOOR_X - DOOR_W / 2, DOOR_X + DOOR_W / 2, zDoorWall, DOOR_H, CEIL, 1);
// с обратной стороны (в комнате)
wallPlane('wr1', 0.2, DOOR_X - DOOR_W / 2, zDoorWall - 0.001, 0, CEIL, -1);
wallPlane('wr2', DOOR_X + DOOR_W / 2, 3.8, zDoorWall - 0.001, 0, CEIL, -1);
wallPlane('wr3', DOOR_X - DOOR_W / 2, DOOR_X + DOOR_W / 2, zDoorWall - 0.001, DOOR_H, CEIL, -1);
// косяки (толщина стены)
for (const sx of [-1, 1]) {
  const j = MeshBuilder.CreateBox('jamb', { width: 0.06, height: DOOR_H, depth: 0.14 }, scene);
  j.position.set(DOOR_X + sx * (DOOR_W / 2 + 0.03), DOOR_H / 2, zDoorWall - 0.03);
  j.material = mat('jambM', null, '#7a6a55');
}
// напротив (план y = −1 → мир z = +1), лицом в −z
wallPlane('wo', X0, X1, W / 2, 0, CEIL, -1, 'right');
wallPlaneX('we0', -W / 2, W / 2, X0, 0, CEIL, 1);
wallPlaneX('we1', -W / 2, W / 2, X1, 0, CEIL, -1);
// комната
wallPlane('rb', 0.2, 3.8, -4.4, 0, CEIL, 1);
wallPlaneX('rl', -4.4, -1, 0.2, 0, CEIL, 1);
wallPlaneX('rr', -4.4, -1, 3.8, 0, CEIL, -1);
const floor = MeshBuilder.CreateGround('floor', { width: X1 - X0, height: 6 }, scene);
floor.position.set((X0 + X1) / 2, 0, -1.7);
floor.material = mat('floorM', floorTex, '#ffffff');
uvScale(floor, (X1 - X0) / 2.4, 6 / 2.4);
const ceil = MeshBuilder.CreatePlane('ceil', { width: X1 - X0, height: 6 }, scene);
ceil.rotation.x = -Math.PI / 2;
ceil.position.set((X0 + X1) / 2, CEIL, -1.7);
ceil.material = mat('ceilM', null, '#b9b6aa');
meshes.ceil.push(ceil);

// ── свет ──
const hemi = new HemisphericLight('hemi', new Vector3(0, 1, 0), scene);
hemi.diffuse = new Color3(1.0, 0.93, 0.8);
hemi.groundColor = new Color3(0.35, 0.3, 0.25);
hemi.specular = Color3.Black();
hemi.intensity = dark ? 0.012 : 0.35;
const lamps: PointLight[] = [];
if (!dark) {
  for (const x of [3, 8, 12.5]) {
    const l = new PointLight(`lamp${x}`, new Vector3(x, CEIL - 0.1, 0), scene);
    l.diffuse = new Color3(1.0, 0.95, 0.85);
    l.specular = new Color3(0.3, 0.3, 0.3);
    l.intensity = 0.55;
    l.range = 8;
    lamps.push(l);
  }
}

// ── камера ──
const camera = new FreeCamera('cam', new Vector3(13.5, 1.6, 0), scene);
camera.minZ = 0.03;
camera.fov = 1.05;
const deg = (v: string | null, d: number) => ((v === null ? d : Number(v)) * Math.PI) / 180;

// ── рука ──
const hand = new HandMesh(scene, { corridorW: W, ceilH: CEIL, layerMask: 0x0fffffff, seed: Number(q.get('seed') ?? 1) });
const toWorld = (p: Pt) => new Vector3(p.x, 0, -p.y);
const doorway: Pt = { x: DOOR_X, y: W / 2, room: 'corr' };
const door: Pt = { x: DOOR_X, y: 2.2, room: 'room' };
const mouth: Pt = { x: DOOR_X, y: 0, room: 'corr' };
const h = createHand(q.get('hand') ?? 'preview-hand', door, mouth);
const tipX = Number(q.get('tipX') ?? (view === 'close' ? 11 : 10));
const input: HandInput = { lightsOn: false, seen: false, goal: { x: tipX, y: 0, room: 'corr' }, players: [], lanterns: [], playerSpeed: 3.0 };
let t = 0;
const DT = 1 / 30;
const step = () => {
  stepHand(h, DT, input);
  t += DT;
  hand.update(handView(h), toWorld, t, doorway);
};
hand.update(handView(h), toWorld, t, doorway);
const lim = 4000;
if (view === 'emerge') {
  const e = Number(q.get('e') ?? 0.3);
  for (let i = 0; i < lim && h.phase === 'emerging' && h.emerge < e; i++) step();
} else {
  for (let i = 0; i < lim && !(h.phase === 'stalking' && Math.abs(h.tip.x - tipX) < 1e-6); i++) step();
  // постоять (пальцы опускаются), ещё немного времени — для подёргиваний
  for (let i = 0; i < Number(q.get('idle') ?? 0); i++) step();
}
if (view === 'retreat') {
  // лампа в 2.2 м перед кончиком: поле накрыло руку — втягивается, пальцы волочатся
  input.lanterns = [{ x: tipX + 2.2, y: 0, room: 'corr' }];
  input.goal = null;
  for (let i = 0; i < Number(q.get('rsteps') ?? 9); i++) step();
}
let victim: Mesh | null = null;
if (view === 'grab') {
  input.players = [{ id: 'p', p: { x: tipX + 1.0, y: 0, room: 'corr' }, protected: false, sees: false }];
  for (let i = 0; i < 200 && h.phase !== 'grabbing'; i++) step();
  for (let i = 0; i < Number(q.get('gsteps') ?? 7); i++) step();
  const fc = hand.fistCenter();
  if (fc) {
    victim = MeshBuilder.CreateCapsule('victim', { radius: 0.28, height: 1.75 }, scene);
    victim.position.set(fc.x, Math.max(0.9, fc.y), fc.z);
    victim.material = mat('victimM', null, '#3b4a6a');
  }
}

// ── кадр ──
const tipW = toWorld(h.tip);
if (view === 'top') {
  for (const m of meshes.ceil) m.setEnabled(false);
  camera.position.set(Number(q.get('cx') ?? 6.5), 15, -1.2);
  camera.setTarget(new Vector3(Number(q.get('cx') ?? 6.5), 0, -1.2));
  camera.fov = 1.0;
} else if (view === 'side') {
  for (const m of meshes.right) m.setEnabled(false);
  for (const m of meshes.ceil) m.setEnabled(false);
  camera.position.set(tipW.x - 1.5, 3.4, 6.5);
  camera.setTarget(new Vector3(tipW.x - 3, 0.8, 0));
} else if (view === 'emerge') {
  camera.position.set(5.5, 1.6, 0.6);
  camera.setTarget(new Vector3(DOOR_X, 1.1, -1));
} else if (view === 'door') {
  // с дальнего конца коридора: рука выходит из двери (сжата косяками) и поворачивает прочь
  camera.position.set(-0.7, 1.6, 0.55);
  camera.setTarget(new Vector3(DOOR_X + 1.2, 1.0, -0.4));
} else {
  const dist = Number(q.get('dist') ?? (view === 'close' ? 2.6 : 3.5));
  camera.position.set(tipW.x + dist, 1.6, Number(q.get('cz') ?? (view === 'grab' ? 0.55 : 0)));
  const yaw = deg(q.get('yaw'), view === 'grab' ? 9 : 0), pitch = deg(q.get('pitch'), -12);
  camera.setTarget(camera.position.add(new Vector3(-Math.cos(yaw) * Math.cos(pitch), Math.sin(pitch), Math.sin(yaw) * Math.cos(pitch))));
}
// лампа игрока: тускло-жёлтая, у камеры (в руке — правее и ниже глаз)
if (dark || view === 'grab' || view === 'retreat' || q.get('lantern') === '1') {
  const fwd = camera.getDirection(new Vector3(0, 0, 1));
  const right = camera.getDirection(new Vector3(1, 0, 0));
  const lp = camera.position.add(fwd.scale(0.35)).add(right.scale(0.25)).add(new Vector3(0, -0.4, 0));
  const lantern = new PointLight('lantern', lp, scene);
  lantern.diffuse = new Color3(1.0, 0.76, 0.4);
  lantern.specular = new Color3(0.25, 0.2, 0.1);
  lantern.intensity = Number(q.get('li') ?? 1.1);
  lantern.range = 6;
}

engine.runRenderLoop(() => scene.render());
setTimeout(() => {
  const st = hand.stats();
  const rooms: Record<string, number> = {};
  for (const [k, v] of hand.byRoom()) rooms[k] = v.length;
  const cols: Record<string, number> = {};
  for (const [k, v] of hand.colliders()) cols[k] = v.length;
  (window as unknown as { __hand: unknown }).__hand = {
    view, phase: h.phase, emerge: +h.emerge.toFixed(2), tip: [+h.tip.x.toFixed(2), +h.tip.y.toFixed(2)], len: +handView(h).length.toFixed(2),
    stats: st, rooms, cols, victim: !!victim, t: +t.toFixed(2),
  };
}, 400);
addEventListener('resize', () => engine.resize());
