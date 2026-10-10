// Пропы санатория, архитектура (PROPS-A): записи p_san_* блока «sanatorium: архитектура» (src/data/props.ts) и модели
// src/view3d/assets/sanatorium_props.glb (tools/make-sanatorium-props.mjs) совпадают по id и габаритам плана; подвесные
// (тег «потолок») висят верхом в 0, остальные стоят на полу; коллайдеры по тегам — как задумано (настенное, подвесное,
// дорожка — 1 см; банкетка и стул — 0.45, кадки — 1.2, перегородка — 2.0, опора — 2.1, бассейн — весь бокс 0.8); свет —
// только emissive (лампы, стёкла окон, тюль), вода бассейна — альфа-тест по текстуре ряби (куски рисуются без смешивания).
import { describe, expect, it } from 'vitest';
import { NodeIO, getBounds } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { fileURLToPath } from 'node:url';
import { PROP_BY_ID } from './props';
import { propHeightM } from '../blockout/core';

const GLB = fileURLToPath(new URL('../view3d/assets/sanatorium_props.glb', import.meta.url));
/** id → ожидаемая высота коллайдера по тегам, м */
const IDS: Record<string, number> = {
  p_san_runner: 0.01,
  p_san_window_curtain: 0.01,
  p_san_window_low: 0.01,
  p_san_bench: 0.45,
  p_san_ficus: 1.2,
  p_san_palm: 1.2,
  p_san_ceiling_lamp: 0.01,
  p_san_chandelier: 0.01,
  p_san_reception: 0.8,
  p_san_sofa: 0.85,
  p_san_noticeboard: 0.01,
  p_san_clock: 0.01,
  p_san_glass_screen: 2.0,
  p_san_arch_window: 0.01,
  p_san_vault: 0.01,
  p_san_vault_leg: 2.1,
  p_san_pool: 0.8,
  p_san_pool_ladder: 0.8,
  p_san_plastic_chair: 0.45,
  p_san_radiator: 0.6,
};
const read = () => new NodeIO().registerExtensions(ALL_EXTENSIONS).read(GLB);

describe('пропы санатория: архитектура, коридор, вестибюль, бассейн', () => {
  it('у каждой записи есть модель того же габарита, у каждой модели — запись', async () => {
    const doc = await read();
    const nodes = doc.getRoot().listScenes()[0].listChildren();
    const byId = new Map(nodes.map((n) => [n.getName(), n]));
    expect([...byId.keys()].sort()).toEqual(Object.keys(IDS).sort());
    for (const id of Object.keys(IDS)) {
      const p = PROP_BY_ID[id];
      expect(p, id).toBeDefined();
      expect(p.tags, id).toContain('санаторий');
      const b = getBounds(byId.get(id)!);
      const w = b.max[0] - b.min[0], d = b.max[2] - b.min[2];
      // свес за план — до 12 см (ламбрекен, барьер стойки, листья), недобор — до 20 см
      expect(w, `${id} w`).toBeLessThanOrEqual(p.w + 0.12);
      expect(w, `${id} w`).toBeGreaterThanOrEqual(p.w - 0.2);
      expect(d, `${id} h`).toBeLessThanOrEqual(p.h + 0.12);
      expect(d, `${id} h`).toBeGreaterThanOrEqual(p.h - 0.2);
      if (p.tags.includes('потолок')) expect(Math.abs(b.max[1]), `${id}: верх подвесного — потолок`).toBeLessThan(0.003);
      else expect(b.min[1], `${id} ниже пола`).toBeGreaterThanOrEqual(-0.002);
    }
  });

  it('коллайдеры по тегам', () => {
    for (const [id, h] of Object.entries(IDS)) expect(propHeightM(PROP_BY_ID[id].tags, PROP_BY_ID[id].name), id).toBeCloseTo(h, 5);
  });

  it('свет — emissive у ламп, стёкол и тюля; вода — альфа-тест с текстурой', async () => {
    const doc = await read();
    const mats = new Map(doc.getRoot().listMaterials().map((m) => [m.getName(), m]));
    const glow = [...mats.values()].filter((m) => m.getEmissiveFactor().some((v) => v > 0.01)).map((m) => m.getName()).sort();
    expect(glow).toEqual(['san_daylight_glow', 'san_lamp_glow', 'san_lamp_warm', 'san_tulle_glow']);
    for (const name of mats.keys()) expect(name.startsWith('san_'), name).toBe(true);
    const water = mats.get('san_pool_water')!;
    expect(water.getAlphaMode()).toBe('MASK');
    expect(water.getBaseColorTexture()).not.toBeNull();
  });
});
