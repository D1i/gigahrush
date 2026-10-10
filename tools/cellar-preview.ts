// Превью земляного погреба (src/view3d/cellarMesh.ts + cellarView.ts) на настоящих комнатах биома (src/data/roomsCellar.ts):
// хаб с лазом наверх (выход — дверь болванки), ход 3 м в крепи, щель 1.8 м, ход со щелью в закром с банками, Г-поворот,
// ход 2 м сбоку. Куски строит PieceCache портального рендера (как в игре: оболочка вместо стен, пола и потолка, предметы
// из cellar_props.glb), но рисуются обычной сценой — комнаты здесь не пересекаются. Свет — как в погребе: темно, бурый
// туман 0.6…4.5 м, у глаз почти погашенная лампа, фонарь игрока (src/view3d/flashlight.ts) в руке.
//  ?view=0..9 — кадр (см. VIEWS), ?fog=0 — без тумана, ?lit=1 — светло (проверка формы), ?flash=0 — без фонаря,
//  ?bin=<id> — клетушка за щелью (по умолчанию cel_bin_jars).
// Скриншоты: node tools/cellar-preview-shots.mjs
import { Engine } from '@babylonjs/core/Engines/engine';
import { Scene } from '@babylonjs/core/scene';
import { UniversalCamera } from '@babylonjs/core/Cameras/universalCamera';
import { HemisphericLight } from '@babylonjs/core/Lights/hemisphericLight';
import { PointLight } from '@babylonjs/core/Lights/pointLight';
import { Color3, Color4 } from '@babylonjs/core/Maths/math.color';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { createDefaultProject } from '../src/data/presets';
import { exportRunJSON, instanceWorld } from '../src/gen/world';
import { segmentLine } from '../src/model/segments';
import type { Instance, Rot, Run, Side } from '../src/model/types';
import { DEFAULT_BLOCKOUT, type RunExport } from '../src/blockout/types';
import { PieceCache } from '../src/view3d/portal';
import { PropModels } from '../src/view3d/propModels';
import { Flashlight } from '../src/view3d/flashlight';
import { cellarCache, cellarMaterial, cellarOptsOf, cellarPrefetch } from '../src/view3d/cellarView';
import { cellarSpecFor } from '../src/view3d/cellarMesh';
import cellarUrl from '../src/view3d/assets/cellar_props.glb?url';
import basementUrl from '../src/view3d/assets/basement_props.glb?url';

const q = new URLSearchParams(location.search);
const C = 0.1;
const p = createDefaultProject();

// ───────────────────────── раскладка ─────────────────────────

const insts: Instance[] = [];
const links: Run['links'] = [];
const OPP: Record<Side, Side> = { N: 'S', S: 'N', E: 'W', W: 'E' };
const OUT: Record<Side, [number, number]> = { N: [0, -1], S: [0, 1], E: [1, 0], W: [-1, 0] };
const roomOf = (id: string) => p.rooms.find((r) => r.id === id)!;
/** номер метки комнаты (без поворота) по стороне и тегу */
const ci = (roomId: string, side: Side, tag?: string) => roomOf(roomId).connectors.findIndex((c) => c.side === side && (!tag || c.tag === tag));
const place = (id: string, roomId: string, rot: Rot, dx: number, dy: number): Instance => {
  const i: Instance = { id, roomId, rot, dx, dy, order: insts.length, parent: null, depth: 0 };
  insts.push(i);
  return i;
};
/** комната roomId метки kb — к метке ka экземпляра a через зазор 1 клетка (поворот — какой подходит) */
function attach(a: Instance, ka: number, id: string, roomId: string, kb: number): Instance {
  const ca = instanceWorld(p, a).connectors[ka];
  for (const rot of [0, 90, 180, 270] as Rot[]) {
    const cb = instanceWorld(p, { id, roomId, rot, dx: 0, dy: 0, order: 0, parent: null, depth: 0 }).connectors[kb];
    if (cb.side !== OPP[ca.side]) continue;
    const la = segmentLine(ca), lb = segmentLine(cb);
    const [ox, oy] = OUT[ca.side];
    const i = place(id, roomId, rot, Math.min(la[0], la[2]) - Math.min(lb[0], lb[2]) + ox, Math.min(la[1], la[3]) - Math.min(lb[1], lb[3]) + oy);
    links.push({ a: { inst: a.id, connector: roomOf(a.roomId).connectors[ka].id }, b: { inst: id, connector: roomOf(roomId).connectors[kb].id } });
    return i;
  }
  throw new Error(`не пристыковать ${roomId}`);
}

const H = place('H', 'cel_hub_small', 0, 0, 0);
const P3 = attach(H, ci('cel_hub_small', 'S'), 'P3', 'cel_pass_3', ci('cel_pass_3', 'N'));
const Q = attach(P3, ci('cel_pass_3', 'S'), 'Q', 'cel_squeeze_18', ci('cel_squeeze_18', 'N'));
const PB = attach(Q, ci('cel_squeeze_18', 'S'), 'PB', 'cel_pass_bin', ci('cel_pass_bin', 'N'));
// ?bin=<id> — клетушка за щелью (cel_bin_fallen — куча и оползень, cel_bin_sacks — мешки); по умолчанию закром с банками
const binId = q.get('bin') ?? 'cel_bin_jars';
const BIN = attach(PB, ci('cel_pass_bin', 'W', 'cellar>bin'), 'BIN', binId, ci(binId, 'S'));
attach(PB, ci('cel_pass_bin', 'S'), 'L', 'cel_turn_l', ci('cel_turn_l', 'S'));
attach(H, ci('cel_hub_small', 'W'), 'P2', 'cel_pass_2', ci('cel_pass_2', 'N'));
const run: Run = {
  seed: 'cellar-preview', settings: { ...p.generator, gap: 1 } as unknown as Run['settings'], instances: insts, links, openConnectors: [], content: [], totals: {},
  warnings: [], sight: { maxM: 0, line: null }, ms: 0,
};
const rx = exportRunJSON(p, run) as RunExport;
// лаз наверх хаба — закрытый выход сети (в мире его так отмечает src/gen4d/stream.ts)
for (const k of rx.instances.find((i) => i.id === 'H')!.connectors) if (k.tag === 'stair') k.exit = true;

// ───────────────────────── сцена ─────────────────────────

const canvas = document.getElementById('c') as HTMLCanvasElement;
const engine = new Engine(canvas, true, { preserveDrawingBuffer: true, stencil: true });
const scene = new Scene(engine);
const lit = q.get('lit') === '1';
scene.clearColor = new Color4(0.016, 0.012, 0.008, 1);
scene.ambientColor = new Color3(0, 0, 0);
const hemi = new HemisphericLight('hemi', new Vector3(0.2, 1, -0.3), scene);
hemi.intensity = lit ? 0.9 : 0;
hemi.groundColor = new Color3(0.4, 0.38, 0.36);
hemi.specular = Color3.Black();
if (q.get('fog') !== '0' && !lit) {
  // туман погреба (src/view3d/cellarWalk.ts CELLAR_FOG)
  scene.fogMode = Scene.FOGMODE_LINEAR;
  scene.fogStart = 0.6;
  scene.fogEnd = 4.5;
  scene.fogColor = new Color3(0.016, 0.012, 0.008);
}
// лампа биома у глаз — почти погашена (cellarWalk.ts CELLAR_LAMP)
const lamp = new PointLight('mood:lamp', Vector3.Zero(), scene);
lamp.intensity = 0.06;
lamp.range = 1.5;
lamp.diffuse = new Color3(1, 0.72, 0.45);
lamp.specular = Color3.Black();

const bb = (i: Instance) => {
  const b = instanceWorld(p, i).bbox;
  return { x0: b.x0 * C, y0: b.y0 * C, x1: b.x1 * C, y1: b.y1 * C, cx: ((b.x0 + b.x1) / 2) * C, cy: ((b.y0 + b.y1) / 2) * C };
};
const h = bb(H), p3 = bb(P3), qq = bb(Q), pb = bb(PB), bin = bb(BIN);
/** кадры: глаз (x, y плана, высота) → цель */
const VIEWS: [number, number, number, number, number, number][] = [
  [p3.cx, p3.y0 + 0.25, 1.6, p3.cx, p3.y1 + 2.5, 1.25], // 0 — вдоль хода 3 м к щели
  [qq.cx, qq.cy - 0.7, 1.6, qq.cx, qq.cy + 1.5, 1.3], // 1 — в щели вперёд
  [qq.cx + 0.03, qq.cy + 0.1, 1.55, qq.x0 - 1, qq.cy + 0.35, 1.25], // 2 — в щели лицом к стене (боком)
  [h.cx + 0.1, h.y1 - 0.25, 1.6, h.cx - 0.25, h.y0 - 0.6, 1.45], // 3 — хаб: лаз наверх (дверь болванки)
  [h.cx + 0.2, h.y0 + 0.35, 1.6, p3.cx, p3.y0 + 1.2, 0.9], // 4 — хаб: устье хода на юг
  [pb.cx + 0.12, pb.y0 + 0.25, 1.6, bin.x1, bin.cy + 0.2, 1.1], // 5 — ход: щель в закром
  [bin.x1 - 0.25, bin.cy + 0.5, 1.6, bin.x0, bin.y0 + 0.4, 1.0], // 6 — в закроме
  [p3.cx + 0.1, p3.y0 + 0.9, 1.6, p3.x0 - 0.1, p3.y0 + 1.6, 0.05], // 7 — подошва стены, осыпь
  [h.cx + 1.0, h.y1 + 1.5, 9, h.cx + 0.6, h.y1 + 3.5, 0], // 8 — сверху
  [qq.cx - 0.12, qq.y1 - 0.12, 1.5, pb.cx + 0.05, pb.y0 + 0.5, 1.15], // 9 — шов щели и хода (стык кусков)
];
const v = VIEWS[Number(q.get('view') ?? 0)] ?? VIEWS[0];
const cam = new UniversalCamera('cam', new Vector3(v[0], v[2], -v[1]), scene);
cam.setTarget(new Vector3(v[3], v[5], -v[4]));
cam.fov = 1.15;
cam.minZ = 0.05;
// куски рисует портальный рендер (слой PORTAL_LAYER) — здесь их рисует камера
cam.layerMask = 0xffffffff;
lamp.position.copyFrom(cam.position).addInPlaceFromFloats(0, -0.08, 0);

const props = new PropModels(scene, [cellarUrl, basementUrl]);
let flash: Flashlight | null = null;
if (q.get('flash') !== '0' && !lit) {
  flash = new Flashlight(scene, cam, { sound: () => false });
  flash.setHeld(true);
  flash.setOn(true);
}

void (async () => {
  await props.loaded;
  const opts = { blockout: { ...DEFAULT_BLOCKOUT, doors: true, deadEnds: 'wall' as const }, propModel: (id: string) => props.get(id), finishes: true, openCut: true };
  // сетки оболочек — в воркере (как при росте мира), куски — как в игре
  const co = cellarOptsOf(opts.blockout, true);
  const ids = insts.map((i) => i.id);
  const t0 = performance.now();
  cellarPrefetch(scene, rx, ids, co);
  const keys = ids.map((id) => cellarSpecFor(rx, id, co)!.key);
  const cc = cellarCache(scene);
  while (!keys.every((k) => cc.has(k)) && performance.now() - t0 < 20000) await new Promise((r) => setTimeout(r, 50));
  const workerMs = performance.now() - t0;
  // материал земли (текстура — из шума) — один раз на сцену, при первом куске погреба
  const tm = performance.now();
  cellarMaterial(scene);
  const matMs = Math.round(performance.now() - tm);
  const cache = new PieceCache(scene, rx, opts);
  const pieces: Record<string, { tris: number; ms: number }> = {};
  for (const id of ids) {
    const t1 = performance.now();
    const piece = cache.get(id)!;
    // маски проёмов — только для стенсила портального рендера
    for (const pq of piece.portals) {
      pq.mask.setEnabled(false);
      pq.thin.setEnabled(false);
    }
    const shell = piece.meshes.find((m) => m.name.startsWith('cellar:'));
    pieces[id] = { tris: shell ? shell.getTotalIndices() / 3 : -1, ms: Math.round(performance.now() - t1) };
  }
  let last = performance.now();
  scene.onBeforeRenderObservable.add(() => {
    const now = performance.now();
    flash?.update((now - last) / 1000, { speed: 0, sprint: 0, crawl: 0 });
    last = now;
  });
  engine.runRenderLoop(() => scene.render());
  await new Promise((res) => setTimeout(res, 1200));
  (window as unknown as { __cellar: unknown }).__cellar = {
    models: props.size, error: props.error, pieces, matMs, workerBuilt: cc.workerBuilt, syncBuilt: cc.syncBuilt, workerMs: Math.round(workerMs),
  };
})();
addEventListener('resize', () => engine.resize());
