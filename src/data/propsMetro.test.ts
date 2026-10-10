// Пропы метро: записи p_metro_* (src/data/props.ts) и модели src/view3d/assets/metro_props.glb (tools/make-metro-props.mjs)
// совпадают по id и габаритам плана; коллайдеры по тегам — как задумано (пути, кромка, панно, свет — 1 см, скамья —
// 0.45; обломки — «россыпь», 1 см: куча пепла по щиколотку, бокс 0.25 на весь план 1.2 × 1.0 — невидимая ступень-стена
// вокруг низкой модели).
import { describe, expect, it } from 'vitest';
import { NodeIO, getBounds } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { fileURLToPath } from 'node:url';
import { PROP_DEFS } from './props';
import { propHeightM } from '../blockout/core';

const GLB = fileURLToPath(new URL('../view3d/assets/metro_props.glb', import.meta.url));
const METRO = PROP_DEFS.filter((p) => p.id.startsWith('p_metro_'));

describe('пропы метро', () => {
  it('у каждой записи есть модель того же габарита, у каждой модели — запись', async () => {
    const doc = await new NodeIO().registerExtensions(ALL_EXTENSIONS).read(GLB);
    const nodes = doc.getRoot().listScenes()[0].listChildren();
    const byId = new Map(nodes.map((n) => [n.getName(), n]));
    expect(METRO.length).toBeGreaterThanOrEqual(21);
    for (const p of METRO) {
      const n = byId.get(p.id);
      expect(n, p.id).toBeTruthy();
      const b = getBounds(n!);
      const w = b.max[0] - b.min[0], d = b.max[2] - b.min[2];
      // свес за план — до 12 см (рама, кант, карниз), недобор — до 20 см (тонкие настенные)
      expect(w, `${p.id} w`).toBeLessThanOrEqual(p.w + 0.12);
      expect(w, `${p.id} w`).toBeGreaterThanOrEqual(p.w - 0.2);
      expect(d, `${p.id} h`).toBeLessThanOrEqual(p.h + 0.12);
      expect(d, `${p.id} h`).toBeGreaterThanOrEqual(p.h - 0.2);
    }
    for (const id of byId.keys()) expect(METRO.some((p) => p.id === id), id).toBe(true);
  });

  it('коллайдеры: накладное, настенное, подвесное и обломки — 1 см, скамья 0.45', () => {
    const h = (id: string) => {
      const p = METRO.find((x) => x.id === id)!;
      return propHeightM(p.tags, p.name);
    };
    for (const id of ['p_metro_track', 'p_metro_edge', 'p_metro_panel', 'p_metro_light', 'p_metro_light_strip', 'p_metro_sign', 'p_metro_clock', 'p_metro_cable', 'p_metro_mini_track', 'p_metro_micro_track', 'p_metro_mini_edge', 'p_metro_micro_edge', 'p_metro_mini_panel', 'p_metro_micro_panel']) {
      expect(h(id), id).toBe(0.01);
    }
    expect(h('p_metro_bench')).toBe(0.45);
    expect(h('p_metro_debris')).toBe(0.01);
    for (const id of ['p_metro_turnstile', 'p_metro_kassa', 'p_metro_esc_booth', 'p_metro_esc_wreck', 'p_metro_gears']) expect(h(id), id).toBe(0.8);
  });
});
