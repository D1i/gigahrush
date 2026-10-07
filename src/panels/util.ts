// Общие помощники панелей инспектора и редактора вариантов.
import type { Assign, Project, Room, Segment, Side } from '../model/types';
import { mutate, type MutateOpts } from '../model/store';

/** Мутация комнаты по id: после undo объекты пересоздаются, поэтому ищем внутри mutate. */
export function mutRoom(roomId: string, fn: (r: Room, p: Project) => void, opts?: MutateOpts) {
  mutate((p) => {
    const r = p.rooms.find((x) => x.id === roomId);
    if (r) fn(r, p);
  }, opts);
}

export const SIDE_NAME: Record<Side, string> = { N: 'север', S: 'юг', E: 'восток', W: 'запад' };

/** Клетки → метры (без хвостов плавающей точки). */
export const toM = (cells: number, cellM: number) => +(cells * cellM).toFixed(3);
/** Метры → клетки (точка может быть дробной: половинки клетки и т.п.). */
export const toCells = (meters: number, cellM: number) => Math.round((meters / cellM) * 1000) / 1000;

/** Поворот в диапазон [0, 360). */
export const normDeg = (v: number) => {
  const r = ((v % 360) + 360) % 360;
  return +r.toFixed(3);
};

/** Название содержимого спота. */
export function assignName(p: Project, a: Assign | null | undefined): string {
  if (!a) return 'пусто';
  if (a.kind === 'prop') return p.props.find((x) => x.id === a.id)?.name ?? '(удалённый декор)';
  return p.items.find((x) => x.id === a.id)?.name ?? '(удалённый предмет)';
}

export const assignValue = (a: Assign | null | undefined) => (a ? `${a.kind}:${a.id}` : '');

export function parseAssignValue(v: string): { kind: 'prop' | 'item'; id: string } | null {
  const i = v.indexOf(':');
  if (i < 0) return null;
  const kind = v.slice(0, i);
  if (kind !== 'prop' && kind !== 'item') return null;
  return { kind, id: v.slice(i + 1) };
}

/** Два отрезка на одной прямой стены пересекаются. */
export function segOverlap(a: Pick<Segment, 'cx' | 'cy' | 'side' | 'len'>, b: Pick<Segment, 'cx' | 'cy' | 'side' | 'len'>) {
  if (a.side !== b.side) return false;
  const horiz = a.side === 'N' || a.side === 'S';
  if (horiz ? a.cy !== b.cy : a.cx !== b.cx) return false;
  const a0 = horiz ? a.cx : a.cy;
  const b0 = horiz ? b.cx : b.cy;
  return a0 < b0 + b.len && b0 < a0 + a.len;
}

/** Смешать цвет #rrggbb с белым (t > 0) или чёрным (t < 0). */
export function shade(hex: string, t: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  const n = m ? parseInt(m[1], 16) : 0x888888;
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => {
    const v = t >= 0 ? c + (255 - c) * t : c * (1 + t);
    return Math.max(0, Math.min(255, Math.round(v)));
  });
  return '#' + ch.map((c) => c.toString(16).padStart(2, '0')).join('');
}

/** Контрастный цвет текста для фона. */
export function inkFor(hex: string): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  const n = m ? parseInt(m[1], 16) : 0x888888;
  const l = 0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255);
  return l > 140 ? '#1a1408' : '#f2eee6';
}

/** Цвета для новых групп спотов. */
export const GROUP_COLORS = ['#e8b04b', '#5fa596', '#6f9fd8', '#d8604a', '#b48ad8', '#8fb86f', '#d88fb0', '#c9c36a'];
