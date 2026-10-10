// Оси, кадры и решётка «Фрактальной станции» — общие для fractalCell / fractalPhysics / сцены. Без Babylon.

export type V3 = [number, number, number];

/** Направление вдоль оси: 0 +X, 1 −X, 2 +Y, 3 −Y, 4 +Z, 5 −Z. «up» игрока, нормаль грани, подъём эскалатора. */
export type Axis6 = 0 | 1 | 2 | 3 | 4 | 5;
export const AXES6: readonly Axis6[] = [0, 1, 2, 3, 4, 5];
export const AXIS_VEC: readonly V3[] = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
/** 0 — X, 1 — Y, 2 — Z */
export const axisIdx = (a: Axis6): 0 | 1 | 2 => (a >> 1) as 0 | 1 | 2;
export const axisSign = (a: Axis6): 1 | -1 => (a & 1 ? -1 : 1);
export const opp = (a: Axis6): Axis6 => (a ^ 1) as Axis6;
export const axis6 = (i: 0 | 1 | 2, s: 1 | -1): Axis6 => (i * 2 + (s < 0 ? 1 : 0)) as Axis6;

/** Базис кадра при yaw = 0 (right = up × fwd, как в Babylon: up +Y, fwd +Z → right +X). */
export const FRAME: Readonly<Record<Axis6, { right: Axis6; fwd: Axis6 }>> = {
  0: { right: 3, fwd: 4 }, // up +X: right −Y, fwd +Z
  1: { right: 2, fwd: 4 }, // up −X: right +Y, fwd +Z
  2: { right: 0, fwd: 4 }, // up +Y: right +X, fwd +Z (как в прогулке)
  3: { right: 1, fwd: 4 }, // up −Y: right −X, fwd +Z
  4: { right: 2, fwd: 0 }, // up +Z: right +Y, fwd +X
  5: { right: 3, fwd: 0 }, // up −Z: right −Y, fwd +X
};

/** Сверхпериод выхода, ячеек. */
export const FR_SUPER = 3;
/** Целочисленный остаток в [0, n). */
export const mod = (i: number, n: number): number => ((i % n) + n) % n;
/** Копия ячейки с абсолютным номером c — выходная (ниша открыта). */
export const isExitCell = (c: V3): boolean =>
  mod(c[0], FR_SUPER) === 0 && mod(c[1], FR_SUPER) === 0 && mod(c[2], FR_SUPER) === 0;
/** Абсолютная ячейка прибытия. */
export const FR_ARRIVAL_CELL: V3 = [1, 1, 1];
