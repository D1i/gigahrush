// Снежные ходы (биом «Снежные тоннели», docs/GENERATOR-4D.md §20): оболочка куска — не стены болванки, а полость в
// снегу. Полость задана функцией расстояния (SDF, < 0 — воздух, > 0 — снег) и превращается в сетку методом
// «surface nets» на решётке 5 см. Без Babylon: на выходе — массивы вершин в координатах Babylon (X = x, Y = z, Z = −y
// плана), их собирает src/view3d/snowView.ts.
//
// Полость куска:
//  • лаз — «трубка» профиля устья набора пользователя (snow-models, 01-snow-tunnel: арка 1.1 × 0.9 м — полуэллипс
//    0.55 × 0.8 м на высоте 0.1 м и чуть вогнутый пол) вдоль кривой: от середины каждого проёма прямой «вывод» 0.3 м по
//    нормали, затем кубическая кривая Безье к другому проёму (два проёма — прямой ход, сдвиг вбок, поворот дугой) или к
//    центру куска (три и больше — развилка). Горка / яма — пол кривой поднимается / опускается синусом (на выводах — 0);
//  • берлога — купол (эллипсоид над вогнутым полом) в середине куска, лазы к нему от проёмов; лавка — снежный уступ у
//    глухой стены (как на концептах набора);
//  • глухой проём (стена) — лаз обрывается в 0.35 м от стены круглым торцом; завал (обвал) — лаз до проёма, в проёме
//    снежная пробка с глыбами (глыбы — модели набора, их ставит snowView);
//  • рельеф — шум (бугры 0.45 м и мелкие 0.15 м, слоистость стен); у проёмов шум гаснет, и в 0.3 м от плоскости проёма
//    полость — точно трубка устья: сечение на плоскости одинаково у обоих соседей, шов не виден. Решётка привязана к
//    мировой (5 см): кольцо вершин на плоскости проёма у соседей совпадает;
//  • полость не выходит за план комнаты (отступ 4 см), кроме проёмов: 4D-соседи по габариту не задевают.
import type { RunInstance, Side } from '../blockout/types';

/** Профиль устья лаза (набор пользователя): полуширина, полувысота свода, высота центра свода, подъём пола у стен. */
export const SNOW_A = 0.55;
export const SNOW_B = 0.8;
export const SNOW_C = 0.1;
export const SNOW_BOWL = 0.108;
/** Высота лаза в свету, м (пол в середине — 0). */
export const SNOW_CRAWL_H = SNOW_C + SNOW_B;
/** Купол берлоги (02-snow-den: в свету ~2.1 × 1.37 м). */
export const DEN_H = 1.37;
/** Шаг решётки, м. */
export const SNOW_STEP = 0.05;
/** Вывод трубки по нормали проёма (без изгиба и шума), м. */
const LEAD = 0.3;
/** Зона «точного устья» у проёма, м. */
const CANON = 0.3;
/** Отступ полости от плана комнаты, м. */
const MARGIN = 0.04;
/** Глухой проём: начало оси обрубка от стены, м (круглый торец — полуширина лаза: воздух кончается в ~0.2 м от стены). */
const STUB = 0.75;

export type SnowDoorState = 'open' | 'closed' | 'collapsed';

/** Проём куска (мир, план, метры): середина на плоскости проёма (середина стены между соседями — граница кусков
 *  портального рендера: линия стены комнаты + полузазор наружу), нормаль внутрь куска, полуширина. */
export interface SnowDoor {
  id: string;
  side: Side;
  /** середина проёма на плоскости проёма */
  x: number;
  y: number;
  /** нормаль внутрь комнаты (план) */
  nx: number;
  ny: number;
  half: number;
  state: SnowDoorState;
  /** завал раскопан на долю 0…1: пробка меньше и ниже (сверху открывается щель) */
  dug?: number;
}

export interface SnowPieceSpec {
  /** габарит (план, метры) */
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  /** высота пола этажа, м (Babylon Y = floorY + z) */
  floorY: number;
  /** полузазор между соседями, м: плоскость проёма — на столько за линией стены (нет — 0) */
  pad?: number;
  doors: SnowDoor[];
  den: boolean;
  /** подъём (+) / провал (−) пола посреди лаза, м */
  rise: number;
  bench: boolean;
  seed: number;
}

export interface SnowMeshData {
  positions: Float32Array;
  normals: Float32Array;
  colors: Float32Array;
  uvs: Float32Array;
  indices: Uint32Array;
}

const OUT: Record<Side, [number, number]> = { N: [0, -1], S: [0, 1], E: [1, 0], W: [-1, 0] };

/** Подъём / провал пола лаза по тегам комнаты: «горка» / «яма» (+ «круто» — вдвое). */
export function snowRise(tags: readonly string[]): number {
  const k = tags.includes('круто') ? 2 : 1;
  if (tags.includes('горка')) return 0.25 * k;
  if (tags.includes('яма')) return -0.3 * k;
  return 0;
}

/** Хэш строки → 32 бита (FNV-1a). */
export function hashStr(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Спецификация куска по экземпляру прогона: проёмы — метки длиной ≥ 1 клетки; state — состояние проёма по id метки
 *  (нет — open: связан или ещё не раскрыт). floorM — высота этажа: в «Прогулке» 0 (куски всех этажей на одной высоте —
 *  их разводит портальный рендер, как и болванку). */
export function snowSpecOf(inst: RunInstance, cellM: number, state: (connectorId: string) => SnowDoorState, gapCells = 1, floorM = 0): SnowPieceSpec {
  const b = inst.bbox;
  const pad = (gapCells * cellM) / 2;
  const doors: SnowDoor[] = [];
  for (const c of inst.connectors) {
    if (c.len < 1) continue;
    const [x1, y1, x2, y2] = c.line;
    const [ox, oy] = OUT[c.side];
    doors.push({
      id: c.id,
      side: c.side,
      x: ((x1 + x2) / 2) * cellM + ox * pad,
      y: ((y1 + y2) / 2) * cellM + oy * pad,
      nx: -ox,
      ny: -oy,
      half: (c.len * cellM) / 2,
      state: state(c.id),
    });
  }
  const tags = inst.roomTags;
  return {
    x0: b.x0 * cellM,
    y0: b.y0 * cellM,
    x1: b.x1 * cellM,
    y1: b.y1 * cellM,
    floorY: (inst.floor ?? 0) * floorM,
    pad,
    doors,
    den: tags.includes('берлога'),
    rise: snowRise(tags),
    bench: tags.includes('лавка'),
    seed: hashStr(inst.id),
  };
}

// ───────────────────────── шум ─────────────────────────

function hash3(x: number, y: number, z: number, s: number): number {
  let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(z, 1274126177) ^ Math.imul(s, 1103515245);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

const fade = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);

/** Шум значений 3D, −1…1. */
export function vnoise(x: number, y: number, z: number, s: number): number {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const fx = fade(x - xi), fy = fade(y - yi), fz = fade(z - zi);
  const l = (a: number, b: number, t: number) => a + (b - a) * t;
  const c = (dx: number, dy: number, dz: number) => hash3(xi + dx, yi + dy, zi + dz, s);
  const v = l(
    l(l(c(0, 0, 0), c(1, 0, 0), fx), l(c(0, 1, 0), c(1, 1, 0), fx), fy),
    l(l(c(0, 0, 1), c(1, 0, 1), fx), l(c(0, 1, 1), c(1, 1, 1), fx), fy),
    fz,
  );
  return v * 2 - 1;
}

// ───────────────────────── полость ─────────────────────────

/** Ломаная оси лаза: точки плана и высота пола. */
interface Tube {
  px: Float64Array;
  py: Float64Array;
  pz: Float64Array;
  n: number;
  /** торцы: закрытый конец оси — полость закругляется (глухой проём, середина развилки), открытый — трубка тянется
   *  дальше по выводу (за плоскость проёма) */
  capStart: boolean;
  capEnd: boolean;
}

const smin = (a: number, b: number, k: number) => {
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.min(a, b) - h * h * k * 0.25;
};

/** SDF профиля лаза в сечении: u — расстояние от оси вбок (≥ 0), h — высота над полом оси. */
export function crawlProfile(u: number, h: number): number {
  const a = SNOW_A, b = SNOW_B, c = SNOW_C;
  const hy = Math.max(0, h - c);
  const e = Math.sqrt((u / a) ** 2 + (hy / b) ** 2) - 1;
  const arch = e * Math.min(a, b);
  const t = Math.min(1, u / a);
  const bowl = SNOW_BOWL * t * t * t;
  return Math.max(arch, bowl - h);
}

function bezierTube(ax: number, ay: number, anx: number, any: number, bx: number, by: number, bnx: number, bny: number, rise: number, capEnd: boolean, steps = 20): Tube {
  // вывод от проёма A по нормали, кривая, вывод к проёму B (нормаль B — внутрь, путь идёт против неё)
  const p0x = ax + anx * LEAD, p0y = ay + any * LEAD;
  const p3x = bx + bnx * LEAD, p3y = by + bny * LEAD;
  const d = Math.hypot(p3x - p0x, p3y - p0y);
  const k = Math.max(0.15, d * 0.42);
  const p1x = p0x + anx * k, p1y = p0y + any * k;
  const p2x = p3x + bnx * k, p2y = p3y + bny * k;
  const n = steps + 3;
  const px = new Float64Array(n), py = new Float64Array(n), pz = new Float64Array(n);
  px[0] = ax;
  py[0] = ay;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps, s = 1 - t;
    px[i + 1] = s * s * s * p0x + 3 * s * s * t * p1x + 3 * s * t * t * p2x + t * t * t * p3x;
    py[i + 1] = s * s * s * p0y + 3 * s * s * t * p1y + 3 * s * t * t * p2y + t * t * t * p3y;
    pz[i + 1] = rise * Math.sin(Math.PI * t) ** 2;
  }
  px[n - 1] = bx;
  py[n - 1] = by;
  return { px, py, pz, n, capStart: false, capEnd };
}

/** Ось от проёма к точке (cx, cy) куска (развилка, берлога). */
function leadTube(ax: number, ay: number, anx: number, any: number, cx: number, cy: number, capEnd: boolean, steps = 12): Tube {
  const p0x = ax + anx * LEAD, p0y = ay + any * LEAD;
  const d = Math.hypot(cx - p0x, cy - p0y);
  const k = Math.max(0.1, d * 0.45);
  const p1x = p0x + anx * k, p1y = p0y + any * k;
  const n = steps + 2;
  const px = new Float64Array(n), py = new Float64Array(n), pz = new Float64Array(n);
  px[0] = ax;
  py[0] = ay;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps, s = 1 - t;
    // квадратичная кривая: p0 → p1 → центр
    px[i + 1] = s * s * p0x + 2 * s * t * p1x + t * t * cx;
    py[i + 1] = s * s * p0y + 2 * s * t * p1y + t * t * cy;
  }
  return { px, py, pz, n, capStart: false, capEnd };
}

/** Ось, укороченная до глухого торца: от точки (cx, cy) к проёму, но не ближе STUB к стене. */
function stubTube(d: SnowDoor, cx: number, cy: number): Tube {
  const t = leadTube(d.x + d.nx * STUB, d.y + d.ny * STUB, d.nx, d.ny, cx, cy, true, 10);
  t.capStart = true;
  return t;
}

/** Ближайшая точка оси: u — расстояние вбок в плане, h — высота над полом оси. За концами оси: открытый конец —
 *  продолжение вывода (трубка вытянута дальше, за плоскость проёма), закрытый (cap) — круглый торец. */
function tubeDist(t: Tube, x: number, y: number, z: number): { u: number; h: number } {
  let best = Infinity, bz = 0;
  const last = t.n - 2;
  for (let i = 0; i <= last; i++) {
    const ax = t.px[i], ay = t.py[i], bx = t.px[i + 1], by = t.py[i + 1];
    const dx = bx - ax, dy = by - ay;
    const l2 = dx * dx + dy * dy || 1e-12;
    const s0 = ((x - ax) * dx + (y - ay) * dy) / l2;
    let d2: number, s = s0;
    if ((s0 < 0 && i === 0 && !t.capStart) || (s0 > 1 && i === last && !t.capEnd)) {
      // открытый конец: расстояние до прямой (вытянутая трубка)
      const qx = ax + dx * s0 - x, qy = ay + dy * s0 - y;
      d2 = qx * qx + qy * qy;
      s = s0 < 0 ? 0 : 1;
    } else {
      s = Math.min(1, Math.max(0, s0));
      const qx = ax + dx * s - x, qy = ay + dy * s - y;
      d2 = qx * qx + qy * qy;
    }
    if (d2 < best) {
      best = d2;
      bz = t.pz[i] + (t.pz[i + 1] - t.pz[i]) * s;
    }
  }
  return { u: Math.sqrt(best), h: z - bz };
}

export interface SnowField {
  /** SDF: < 0 воздух; noise — с рельефом */
  f(x: number, y: number, z: number, noise?: boolean): number;
  /** высота пола под точкой (для цвета и для игрока): высота пола ближайшей оси / купола */
  floorAt(x: number, y: number): number;
  zMin: number;
  zMax: number;
}

/** Поле полости куска (план, метры; z — над полом этажа). */
export function snowField(spec: SnowPieceSpec): SnowField {
  const { x0, y0, x1, y1, doors } = spec;
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  const tubes: Tube[] = [];
  const open = doors.filter((d) => d.state !== 'closed');
  const closed = doors.filter((d) => d.state === 'closed');
  // берлога: купол в середине; полуоси — по плану минус отступ
  const den = spec.den
    ? { cx, cy, rx: Math.max(0.6, (x1 - x0) / 2 - 0.12), ry: Math.max(0.6, (y1 - y0) / 2 - 0.12), H: DEN_H - SNOW_C }
    : null;
  // точка встречи лазов развилки: центр, сдвинутый к проёмам (Т-образный кусок — к середине основного хода)
  let hx = cx, hy = cy;
  if (!den && open.length >= 3) {
    hx = open.reduce((s, d) => s + d.x, 0) / open.length;
    hy = open.reduce((s, d) => s + d.y, 0) / open.length;
  }
  if (den) {
    for (const d of open) tubes.push(leadTube(d.x, d.y, d.nx, d.ny, cx, cy, true, 8));
    for (const d of closed) tubes.push(stubTube(d, cx, cy));
  } else if (open.length === 2) {
    const [a, b] = open;
    tubes.push(bezierTube(a.x, a.y, a.nx, a.ny, b.x, b.y, b.nx, b.ny, spec.rise, false));
    for (const d of closed) tubes.push(stubTube(d, hx, hy));
  } else if (open.length === 1) {
    // тупиковый лаз: от проёма до середины, торец круглый
    const a = open[0];
    const t = leadTube(a.x, a.y, a.nx, a.ny, hx, hy, true, 10);
    tubes.push(t);
    for (const d of closed) tubes.push(stubTube(d, hx, hy));
  } else if (open.length >= 3) {
    for (const d of open) tubes.push(leadTube(d.x, d.y, d.nx, d.ny, hx, hy, true, 10));
    for (const d of closed) tubes.push(stubTube(d, hx, hy));
  } else {
    // все проёмы глухие — пещерка у середины
    for (const d of closed) tubes.push(stubTube(d, hx, hy));
  }
  // лавка берлоги — у стены без проёмов (самой длинной)
  let bench: { x0: number; y0: number; x1: number; y1: number; h: number } | null = null;
  if (den && spec.bench) {
    const free = (['N', 'S', 'E', 'W'] as Side[]).filter((s) => !doors.some((d) => d.side === s));
    const side = free.sort((a, b) => (a === 'N' || a === 'S' ? x1 - x0 : y1 - y0) - (b === 'N' || b === 'S' ? x1 - x0 : y1 - y0)).pop();
    const dep = 0.45, len = 0.6;
    if (side === 'N') bench = { x0: cx - len, x1: cx + len, y0: y0, y1: y0 + 0.12 + dep, h: 0.38 };
    if (side === 'S') bench = { x0: cx - len, x1: cx + len, y0: y1 - 0.12 - dep, y1: y1, h: 0.38 };
    if (side === 'W') bench = { x0: x0, x1: x0 + 0.12 + dep, y0: cy - len, y1: cy + len, h: 0.38 };
    if (side === 'E') bench = { x0: x1 - 0.12 - dep, x1: x1, y0: cy - len, y1: cy + len, h: 0.38 };
  }
  // пробки завалов
  const plugs = doors.filter((d) => d.state === 'collapsed');
  const maxRise = Math.max(0, spec.rise);
  const minRise = Math.min(0, spec.rise);
  const zMin = minRise - 0.25;
  const zMax = (den ? DEN_H : SNOW_CRAWL_H) + maxRise + 0.2;
  const S = spec.seed;

  /** Расстояние до плоскости проёма d (вглубь куска) и внутри ли его пролёта. */
  const doorAt = (d: SnowDoor, x: number, y: number) => {
    const along = (x - d.x) * d.nx + (y - d.y) * d.ny;
    const lat = Math.abs((x - d.x) * -d.ny + (y - d.y) * d.nx);
    return { along, lat };
  };

  const base = (x: number, y: number, z: number): { f: number; h: number } => {
    let f = Infinity, hBest = z;
    for (const t of tubes) {
      const r = tubeDist(t, x, y, z);
      const g = crawlProfile(r.u, r.h);
      if (g < f) hBest = r.h;
      f = f === Infinity ? g : smin(f, g, 0.18);
    }
    if (den) {
      const dx = (x - den.cx) / den.rx, dy = (y - den.cy) / den.ry;
      const hz = Math.max(0, z - SNOW_C) / den.H;
      const r = Math.sqrt(dx * dx + dy * dy);
      const e = (Math.sqrt(dx * dx + dy * dy + hz * hz) - 1) * Math.min(den.rx, den.ry, den.H);
      const bowl = 0.12 * Math.min(1, r) ** 3;
      const g = Math.max(e, bowl - z);
      if (g < f) hBest = z;
      f = f === Infinity ? g : smin(f, g, 0.3);
    }
    if (bench) {
      // снежный уступ: твёрдое тело (вычитается из воздуха)
      const bx = Math.max(bench.x0 - x, x - bench.x1, 0), by = Math.max(bench.y0 - y, y - bench.y1, 0);
      const inside = Math.max(bench.x0 - x, x - bench.x1, bench.y0 - y, y - bench.y1);
      const bd = (inside < 0 ? inside : Math.hypot(bx, by));
      const solid = Math.max(bd, z - bench.h) - 0.04;
      f = Math.max(f, -solid);
    }
    return { f, h: hBest };
  };

  const f = (x: number, y: number, z: number, noise = true): number => {
    let { f: v, h } = base(x, y, z);
    // у проёмов — точная трубка устья
    let wNoise = 1;
    for (const d of doors) {
      const { along, lat } = doorAt(d, x, y);
      if (lat > d.half + 0.25 || along > CANON + 0.25) continue;
      const fade1 = Math.min(1, Math.max(0, (along - 0.12) / 0.33));
      wNoise = Math.min(wNoise, fade1);
      if (d.state !== 'closed' && along < CANON && lat < d.half) {
        const canon = crawlProfile(lat, z);
        const w = 1 - Math.max(0, along) / CANON;
        v = v * (1 - w) + canon * w;
      }
    }
    if (noise && wNoise > 0 && Math.abs(v) < 0.1) {
      // пол — ровнее (по нему ползут), своды и стены — бугристые и слоистые
      const fl = Math.min(1, Math.max(0.15, (h - 0.03) / 0.25));
      const n1 = vnoise(x * 2.2, y * 2.2, z * 2.6, S) * 0.055;
      const n2 = vnoise(x * 6.5, y * 6.5, z * 7, S + 7) * 0.018;
      const lay = Math.sin(z * 31 + vnoise(x * 1.3, y * 1.3, z, S + 13) * 3) * 0.006;
      v += (n1 + n2 + lay) * fl * wNoise;
    }
    // пробки завалов: снег в проёме (с бугром)
    for (const d of plugs) {
      const { along, lat } = doorAt(d, x, y);
      if (along > 1.1 || lat > d.half + 0.6) continue;
      const dug = Math.min(1, Math.max(0, d.dug ?? 0));
      const R = 0.72 * (1 - 0.5 * dug), zc = 0.35 - 0.18 * dug;
      const r = Math.hypot(along + 0.15, lat * 0.85, (z - zc) * 1.1) - R - vnoise(x * 4, y * 4, z * 4, S + 29) * 0.07;
      v = Math.max(v, -r);
    }
    // план комнаты (кроме пролётов проёмов) — снег
    let edge = Math.min(x - x0, x1 - x, y - y0, y1 - y);
    if (edge < 0.3) {
      edge = Infinity;
      const walls: [Side, number][] = [['W', x - x0], ['E', x1 - x], ['N', y - y0], ['S', y1 - y]];
      for (const [side, dist] of walls) {
        if (dist >= edge) continue;
        const inDoor = doors.some((d) => d.side === side && d.state !== 'closed' && doorAt(d, x, y).lat < d.half);
        if (!inDoor) edge = dist;
      }
      if (edge !== Infinity) v = Math.max(v, MARGIN - edge);
    }
    return v;
  };

  const floorAt = (x: number, y: number): number => {
    let best = Infinity, z = 0;
    for (const t of tubes) {
      const r = tubeDist(t, x, y, 0);
      if (r.u < best) {
        best = r.u;
        z = -r.h;
      }
    }
    if (den) {
      const dx = (x - den.cx) / den.rx, dy = (y - den.cy) / den.ry;
      if (dx * dx + dy * dy < 1) return 0;
    }
    return z;
  };

  return { f, floorAt, zMin, zMax };
}

// ───────────────────────── surface nets ─────────────────────────

/**
 * Сетка полости куска. Решётка — мировая, шаг step; по проёмам — на шаг за плоскость (вершины за ней прижимаются к
 * плоскости, грани целиком за ней отбрасываются). noise = false — гладкая (коллайдер). Нормали — градиент поля.
 */
export function buildSnowMesh(spec: SnowPieceSpec, step = SNOW_STEP, noise = true): SnowMeshData {
  const F = snowField(spec);
  // по сторонам с открытыми проёмами — до плоскости проёма (полузазор) и ещё шаг решётки за неё
  const pad = spec.pad ?? 0;
  const ext = { W: 0, E: 0, N: 0, S: 0 };
  const lim = { W: 0, E: 0, N: 0, S: 0 };
  for (const d of spec.doors) if (d.state !== 'closed') {
    ext[d.side] = pad + step;
    lim[d.side] = pad;
  }
  return surfaceNets(
    {
      f: F.f,
      x0: spec.x0 - ext.W,
      y0: spec.y0 - ext.N,
      x1: spec.x1 + ext.E,
      y1: spec.y1 + ext.S,
      z0: F.zMin,
      z1: F.zMax,
      cx0: spec.x0 - lim.W,
      cy0: spec.y0 - lim.N,
      cx1: spec.x1 + lim.E,
      cy1: spec.y1 + lim.S,
      floorY: spec.floorY,
      uvM: 0.6,
      // снег 0.85…0.95 (палитра набора), впадины темнее, свод светлее — «свечение сквозь снег»
      color(x, y, z, gx, gy, gz, at, out, o) {
        // затенение впадин: насколько глубоко в воздух уходит поле вдоль нормали
        const probe = -at(x + gx * 0.12, y + gy * 0.12, z + gz * 0.12);
        const ao = Math.min(1, Math.max(0.45, 0.45 + probe / 0.12 * 0.55));
        const up = Math.min(1, Math.max(0, (z - 0.15) / 0.8));
        const tone = 0.86 + 0.06 * vnoise(x * 1.7, y * 1.7, z * 1.7, spec.seed + 101);
        const c = tone * ao;
        out[o] = c * (0.96 + 0.04 * up);
        out[o + 1] = c * (0.97 + 0.03 * up);
        out[o + 2] = c;
        out[o + 3] = 1;
      },
    },
    step,
    noise,
  );
}

/** Полость для surfaceNets: поле, решётка, прямоугольник прижима у проёмов, цвет вершин. */
export interface NetsSpec {
  /** SDF (план, метры; z — над полом этажа): < 0 воздух; noise = false — без рельефа (грубый проход, коллайдер) */
  f(x: number, y: number, z: number, noise: boolean): number;
  /** габарит решётки, м: узлы — от floor(x0 / step) до ceil(x1 / step) (по высоте — z0…z1) */
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  z0: number;
  z1: number;
  /** прямоугольник плана: вершины за ним прижимаются к нему (плоскости проёмов), грани целиком за ним отбрасываются */
  cx0: number;
  cy0: number;
  cx1: number;
  cy1: number;
  /** Babylon Y = floorY + z */
  floorY: number;
  /** UV — проекция по главной оси нормали: метров на повтор */
  uvM: number;
  /** цвет вершины (x, y, z плана; нормаль к воздуху gx, gy, gz; at — поле по решётке) → out[o … o + 3] */
  color(x: number, y: number, z: number, gx: number, gy: number, gz: number, at: (x: number, y: number, z: number) => number, out: Float32Array, o: number): void;
  /** поправить нормаль вершины (к воздуху, план; n — по решётке, единичная) — например, у плоскости проёма взять её из
   *  точного профиля, одинакового у соседей; нет — нормаль по решётке */
  normal?(x: number, y: number, z: number, n: [number, number, number]): void;
}

/**
 * Surface nets по полю s.f на мировой решётке шага step (общее у снежных ходов и погреба): по вершине на ячейку со
 * сменой знака, по четырёхугольнику на ребро со сменой знака; вершины за прямоугольником прижима — на его край (у
 * соседей по проёму кольцо вершин на плоскости проёма совпадает, если поле у плоскости одинаково и не зависит от
 * расстояния до неё). Нормали — градиент поля по решётке.
 */
export function surfaceNets(s: NetsSpec, step: number, noise: boolean): SnowMeshData {
  const F = s;
  const gx0 = Math.floor(s.x0 / step + 1e-6), gx1 = Math.ceil(s.x1 / step - 1e-6);
  const gy0 = Math.floor(s.y0 / step + 1e-6), gy1 = Math.ceil(s.y1 / step - 1e-6);
  const gz0 = Math.floor(s.z0 / step), gz1 = Math.ceil(s.z1 / step);
  const nx = gx1 - gx0 + 1, ny = gy1 - gy0 + 1, nz = gz1 - gz0 + 1;
  const val = new Float32Array(nx * ny * nz);
  const I = (i: number, j: number, k: number) => (k * ny + j) * nx + i;
  // грубая решётка (шаг ×4, без рельефа): вдали от поверхности точное значение не нужно — берётся интерполяция
  const Q = 4;
  const qx = Math.ceil((nx - 1) / Q) + 1, qy = Math.ceil((ny - 1) / Q) + 1, qz = Math.ceil((nz - 1) / Q) + 1;
  const coarse = new Float32Array(qx * qy * qz);
  for (let k = 0; k < qz; k++) for (let j = 0; j < qy; j++) for (let i = 0; i < qx; i++) {
    coarse[(k * qy + j) * qx + i] = F.f((gx0 + i * Q) * step, (gy0 + j * Q) * step, (gz0 + k * Q) * step, false);
  }
  const FAR = 0.14;
  for (let k = 0; k < nz; k++) {
    const z = (gz0 + k) * step;
    const ck = Math.min(qz - 2, Math.floor(k / Q)), tz = k / Q - ck;
    for (let j = 0; j < ny; j++) {
      const y = (gy0 + j) * step;
      const cj = Math.min(qy - 2, Math.floor(j / Q)), ty = j / Q - cj;
      for (let i = 0; i < nx; i++) {
        const ci = Math.min(qx - 2, Math.floor(i / Q)), tx = i / Q - ci;
        const o = (ck * qy + cj) * qx + ci;
        const c00 = coarse[o] + (coarse[o + 1] - coarse[o]) * tx;
        const c10 = coarse[o + qx] + (coarse[o + qx + 1] - coarse[o + qx]) * tx;
        const c01 = coarse[o + qx * qy] + (coarse[o + qx * qy + 1] - coarse[o + qx * qy]) * tx;
        const c11 = coarse[o + qx * qy + qx] + (coarse[o + qx * qy + qx + 1] - coarse[o + qx * qy + qx]) * tx;
        const c = (c00 + (c10 - c00) * ty) * (1 - tz) + (c01 + (c11 - c01) * ty) * tz;
        val[I(i, j, k)] = Math.abs(c) > FAR ? c : F.f((gx0 + i) * step, y, z, noise);
      }
    }
  }
  /** поле по решётке (трилинейно), план и высота — метры */
  const at = (x: number, y: number, z: number): number => {
    const fx = Math.min(nx - 1.001, Math.max(0, x / step - gx0)), fy = Math.min(ny - 1.001, Math.max(0, y / step - gy0)), fz = Math.min(nz - 1.001, Math.max(0, z / step - gz0));
    const i = Math.floor(fx), j = Math.floor(fy), k = Math.floor(fz);
    const tx = fx - i, ty = fy - j, tz = fz - k;
    const o = I(i, j, k);
    const a = val[o] + (val[o + 1] - val[o]) * tx, b = val[o + nx] + (val[o + nx + 1] - val[o + nx]) * tx;
    const p = nx * ny;
    const c = val[o + p] + (val[o + p + 1] - val[o + p]) * tx, d = val[o + p + nx] + (val[o + p + nx + 1] - val[o + p + nx]) * tx;
    return (a + (b - a) * ty) * (1 - tz) + (c + (d - c) * ty) * tz;
  };
  // вершины: по одной на ячейку со сменой знака
  const cid = new Int32Array((nx - 1) * (ny - 1) * (nz - 1)).fill(-1);
  const C = (i: number, j: number, k: number) => (k * (ny - 1) + j) * (nx - 1) + i;
  const pos: number[] = [];
  const clampX = (x: number) => Math.min(s.cx1, Math.max(s.cx0, x));
  const clampY = (y: number) => Math.min(s.cy1, Math.max(s.cy0, y));
  const beyond: boolean[] = [];
  const EDGES: [number, number][] = [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]];
  const corner = new Float32Array(8);
  for (let k = 0; k + 1 < nz; k++) {
    for (let j = 0; j + 1 < ny; j++) {
      for (let i = 0; i + 1 < nx; i++) {
        let mask = 0;
        for (let c = 0; c < 8; c++) {
          const v = (corner[c] = val[I(i + (c & 1), j + ((c >> 1) & 1), k + ((c >> 2) & 1))]);
          if (v < 0) mask |= 1 << c;
        }
        if (mask === 0 || mask === 255) continue;
        let sx = 0, sy = 0, sz = 0, cnt = 0;
        for (const [a, b] of EDGES) {
          const va = corner[a], vb = corner[b];
          if (va < 0 === vb < 0) continue;
          const t = va / (va - vb);
          sx += (a & 1) + ((b & 1) - (a & 1)) * t;
          sy += ((a >> 1) & 1) + (((b >> 1) & 1) - ((a >> 1) & 1)) * t;
          sz += ((a >> 2) & 1) + (((b >> 2) & 1) - ((a >> 2) & 1)) * t;
          cnt++;
        }
        const x = (gx0 + i + sx / cnt) * step, y = (gy0 + j + sy / cnt) * step, z = (gz0 + k + sz / cnt) * step;
        const cx = clampX(x), cy = clampY(y);
        beyond.push(cx !== x || cy !== y);
        cid[C(i, j, k)] = pos.length / 3;
        pos.push(cx, cy, z);
      }
    }
  }
  // грани: по ребру со сменой знака — четырёхугольник из четырёх ячеек вокруг него (воздух — внутри: нормаль к воздуху)
  const idx: number[] = [];
  const quad = (a: number, b: number, c: number, d: number, flip: boolean) => {
    if (a < 0 || b < 0 || c < 0 || d < 0) return;
    if (beyond[a] && beyond[b] && beyond[c] && beyond[d]) return;
    if (flip) idx.push(a, c, b, a, d, c);
    else idx.push(a, b, c, a, c, d);
  };
  for (let k = 0; k < nz; k++) {
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        const v0 = val[I(i, j, k)] < 0;
        // ребро по x
        if (i + 1 < nx && j > 0 && k > 0 && j < ny - 1 && k < nz - 1) {
          const v1 = val[I(i + 1, j, k)] < 0;
          if (v0 !== v1) quad(cid[C(i, j - 1, k - 1)], cid[C(i, j, k - 1)], cid[C(i, j, k)], cid[C(i, j - 1, k)], v1);
        }
        // ребро по y
        if (j + 1 < ny && i > 0 && k > 0 && i < nx - 1 && k < nz - 1) {
          const v1 = val[I(i, j + 1, k)] < 0;
          if (v0 !== v1) quad(cid[C(i - 1, j, k - 1)], cid[C(i - 1, j, k)], cid[C(i, j, k)], cid[C(i, j, k - 1)], v1);
        }
        // ребро по z
        if (k + 1 < nz && i > 0 && j > 0 && i < nx - 1 && j < ny - 1) {
          const v1 = val[I(i, j, k + 1)] < 0;
          if (v0 !== v1) quad(cid[C(i - 1, j - 1, k)], cid[C(i, j - 1, k)], cid[C(i, j, k)], cid[C(i - 1, j, k)], v1);
        }
      }
    }
  }
  // нормали (к воздуху), цвета (s.color) и UV
  const n = pos.length / 3;
  const positions = new Float32Array(n * 3), normals = new Float32Array(n * 3), colors = new Float32Array(n * 4), uvs = new Float32Array(n * 2);
  // градиент — по решётке (у соседей по проёму значения на плоскости и за ней одинаковы — одинаковы и нормали шва)
  const e = step;
  const nn: [number, number, number] = [0, 0, 0];
  for (let v = 0; v < n; v++) {
    const x = pos[v * 3], y = pos[v * 3 + 1], z = pos[v * 3 + 2];
    let gx = at(x + e, y, z) - at(x - e, y, z);
    let gy = at(x, y + e, z) - at(x, y - e, z);
    let gz = at(x, y, z + e) - at(x, y, z - e);
    const gl = Math.hypot(gx, gy, gz) || 1;
    // к воздуху — против градиента (поле растёт в снег)
    gx = -gx / gl;
    gy = -gy / gl;
    gz = -gz / gl;
    if (s.normal) {
      nn[0] = gx;
      nn[1] = gy;
      nn[2] = gz;
      s.normal(x, y, z, nn);
      [gx, gy, gz] = nn;
    }
    // Babylon: X = x, Y = z (+ пол этажа), Z = −y
    positions[v * 3] = x;
    positions[v * 3 + 1] = z + s.floorY;
    positions[v * 3 + 2] = -y;
    normals[v * 3] = gx;
    normals[v * 3 + 1] = gz;
    normals[v * 3 + 2] = -gy;
    s.color(x, y, z, gx, gy, gz, at, colors, v * 4);
    // UV: проекция по главной оси нормали (рельеф шумный — швы проекции не видны), uvM м на повтор
    const ax = Math.abs(gx), ay = Math.abs(gy), az = Math.abs(gz);
    const k = 1 / s.uvM;
    if (az >= ax && az >= ay) {
      uvs[v * 2] = x * k;
      uvs[v * 2 + 1] = y * k;
    } else if (ax >= ay) {
      uvs[v * 2] = y * k;
      uvs[v * 2 + 1] = z * k;
    } else {
      uvs[v * 2] = x * k;
      uvs[v * 2 + 1] = z * k;
    }
  }
  return { positions, normals, colors, uvs, indices: Uint32Array.from(idx) };
}
