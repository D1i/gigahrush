// Пример интеграции Room Forge → Babylon.js: JSON прогона → болванка уровня → ходьба от первого лица.
// Запуск: npm run dev → <адрес dev-сервера>/examples/babylon-demo/
//
// В своём проекте нужно только:
//   1) скопировать папку src/blockout/ (types.ts, core.ts, babylon.ts, subrun.ts, pieces.ts) и для
//      складчатых прогонов — src/view3d/portal.ts;
//   2) npm i @babylonjs/core;
//   3) повторить функцию loadLevel() ниже (для складчатых прогонов — showFold()).
//
// Складчатый (4D) прогон (run.mode === 'fold'): комнаты разных слоёв W стоят в одном месте 3D, поэтому —
// портальный рендер: у каждой комнаты свой кусок болванки, текущая рисуется обычно, остальные — только
// сквозь проёмы (стенсил), рекурсивно, пока проём виден в кадре (тумана не нужно). Комнаты могут
// пересекаться в 3D даже в поле зрения; переход через порог бесшовен. Подробно — docs/BLOCKOUT-BABYLON.md §12.
import { Engine } from '@babylonjs/core/Engines/engine';
import { Scene } from '@babylonjs/core/scene';
import { UniversalCamera } from '@babylonjs/core/Cameras/universalCamera';
import { HemisphericLight } from '@babylonjs/core/Lights/hemisphericLight';
import { Color3, Color4 } from '@babylonjs/core/Maths/math.color';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import '@babylonjs/core/Collisions/collisionCoordinator'; // без этого импорта checkCollisions не работает
import '@babylonjs/core/Culling/ray'; // picking (клик по полу → комната)

import { buildBlockoutModel } from '../../src/blockout/core';
import { buildBabylonBlockout, type BabylonBlockout } from '../../src/blockout/babylon';
import { isFoldRun, linkBetween } from '../../src/blockout/subrun';
import type { BlockoutModel, RunExport } from '../../src/blockout/types';
import { PieceCache, PortalRenderer } from '../../src/view3d/portal';

// ── сцена ──
const canvas = document.getElementById('c') as HTMLCanvasElement;
// stencil: true — нужен портальному рендеру складчатых прогонов (по умолчанию в WebGL его нет)
const engine = new Engine(canvas, true, { stencil: true }, true);
const scene = new Scene(engine);
scene.clearColor = new Color4(0.05, 0.05, 0.06, 1);
scene.collisionsEnabled = true;
scene.gravity = new Vector3(0, -9.81 / 60, 0); // смещение за кадр при 60 fps

const light = new HemisphericLight('light', new Vector3(0.2, 1, -0.3), scene);
light.groundColor = new Color3(0.4, 0.4, 0.4); // потолки и низ мебели не чёрные

// ── игрок: камера-капсула, глаза на 1.6 м ──
const player = new UniversalCamera('player', new Vector3(0, 1.65, 0), scene);
player.ellipsoid = new Vector3(0.3, 0.85, 0.3); // полуоси капсулы: ширина 0.6 м, рост 1.7 м
player.ellipsoidOffset = new Vector3(0, 0.1, 0); // низ капсулы = позиция камеры − 1.6 м
player.checkCollisions = true;
player.applyGravity = true;
player.minZ = 0.05;
player.speed = 0.22;
player.angularSensibility = 2200;
player.keysUp = [87, 38]; // W ↑
player.keysDown = [83, 40]; // S ↓
player.keysLeft = [65, 37]; // A ←
player.keysRight = [68, 39]; // D →
player.attachControl(true);
canvas.addEventListener('click', () => {
  canvas.focus();
  engine.enterPointerlock();
});

// ── уровень ──
let level: BabylonBlockout | null = null;
let lastRun: RunExport | null = null;
const finishBox = document.getElementById('finishes') as HTMLInputElement;

function loadLevel(run: RunExport) {
  lastRun = run;
  const start = run.instances.find((i) => i.parent == null) ?? run.instances[0];
  fold?.portal.dispose();
  fold?.cache.dispose();
  fold = null;
  level?.dispose(); // старый уровень: меши, материалы, текстуры
  level = null;
  if (isFoldRun(run)) {
    showFold(run, start.id);
    const layers = new Set(run.instances.map((i) => i.w ?? 0)).size;
    return info(`${run.seed}: складчатый (4D), комнат ${run.instances.length}, слоёв W ${layers}; портальный рендер`);
  }

  // 1) ядро: план → непересекающиеся объёмы стен, полы, потолки, проёмы (чистые данные, без Babylon)
  const model = buildBlockoutModel(run, { deadEnds: 'panel' });

  // 2) адаптер: модель → меши Babylon (стены слиты по видам, полы/потолки/мебель — по мешу).
  //    finishes: облицовка стен (обои, кафель, краска) и полы по отделке комнат из JSON — если JSON
  //    экспортирован с текстурами, иначе — средним цветом отделки; false — сетка блокаута.
  level = buildBabylonBlockout(scene, model, { collisions: true, finishes: finishBox.checked });

  // 3) спавн в стартовой комнате
  const room = spawnIn(model, start?.id);
  const fin = model.finishes?.length ? `, отделок ${model.finishes.length}` : ', без отделки';
  info(`${run.seed}: комнат ${model.rooms.length}, объёмов ${model.solids.length}${fin}, мешей ${scene.meshes.length}, старт — ${room.name}`);
}

/** Игрок — у anchor комнаты inst, взгляд на её первый проём. План (x, y вниз) → Babylon (X = x, Z = −y). */
function spawnIn(model: BlockoutModel, inst: string | undefined) {
  const room = model.rooms.find((r) => r.inst === inst) ?? model.rooms[0];
  const [x, y] = room.anchor;
  player.position.set(x, 1.65, -y);
  const door = model.openings.find((o) => o.a.inst === room.inst || o.b.inst === room.inst);
  const [tx, ty] = door ? [(door.rect.x0 + door.rect.x1) / 2, (door.rect.y0 + door.rect.y1) / 2] : [x + 1, y];
  player.setTarget(new Vector3(tx, 1.5, -ty));
  return room;
}

// ── складчатый (4D) прогон: портальный рендер ──
let fold: { run: RunExport; cache: PieceCache; portal: PortalRenderer } | null = null;

/** Горизонт портального рендера (как viewHorizonM в src/gen4d/pvs.ts): проёмы открываются, пока видны в
 *  кадре, а дальше горизонта комната за проёмом рисуется без своих проёмов. Туман не нужен (по желанию —
 *  атмосфера: тогда проёмы за fogEnd рендер не открывает сам). */
const horizonOf = (run: RunExport) => {
  const s = Number(run.settings?.sightM) || 0;
  return s > 0 ? Math.max(3 * s, 24) : 40;
};

function showFold(run: RunExport, start: string) {
  // куски комнат (своя геометрия каждой, строятся по требованию и кэшируются) и рендер по проёмам
  const cache = new PieceCache(scene, run, { blockout: { deadEnds: 'panel' }, finishes: finishBox.checked });
  const portal = new PortalRenderer(scene, player, cache, {
    horizonM: horizonOf(run),
    // игрок перешёл через середину проёма — текущей стала комната за ним (3D-позиция не меняется)
    onCross: (from, to) => {
      const w = (id: string) => run.instances.find((i) => i.id === id)?.w ?? 0;
      const dw = linkBetween(run, from, to)?.dw ?? 0;
      const room = cache.peek(to)?.model.rooms[0];
      info(`${room?.name ?? to} · W ${w(to)}${dw ? ` (порог: W ${w(to) - dw} → ${w(to)})` : ''}`);
    },
  });
  portal.setCurrent(start);
  portal.setActive(true); // кадр, текущая комната (по полу), коллизии (текущая + сосед у порога) — сам
  fold = { run, cache, portal };
  spawnIn(cache.get(start)!.model, start);
}

// клик по полу/мебели → комната (metadata.inst)
scene.onPointerDown = (_e, pick) => {
  const inst = level?.instOf(pick?.pickedMesh);
  if (inst) console.log('комната', inst, pick?.pickedMesh?.metadata);
};

engine.runRenderLoop(() => scene.render());
// для отладки из консоли: demo.player.position, demo.fold?.center
(window as any).demo = { scene, player, get fold() { return fold; }, get level() { return level; } };
window.addEventListener('resize', () => engine.resize());

// ── выбор JSON: фикстура (fetch из src/blockout/fixtures) или свой файл ──
const sel = document.getElementById('fixture') as HTMLSelectElement;
const file = document.getElementById('file') as HTMLInputElement;
const info = (s: string) => ((document.getElementById('info') as HTMLElement).textContent = s);
const fail = (e: unknown) => {
  const el = document.getElementById('err') as HTMLElement;
  el.textContent = 'Не удалось построить уровень:\n' + String((e as Error)?.message ?? e);
  el.style.display = 'block';
  console.error(e);
};
const run = (fn: () => Promise<RunExport> | RunExport) =>
  Promise.resolve()
    .then(fn)
    .then((r) => {
      (document.getElementById('err') as HTMLElement).style.display = 'none';
      loadLevel(r);
    })
    .catch(fail);

// './…' — файл рядом с демо (складчатый прогон), иначе — фикстура ядра
const fixture = (name: string) =>
  run(() => fetch(new URL(name.startsWith('./') ? name : `../../src/blockout/fixtures/${name}`, import.meta.url)).then((r) => r.json()));
sel.onchange = () => fixture(sel.value);
(document.getElementById('open') as HTMLElement).onclick = () => file.click();
file.onchange = () => {
  const f = file.files?.[0];
  if (f) run(() => f.text().then((t) => JSON.parse(t) as RunExport));
  file.value = '';
};
// отделка вкл/выкл — перестроить тот же уровень (игрок остаётся на месте)
finishBox.onchange = () => {
  if (!lastRun) return;
  const pos = player.position.clone();
  const rot = player.rotation.clone();
  const cur = fold?.portal.current;
  loadLevel(lastRun);
  if (fold && cur) fold.portal.setCurrent(cur); // складчатый: та же комната
  player.position.copyFrom(pos);
  player.rotation.copyFrom(rot);
};
fixture(sel.value);
