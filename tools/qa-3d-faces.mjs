// Анализ model.faces (ядро через dev-сервер Vite в браузере): перекрытия и микрозазоры соседних граней
// в одной плоскости. node tools/qa-3d-faces.mjs [url] [fixture]
import { chromium } from 'playwright-core';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const url = process.argv[2] ?? 'http://localhost:5205/';
const fx = process.argv[3] ?? 'run-gap1-30';
const run = JSON.parse(readFileSync(fileURLToPath(new URL(`../src/blockout/fixtures/${fx}.json`, import.meta.url)), 'utf8'));
// отделку всем — чтобы ядро выдало грани
run.finishes = [{ id: 'w', name: 'w', surface: 'wall', color: '#888888', tex: null, hasTex: false, tileW: 1, tileH: 1, dado: null }];
for (const i of run.instances) i.finish = { wall: 'w', floor: null };

const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
const page = await browser.newPage();
await page.goto(new URL('examples/babylon-demo/', url).href);
const res = await page.evaluate(async (run) => {
  const { buildBlockoutModel } = await import('/src/blockout/core.ts');
  const m = buildBlockoutModel(run);
  const geo = (f) => {
    const vx = Math.abs(f.normal[0]) >= Math.abs(f.normal[1]);
    const [x1, y1, x2, y2] = f.line;
    return { key: (vx ? 'x' : 'y') + Math.sign(vx ? f.normal[0] : f.normal[1]) + ':' + (vx ? x1 : y1).toFixed(4), a0: Math.min(vx ? y1 : x1, vx ? y2 : x2), a1: Math.max(vx ? y1 : x1, vx ? y2 : x2) };
  };
  const planes = new Map();
  for (const f of m.faces) {
    const g = { ...geo(f), f };
    if (!planes.has(g.key)) planes.set(g.key, []);
    planes.get(g.key).push(g);
  }
  const overlaps = [];
  const gaps = [];
  const splits = [];
  for (const [key, list] of planes) {
    list.sort((a, b) => a.a0 - b.a0);
    for (let i = 0; i < list.length; i++)
      for (let j = i + 1; j < list.length; j++) {
        const A = list[i];
        const B = list[j];
        const w = Math.min(A.a1, B.a1) - Math.max(A.a0, B.a0);
        const h = Math.min(A.f.z1, B.f.z1) - Math.max(A.f.z0, B.f.z0);
        const d = (g) => `${g.f.inst}[${g.a0.toFixed(2)}..${g.a1.toFixed(2)} z${g.f.z0}-${g.f.z1} ${g.f.part}]`;
        if (w > 1e-6 && h > 1e-6) overlaps.push(`${key} ${d(A)} × ${d(B)}`);
        const gap = B.a0 - A.a1;
        if (gap > 1e-6 && gap < 0.05 && h > 1e-6) gaps.push(`${key} ${d(A)} |${gap.toFixed(4)}| ${d(B)}`);
        if (Math.abs(gap) < 1e-6 && A.f.inst === B.f.inst && A.f.part === 'wall' && B.f.part === 'wall' && A.f.z0 === B.f.z0 && A.f.z1 === B.f.z1) splits.push(`${key} ${d(A)} + ${d(B)}`);
      }
  }
  return { faces: m.faces.length, planes: planes.size, overlapCount: overlaps.length, overlaps: overlaps.slice(0, 12), gapCount: gaps.length, gaps: gaps.slice(0, 12), sameRoomSplits: splits.length, splitSample: splits.slice(0, 6) };
}, run);
console.log(JSON.stringify(res, null, 1));
await browser.close();
