// Попадание курсором в объекты комнаты. Приоритет: споты > декор > метки > двери.
// Скрытые слои не участвуют.
import type { LayerKey, Project, Room, Selection } from '../model/types';
import { distToSegment } from '../model/segments';
import { hitProp } from '../render/props';
import type { View } from '../render/camera';
import { conOffsetPx, HANDLE_PX, handleOffset, handlePositions, roomBBox, spotRadiusPx } from './drawRoom';

export function hitObject(
  p: Project,
  room: Room,
  v: View,
  layers: Record<LayerKey, boolean>,
  x: number,
  y: number,
): Selection {
  const tolC = 6 / v.ppc; // допуск 6 px в клетках
  if (layers.spots) {
    const r = (spotRadiusPx(v) + 3) / v.ppc;
    let best: { id: string; d: number } | null = null;
    for (const s of room.spots) {
      const d = Math.hypot(s.x - x, s.y - y);
      if (d <= r && (!best || d < best.d)) best = { id: s.id, d };
    }
    if (best) return { kind: 'spot', id: best.id };
  }
  if (layers.decor) {
    const props = new Map(p.props.map((q) => [q.id, q]));
    const cm = p.settings.cellM;
    // сверху — последний нарисованный
    for (let i = room.decor.length - 1; i >= 0; i--) {
      const d = room.decor[i];
      const prop = props.get(d.propId);
      if (prop && hitProp(prop, d.x * cm, d.y * cm, d.rot, x * cm, y * cm, 2 / v.scale)) return { kind: 'decor', id: d.id };
    }
  }
  if (layers.connectors) {
    // метка нарисована снаружи стены — расширяем допуск на вынос
    const tol = tolC + (conOffsetPx(v) + 4) / v.ppc;
    let best: { id: string; d: number } | null = null;
    for (const c of room.connectors) {
      const d = distToSegment(c, x, y);
      if (d <= tol && (!best || d < best.d)) best = { id: c.id, d };
    }
    if (best) return { kind: 'connector', id: best.id };
  }
  if (layers.doors) {
    let best: { id: string; d: number } | null = null;
    for (const dr of room.doors) {
      const d = distToSegment(dr, x, y);
      if (d <= tolC + 0.5 && (!best || d < best.d)) best = { id: dr.id, d };
    }
    if (best) return { kind: 'door', id: best.id };
  }
  return null;
}

/** Ручка габарита под курсором (экранные px) или null. */
export function hitHandle(room: Room, v: View, sx: number, sy: number): string | null {
  const bb = roomBBox(room);
  if (!bb) return null;
  const tol = HANDLE_PX / 2 + 4;
  for (const [id, hx, hy] of handlePositions(v, bb)) {
    const [ox, oy] = handleOffset(id);
    if (Math.abs(sx - hx - ox) <= tol && Math.abs(sy - hy - oy) <= tol) return id;
  }
  return null;
}

export const HANDLE_CURSOR: Record<string, string> = {
  n: 'ns-resize', s: 'ns-resize', e: 'ew-resize', w: 'ew-resize',
  ne: 'nesw-resize', sw: 'nesw-resize', nw: 'nwse-resize', se: 'nwse-resize',
};
