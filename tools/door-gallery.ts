// Галерея дверей (src/blockout/doors.ts): каждая дверь каталога — закрытой (выход) и распахнутой, через тот же адаптер
// Babylon, что и «Прогулка». Открыть: npm run dev → http://localhost:5173/tools/door-gallery.html
// Параметры URL: ?only=apt_dermantin,int_dg — только эти; ?dead=1 — закрытые заколочены; ?w=<м> — ширина всех проёмов.
import { Engine } from '@babylonjs/core/Engines/engine';
import { Scene } from '@babylonjs/core/scene';
import { FreeCamera } from '@babylonjs/core/Cameras/freeCamera';
import { HemisphericLight } from '@babylonjs/core/Lights/hemisphericLight';
import { DirectionalLight } from '@babylonjs/core/Lights/directionalLight';
import { Color3, Color4 } from '@babylonjs/core/Maths/math.color';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { buildBlockoutModel } from '../src/blockout/core';
import { buildBabylonBlockout } from '../src/blockout/babylon';
import { DOOR_STYLES, restAngle, type DoorStyle } from '../src/blockout/doors';
import { DEFAULT_BLOCKOUT, type DoorSlot, type RunConnector, type RunExport, type RunInstance } from '../src/blockout/types';

/** Типовая ширина проёма двери, клеток по 0.1 м. */
const WIDTH: Record<string, number> = {
  apt_dermantin: 10, apt_wood: 10, apt_metal90: 10, int_dg: 9, int_do: 8, int_bath: 7, int_closet: 6, int_double: 13, balcony: 8,
  tambour: 13, dorm_room: 9, service_metal: 9, basement_metal: 10, storage_lattice: 7, barn_plank: 11, barn_gate: 10,
  cellar_low: 8, snow_iced: 9, factory_hermetic: 9, factory_gate: 20,
};

const q = new URLSearchParams(location.search);
const only = q.get('only')?.split(',') ?? null;
const dead = q.get('dead') === '1';
const wForce = q.get('w') ? Math.round(Number(q.get('w')) * 10) : 0;
const styles: DoorStyle[] = DOOR_STYLES.filter((s) => !only || only.includes(s.id));

// ── прогон: одна длинная комната 3 м в глубину; на северной стене — закрытые двери, на южной — распахнутые (проёмы
// прорезаны наружу) ──
const DEPTH = 52;
const conns: RunConnector[] = [];
const place: { style: DoorStyle; x0: number; len: number }[] = [];
let x = 12;
for (const st of styles) {
  const len = wForce || WIDTH[st.id] || 9;
  place.push({ style: st, x0: x, len });
  const seg = (side: 'N' | 'S', id: string, extra: Partial<RunConnector>): RunConnector => {
    const cy = side === 'N' ? 0 : DEPTH - 1;
    const yl = side === 'N' ? 0 : DEPTH;
    return { id, cx: x, cy, side, len, line: [x, yl, x + len, yl], name: id, tag: 'gallery', linkedTo: null, ...extra } as RunConnector;
  };
  conns.push(seg('N', `n_${st.id}`, { exit: true }));
  conns.push(seg('S', `s_${st.id}`, { cut: true }));
  x += len + 16;
}
const LX = x + 2;
const inst: RunInstance = {
  id: 'g',
  roomId: 'gallery',
  roomName: 'Галерея дверей',
  roomTags: [],
  rot: 0,
  dx: 0,
  dy: 0,
  depth: 0,
  parent: null,
  bbox: { x0: 0, y0: 0, x1: LX, y1: DEPTH },
  cells: Array.from({ length: DEPTH }, (_, y) => `${y}:0-${LX - 1}`),
  doors: [],
  connectors: conns,
  decor: [],
  spots: [],
  tier: null,
  danger: 0,
  dangerAcc: 0,
  loot: [],
};
const run: RunExport = {
  format: 'room-forge-run', version: 1, seed: 'doors', cellM: 0.1, settings: { gap: 1 }, props: [], items: [], instances: [inst], links: [], openConnectors: [],
};
const model = buildBlockoutModel(run, { ...DEFAULT_BLOCKOUT, wallHeightM: 2.7, deadEnds: 'panel', cutEnds: 'open', ceilings: false });
// слоты дверей — по меткам (метка «gallery» каталогу не известна — дверь задаём сами)
const slots: DoorSlot[] = [];
for (const p of place) {
  const a = p.x0 * 0.1, b = (p.x0 + p.len) * 0.1;
  const base = { tag: 'gallery', style: p.style.id, widthM: p.len * 0.1, heightM: 2.1, hinge: 'left' as const, space: [1.5, 1.5] as [number, number] };
  slots.push({ ...base, inst: 'g', connector: `n_${p.style.id}`, seed: `g/n_${p.style.id}`, role: dead ? 'dead' : 'exit', leaf: true, line: [a, 0, b, 0], normal: [0, 1], angle: 0 });
  slots.push({ ...base, inst: 'g', connector: `s_${p.style.id}`, seed: `g/s_${p.style.id}`, role: 'opened', leaf: true, line: [a, DEPTH * 0.1, b, DEPTH * 0.1], normal: [0, -1], angle: restAngle(p.style, `g/s_${p.style.id}`, p.len * 0.1, 1.5) });
}
model.doors = slots;

// ── сцена ──
const canvas = document.getElementById('stage') as HTMLCanvasElement;
const engine = new Engine(canvas, true, { preserveDrawingBuffer: true, stencil: true });
const scene = new Scene(engine);
scene.clearColor = new Color4(0.05, 0.05, 0.06, 1);
const hemi = new HemisphericLight('hemi', new Vector3(0.15, 1, -0.25), scene);
hemi.intensity = 0.85;
hemi.groundColor = new Color3(0.62, 0.6, 0.58);
hemi.specular = Color3.Black();
const sun = new DirectionalLight('sun', new Vector3(-0.45, -1, 0.3), scene);
sun.intensity = 0.38;
sun.specular = Color3.Black();
buildBabylonBlockout(scene, model, { finishes: false });
const cam = new FreeCamera('cam', new Vector3(0, 1.4, -2), scene);
cam.minZ = 0.02;
cam.fov = 0.95;

const grid = document.getElementById('grid')!;
const shot = (pos: Vector3, target: Vector3): string => {
  cam.position.copyFrom(pos);
  cam.setTarget(target);
  scene.render();
  return canvas.toDataURL('image/png');
};

scene.executeWhenReady(() => {
  for (const p of place) {
    const cx = (p.x0 + p.len / 2) * 0.1;
    const w = p.len * 0.1;
    const back = Math.max(2.3, w * 1.25 + 0.9);
    // закрытая: из комнаты прямо (северная стена: план y = 0 → Babylon z = 0, комната — z < 0)
    const a = shot(new Vector3(cx, 1.25, -back), new Vector3(cx, 1.08, 0));
    // распахнутая: южная стена (z = −3), вид наискось со стороны свободного края
    const b = shot(new Vector3(cx - w * 0.5 - 0.6, 1.45, -DEPTH * 0.1 + back * 0.95), new Vector3(cx + 0.15, 1.0, -DEPTH * 0.1));
    const st = p.style;
    const cell = document.createElement('div');
    cell.className = 'cell';
    cell.innerHTML =
      `<div class="imgs"><img src="${a}"><img src="${b}"></div>` +
      `<b>${st.name}</b><span class="g">${st.group}</span> · <span class="w">${st.id} · проём ${w.toFixed(1)} м · полотно ${Math.round(st.thick * 1000) / 10} см` +
      `${st.leaves === 2 ? ' · 2 створки' : ''} · ${st.anim.handle}</span>` +
      `<div class="m">${st.model}</div><div class="w">${st.where}</div>`;
    grid.appendChild(cell);
  }
  document.getElementById('sum')!.textContent = `Двери: ${place.length} из каталога (${DOOR_STYLES.length})${dead ? ' · заколоченные' : ''}`;
  (window as unknown as { __ready: boolean }).__ready = true;
});
