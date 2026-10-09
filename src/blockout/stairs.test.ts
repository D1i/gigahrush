// Куски портального рендера на высоте (RunInstance.z) и зал с лестницей (RunInstance.stair, src/blockout/stairs.ts):
// стены и потолок зала на перепад выше, проём верхней метки — на этаж выше (под ним стена), порталы двух сторон каждого
// проёма на одной отметке, опора на марше — по линии носков, меши ступеней/площадок/коллайдера без NaN.
import { describe, expect, it } from 'vitest';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine';
import { Scene } from '@babylonjs/core/scene';
import { exportRunJSON } from '../gen/world';
import { createStreamWorld, streamSettings } from '../gen4d/stream';
import { STOREY_M } from '../model/stairs';
import { stairHall, stairProject } from '../model/stairs.test-util';
import { buildBabylonBlockout } from './babylon';
import { validateBlockout } from './core';
import { buildPiece, mergePieces, piecePortals } from './pieces';
import { liftPiece, stairFloorAt, stairMeshes } from './stairs';
import { DEFAULT_BLOCKOUT, type BlockoutModel, type RunExport } from './types';

class FakeCanvas {
  constructor(public width: number, public height: number) {}
  getContext() {
    const store: Record<string | symbol, unknown> = {};
    return new Proxy(store, { get: (t, k) => (k in t ? t[k] : () => undefined), set: (t, k, v) => ((t[k] = v), true) });
  }
}
(globalThis as any).OffscreenCanvas ??= FakeCanvas;

const H = DEFAULT_BLOCKOUT.wallHeightM, D = DEFAULT_BLOCKOUT.doorHeightM, S = DEFAULT_BLOCKOUT.slabM;

/** Мир со стартом в зале (узкий или широкий марш), раскрытый на две двери; экспорт — как у прогулки. */
function world(narrow: boolean): { rx: RunExport; hall: string; up: string; down: string } {
  const p = stairProject([stairHall('t_stair', narrow ? { flightW: 1.2 } : {})]);
  // сид, при котором за обеими дверьми зала что-то встало (пул пресетов меняется — перебором, а не одним сидом)
  for (const seed of ['stairs-blockout', 'a', 'b', 'c', 'd', 'e', 'f', 'g']) {
    const w = createStreamWorld(p, streamSettings(seed, { startRoomId: 't_stair', deadEndChance: 0 }));
    w.ensureAround(w.startId!, 2);
    const rx = exportRunJSON(p, w.run()) as RunExport;
    const hall = rx.instances.find((i) => i.id === w.startId)!;
    const other = (conn: string) => hall.connectors.find((c) => c.name === conn)?.linkedTo?.inst ?? null;
    const up = other('Верх'), down = other('Низ');
    if (up && down) return { rx, hall: hall.id, up, down };
  }
  throw new Error('нет сида, при котором у зала оба соседа');
}

const finite = (a: ArrayLike<number>) => Array.from(a).every((v) => Number.isFinite(v));

describe('лестницы в кусках портального рендера', { timeout: 60000 }, () => {
  const { rx, hall, up, down } = world(false);
  const pieces = new Map<string, BlockoutModel>(rx.instances.map((i) => [i.id, buildPiece(rx, i.id, { deadEnds: 'panel', doors: true })]));

  it('экспорт: высота комнаты за верхом, лестница и подъём у метки', () => {
    const h = rx.instances.find((i) => i.id === hall)!;
    expect(h.stair?.flights.length).toBe(1);
    expect(h.connectors.find((c) => c.name === 'Верх')!.dz).toBeCloseTo(STOREY_M, 9);
    expect(h.connectors.find((c) => c.name === 'Низ')!.dz).toBeUndefined();
    expect(rx.instances.find((i) => i.id === up)!.z).toBeCloseTo(STOREY_M, 9);
    expect(rx.instances.find((i) => i.id === down)!.z).toBeUndefined();
  });

  it('зал: стены и потолок на перепад выше, верхний проём — на этаж выше, под ним стена', () => {
    const pc = pieces.get(hall)!;
    const R = STOREY_M;
    const walls = pc.solids.filter((s) => s.kind === 'wall');
    expect(Math.max(...walls.map((s) => s.z1))).toBeCloseTo(H + S + R, 6);
    expect(pc.ceilings.find((c) => c.inst === hall)!.z).toBeCloseTo(H + R, 6);
    expect(pc.floors.find((f) => f.inst === hall)!.z).toBe(0);
    const lintels = pc.solids.filter((s) => s.kind === 'lintel').map((s) => s.z0).sort();
    expect(lintels[0]).toBeCloseTo(D, 6);
    expect(lintels[lintels.length - 1]).toBeCloseTo(D + R, 6);
    // пол половины верхнего проёма — на этаже, под ней — стена до плиты
    const portalFloors = pc.floors.filter((f) => f.inst === null).map((f) => f.z).sort();
    expect(portalFloors[0]).toBe(0);
    expect(portalFloors[portalFloors.length - 1]).toBeCloseTo(R, 6);
    expect(walls.some((s) => Math.abs(s.z1 - (R - S)) < 1e-6 && Math.abs(s.z0 + S) < 1e-6)).toBe(true);
    // дверь верхней метки — на этаже
    const slot = pc.doors?.find((d) => d.connector === rx.instances.find((i) => i.id === hall)!.connectors.find((c) => c.name === 'Верх')!.id);
    if (slot) expect(slot.z).toBeCloseTo(R, 6);
    // широкий марш во всю ширину — перил нет
    expect(pc.stairs?.[0].rails).toEqual([]);
  });

  it('комната над залом поднята целиком; порталы двух сторон каждого проёма на одной отметке', () => {
    const pu = pieces.get(up)!;
    expect(pu.floors.find((f) => f.inst === up)!.z).toBeCloseTo(STOREY_M, 6);
    expect(Math.min(...pu.solids.map((s) => s.z0))).toBeCloseTo(STOREY_M - S, 6);
    const ports = new Map<string, number>();
    for (const [id, pc] of pieces) {
      for (const q of piecePortals(rx, pc, id)) {
        const key = [`${q.a.inst}/${q.a.connector}`, `${q.b.inst}/${q.b.connector}`].sort().join('|');
        const seen = ports.get(key);
        if (seen === undefined) ports.set(key, q.z);
        else expect(q.z, key).toBeCloseTo(seen, 9);
      }
    }
    const hallUp = piecePortals(rx, pieces.get(hall)!, hall).find((q) => q.to === up)!;
    expect(hallUp.z).toBeCloseTo(STOREY_M, 9);
    expect(piecePortals(rx, pieces.get(hall)!, hall).find((q) => q.to === down)!.z).toBe(0);
  });

  it('опора: на нижней площадке — нет, марш — по линии носков вверх, верхняя площадка — пол', () => {
    const g = pieces.get(hall)!.stairs!;
    const f = g[0].flights[0];
    const x = (f.rect.x0 + f.rect.x1) / 2;
    expect(stairFloorAt(g, x, f.rect.y1 + 0.5)).toBeNull();
    let last = -1;
    // опора начинается за проступь до первой ступени
    const t = (f.rect.y1 - f.rect.y0) / f.steps;
    expect(stairFloorAt(g, x, f.rect.y1 + t * 0.9)!.z).toBeGreaterThan(0);
    for (let y = f.rect.y1 + t * 0.9; y > f.rect.y0; y -= 0.1) {
      const s = stairFloorAt(g, x, y)!;
      expect(s.flight).toBe(true);
      expect(s.z).toBeGreaterThanOrEqual(last);
      last = s.z;
    }
    expect(last).toBeCloseTo(STOREY_M, 6);
    expect(stairFloorAt(g, x, f.rect.y0 - 0.5)).toEqual({ z: STOREY_M, flight: false });
  });

  it('меши: ступени, площадка, невидимый пандус; без NaN, индексы в пределах', () => {
    const sm = stairMeshes(pieces.get(hall)!.stairs!);
    for (const b of [sm.visible, sm.pads, sm.collider]) {
      expect(b.empty).toBe(false);
      expect(finite(b.p) && finite(b.n)).toBe(true);
      expect(Math.max(...b.i)).toBeLessThan(b.p.length / 3);
      expect(b.c.length / 4).toBe(b.p.length / 3);
    }
    const engine = new NullEngine();
    const scene = new Scene(engine);
    const bo = buildBabylonBlockout(scene, pieces.get(hall)!, { collisions: true });
    const by = (n: string) => bo.root.getChildMeshes(false).find((m) => m.name === n)!;
    expect(by('stairs').checkCollisions).toBe(false);
    expect(by('stairPads').checkCollisions).toBe(true);
    expect(by('stairCollider').checkCollisions).toBe(true);
    expect(by('stairCollider').isVisible).toBe(false);
    bo.dispose();
    scene.dispose();
    engine.dispose();
  });

  it('узкий марш: перила вдоль марша и у края площадки над низом', () => {
    const n = world(true);
    const pc = buildPiece(n.rx, n.hall, { deadEnds: 'panel' });
    const rails = pc.stairs![0].rails;
    expect(rails.length).toBeGreaterThanOrEqual(2);
    // вдоль марша — наклонные (высота растёт), у площадки — на её полу
    expect(rails.some((r) => r.pts[r.pts.length - 1][2] - r.pts[0][2] > 1 || r.pts[0][2] - r.pts[r.pts.length - 1][2] > 1)).toBe(true);
    expect(rails.some((r) => r.pts.every((q) => Math.abs(q[2] - STOREY_M) < 1e-6))).toBe(true);
    for (const r of rails) expect(r.low).toBe(0);
  });

  it('validateBlockout: зал и каждый его сосед вместе — чистая стыковка на своих высотах', () => {
    for (const [id, pc] of pieces) expect(validateBlockout(mergePieces([pc])), id).toEqual([]);
    for (const nb of [up, down]) expect(validateBlockout(mergePieces([pieces.get(hall)!, pieces.get(nb)!])), nb).toEqual([]);
  });

  it('без высоты и лестницы кусок не меняется', () => {
    const plain = rx.instances.find((i) => !i.z && !i.stair)!;
    const pc = pieces.get(plain.id)!;
    expect(liftPiece(pc, plain)).toBe(pc);
  });
});
