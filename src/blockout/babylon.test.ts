// Адаптер Babylon на NullEngine: число мешей, габариты, поворот мебели, укрытия (плита над просветом), instOf, отделка,
// dispose без утечек.
import { describe, expect, it } from 'vitest';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine';
import { Scene } from '@babylonjs/core/scene';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { VertexBuffer } from '@babylonjs/core/Buffers/buffer';
import { CreateBoxVertexData } from '@babylonjs/core/Meshes/Builders/boxBuilder';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { BoxBatch, buildBabylonBlockout } from './babylon';
import { buildBlockoutModel } from './core';
import { DEFAULT_BLOCKOUT, type BlockoutModel, type RunExport, type RunFinish } from './types';
import gap0 from './fixtures/run-gap0-30.json';
import gap1 from './fixtures/run-gap1-30.json';
import gap3 from './fixtures/run-gap3-20.json';
import big from './fixtures/run-gap1-150.json';

// В node нет canvas: DynamicTexture сетки рисует в заглушку (NullEngine всё равно ничего не загружает в GPU).
class FakeCanvas {
  constructor(public width: number, public height: number) {}
  getContext() {
    const store: Record<string | symbol, unknown> = {};
    return new Proxy(store, {
      get: (t, k) => (k in t ? t[k] : () => undefined),
      set: (t, k, v) => ((t[k] = v), true),
    });
  }
}
(globalThis as any).OffscreenCanvas ??= FakeCanvas;

function mkScene() {
  const engine = new NullEngine();
  const scene = new Scene(engine);
  return { engine, scene };
}

const R = (x0: number, y0: number, x1: number, y1: number) => ({ x0, y0, x1, y1 });

/** Две комнаты вплотную через перегородку с проёмом, обвязка 0.2 м, тупик и шкаф с rot 90. */
function twoRooms(): BlockoutModel {
  const H = 2.5;
  return {
    format: 'room-forge-blockout',
    version: 1,
    units: 'm',
    axes: 'plan: x right, y down, z up',
    cellM: 0.1,
    options: { ...DEFAULT_BLOCKOUT, partitionM: 0.08 },
    bounds: R(0, 0, 6, 4),
    solids: [
      { kind: 'wall', rect: R(0, 0, 6, 0.2), z0: 0, z1: H },
      { kind: 'wall', rect: R(0, 3.8, 6, 4), z0: 0, z1: H },
      { kind: 'wall', rect: R(0, 0.2, 0.2, 3.8), z0: 0, z1: H },
      { kind: 'wall', rect: R(5.8, 0.2, 6, 3.8), z0: 0, z1: H },
      { kind: 'partition', rect: R(2.96, 0.2, 3.04, 1.5), z0: 0, z1: H },
      { kind: 'partition', rect: R(2.96, 2.3, 3.04, 3.8), z0: 0, z1: H },
      { kind: 'lintel', rect: R(2.96, 1.5, 3.04, 2.3), z0: 2.1, z1: H },
    ],
    floors: [
      { inst: 'i0', rects: [R(0.2, 0.2, 2.96, 3.8)], z: 0 },
      { inst: 'i1', rects: [R(3.04, 0.2, 5.8, 3.8)], z: 0 },
      { inst: null, rects: [R(2.96, 1.5, 3.04, 2.3)], z: 0 },
    ],
    ceilings: [
      { inst: 'i0', rects: [R(0.2, 0.2, 2.96, 3.8)], z: H },
      { inst: 'i1', rects: [R(3.04, 0.2, 5.8, 3.8)], z: H },
    ],
    openings: [
      { a: { inst: 'i0', connector: 'c1' }, b: { inst: 'i1', connector: 'c0' }, rect: R(2.96, 1.5, 3.04, 2.3), axis: 'x', widthM: 0.8, heightM: 2.1 },
    ],
    deadEnds: [{ inst: 'i0', connector: 'c2', line: [0.8, 0.2, 1.6, 0.2], normal: [0, 1], widthM: 0.8, heightM: 2.1 }],
    props: [
      { inst: 'i0', source: 'decor', propId: 'p_wardrobe', name: 'Шкаф', x: 1.5, y: 2, rot: 90, w: 1, d: 0.5, h: 2, color: '#8a5a33', tags: ['шкаф'] },
      { inst: 'i1', source: 'spot', propId: 'p_table', name: 'Стол', x: 4.5, y: 2, rot: 0, w: 0.9, d: 0.6, h: 0.75, color: '#c9b48a', tags: ['стол'] },
    ],
    rooms: [
      { inst: 'i0', roomId: 'a', name: 'A', tags: [], bbox: R(0.2, 0.2, 2.96, 3.8), anchor: [1.58, 2], tier: null, floorAreaM2: 9.9, finish: { wall: null, floor: null } },
      { inst: 'i1', roomId: 'b', name: 'B', tags: [], bbox: R(3.04, 0.2, 5.8, 3.8), anchor: [4.42, 2], tier: null, floorAreaM2: 9.9, finish: { wall: null, floor: null } },
    ],
    faces: [],
    finishes: [],
    stats: { floorCells: 0, wallCells: 0, solids: 7, openings: 1, deadEnds: 1, ms: 0 },
    issues: [],
  };
}

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

/** Те же комнаты с отделкой: обои W в i0, двухтонная краска P (низ PL до 1.5 м) в i1, линолеум L на полу i0. */
function finishedRooms(): BlockoutModel {
  const m = twoRooms();
  const fin = (id: string, surface: 'wall' | 'floor', tex: string | null, tileW: number, tileH: number, dado: RunFinish['dado'] = null): RunFinish => ({
    id,
    name: 'Отделка ' + id,
    surface,
    color: '#6a8a5a',
    tex,
    hasTex: !!tex,
    tileW,
    tileH,
    dado,
  });
  m.finishes = [fin('W', 'wall', PNG, 0.5, 0.6), fin('P', 'wall', null, 1, 1, { finishId: 'PL', heightM: 1.5 }), fin('PL', 'wall', null, 1, 1), fin('L', 'floor', PNG, 2, 2)];
  m.faces = [
    { inst: 'i0', line: [0.2, 0.2, 2.96, 0.2], normal: [0, 1], z0: 0, z1: 2.5, part: 'wall', finish: 'W' },
    { inst: 'i0', line: [0.2, 0.2, 0.2, 3.8], normal: [1, 0], z0: 0, z1: 2.5, part: 'wall', finish: 'W' },
    { inst: 'i1', line: [5.8, 0.2, 5.8, 3.8], normal: [-1, 0], z0: 0, z1: 2.5, part: 'wall', finish: 'P' },
    { inst: 'i1', line: [3.04, 1.5, 3.04, 2.3], normal: [1, 0], z0: 2.1, z1: 2.5, part: 'lintel', finish: 'P' },
    { inst: 'i1', line: [3.04, 3.8, 5.8, 3.8], normal: [0, -1], z0: 0, z1: 2.5, part: 'wall', finish: null },
  ];
  m.floors[0].finish = 'L';
  m.rooms[0].finish = { wall: 'W', floor: 'L' };
  m.rooms[1].finish = { wall: 'P', floor: null };
  return m;
}

/** Габариты набора мешей в мировых координатах. */
function worldBox(meshes: Mesh[]) {
  const min = new Vector3(Infinity, Infinity, Infinity);
  const max = new Vector3(-Infinity, -Infinity, -Infinity);
  for (const m of meshes) {
    m.computeWorldMatrix(true);
    const bb = m.getBoundingInfo().boundingBox;
    min.minimizeInPlace(bb.minimumWorld);
    max.maximizeInPlace(bb.maximumWorld);
  }
  return { min, max };
}

/** Знак cross(p1−p0, p2−p0)·n для каждого треугольника (n — нормаль первой вершины). */
function windingSigns(pos: ArrayLike<number>, nrm: ArrayLike<number>, idx: ArrayLike<number>): number[] {
  const out: number[] = [];
  for (let t = 0; t < idx.length; t += 3) {
    const [a, b, c] = [idx[t], idx[t + 1], idx[t + 2]];
    const P = (i: number) => new Vector3(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]);
    const cr = Vector3.Cross(P(b).subtract(P(a)), P(c).subtract(P(a)));
    out.push(Math.sign(Vector3.Dot(cr, new Vector3(nrm[a * 3], nrm[a * 3 + 1], nrm[a * 3 + 2]))));
  }
  return out;
}

describe('BoxBatch', () => {
  it('обход граней совпадает с CreateBox Babylon (лицевые грани наружу)', () => {
    const ref = CreateBoxVertexData({ size: 1 });
    const refSigns = windingSigns(ref.positions!, ref.normals!, ref.indices!);
    expect(new Set(refSigns).size).toBe(1);
    const g = new BoxBatch();
    g.box(-1, 0, 2, 3, 2.5, 2.2);
    g.planQuad(R(0, 0, 1, 1), 0, true);
    g.planQuad(R(0, 0, 1, 1), 2.5, false);
    const signs = windingSigns(g.p, g.n, g.i);
    expect(signs.every((s) => s === refSigns[0])).toBe(true);
    // плоскость пола смотрит вверх, потолка — вниз
    expect(g.n.slice(24 * 3 + 1, 24 * 3 + 2)[0]).toBe(1);
    expect(g.n.slice(28 * 3 + 1, 28 * 3 + 2)[0]).toBe(-1);
  });

  it('UV в мировых метрах: соседние боксы продолжают сетку', () => {
    const g = new BoxBatch();
    g.planBox(R(0, 0, 1, 0.2), 0, 2.5);
    g.planBox(R(1, 0, 2.3, 0.2), 0, 2.5);
    // для каждой вершины UV — проекция мировой позиции по оси грани
    for (let v = 0; v < g.verts; v++) {
      const [x, y, z] = g.p.slice(v * 3, v * 3 + 3);
      const [nx, ny] = g.n.slice(v * 3, v * 3 + 2);
      const [u, w] = g.uv.slice(v * 2, v * 2 + 2);
      const exp = nx ? [z, y] : ny ? [x, z] : [x, y];
      expect(u).toBeCloseTo(exp[0], 6);
      expect(w).toBeCloseTo(exp[1], 6);
    }
  });
});

describe('buildBabylonBlockout', () => {
  it('меши по видам, полы/потолки по экземплярам, пол проёма отдельно', () => {
    const { scene, engine } = mkScene();
    const bo = buildBabylonBlockout(scene, twoRooms(), { collisions: true });
    expect(bo.walls.map((m) => m.name).sort()).toEqual(['lintel', 'partition', 'wall']);
    expect(bo.floors.map((m) => m.name).sort()).toEqual(['floor:i0', 'floor:i1', 'portalFloor']);
    expect(bo.ceilings.length).toBe(2);
    expect(bo.props.length).toBe(2);
    expect(bo.deadEnds.length).toBe(1);
    // все меши — под root
    for (const m of [...bo.walls, ...bo.floors, ...bo.ceilings, ...bo.props, ...bo.deadEnds]) expect(m.parent).toBe(bo.root);
    // коллизии: стены, полы, мебель — да; потолки, тупики — нет
    expect(bo.walls.every((m) => m.checkCollisions)).toBe(true);
    expect(bo.floors.every((m) => m.checkCollisions)).toBe(true);
    expect(bo.props.every((m) => m.checkCollisions)).toBe(true);
    expect(bo.ceilings.some((m) => m.checkCollisions)).toBe(false);
    // плиты: пол 0.2 м вниз от z
    const fl = worldBox([bo.floors.find((m) => m.name === 'floor:i0')!]);
    expect(fl.max.y).toBeCloseTo(0, 6);
    expect(fl.min.y).toBeCloseTo(-0.2, 6);
    bo.dispose();
    engine.dispose();
  });

  it('слитые объёмы: внутренние грани на стыках не выпускаются, обход лицевой', () => {
    const { scene, engine } = mkScene();
    const bo = buildBabylonBlockout(scene, twoRooms());
    const quads = (name: string) => {
      const m = bo.walls.find((x) => x.name === name)!;
      const p = m.getVerticesData(VertexBuffer.PositionKind)!;
      const n = m.getVerticesData(VertexBuffer.NormalKind)!;
      const out: { n: number[]; min: number[]; max: number[] }[] = [];
      for (let k = 0; k < p.length / 3; k += 4) {
        const vs = [0, 1, 2, 3].map((i) => [p[(k + i) * 3], p[(k + i) * 3 + 1], p[(k + i) * 3 + 2]]);
        out.push({ n: [n[k * 3], n[k * 3 + 1], n[k * 3 + 2]], min: [0, 1, 2].map((a) => Math.min(...vs.map((v) => v[a]))), max: [0, 1, 2].map((a) => Math.max(...vs.map((v) => v[a]))) });
      }
      // обход: как у CreateBox
      const ref = CreateBoxVertexData({ size: 1 });
      const refSign = windingSigns(ref.positions!, ref.normals!, ref.indices!)[0];
      expect(windingSigns(p, n, m.getIndices()!).every((sg) => sg === refSign)).toBe(true);
      return out;
    };
    // перегородка y 0.2..1.5 под перемычкой y 1.5..2.3 (z 2.1..2.5): её торец в плоскости y = 1.5
    // (Babylon Z = −1.5) остаётся только ниже перемычки — это откос проёма
    const part = quads('partition').filter((q) => Math.abs(q.min[2] + 1.5) < 1e-6 && Math.abs(q.max[2] + 1.5) < 1e-6);
    expect(part.length).toBe(1);
    expect(part[0].min[1]).toBeCloseTo(0, 6);
    expect(part[0].max[1]).toBeCloseTo(2.1, 6);
    // у перемычки нет граней в плоскостях стыка с перегородками (y = 1.5 и y = 2.3)
    const lint = quads('lintel');
    expect(lint.some((q) => Math.abs(q.n[2]) > 0.5)).toBe(false);
    expect(lint.length).toBe(4); // низ (над проёмом), верх, две стороны к комнатам
    // торец перегородки, упёртый в северную стену (y = 0.2), тоже не выпускается
    expect(quads('partition').some((q) => Math.abs(q.min[2] + 0.2) < 1e-6 && Math.abs(q.max[2] + 0.2) < 1e-6)).toBe(false);
    bo.dispose();
    engine.dispose();
  });

  it('merge: false — меш на бокс', () => {
    const { scene, engine } = mkScene();
    const bo = buildBabylonBlockout(scene, twoRooms(), { merge: false });
    expect(bo.walls.length).toBe(7);
    expect(bo.deadEnds[0].metadata).toMatchObject({ kind: 'deadEnd', inst: 'i0', connector: 'c2' });
    bo.dispose();
    engine.dispose();
  });

  it('габариты стен совпадают с model.bounds (X = x, Z = −y)', () => {
    const { scene, engine } = mkScene();
    const model = twoRooms();
    const bo = buildBabylonBlockout(scene, model);
    const { min, max } = worldBox(bo.walls);
    expect(min.x).toBeCloseTo(model.bounds.x0, 6);
    expect(max.x).toBeCloseTo(model.bounds.x1, 6);
    expect(min.z).toBeCloseTo(-model.bounds.y1, 6);
    expect(max.z).toBeCloseTo(-model.bounds.y0, 6);
    expect(min.y).toBeCloseTo(0, 6);
    expect(max.y).toBeCloseTo(2.5, 6);
    // перемычка — над проёмом, от высоты двери до потолка
    const lt = worldBox(bo.walls.filter((m) => m.name === 'lintel'));
    expect(lt.min.y).toBeCloseTo(2.1, 6);
    bo.dispose();
    engine.dispose();
  });

  it('поворот мебели: rot 0 смотрит в −Z (план +y), rot 90 — в −X мира', () => {
    const { scene, engine } = mkScene();
    const bo = buildBabylonBlockout(scene, twoRooms());
    const front = (m: Mesh) => {
      const wm = m.computeWorldMatrix(true);
      // по оси: перед = −Z локально
      const dir = Vector3.TransformNormal(new Vector3(0, 0, -1), wm);
      // по геометрии: тёмные вершины полоски в мире
      const pos = m.getVerticesData(VertexBuffer.PositionKind)!;
      const col = m.getVerticesData(VertexBuffer.ColorKind)!;
      const c = Vector3.Zero();
      let n = 0;
      for (let v = 0; v < pos.length / 3; v++) {
        if (col[v * 4] > 0.5) continue;
        c.addInPlace(Vector3.TransformCoordinates(new Vector3(pos[v * 3], pos[v * 3 + 1], pos[v * 3 + 2]), wm));
        n++;
      }
      return { dir, stripe: c.scale(1 / n), center: m.position.clone() };
    };
    const wardrobe = front(bo.props.find((m) => m.metadata && (m.metadata as any).propId === 'p_wardrobe')!);
    expect(wardrobe.dir.x).toBeCloseTo(-1, 6);
    expect(wardrobe.dir.z).toBeCloseTo(0, 6);
    expect(wardrobe.stripe.x).toBeLessThan(wardrobe.center.x - 0.2); // d/2 = 0.25
    expect(wardrobe.stripe.z).toBeCloseTo(wardrobe.center.z, 6);
    expect(wardrobe.center.x).toBeCloseTo(1.5, 6);
    expect(wardrobe.center.z).toBeCloseTo(-2, 6);
    // повёрнутый шкаф: ширина 1 м легла вдоль Z мира
    const wb = worldBox([bo.props[0]]);
    expect(wb.max.z - wb.min.z).toBeCloseTo(1, 2);
    expect(wb.min.y).toBeCloseTo(0, 6);

    const table = front(bo.props.find((m) => (m.metadata as any).propId === 'p_table')!);
    expect(table.dir.z).toBeCloseTo(-1, 6);
    expect(table.stripe.z).toBeLessThan(table.center.z - 0.25);
    bo.dispose();
    engine.dispose();
  });

  /** Две комнаты + кровать (просвет 0.30) в i0 и стол (0.62, на площадке 0.5 м, rot 90) в i1. */
  const coverRooms = (): BlockoutModel => {
    const m = twoRooms();
    m.props.push(
      { inst: 'i0', source: 'decor', propId: 'p_bed1', name: 'Кровать', x: 1.2, y: 1.5, rot: 0, w: 0.9, d: 2, h: 0.5, color: '#b0a080', tags: ['кровать'], cover: 'bed', clear: 0.3 },
      { inst: 'i1', source: 'decor', propId: 'p_table_kitchen', name: 'Стол кухонный', x: 4.5, y: 3, rot: 90, w: 0.9, d: 0.6, h: 0.75, color: '#c9b48a', tags: ['стол'], z: 0.5, cover: 'table', clear: 0.62 },
    );
    return m;
  };
  const propMesh = (bo: ReturnType<typeof buildBabylonBlockout>, id: string) => bo.props.find((m) => (m.metadata as any).propId === id)!;

  it('укрытия: коллайдер кровати и стола — плита от просвета, metadata.cover; видны плита и ножки без коллизий', () => {
    const { scene, engine } = mkScene();
    const bo = buildBabylonBlockout(scene, coverRooms(), { collisions: true });
    expect(bo.props.length).toBe(4);
    const collide = new Set(bo.root.getChildMeshes(false).filter((m) => m.checkCollisions));

    const bed = propMesh(bo, 'p_bed1');
    expect(bed.metadata).toEqual({ kind: 'prop', inst: 'i0', propId: 'p_bed1', name: 'Кровать', cover: 'bed', clear: 0.3 });
    expect(collide.has(bed)).toBe(true);
    expect(bed.isVisible).toBe(false); // коллайдер не рисуется (портальный рендер его пропустит)
    const bb = worldBox([bed]);
    expect(bb.min.y).toBeCloseTo(0.3, 6); // лёжа (0.05…0.25) — под ней, на четвереньках (0.18…0.59) — упор
    expect(bb.max.y).toBeCloseTo(0.5, 6);
    expect(bb.max.x - bb.min.x).toBeCloseTo(0.9, 6);
    expect(bb.max.z - bb.min.z).toBeCloseTo(2, 6);
    // видимая болванка: плита + 4 ножки до пола + полоска на переду плиты; без коллизий, на месте кровати
    const vis = bed.getChildMeshes(false);
    expect(vis.length).toBe(1);
    const box = vis[0] as Mesh;
    expect(box.name).toBe('propBox:i0:p_bed1');
    expect(box.isVisible).toBe(true);
    expect(collide.has(box)).toBe(false);
    expect(box.metadata).toMatchObject({ kind: 'prop', inst: 'i0', propId: 'p_bed1' });
    expect((box.metadata as any).cover).toBeUndefined();
    expect(bo.instOf(box)).toBe('i0');
    expect(box.getTotalVertices()).toBe(24 + 4 + 4 * 24);
    const vb = worldBox([box]);
    expect(vb.min.y).toBeCloseTo(0, 6);
    expect(vb.max.y).toBeCloseTo(0.5, 6);
    expect(vb.min.x).toBeCloseTo(bb.min.x, 6);
    expect(vb.max.z).toBeCloseTo(bb.max.z, 6);
    // ножки: всё, что ниже плиты, — четыре столбика 5 см по углам (отступ 3 см), середина под кроватью пуста
    const pos = box.getVerticesData(VertexBuffer.PositionKind)!;
    const col = box.getVerticesData(VertexBuffer.ColorKind)!;
    const low: number[][] = [];
    for (let v = 0; v < pos.length / 3; v++) if (pos[v * 3 + 1] < 0.3 - 1e-6) low.push([pos[v * 3], pos[v * 3 + 2]]);
    expect(low.length).toBe(4 * 12); // у каждой ножки низ (4) и нижние углы 4 боковых граней (8)
    for (const [x, z] of low) {
      expect(Math.abs(x)).toBeGreaterThan(0.45 - 0.08 - 1e-6);
      expect(Math.abs(x)).toBeLessThan(0.45 - 0.03 + 1e-6);
      expect(Math.abs(z)).toBeGreaterThan(1 - 0.08 - 1e-6);
      expect(Math.abs(z)).toBeLessThan(1 - 0.03 + 1e-6);
    }
    // тёмная полоска — на переднем торце плиты (−Z локально), по высоте внутри плиты
    let dark = 0;
    for (let v = 0; v < pos.length / 3; v++) {
      if (col[v * 4] > 0.5) continue;
      dark++;
      expect(pos[v * 3 + 2]).toBeLessThan(-1);
      expect(pos[v * 3 + 1]).toBeGreaterThan(0.3);
      expect(pos[v * 3 + 1]).toBeLessThan(0.5);
    }
    expect(dark).toBe(4);

    // стол на площадке 0.5 м, повёрнут: плита 0.5 + 0.62 … 0.5 + 0.75, ширина 0.9 легла вдоль Z мира
    const table = propMesh(bo, 'p_table_kitchen');
    expect(table.metadata).toMatchObject({ kind: 'prop', inst: 'i1', cover: 'table', clear: 0.62 });
    expect(collide.has(table)).toBe(true);
    const tb = worldBox([table]);
    expect(tb.min.y).toBeCloseTo(1.12, 6);
    expect(tb.max.y).toBeCloseTo(1.25, 6);
    expect(tb.max.z - tb.min.z).toBeCloseTo(0.9, 6);
    expect(worldBox(table.getChildMeshes(false) as Mesh[]).min.y).toBeCloseTo(0.5, 6);

    // остальная мебель — как была: видимый бокс от пола, коллайдер, без cover
    const wardrobe = propMesh(bo, 'p_wardrobe');
    expect(wardrobe.metadata).toEqual({ kind: 'prop', inst: 'i0', propId: 'p_wardrobe', name: 'Шкаф' });
    expect(wardrobe.isVisible).toBe(true);
    expect(wardrobe.checkCollisions).toBe(true);
    expect(wardrobe.getChildMeshes(false).length).toBe(0);
    expect(worldBox([wardrobe]).min.y).toBeCloseTo(0, 6);
    expect(bo.props.every((m) => m.checkCollisions)).toBe(true);
    bo.dispose();
    engine.dispose();
  });

  it('укрытия с моделью предмета: меняется только невидимый коллайдер, ножек нет', () => {
    const { scene, engine } = mkScene();
    const tpl = new Mesh('tpl', scene);
    CreateBoxVertexData({ size: 0.5 }).applyToMesh(tpl);
    tpl.setEnabled(false);
    const before = scene.meshes.length;
    const bo = buildBabylonBlockout(scene, coverRooms(), { collisions: true, propModel: (id) => (id === 'p_bed1' || id === 'p_wardrobe' ? tpl : null) });
    const bed = propMesh(bo, 'p_bed1');
    expect(bed.isVisible).toBe(false);
    expect(bed.checkCollisions).toBe(true);
    expect(bed.metadata).toMatchObject({ cover: 'bed', clear: 0.3 });
    expect(worldBox([bed]).min.y).toBeCloseTo(0.3, 6);
    const kids = bed.getChildMeshes(true);
    expect(kids.map((k) => k.name)).toEqual(['propModel:i0:p_bed1']);
    expect(kids[0].checkCollisions).toBe(false);
    expect((kids[0].metadata as any).cover).toBeUndefined();
    // модель стоит на полу предмета (начало координат коллайдера — пол, не низ плиты)
    expect(kids[0].position.y).toBe(0);
    // шкаф с моделью — коллайдер от пола
    expect(worldBox([propMesh(bo, 'p_wardrobe')]).min.y).toBeCloseTo(0, 6);
    bo.dispose();
    expect(scene.meshes.length).toBe(before);
    engine.dispose();
  });

  it('instOf: пол/потолок/мебель → экземпляр, стены и пустота → null', () => {
    const { scene, engine } = mkScene();
    const bo = buildBabylonBlockout(scene, twoRooms());
    expect(bo.instOf(bo.floors.find((m) => m.name === 'floor:i1'))).toBe('i1');
    expect(bo.instOf(bo.ceilings[0])).toBe('i0');
    expect(bo.instOf(bo.props[0])).toBe('i0');
    expect(bo.instOf(bo.floors.find((m) => m.name === 'portalFloor'))).toBeNull();
    expect(bo.instOf(bo.walls[0])).toBeNull();
    expect(bo.instOf(null)).toBeNull();
    expect(bo.instOf({})).toBeNull();
    bo.setCeilingsVisible(false);
    expect(bo.ceilings.every((m) => !m.isVisible)).toBe(true);
    bo.setCeilingsVisible(true);
    expect(bo.ceilings.every((m) => m.isVisible)).toBe(true);
    bo.dispose();
    engine.dispose();
  });

  it('dispose убирает меши, узлы, материалы и текстуры', () => {
    const { scene, engine } = mkScene();
    const before = { m: scene.meshes.length, mat: scene.materials.length, tex: scene.textures.length, tn: scene.transformNodes.length, g: scene.geometries.length };
    const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
    const bo = buildBabylonBlockout(scene, twoRooms(), { propTextures: { p_wardrobe: png } });
    expect(scene.meshes.length).toBeGreaterThan(before.m);
    // текстура вида сверху — дочерняя плоскость над шкафом
    const top = bo.props[0].getChildMeshes()[0];
    expect((top.metadata as any).kind).toBe('propTop');
    expect(bo.instOf(top)).toBe('i0');
    expect(scene.textures.length).toBeGreaterThanOrEqual(before.tex + 2); // сетка + текстура шкафа
    bo.dispose();
    bo.dispose(); // повторно — без ошибок
    expect(scene.meshes.length).toBe(before.m);
    expect(scene.materials.length).toBe(before.mat);
    expect(scene.textures.length).toBe(before.tex);
    expect(scene.transformNodes.length).toBe(before.tn);
    expect(scene.geometries.length).toBe(before.g);
    engine.dispose();
  });

  it('тупики: панель только в режиме panel', () => {
    const { scene, engine } = mkScene();
    const m = twoRooms();
    m.options = { ...m.options, deadEnds: 'wall' };
    const bo = buildBabylonBlockout(scene, m);
    expect(bo.deadEnds.length).toBe(0);
    bo.dispose();
    // панель утоплена в стену: задняя грань внутри массы стены (y < 0.2), передняя — в комнате
    const bo2 = buildBabylonBlockout(scene, twoRooms());
    const box = worldBox(bo2.deadEnds);
    expect(-box.max.z).toBeGreaterThan(0.17); // план y_min = −Z_max
    expect(-box.max.z).toBeLessThan(0.2);
    expect(-box.min.z).toBeGreaterThan(0.2);
    bo2.dispose();
    engine.dispose();
  });

  it('тупики: deadEndColor — отдельный меш и материал на цвет, без утечек', () => {
    const { scene, engine } = mkScene();
    const before = { m: scene.meshes.length, mat: scene.materials.length };
    const bo = buildBabylonBlockout(scene, twoRooms(), { deadEndColor: (d) => (d.connector === 'c2' ? '#E0A040' : null) });
    expect(bo.deadEnds.map((m) => m.name)).toEqual(['deadEnds:#e0a040']);
    expect((bo.deadEnds[0].material as any).emissiveColor.r).toBeGreaterThan(0.3);
    bo.dispose();
    const bo2 = buildBabylonBlockout(scene, twoRooms(), { merge: false, deadEndColor: () => '#3366cc' });
    expect(bo2.deadEnds[0].metadata).toMatchObject({ kind: 'deadEnd', inst: 'i0', connector: 'c2' });
    expect(bo2.deadEnds[0].material!.name).toBe('blockout:deadEnd:#3366cc');
    bo2.dispose();
    expect(scene.meshes.length).toBe(before.m);
    expect(scene.materials.length).toBe(before.mat);
    engine.dispose();
  });
});

describe('отделка', () => {
  const vtx = (m: Mesh) => {
    const p = m.getVerticesData(VertexBuffer.PositionKind)!;
    const n = m.getVerticesData(VertexBuffer.NormalKind)!;
    const uv = m.getVerticesData(VertexBuffer.UVKind)!;
    return Array.from({ length: p.length / 3 }, (_, i) => ({
      p: [p[i * 3], p[i * 3 + 1], p[i * 3 + 2]],
      n: [n[i * 3], n[i * 3 + 1], n[i * 3 + 2]],
      uv: [uv[i * 2], uv[i * 2 + 1]],
    }));
  };
  const facing = (bo: ReturnType<typeof buildBabylonBlockout>, id: string) => bo.facings.find((m) => m.name === 'facing:' + id)!;

  it('облицовка: меш на отделку, без коллизий, metadata с finishId, лицом в комнату', () => {
    const { scene, engine } = mkScene();
    const bo = buildBabylonBlockout(scene, finishedRooms(), { collisions: true });
    expect(bo.facings.map((m) => m.name).sort()).toEqual(['facing:P', 'facing:PL', 'facing:W']);
    for (const m of bo.facings) {
      expect(m.parent).toBe(bo.root);
      expect(m.checkCollisions).toBe(false);
      expect((m.metadata as any).kind).toBe('facing');
      expect(m.material).toBe(bo.finishMaterials[(m.metadata as any).finishId]);
      expect(bo.instOf(m)).toBeNull();
    }
    // грань без отделки не облицовывается: у W две грани по 4 вершины
    const w = facing(bo, 'W');
    expect(w.getTotalVertices()).toBe(8);
    const ref = CreateBoxVertexData({ size: 1 });
    const refSign = windingSigns(ref.positions!, ref.normals!, ref.indices!)[0];
    const signs = windingSigns(w.getVerticesData(VertexBuffer.PositionKind)!, w.getVerticesData(VertexBuffer.NormalKind)!, w.getIndices()!);
    expect(signs.every((sg) => sg === refSign)).toBe(true);
    // без текстуры — цвет, с текстурой — текстура; zOffset против мерцания с гранью стены
    expect(bo.finishMaterials.P.diffuseTexture).toBeNull();
    expect(bo.finishMaterials.W.diffuseTexture).not.toBeNull();
    expect(bo.finishMaterials.W.zOffset).toBeLessThan(0);
    bo.dispose();
    engine.dispose();
  });

  it('UV = метры / размер повтора; облицовка на 1.5 мм перед стеной и за панелью тупика', () => {
    const { scene, engine } = mkScene();
    const bo = buildBabylonBlockout(scene, finishedRooms());
    const w = vtx(facing(bo, 'W'));
    for (const v of w) {
      // v — высота от пола / tileH (низ текстуры у пола)
      expect(v.uv[1]).toBeCloseTo(v.p[1] / 0.6, 6);
      if (Math.abs(v.n[2]) > 0.5) {
        // северная стена i0: нормаль −Z (план +y — внутрь комнаты), u = X / tileW
        expect(v.n[2]).toBe(-1);
        expect(v.uv[0]).toBeCloseTo(v.p[0] / 0.5, 6);
        expect(v.p[2]).toBeCloseTo(-0.2015, 6);
      } else {
        // западная стена i0: нормаль +X, u = Z / tileW
        expect(v.n[0]).toBe(1);
        expect(v.uv[0]).toBeCloseTo(v.p[2] / 0.5, 6);
        expect(v.p[0]).toBeCloseTo(0.2015, 6);
      }
    }
    // длина северной грани 2.76 м (+1.5 мм с каждого конца — смыкание на выпуклых углах) → 5.526 повтора
    // по u; высота 2.5 м → 4.17 по v
    const north = w.filter((v) => v.n[2] < -0.5);
    expect(Math.min(...north.map((v) => v.p[0]))).toBeCloseTo(0.2 - 0.0015, 6);
    expect(Math.max(...north.map((v) => v.uv[0])) - Math.min(...north.map((v) => v.uv[0]))).toBeCloseTo((2.76 + 0.003) / 0.5, 6);
    expect(Math.max(...north.map((v) => v.uv[1]))).toBeCloseTo(2.5 / 0.6, 6);
    // панель тупика на той же стене выступает дальше облицовки (1.5 см против 1.5 мм)
    const de = worldBox(bo.deadEnds);
    expect(-de.min.z).toBeGreaterThan(0.2015 + 0.01);
    bo.dispose();
    engine.dispose();
  });

  it('dado делит грань по heightM: низ — отделка панели, верх и перемычка — основная', () => {
    const { scene, engine } = mkScene();
    const bo = buildBabylonBlockout(scene, finishedRooms());
    const low = worldBox([facing(bo, 'PL')]);
    const up = worldBox([facing(bo, 'P')]);
    expect(low.min.y).toBeCloseTo(0, 6);
    expect(low.max.y).toBeCloseTo(1.5, 6);
    expect(up.min.y).toBeCloseTo(1.5, 6);
    expect(up.max.y).toBeCloseTo(2.5, 6);
    expect(facing(bo, 'P').getTotalVertices()).toBe(8); // верх стены + перемычка
    expect(facing(bo, 'PL').getTotalVertices()).toBe(4);
    // восточная стена i1: нормаль −X (внутрь комнаты), «вправо» = −Z → u = −Z / tileW
    for (const v of vtx(facing(bo, 'PL'))) {
      expect(v.n[0]).toBe(-1);
      expect(v.uv[0]).toBeCloseTo(-v.p[2], 6);
      expect(v.p[0]).toBeCloseTo(5.8 - 0.0015, 6);
    }
    bo.dispose();
    engine.dispose();
  });

  it('пол с отделкой: материал отделки и UV = метры / tile; без отделки — сетка', () => {
    const { scene, engine } = mkScene();
    const bo = buildBabylonBlockout(scene, finishedRooms());
    const f0 = bo.floors.find((m) => m.name === 'floor:i0')!;
    const f1 = bo.floors.find((m) => m.name === 'floor:i1')!;
    expect(f0.material).toBe(bo.finishMaterials.L);
    expect((f0.metadata as any).finishId).toBe('L');
    expect(f1.material).toBe(bo.materials.floor);
    const top = vtx(f0).filter((v) => v.n[1] > 0.5);
    expect(top.length).toBeGreaterThan(0);
    for (const v of top) {
      expect(v.uv[0]).toBeCloseTo(v.p[0] / 2, 6);
      expect(v.uv[1]).toBeCloseTo(v.p[2] / 2, 6);
    }
    bo.dispose();
    engine.dispose();
  });

  it('соседние грани в одной плоскости (стена | перемычка | стена) не перекрываются', () => {
    const { scene, engine } = mkScene();
    const m = finishedRooms();
    m.finishes.push({ id: 'Q', name: 'Q', surface: 'wall', color: '#888888', tex: null, hasTex: false, tileW: 1, tileH: 1, dado: null });
    m.faces.push(
      { inst: 'i0', line: [2.96, 0.2, 2.96, 1.5], normal: [-1, 0], z0: 0, z1: 2.5, part: 'wall', finish: 'Q' },
      { inst: 'i0', line: [2.96, 1.5, 2.96, 2.3], normal: [-1, 0], z0: 2.1, z1: 2.5, part: 'lintel', finish: 'Q' },
      { inst: 'i0', line: [2.96, 2.3, 2.96, 3.8], normal: [-1, 0], z0: 0, z1: 2.5, part: 'wall', finish: 'Q' },
    );
    const bo = buildBabylonBlockout(scene, m);
    // квады: [план y0, y1, z0, z1]
    const q = vtx(facing(bo, 'Q'));
    const quads: number[][] = [];
    for (let k = 0; k < q.length; k += 4) {
      const ys = q.slice(k, k + 4).map((v) => -v.p[2]);
      const zs = q.slice(k, k + 4).map((v) => v.p[1]);
      quads.push([Math.min(...ys), Math.max(...ys), Math.min(...zs), Math.max(...zs)].map((x) => +x.toFixed(5)));
    }
    // площадь пересечения любых двух квадов (они в одной плоскости) — ноль
    for (let i = 0; i < quads.length; i++)
      for (let j = i + 1; j < quads.length; j++) {
        const [a, b] = [quads[i], quads[j]];
        const w = Math.min(a[1], b[1]) - Math.max(a[0], b[0]);
        const h = Math.min(a[3], b[3]) - Math.max(a[2], b[2]);
        expect(w > 1e-6 && h > 1e-6).toBe(false);
      }
    // перемычка — ровно по проёму; у стен свободные концы продлены, у проёма — полоска до низа перемычки;
    // стены разрезаны на отметке 2.1 (низ перемычки) — у соседей общие вершины, без T-стыков
    expect(quads).toContainEqual([1.5, 2.3, 2.1, 2.5]);
    expect(quads).toContainEqual([0.1985, 1.5, 0, 2.1]);
    expect(quads).toContainEqual([0.1985, 1.5, 2.1, 2.5]);
    expect(quads).toContainEqual([1.5, 1.5015, 0, 2.1]);
    expect(quads).toContainEqual([2.2985, 2.3, 0, 2.1]);
    // каждый вертикальный край квада по высоте совпадает с краем соседа или свободен (T-стыков нет)
    for (const a of quads)
      for (const b of quads)
        if (a !== b && (Math.abs(a[1] - b[0]) < 1e-6 || Math.abs(a[0] - b[1]) < 1e-6)) {
          const h = Math.min(a[3], b[3]) - Math.max(a[2], b[2]);
          if (h > 1e-6) expect([a[2], a[3]]).toEqual([b[2], b[3]]);
        }
    bo.dispose();
    engine.dispose();
  });

  it('finishes: false — как без отделки', () => {
    const { scene, engine } = mkScene();
    const bo = buildBabylonBlockout(scene, finishedRooms(), { finishes: false });
    expect(bo.facings.length).toBe(0);
    expect(Object.keys(bo.finishMaterials).length).toBe(0);
    expect(bo.floors.find((m) => m.name === 'floor:i0')!.material).toBe(bo.materials.floor);
    bo.dispose();
    engine.dispose();
  });

  it('текстура — одна на отделку; dispose чистит облицовку, материалы и текстуры отделок', () => {
    const { scene, engine } = mkScene();
    const before = { m: scene.meshes.length, mat: scene.materials.length, tex: scene.textures.length, g: scene.geometries.length };
    const bo = buildBabylonBlockout(scene, finishedRooms());
    expect(scene.textures.length).toBe(before.tex + 3); // сетка + W + L (W на двух гранях — одна текстура)
    expect(Object.keys(bo.finishMaterials).sort()).toEqual(['L', 'P', 'PL', 'W']);
    bo.dispose();
    expect(scene.meshes.length).toBe(before.m);
    expect(scene.materials.length).toBe(before.mat);
    expect(scene.textures.length).toBe(before.tex);
    expect(scene.geometries.length).toBe(before.g);
    engine.dispose();
  });
});

// Интеграция с ядром — когда оно готово (до этого тест пропускается).
const FIX: Record<string, RunExport> = { 'run-gap0-30': gap0, 'run-gap1-30': gap1, 'run-gap3-20': gap3, 'run-gap1-150': big } as any;
const fixture = (name: string) => structuredClone(FIX[name]);
let coreReady = true;
try {
  buildBlockoutModel(fixture('run-gap3-20'));
} catch {
  coreReady = false;
}

describe.runIf(coreReady)('фикстуры через ядро', () => {
  for (const name of ['run-gap0-30', 'run-gap1-30', 'run-gap3-20', 'run-gap1-150']) {
    it(name, () => {
      const { scene, engine } = mkScene();
      const model = buildBlockoutModel(fixture(name));
      const bo = buildBabylonBlockout(scene, model, { collisions: true });
      const { min, max } = worldBox(bo.walls);
      expect(min.x).toBeCloseTo(model.bounds.x0, 4);
      expect(max.x).toBeCloseTo(model.bounds.x1, 4);
      expect(min.z).toBeCloseTo(-model.bounds.y1, 4);
      expect(max.z).toBeCloseTo(-model.bounds.y0, 4);
      expect(bo.walls.length).toBeLessThanOrEqual(4);
      expect(bo.props.length).toBe(model.props.length);
      const insts = new Set(model.rooms.map((r) => r.inst));
      for (const f of bo.floors) {
        const i = bo.instOf(f);
        if (i) expect(insts.has(i)).toBe(true);
      }
      bo.dispose();
      expect(scene.meshes.length).toBe(0);
      engine.dispose();
    });
  }
});
