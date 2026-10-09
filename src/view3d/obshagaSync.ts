// «Общага» в коопе (docs/COOP.md §2.5): хост ведёт режиссёра (src/locations/obshaga.ts) и ~10 раз в секунду рассылает
// его срез событием fx 'obsh' (≤ 2 КБ JSON, иначе сервер отбросит): свет, двери в ходу, рука (след упрощён до ≤ 40
// точек, сантиметры; тычок под кровать — кого, куда, фаза цикла; кровать рядом — рамка), события для жертвы (grab /
// released / killed / poke). Клиенты рисуют по срезу; свет и фазу тычка между рассылками досчитывают сами.
// Без движка — для тестов.
import { handView, lightLevel, type BlackoutPhase, type BlackoutState, type HandPhase, type HandView, type ObshagaState, type Pt } from '../locations/obshaga';

/** Предел JSON события fx (сервер, tools/coop-server.mjs MAX_FX), с запасом. */
export const FX_MAX = 2048;
const BUDGET = 1900;
const PHASES: BlackoutPhase[] = ['lit', 'flicker', 'dark', 'return'];

/** Срез режиссёра для клиентов. */
export interface ObshWire {
  /** номер рассылки */
  q: number;
  /** свет: фаза (индекс PHASES), номер цикла, время в фазе, длительность (с, сотые), ключ мигания */
  b: [number, number, number, number, number];
  /** двери в ходу: id → открытость (сотые); закрытых нет */
  d: Record<string, number>;
  /** рука или null */
  h: WireHand | null;
  /** дверь руки */
  hd: string | null;
  /** события с прошлой рассылки: [вид, жертва] — grab / released / killed / poke (тычок: урон жертве) */
  ev?: [string, string][];
}

export interface WireHand {
  ph: HandPhase;
  /** комнаты точек (таблица) */
  r: string[];
  /** след с кистью на конце: x, y (см), индекс комнаты — тройками */
  p: number[];
  /** направление кисти, рад (сотые) */
  hd: number;
  v: string | null;
  dp: number;
  em: number;
  f: 0 | 1;
  bl: 0 | 1;
  va: number;
  len: number;
  /** тычет под кровать (нет — не тычет): жертва, точка x, y (см), индекс комнаты в r (−1 — без комнаты), фаза цикла (сотые) */
  pk?: [string, number, number, number, number];
  /** кровать рядом (HandView.bed): рамка x0, y0, x1, y1, см; нет — нет */
  bd?: [number, number, number, number];
}

const r2 = (v: number) => Math.round(v * 100) / 100;

/** Расстояние от p до отрезка ab. */
function segDist(p: Pt, a: Pt, b: Pt): number {
  const dx = b.x - a.x, dy = b.y - a.y;
  const l2 = dx * dx + dy * dy;
  const u = l2 > 0 ? Math.min(1, Math.max(0, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2)) : 0;
  return Math.hypot(a.x + dx * u - p.x, a.y + dy * u - p.y);
}

/** Рамер — Дуглас — Пекер: точки ломаной, отклоняющиеся больше eps (концы — всегда; смена комнаты — тоже). */
function rdp(pts: readonly Pt[], eps: number): Pt[] {
  if (pts.length <= 2) return pts.slice();
  const keep = new Array<boolean>(pts.length).fill(false);
  keep[0] = keep[pts.length - 1] = true;
  // смена метки комнаты — опорная точка (рендер делит руку по комнатам)
  for (let i = 1; i < pts.length; i++) if (pts[i].room !== pts[i - 1].room) keep[i] = keep[i - 1] = true;
  const stack: [number, number][] = [];
  let a = 0;
  for (let i = 1; i < pts.length; i++) if (keep[i]) (stack.push([a, i]), (a = i));
  while (stack.length) {
    const [i, j] = stack.pop()!;
    let best = -1, bd = eps;
    for (let k = i + 1; k < j; k++) {
      const d = segDist(pts[k], pts[i], pts[j]);
      if (d > bd) (bd = d), (best = k);
    }
    if (best >= 0) {
      keep[best] = true;
      stack.push([i, best], [best, j]);
    }
  }
  return pts.filter((_, i) => keep[i]);
}

/** Ломаная руки — не больше max точек (концы сохраняются; изгибы — по возможности). */
export function simplifyTrail(pts: readonly Pt[], max: number): Pt[] {
  if (pts.length <= max) return pts.slice();
  let eps = 0.02;
  let out = rdp(pts, eps);
  while (out.length > max && eps < 50) out = rdp(pts, (eps *= 2));
  if (out.length > max) {
    // всё ещё много (смены комнат) — равномерно, с концами
    const step = (out.length - 1) / (max - 1);
    out = Array.from({ length: max }, (_, i) => out[Math.round(i * step)]);
  }
  return out;
}

function wireHand(v: HandView, maxPts: number): WireHand {
  const pts = simplifyTrail(v.trail, maxPts);
  const rooms: string[] = [];
  const idx = new Map<string, number>();
  const p: number[] = [];
  for (const q of pts) {
    const room = q.room ?? '';
    let i = idx.get(room);
    if (i === undefined) idx.set(room, (i = rooms.push(room) - 1));
    p.push(Math.round(q.x * 100), Math.round(q.y * 100), i);
  }
  const w: WireHand = {
    ph: v.phase, r: rooms, p, hd: r2(v.heading), v: v.victim, dp: r2(v.dragProgress), em: r2(v.emerge01),
    f: v.frozen ? 1 : 0, bl: v.blocked ? 1 : 0, va: r2(v.variant), len: r2(v.length),
  };
  if (v.poke && v.pokeAt) {
    const room = v.pokeAt.room;
    let ri = -1;
    if (room !== undefined) {
      ri = idx.get(room) ?? -1;
      if (ri < 0) idx.set(room, (ri = rooms.push(room) - 1));
    }
    w.pk = [v.poke, Math.round(v.pokeAt.x * 100), Math.round(v.pokeAt.y * 100), ri, r2(v.poke01)];
  }
  if (v.bed) w.bd = [Math.round(v.bed.x0 * 100), Math.round(v.bed.y0 * 100), Math.round(v.bed.x1 * 100), Math.round(v.bed.y1 * 100)];
  return w;
}

/** Срез режиссёра (≤ BUDGET байт JSON: лишнее — меньше точек руки, затем двери, затем события). */
export function toWire(dir: ObshagaState, q: number, events: readonly [string, string][] = []): ObshWire {
  const b = dir.blackout;
  const doors: Record<string, number> = {};
  for (const [id, d] of Object.entries(dir.doors)) if (d.open > 0.001 || d.phase === 'opening') doors[id] = Math.max(0.01, r2(d.open));
  const hv = dir.hand ? handView(dir.hand) : null;
  let max = 40;
  const make = (): ObshWire => ({
    q,
    b: [PHASES.indexOf(b.phase), b.n, r2(b.t), r2(b.dur), b.key],
    d: doors,
    h: hv && hv.visible ? wireHand(hv, max) : null,
    hd: dir.handDoor,
    ...(events.length ? { ev: events.slice(-8).map((e) => [e[0], e[1]] as [string, string]) } : {}),
  });
  let w = make();
  while (JSON.stringify(w).length > BUDGET && max > 8) {
    max = Math.floor(max * 0.7);
    w = make();
  }
  if (JSON.stringify(w).length > BUDGET) {
    // дверей слишком много (не бывает) — оставить самые открытые
    const keep = Object.entries(doors).sort((a, b) => b[1] - a[1]).slice(0, 12);
    for (const k of Object.keys(doors)) delete doors[k];
    for (const [k, v] of keep) doors[k] = v;
    w = make();
  }
  return w;
}

/** Срез у клиента: свет (досчитывается между рассылками), двери, рука. */
export interface ObshRemote {
  blackout: BlackoutState;
  doors: Record<string, number>;
  hand: HandView | null;
  handDoor: string | null;
  events: [string, string][];
  q: number;
}

export function fromWire(w: ObshWire): ObshRemote | null {
  if (!w || typeof w !== 'object' || !Array.isArray(w.b) || w.b.length < 5) return null;
  const [pi, n, t, dur, key] = w.b;
  const phase = PHASES[pi] ?? 'lit';
  const blackout: BlackoutState = { seed: '', key: Number(key) || 0, phase, n: Number(n) || 0, t: Number(t) || 0, dur: Number(dur) || 0, time: 0 };
  let hand: HandView | null = null;
  const h = w.h;
  if (h && Array.isArray(h.p) && h.p.length >= 3) {
    const trail: Pt[] = [];
    for (let i = 0; i + 2 < h.p.length; i += 3) {
      const room = h.r?.[h.p[i + 2]];
      trail.push(room ? { x: h.p[i] / 100, y: h.p[i + 1] / 100, room } : { x: h.p[i] / 100, y: h.p[i + 1] / 100 });
    }
    // тычок под кровать
    const pk = Array.isArray(h.pk) && h.pk.length >= 5 && typeof h.pk[0] === 'string' ? h.pk : null;
    let pokeAt: Pt | null = null;
    if (pk) {
      const room = pk[3] >= 0 ? h.r?.[pk[3]] : undefined;
      const x = (Number(pk[1]) || 0) / 100, y = (Number(pk[2]) || 0) / 100;
      pokeAt = room ? { x, y, room } : { x, y };
    }
    hand = {
      phase: h.ph, visible: true, tip: { ...trail[trail.length - 1] }, heading: Number(h.hd) || 0, trail, length: Number(h.len) || 0,
      victim: h.v ?? null, dragProgress: Number(h.dp) || 0, emerge01: Number(h.em) || 0, frozen: !!h.f, blocked: !!h.bl, variant: Number(h.va) || 0,
      poke: pk ? pk[0] : null, pokeAt, poke01: pk ? Math.min(1, Math.max(0, Number(pk[4]) || 0)) : 0,
      bed: Array.isArray(h.bd) && h.bd.length === 4 && h.bd.every((v) => Number.isFinite(v))
        ? { x0: h.bd[0] / 100, y0: h.bd[1] / 100, x1: h.bd[2] / 100, y1: h.bd[3] / 100 } : null,
    };
  }
  const doors: Record<string, number> = {};
  for (const [k, v] of Object.entries(w.d ?? {})) if (typeof v === 'number' && Number.isFinite(v)) doors[k] = Math.min(1, Math.max(0, v));
  return { blackout, doors, hand, handDoor: typeof w.hd === 'string' ? w.hd : null, events: Array.isArray(w.ev) ? w.ev.filter((e) => Array.isArray(e) && e.length === 2).map((e) => [String(e[0]), String(e[1])] as [string, string]) : [], q: Number(w.q) || 0 };
}

/** Свет у клиента между рассылками: время фазы идёт (не дальше её конца). */
export function advanceRemote(r: ObshRemote, dt: number): number {
  const b = r.blackout;
  if (dt > 0 && Number.isFinite(dt)) b.t = Math.min(b.dur, b.t + dt);
  return lightLevel(b);
}
