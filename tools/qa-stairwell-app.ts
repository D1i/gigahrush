// Стенд сцены «Бесконечная лестница» без приложения (для QA и подбора света): свой движок, сцена из
// src/locations/sceneStairwell.ts, механика — настоящая. Параметры спецификации — из адреса:
// ?interval=1,1.5&grab=4&accel=6&sounds=2,2&floors=2,2&dark=0.85&seed=qa&hud=1
import { Engine } from '@babylonjs/core/Engines/engine';
import { StairwellScene } from '../src/locations/sceneStairwell';
import { DEFAULT_STAIRWELL } from '../src/locations/stairwell';
import type { StairwellSpec } from '../src/model/types';

const q = new URLSearchParams(location.search);
const pair = (k: string, d: [number, number]): [number, number] => {
  const v = q.get(k)?.split(',').map(Number);
  return v && v.length === 2 && v.every(Number.isFinite) ? [v[0], v[1]] : d;
};
const num = (k: string, d: number) => (q.has(k) && Number.isFinite(Number(q.get(k))) ? Number(q.get(k)) : d);
const spec: StairwellSpec = {
  ...DEFAULT_STAIRWELL,
  sounds: pair('sounds', DEFAULT_STAIRWELL.sounds),
  interval: pair('interval', DEFAULT_STAIRWELL.interval),
  floorsDown: pair('floors', DEFAULT_STAIRWELL.floorsDown),
  grabS: num('grab', DEFAULT_STAIRWELL.grabS),
  accelS: num('accel', DEFAULT_STAIRWELL.accelS),
  darkness: num('dark', DEFAULT_STAIRWELL.darkness),
};
const canvas = document.getElementById('c') as HTMLCanvasElement;
const hud = document.getElementById('hud')!;
const engine = new Engine(canvas, true, { stencil: true, preserveDrawingBuffer: false }, true);
window.addEventListener('resize', () => engine.resize());
const exits: string[] = [];
const s = await StairwellScene.create(engine, canvas, {
  spec,
  seedKey: q.get('seed') ?? 'qa',
  sound: q.get('sound') !== '0',
  onHud: (h) => {
    if (q.get('hud') === '1') hud.textContent = JSON.stringify({ ...h, y: +h.y.toFixed(2), meter: +h.meter.toFixed(2) }, null, 1);
  },
  onExit: (k, n) => exits.push(`${k}:${n}`),
});
s.attach();
engine.runRenderLoop(() => s.render());
Object.assign(window, { __stair: s, __stairExits: exits, __engine: engine });
