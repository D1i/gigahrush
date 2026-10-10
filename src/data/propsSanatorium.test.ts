// Пропы санатория, мебель и предметы помещений (PROPS-B): записи p_san_* блока «sanatorium: мебель»
// (src/data/props.ts) и модели src/view3d/assets/sanatorium_rooms.glb (tools/make-sanatorium-rooms.mjs) совпадают по id
// и габаритам плана; коллайдеры по тегам — как задумано (настенное, подвесное, плоское на полу — 1 см; кровати и кушетка
// — 0.5, столы — 0.75, купель и чан — 0.8: без слов «ванна»/«бак» в имени); укрытия (PROP_COVER) — у кроватей, кушетки
// и столов на ножках, и просвет модели под ними не ниже заявленного.
import { describe, expect, it } from 'vitest';
import { NodeIO, getBounds, type Node } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { fileURLToPath } from 'node:url';
import { PROP_BY_ID } from './props';
import { propCover, propHeightM } from '../blockout/core';

const GLB = fileURLToPath(new URL('../view3d/assets/sanatorium_rooms.glb', import.meta.url));
const IDS = [
  'p_san_bed', 'p_san_bed_frame', 'p_san_nightstand', 'p_san_wardrobe', 'p_san_table', 'p_san_chair', 'p_san_armchair', 'p_san_rug',
  'p_san_hydro_bath', 'p_san_tile_wall', 'p_san_tile_mural', 'p_san_pipes_gauge', 'p_san_sink', 'p_san_slogan', 'p_san_couch',
  'p_san_mud_tank', 'p_san_desk', 'p_san_med_cabinet', 'p_san_scale', 'p_san_charcot_desk', 'p_san_dining_table', 'p_san_buffet',
  'p_san_floor_gap', 'p_san_lino_roll', 'p_san_shovel', 'p_san_wire_coil', 'p_san_hanging_wire', 'p_san_cement_bag', 'p_san_ladder',
  'p_san_debris',
];
const read = () => new NodeIO().registerExtensions(ALL_EXTENSIONS).read(GLB);
const h = (id: string) => propHeightM(PROP_BY_ID[id].tags, PROP_BY_ID[id].name);

describe('пропы санатория: мебель и предметы помещений', () => {
  it('у каждой записи есть модель того же габарита, у каждой модели — запись', async () => {
    const doc = await read();
    const nodes = doc.getRoot().listScenes()[0].listChildren();
    const byId = new Map(nodes.map((n) => [n.getName(), n]));
    expect([...byId.keys()].sort()).toEqual([...IDS].sort());
    for (const id of IDS) {
      const p = PROP_BY_ID[id];
      expect(p, id).toBeDefined();
      const b = getBounds(byId.get(id)!);
      const w = b.max[0] - b.min[0], d = b.max[2] - b.min[2];
      // свес за план — до 12 см (карниз, бахрома, шланги), недобор — до 20 см (тонкие настенные)
      expect(w, `${id} w`).toBeLessThanOrEqual(p.w + 0.12);
      expect(w, `${id} w`).toBeGreaterThanOrEqual(p.w - 0.2);
      expect(d, `${id} h`).toBeLessThanOrEqual(p.h + 0.12);
      expect(d, `${id} h`).toBeGreaterThanOrEqual(p.h - 0.2);
      expect(b.min[1], `${id} ниже пола`).toBeGreaterThanOrEqual(id === 'p_san_hanging_wire' ? -0.61 : -0.002);
    }
  });

  it('коллайдеры по тегам', () => {
    for (const id of ['p_san_rug', 'p_san_tile_wall', 'p_san_tile_mural', 'p_san_pipes_gauge', 'p_san_slogan', 'p_san_floor_gap', 'p_san_shovel', 'p_san_wire_coil', 'p_san_hanging_wire', 'p_san_debris']) {
      expect(h(id), id).toBe(0.01);
    }
    for (const id of ['p_san_bed', 'p_san_bed_frame', 'p_san_couch']) expect(h(id), id).toBe(0.5);
    for (const id of ['p_san_table', 'p_san_desk', 'p_san_dining_table']) expect(h(id), id).toBe(0.75);
    for (const id of ['p_san_hydro_bath', 'p_san_mud_tank', 'p_san_scale', 'p_san_charcot_desk', 'p_san_lino_roll', 'p_san_cement_bag', 'p_san_ladder']) expect(h(id), id).toBe(0.8);
    expect(h('p_san_chair')).toBe(0.45);
    expect(h('p_san_armchair')).toBe(0.85);
    expect(h('p_san_sink')).toBe(0.85);
    expect(h('p_san_buffet')).toBe(0.85);
    expect(h('p_san_nightstand')).toBe(0.85);
    expect(h('p_san_wardrobe')).toBe(1.9);
    expect(h('p_san_med_cabinet')).toBe(1.9);
  });

  it('укрытия: под кроватями, кушеткой и столами модель не ниже просвета (кроме ножек)', async () => {
    const doc = await read();
    const byId = new Map(doc.getRoot().listScenes()[0].listChildren().map((n) => [n.getName(), n] as [string, Node]));
    for (const id of ['p_san_bed', 'p_san_bed_frame', 'p_san_couch', 'p_san_table', 'p_san_desk', 'p_san_dining_table']) {
      const c = propCover(id);
      expect(c, id).not.toBeNull();
      // вершины ниже просвета — только у ножек: в полосе 0.1 м у краёв плана (и упавшая ламель на полу у кровати без матраса)
      const p = PROP_BY_ID[id];
      const n = byId.get(id)!;
      const mesh = n.getMesh()!;
      // квантованные позиции — через матрицу узла (квантование кладёт масштаб и сдвиг в узел)
      const m = n.getWorldMatrix();
      let inner = 0;
      for (const prim of mesh.listPrimitives()) {
        const pos = prim.getAttribute('POSITION')!;
        const el: number[] = [];
        for (let i = 0; i < pos.getCount(); i++) {
          pos.getElement(i, el);
          const x = m[0] * el[0] + m[4] * el[1] + m[8] * el[2] + m[12];
          const y = m[1] * el[0] + m[5] * el[1] + m[9] * el[2] + m[13];
          const z = m[2] * el[0] + m[6] * el[1] + m[10] * el[2] + m[14];
          if (y >= c!.clear + 0.02 || y < 0.03) continue;
          const nearEdge = Math.abs(x) > p.w / 2 - 0.1 || Math.abs(z) > p.h / 2 - 0.1;
          if (!nearEdge) inner++;
        }
      }
      // у кровати без матраса — сломанная ламель свисает к полу (декор, не мешает: коллайдер — плита укрытия)
      if (id === 'p_san_bed_frame') expect(inner, id).toBeLessThan(40);
      else expect(inner, id).toBe(0);
    }
  });
});
