// Воркер оболочек снежных ходов: сетка куска (оболочка 5 см с рельефом и гладкий коллайдер 10 см) строится вне
// главного потока — пока игрок ползёт, куски впереди готовятся заранее (src/view3d/snowView.ts, SnowMeshCache).
import { buildSnowMesh, type SnowMeshData, type SnowPieceSpec } from './snowMesh';

const buffers = (d: SnowMeshData) => [d.positions.buffer, d.normals.buffer, d.colors.buffer, d.uvs.buffer, d.indices.buffer] as ArrayBuffer[];

self.onmessage = (e: MessageEvent<{ key: string; spec: SnowPieceSpec }>) => {
  const { key, spec } = e.data;
  try {
    const shell = buildSnowMesh(spec);
    const col = buildSnowMesh(spec, 0.1, false);
    (self as unknown as Worker).postMessage({ key, shell, col }, [...buffers(shell), ...buffers(col)]);
  } catch (err) {
    (self as unknown as Worker).postMessage({ key, error: String((err as Error)?.message ?? err) });
  }
};
