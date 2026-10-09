// Лестницы с перепадом высоты (Room.stair): марши и площадки внутри комнаты. Пол у каждой метки стоит на своей высоте
// (connDz): комната за меткой ставится так, что полы двух меток проёма на одной высоте — мир за лестницей выше или ниже
// (Instance.z = z родителя + dz его метки − dz метки комнаты, src/gen4d/foldcore.ts link). Два подъёма подряд — +2 этажа,
// спуск со старта — отрицательная высота (подвал).
// Геометрия (ступени, перила, невидимый пандус-коллайдер, площадки) — src/blockout/stairs.ts по RunInstance.stair;
// опора игрока на марше — src/view3d/stairWalk.ts.
import { OPPOSITE, rotateCell, rotateSide } from './cells';
import type { Connector, Room, Side, StairFlight, StairPad, StairSpec } from './types';

/** Высота этажа «пол — пол» болванки по умолчанию (стены 2.5 м + плита 0.2 м, src/blockout/types.ts), м: подъём марша
 *  на этаж. */
export const STOREY_M = 2.7;
/** Высота ступени, м (ГОСТ 9818: 150 мм при проступи 300 мм). */
export const STEP_RISE = 0.15;

const ALONG: Record<Side, [number, number]> = { N: [0, -1], S: [0, 1], E: [1, 0], W: [-1, 0] };

/** Точка (клетки, дробные) внутри прямоугольника клеток. */
const inRect = (r: { x: number; y: number; w: number; h: number }, px: number, py: number): boolean =>
  px > r.x && px < r.x + r.w && py > r.y && py < r.y + r.h;

/** Доля пути по маршу снизу вверх (0 — нижний край, 1 — верхний) в точке (клетки). */
export function flightT(f: StairFlight, px: number, py: number): number {
  const [ux, uy] = ALONG[f.up];
  if (ux) return ux > 0 ? (px - f.x) / f.w : (f.x + f.w - px) / f.w;
  return uy > 0 ? (py - f.y) / f.h : (f.y + f.h - py) / f.h;
}

/** Высота пола лестницы в точке плана комнаты (клетки), м над низом комнаты: площадки и марши (по средней линии);
 *  0 — обычный пол. */
export function stairZ(spec: StairSpec, px: number, py: number): number {
  let z = 0;
  for (const p of spec.pads ?? []) if (inRect(p, px, py)) z = Math.max(z, p.z);
  for (const f of spec.flights) {
    if (!inRect(f, px, py)) continue;
    const t = Math.min(1, Math.max(0, flightT(f, px, py)));
    z = Math.max(z, f.z0 + (f.z1 - f.z0) * t);
  }
  return z;
}

/** Середина метки (клетки, дробные) — на её клетках, в полуклетке от стены. */
function connMid(c: Pick<Connector, 'cx' | 'cy' | 'side' | 'len'>): [number, number] {
  return c.side === 'N' || c.side === 'S' ? [c.cx + c.len / 2, c.cy + 0.5] : [c.cx + 0.5, c.cy + c.len / 2];
}

/** Высота пола у метки над низом комнаты, м: площадка под ней, конец марша (метка на стороне up — верх, напротив —
 *  низ), иначе 0. */
export function connZ(spec: StairSpec, c: Pick<Connector, 'cx' | 'cy' | 'side' | 'len'>): number {
  const [px, py] = connMid(c);
  let z = 0;
  for (const p of spec.pads ?? []) if (inRect(p, px, py)) z = Math.max(z, p.z);
  for (const f of spec.flights) {
    if (!inRect(f, px, py)) continue;
    z = Math.max(z, c.side === f.up ? f.z1 : c.side === OPPOSITE[f.up] ? f.z0 : stairZ({ flights: [f] }, px, py));
  }
  return Math.round(z * 1e6) / 1e6;
}

const dzCache = new WeakMap<Room, number[]>();

/** Высоты пола у меток комнаты (порядок room.connectors), м; у комнаты без лестницы — нули. Кэш на объект комнаты. */
export function connDzs(room: Room): number[] {
  let d = dzCache.get(room);
  if (!d) dzCache.set(room, (d = room.connectors.map((c) => (room.stair ? connZ(room.stair, c) : 0))));
  return d;
}

/** Высота пола у метки ci комнаты над её низом, м (0 — без лестницы). */
export function connDz(room: Room, ci: number): number {
  return room.stair ? (connDzs(room)[ci] ?? 0) : 0;
}

/** Перепад лестницы комнаты (самая высокая площадка / верх марша), м; 0 — без лестницы. */
export function stairRise(spec: StairSpec | null | undefined): number {
  if (!spec) return 0;
  let z = 0;
  for (const f of spec.flights) z = Math.max(z, f.z0, f.z1);
  for (const p of spec.pads ?? []) z = Math.max(z, p.z);
  return z;
}

/** Ступеней в марше: перепад / ~STEP_RISE (не меньше 1). */
export function stepCount(f: Pick<StairFlight, 'z0' | 'z1'>): number {
  return Math.max(1, Math.round(Math.abs(f.z1 - f.z0) / STEP_RISE));
}

export interface StraightStairOpts {
  /** габарит зала, м: ширина поперёк марша и длина вдоль него */
  w: number;
  l: number;
  /** куда идти вверх (сторона зала, у которой верхняя площадка) */
  up: Side;
  /** подъём, м (по умолчанию этаж STOREY_M) */
  rise?: number;
  /** глубина нижней и верхней площадки, м (по умолчанию 1.0) */
  landing?: number;
  top?: number;
  /** ширина марша, м (по умолчанию во всю ширину) и его отступ поперёк от левого (W / N) края, м */
  flightW?: number;
  offset?: number;
  /** левый верхний угол зала в плане комнаты, м (по умолчанию 0, 0) */
  x?: number;
  y?: number;
}

const cl = (m: number) => Math.round(m / 0.1 + 1e-9);

/**
 * Прямой зал «площадка — марш — площадка» в метрах (клетки 0.1 м): нижняя площадка на высоте 0, марш, верхняя
 * площадка на высоте rise во всю ширину зала. Метки ставятся отдельно (RoomBuilder.open): у стены up — верхняя (dz =
 * rise), у противоположной — нижняя (dz = 0). Узкий марш (flightW < w) — сбоку низ без марша, перила — сами.
 */
export function straightStair(o: StraightStairOpts): StairSpec {
  const rise = o.rise ?? STOREY_M;
  const lo = o.landing ?? 1.0, hi = o.top ?? 1.0;
  const fw = Math.min(o.flightW ?? o.w, o.w);
  const off = Math.min(Math.max(0, o.offset ?? 0), o.w - fw);
  const x = o.x ?? 0, y = o.y ?? 0;
  const vert = o.up === 'N' || o.up === 'S';
  // вдоль: от начала зала по оси марша (y для N/S, x для E/W), поперёк — другая ось
  const L = o.l;
  const span = (a0: number, a1: number, b0: number, b1: number) =>
    vert ? { x: cl(x + b0), y: cl(y + a0), w: cl(x + b1) - cl(x + b0), h: cl(y + a1) - cl(y + a0) }
      : { x: cl(x + a0), y: cl(y + b0), w: cl(x + a1) - cl(x + a0), h: cl(y + b1) - cl(y + b0) };
  // верх у стороны N / W — в начале оси
  const upFirst = o.up === 'N' || o.up === 'W';
  const top: [number, number] = upFirst ? [0, hi] : [L - hi, L];
  const fl: [number, number] = upFirst ? [hi, L - lo] : [lo, L - hi];
  const flight: StairFlight = { ...span(fl[0], fl[1], off, off + fw), up: o.up, z0: 0, z1: rise };
  const pad: StairPad = { ...span(top[0], top[1], 0, o.w), z: rise };
  return { flights: [flight], pads: [pad] };
}

/** Проблемы описания лестницы комнаты (пусто — всё верно): марши и площадки на клетках комнаты, высоты ≥ 0, метки
 *  не на боку марша. */
export function stairIssues(room: Room): string[] {
  const s = room.stair;
  if (!s) return [];
  const out: string[] = [];
  const has = (x: number, y: number) => room.cells.has(`${x},${y}`);
  const covered = (r: { x: number; y: number; w: number; h: number }, what: string) => {
    if (!(r.w > 0 && r.h > 0)) out.push(`${room.id}: ${what} — пустой прямоугольник`);
    for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) {
      if (!has(x, y)) {
        out.push(`${room.id}: ${what} выходит за клетки комнаты (${x},${y})`);
        return;
      }
    }
  };
  s.flights.forEach((f, i) => {
    covered(f, `марш ${i + 1}`);
    if (!(f.z0 >= 0 && f.z1 >= 0) || f.z0 === f.z1) out.push(`${room.id}: марш ${i + 1} — высоты ${f.z0}…${f.z1} (нужны ≥ 0 и разные)`);
  });
  (s.pads ?? []).forEach((p, i) => {
    covered(p, `площадка ${i + 1}`);
    if (!(p.z > 0)) out.push(`${room.id}: площадка ${i + 1} — высота ${p.z} (нужна > 0)`);
  });
  room.connectors.forEach((c) => {
    const [px, py] = connMid(c);
    for (const f of s.flights) {
      if (inRect(f, px, py) && c.side !== f.up && c.side !== OPPOSITE[f.up]) out.push(`${room.id}: метка «${c.name}» на боку марша`);
    }
  });
  return out;
}

/** Лестница экземпляра в мировых клетках (поворот rot вокруг (0, 0), затем сдвиг dx, dy) — для экспорта прогона
 *  (RunInstance.stair): прямоугольники [x0, x1) × [y0, y1); стиль марша (эскалатор) — только если задан. */
export function worldStair(spec: StairSpec, rot: number, dx: number, dy: number): {
  flights: { x0: number; y0: number; x1: number; y1: number; up: Side; z0: number; z1: number; style?: 'escalator' }[];
  pads: { x0: number; y0: number; x1: number; y1: number; z: number }[];
} {
  const rect = (r: { x: number; y: number; w: number; h: number }) => {
    const [ax, ay] = rotateCell(r.x, r.y, rot);
    const [bx, by] = rotateCell(r.x + r.w - 1, r.y + r.h - 1, rot);
    return { x0: Math.min(ax, bx) + dx, y0: Math.min(ay, by) + dy, x1: Math.max(ax, bx) + 1 + dx, y1: Math.max(ay, by) + 1 + dy };
  };
  return {
    flights: spec.flights.map((f) => ({ ...rect(f), up: rotateSide(f.up, rot), z0: f.z0, z1: f.z1, ...(f.style === 'escalator' ? { style: f.style } : {}) })),
    pads: (spec.pads ?? []).map((p) => ({ ...rect(p), z: p.z })),
  };
}

/** Копия описания лестницы. */
export function cloneStair(s: StairSpec | null): StairSpec | null {
  return s ? { flights: s.flights.map((f) => ({ ...f })), ...(s.pads ? { pads: s.pads.map((p) => ({ ...p })) } : {}) } : null;
}

const SIDES: readonly Side[] = ['N', 'E', 'S', 'W'];
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const n = (v: unknown, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);

/** Толерантный разбор описания лестницы (сохранённый проект): мусор — null, пустые марши отбрасываются. */
export function parseStair(v: unknown): StairSpec | null {
  if (!isObj(v) || !Array.isArray(v.flights)) return null;
  const rect = (o: Record<string, unknown>) => ({ x: Math.round(n(o.x)), y: Math.round(n(o.y)), w: Math.max(0, Math.round(n(o.w))), h: Math.max(0, Math.round(n(o.h))) });
  const flights: StairFlight[] = v.flights.filter(isObj).map((o) => ({
    ...rect(o),
    up: SIDES.includes(o.up as Side) ? (o.up as Side) : 'N',
    z0: Math.max(0, n(o.z0)),
    z1: Math.max(0, n(o.z1)),
    // стиль марша: только известный (эскалатор метро), иначе обычная лестница
    ...(o.style === 'escalator' ? { style: 'escalator' as const } : {}),
  })).filter((f) => f.w > 0 && f.h > 0);
  const pads: StairPad[] = (Array.isArray(v.pads) ? v.pads : []).filter(isObj).map((o) => ({ ...rect(o), z: Math.max(0, n(o.z)) })).filter((p) => p.w > 0 && p.h > 0);
  if (!flights.length && !pads.length) return null;
  return { flights, ...(pads.length ? { pads } : {}) };
}
