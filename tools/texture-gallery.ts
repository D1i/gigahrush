// Галерея процедурных текстур: все kind в типовых габаритах на светлом (пол) и тёмном фоне.
// Параметры URL: ?scale=90 (px на метр), ?only=sofa,bed_single, ?small=28 (px/м мелкого превью).
import { makeTexture, TEXTURE_KINDS, type TextureKind } from '../src/data/textures';

const DIMS: Record<TextureKind, [number, number]> = {
  sofa: [2.0, 0.9], bed_single: [0.9, 2.0], bed_double: [1.6, 2.0], wardrobe: [1.2, 0.6],
  sideboard: [1.4, 0.45], wall_unit: [3.0, 0.5], table_rect: [1.2, 0.75], table_round: [0.9, 0.9],
  desk: [1.2, 0.65], chair: [0.45, 0.5], stool: [0.35, 0.35], armchair: [0.75, 0.8],
  fridge: [0.6, 0.65], stove: [0.5, 0.6], sink_kitchen: [0.8, 0.6], kitchen_counter: [1.0, 0.6],
  boiler: [0.45, 0.4], bathtub: [1.5, 0.7], toilet: [0.38, 0.68], washbasin: [0.55, 0.45],
  washing_machine: [0.6, 0.6], rug: [2.0, 1.4], tv_stand: [0.9, 0.5], radio: [0.6, 0.35],
  workbench: [1.5, 0.7], shelf: [1.0, 0.3], tool_cabinet: [0.8, 0.45], coat_rack: [1.0, 0.35],
  shoe_rack: [0.8, 0.35], nightstand: [0.45, 0.4], dresser: [1.0, 0.5], piano: [1.5, 0.6],
  radiator: [1.0, 0.15], plant: [0.5, 0.5], boxes: [0.8, 0.6], moonshine_still: [0.8, 0.5],
  bottle_crate: [0.5, 0.33], trash: [0.35, 0.35], pipe: [1.0, 0.12], mattress: [0.9, 1.9],
  sewing_machine: [0.9, 0.5], bookshelf: [0.9, 0.35], cot: [0.7, 1.9],
  elevator: [1.4, 1.6], mailboxes: [1.0, 0.3], bench: [1.5, 0.5], locker: [0.9, 0.5],
  office_desk: [1.4, 0.75], shower: [0.9, 0.9], sink_row: [2.4, 0.5], drying_rack: [1.6, 0.6],
  electrical_panel: [0.6, 0.25], pipes: [2.5, 0.35], boiler_tank: [0.8, 0.8], stroller: [0.6, 1.1],
  bicycle: [1.8, 0.6], lenin_bust: [0.6, 0.6], chess_table: [0.7, 0.7], coat_hooks: [1.2, 0.3],
};

const q = new URLSearchParams(location.search);
const scale = Number(q.get('scale') ?? 90);
const small = Number(q.get('small') ?? 30);
const only = q.get('only')?.split(',') ?? null;

function bytes(url: string): number {
  const b64 = url.slice(url.indexOf(',') + 1);
  return Math.floor((b64.length * 3) / 4) - (b64.endsWith('==') ? 2 : b64.endsWith('=') ? 1 : 0);
}

const grid = document.getElementById('grid')!;
const sizes: number[] = [];
// ?stress=1 — нетипичные габариты (проверка, что ничего не ломается)
const jobs: [TextureKind, number, number][] = [];
for (const kind of TEXTURE_KINDS) {
  if (only && !only.includes(kind)) continue;
  if (q.get('stress')) for (const d of [[0.2, 2], [2, 0.2], [1, 1], [3, 0.6]] as const) jobs.push([kind, d[0], d[1]]);
  else jobs.push([kind, ...DIMS[kind]]);
}
for (const [kind, w, h] of jobs) {
  const url = makeTexture(kind, w, h);
  if (!url) continue;
  const n = bytes(url);
  sizes.push(n);
  const cell = document.createElement('div');
  cell.className = 'cell';
  const img = (sc: number, cls: string) =>
    `<div class="bg ${cls}"><img src="${url}" width="${Math.round(w * sc)}" height="${Math.round(h * sc)}"></div>`;
  cell.innerHTML =
    `<div class="${n > 12000 ? 'big' : ''}">${kind} ${w}×${h} — ${n} B</div>` +
    `<div class="row">${img(scale, 'floor')}${img(scale, 'dark')}${img(small, 'floor')}</div>`;
  grid.appendChild(cell);
}
const total = sizes.reduce((a, b) => a + b, 0);
document.getElementById('sum')!.textContent =
  `${sizes.length} текстур; всего ${total} B; среднее ${Math.round(total / Math.max(1, sizes.length))} B; максимум ${Math.max(0, ...sizes)} B`;
