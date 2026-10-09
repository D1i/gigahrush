// Ядро генератора болванок: RunExport → BlockoutModel. Без зависимостей от приложения и движка.
//
// Идея: каждая клетка плана получает ровно ОДИН класс (пол комнаты / проём / стеновая масса / колонна /
// пусто). Объёмы строятся из классов, поэтому геометрия разных классов не может наложиться: стена
// между соседними комнатами — это одни и те же клетки зазора, а не две стены каждой комнаты.
// Тонкие перегородки (gap = 0) стоят на рёбрах между клетками разных комнат и живут по высоте между
// плитой пола и плитой потолка. Подробно — docs/BLOCKOUT.md.
import { DEFAULT_BLOCKOUT } from './types';
import { chooseHinge, doorStyleFor, leafHere, restAngle } from './doors';
import type {
  BlockoutModel,
  BlockoutOptions,
  DeadEnd,
  DeadEndMode,
  DoorRole,
  DoorSlot,
  Opening,
  PropBox,
  PropCoverKind,
  Rect,
  RoomInfo3D,
  RunConnector,
  RunExport,
  RunSegment,
  Side,
  Solid,
  SolidKind,
  Surface,
  WallFace,
} from './types';

// ───────────────────────── классы клеток ─────────────────────────

const EMPTY = 0;
/** пол экземпляра (own = индекс экземпляра) */
const FLOOR = 1;
/** проём связи в зазоре gap ≥ 1 (own = индекс связи) */
const PORTAL = 2;
/** проём тупика, прорезанный наружу (deadEnds = 'open'; own = индекс экземпляра) */
const CARVE = 3;
const WALL = 4;
const COLUMN = 5;

/** типы рёбер между клетками (только для перегородок gap = 0) */
const E_PART = 1;
const E_LINTEL = 2;

const EPS = 1e-6;
/** предел сетки плана (4000×4000 клеток = 400×400 м при 0.1 м); карта на 150 комнат ≈ 0.5 млн */
const MAX_GRID_CELLS = 16_000_000;

// ───────────────────────── геометрия отрезков (как в docs/GENERATOR.md §2) ─────────────────────────

const SIGMA: Record<Side, 1 | -1> = { N: -1, W: -1, S: 1, E: 1 };
const OPP: Record<Side, Side> = { N: 'S', S: 'N', E: 'W', W: 'E' };
/** отрезок идёт вдоль x (стороны N/S) */
const alongX = (s: Side): boolean => s === 'N' || s === 'S';
/** координата линии отрезка по нормали (по углам клеток) */
const lineOf = (g: RunSegment): number =>
  g.side === 'N' ? g.cy : g.side === 'S' ? g.cy + 1 : g.side === 'W' ? g.cx : g.cx + 1;
/** начало отрезка вдоль стены */
const startOf = (g: RunSegment): number => (alongX(g.side) ? g.cx : g.cy);

const r6 = (v: number): number => {
  const r = Math.round(v * 1e6) / 1e6;
  return r === 0 ? 0 : r;
};
const nowMs = (): number => (typeof performance !== 'undefined' ? performance.now() : Date.now());
const normDeg = (d: number): number => ((d % 360) + 360) % 360;

const SEG_RE = /^(-?\d+)(?:-(-?\d+))?$/;

/** Декодер сжатых рядов "y:x1-x2,x3" → плоский массив [x, y, x, y, …]. */
function decodeRows(rows: readonly string[], bad: (row: string) => void): number[] {
  const out: number[] = [];
  for (const row of rows) {
    const i = typeof row === 'string' ? row.indexOf(':') : -1;
    const y = i > 0 ? Number(row.slice(0, i)) : NaN;
    if (!Number.isInteger(y)) {
      bad(String(row));
      continue;
    }
    for (const raw of row.slice(i + 1).split(',')) {
      const part = raw.trim();
      if (!part) continue;
      const m = SEG_RE.exec(part);
      if (!m) {
        bad(row);
        continue;
      }
      const a = +m[1];
      const b = m[2] !== undefined ? +m[2] : a;
      for (let x = Math.min(a, b); x <= Math.max(a, b); x++) out.push(x, y);
    }
  }
  return out;
}

// ───────────────────────── слияние клеток в прямоугольники ─────────────────────────

interface CellRect {
  x: number;
  y: number;
  w: number;
  h: number;
  lab: number;
}

/** Жадное разбиение по рядам: максимальная ширина, затем рост вниз, пока ряд целиком совпадает.
 *  (Проход по столбцам пробовали — на реальных картах выигрыш < 1 %, не стоит двойной работы.) */
function greedyPass(label: Int32Array, W: number, H: number): CellRect[] {
  const used = new Uint8Array(W * H);
  const out: CellRect[] = [];
  for (let y = 0; y < H; y++) {
    const rowBase = y * W;
    for (let x = 0; x < W; x++) {
      const i = rowBase + x;
      const lab = label[i];
      if (lab === 0 || used[i]) continue;
      let w = 1;
      while (x + w < W && label[i + w] === lab && !used[i + w]) w++;
      let h = 1;
      grow: while (y + h < H) {
        const r = (y + h) * W + x;
        for (let k = 0; k < w; k++) if (label[r + k] !== lab || used[r + k]) break grow;
        h++;
      }
      for (let k = 0; k < h; k++) used.fill(1, (y + k) * W + x, (y + k) * W + x + w);
      out.push({ x, y, w, h, lab });
      x += w - 1;
    }
  }
  return out;
}

// ───────────────────────── настройки ─────────────────────────

const DEAD_MODES: DeadEndMode[] = ['wall', 'panel', 'open'];

function normOptions(o: BlockoutOptions, cellM: number, issues: string[]): BlockoutOptions {
  const num = (v: unknown, d: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : d);
  const D = DEFAULT_BLOCKOUT;
  const wallHeightM = Math.max(0.1, num(o.wallHeightM, D.wallHeightM));
  const doorHeightM = Math.max(0, num(o.doorHeightM, D.doorHeightM));
  let outerWallCells = Math.round(num(o.outerWallCells, D.outerWallCells));
  if (outerWallCells < 1) {
    issues.push(`outerWallCells = ${outerWallCells}: без обвязки пол открыт наружу — взята 1 клетка`);
    outerWallCells = 1;
  }
  let partitionM = num(o.partitionM, D.partitionM);
  const maxP = r6(cellM * 0.9);
  if (partitionM > maxP) {
    issues.push(`Перегородка ${partitionM} м толще клетки ${cellM} м — уменьшена до ${maxP} м`);
    partitionM = maxP;
  }
  if (partitionM < cellM * 0.01) partitionM = r6(cellM * 0.01);
  return {
    wallHeightM,
    doorHeightM,
    outerWallCells,
    partitionM,
    slabM: Math.max(0, num(o.slabM, D.slabM)),
    ceilings: o.ceilings !== false,
    props: o.props !== false,
    spotProps: o.spotProps !== false,
    deadEnds: DEAD_MODES.includes(o.deadEnds) ? o.deadEnds : D.deadEnds,
    ...(o.cutEnds && DEAD_MODES.includes(o.cutEnds) ? { cutEnds: o.cutEnds } : {}),
    fillVoids: o.fillVoids !== false,
    ...(o.ownership === true ? { ownership: true } : {}),
    ...(o.doors === true ? { doors: true } : {}),
  };
}

// ───────────────────────── построение ─────────────────────────

interface DeadSeg {
  ii: number;
  seg: RunSegment;
  source: 'connector' | 'door';
  /** режим этого тупика: deadEnds или (для срезанной связи, RunConnector.cut) cutEnds */
  mode: DeadEndMode;
}

/** Построить модель болванки по экспорту прогона. Не мутирует вход. */
export function buildBlockoutModel(run: RunExport, opts?: Partial<BlockoutOptions>): BlockoutModel {
  const tStart = nowMs();
  const issues: string[] = [];
  const c = typeof run.cellM === 'number' && run.cellM > 0 ? run.cellM : 0.1;
  if (c !== run.cellM) issues.push(`cellM не задан — взято ${c} м`);
  const o = normOptions({ ...DEFAULT_BLOCKOUT, ...(opts ?? {}) }, c, issues);
  const gap = Math.max(0, Math.round(Number(run.settings?.gap) || 0));
  const R = o.outerWallCells;
  const th = o.partitionM / 2;
  const wallH = o.wallHeightM;
  const doorH = Math.min(o.doorHeightM, wallH);
  /** есть ли перемычка над проёмами (дверь ниже потолка) */
  const lintels = o.doorHeightM < wallH - EPS;
  const slab = o.slabM;
  const zLo = -slab;
  const zHi = wallH + slab;
  const insts = run.instances ?? [];

  // 1. Экземпляры: клетки, индекс по id.
  const idx = new Map<string, number>();
  const cellLists: number[][] = [];
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  insts.forEach((inst, i) => {
    if (idx.has(inst.id)) issues.push(`Экземпляр ${inst.id} встречается дважды — у второго только незанятые клетки`);
    else idx.set(inst.id, i);
    const list = decodeRows(inst.cells ?? [], (row) => issues.push(`Экземпляр ${inst.id}: не разобрана строка клеток «${row}»`));
    cellLists.push(list);
    for (let k = 0; k < list.length; k += 2) {
      const x = list[k], y = list[k + 1];
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  });
  if (minX === Infinity) {
    issues.push('В прогоне нет ни одной клетки пола');
    return emptyModel(c, o, issues, nowMs() - tStart);
  }

  // Отделки: ссылки экземпляров проверяются по таблице finishes.
  const finishes = [...(run.finishes ?? [])];
  const finishIds = new Set(finishes.map((f) => f.id));
  const finishOf = insts.map((inst) => {
    const pick = (id: string | null | undefined, what: string): string | null => {
      if (id == null) return null;
      if (finishIds.has(id)) return id;
      issues.push(`Отделка «${id}» (${what} ${inst.id}) не найдена в finishes — без отделки`);
      return null;
    };
    return { wall: pick(inst.finish?.wall, 'стены'), floor: pick(inst.finish?.floor, 'пол') };
  });

  // Сетка с полями: обвязка R + запас под заливку снаружи.
  const M = R + 3;
  const gx0 = minX - M, gy0 = minY - M;
  const W = maxX - minX + 1 + 2 * M;
  const H = maxY - minY + 1 + 2 * M;
  const N = W * H;
  if (N > MAX_GRID_CELLS) {
    issues.push(`План ${W}×${H} клеток слишком велик (> ${MAX_GRID_CELLS}) — вероятно, испорченные координаты; модель не построена`);
    return emptyModel(c, o, issues, nowMs() - tStart);
  }
  const cls = new Uint8Array(N);
  const own = new Int32Array(N).fill(-1);
  const at = (x: number, y: number): number =>
    x < gx0 || y < gy0 || x >= gx0 + W || y >= gy0 + H ? -1 : (y - gy0) * W + (x - gx0);
  const instId = (i: number): string => insts[i]?.id ?? `#${i}`;

  // 2. FLOOR. Пересечение экземпляров — проблема входа, клетка остаётся за первым.
  const overlaps = new Map<string, number>();
  const ownMode = o.ownership === true;
  /** владение: кто ещё претендует на клетку пола (пересечения соседей в части складчатого прогона) */
  const claims = new Map<number, number[]>();
  cellLists.forEach((list, i) => {
    for (let k = 0; k < list.length; k += 2) {
      const g = at(list[k], list[k + 1]);
      if (cls[g] === FLOOR) {
        if (own[g] !== i) {
          const key = `${own[g]}|${i}`;
          overlaps.set(key, (overlaps.get(key) ?? 0) + 1);
          if (ownMode) {
            const cl = claims.get(g);
            if (cl) cl.push(i);
            else claims.set(g, [own[g], i]);
          }
        }
      } else {
        cls[g] = FLOOR;
        own[g] = i;
      }
    }
  });
  for (const [key, n] of overlaps) {
    const [a, b] = key.split('|').map(Number);
    issues.push(`Экземпляры ${instId(a)} и ${instId(b)} пересекаются (${n} кл.) — клетки отданы ${instId(a)}`);
  }

  // Рёбра для перегородок: vE — между (lx−1, ly) и (lx, ly), hE — между (lx, ly−1) и (lx, ly).
  const VW = W + 1;
  const vE = new Uint8Array(VW * H);
  const hE = new Uint8Array(W * (H + 1));

  // 3. PORTAL — проёмы связей.
  const connOf = (ii: number, id: string): RunConnector | undefined => (insts[ii].connectors ?? []).find((k) => k.id === id);
  const linked = new Set<string>();
  const failed = new Set<string>();
  const openings: Opening[] = [];
  const pending0: { op: Opening; vertical: boolean; line: number; t0: number; t1: number }[] = [];
  const links = run.links ?? [];
  // метки прихода переходов спец-локаций (их linkedTo указывает на локацию без метки) — тупики без жалоб
  const transit = new Set<string>();
  // из них — метки прихода (не исчезнувшие двери): всегда панель — у неё игрок выходит из локации и через неё
  // возвращается (FoldDriver.deadEndAt ищет её среди панелей), даже когда прочие тупики — стены
  const arrive = new Set<string>();
  links.forEach((L, li) => {
    // переход спец-локации на другой этаж (вниз — 'descent', выход лифта — 'lift') — не проём
    if (L.kind === 'descent' || L.kind === 'lift') {
      transit.add(`${L.b?.inst}/${L.b?.connector}`);
      arrive.add(`${L.b?.inst}/${L.b?.connector}`);
      return;
    }
    // «исчезнувшая» дверь бесконечного мира (пропущенный переход) — не проём: обе метки — тупики без жалоб; шов
    // бесконечного хода (wrap) — тоже: в модели целиком комнаты не соседи (проём открывают куски, сдвинув соседа)
    if (L.sealed || L.wrap) {
      transit.add(`${L.a?.inst}/${L.a?.connector}`);
      transit.add(`${L.b?.inst}/${L.b?.connector}`);
      return;
    }
    const nameA = `${L.a?.inst}/${L.a?.connector}`;
    const nameB = `${L.b?.inst}/${L.b?.connector}`;
    const fail = (why: string): void => {
      issues.push(`Метки ${nameA} и ${nameB} связаны, но ${why} — проём пропущен`);
      failed.add(nameA);
      failed.add(nameB);
    };
    const ia = idx.get(L.a?.inst);
    const ib = idx.get(L.b?.inst);
    if (ia === undefined || ib === undefined) return fail(`экземпляр ${ia === undefined ? L.a?.inst : L.b?.inst} не найден`);
    if (ia === ib) return fail('это один и тот же экземпляр');
    const ka = connOf(ia, L.a.connector);
    const kb = connOf(ib, L.b.connector);
    if (!ka || !kb) return fail(`метка ${!ka ? nameA : nameB} не найдена`);
    if (!(ka.len >= 1) || !(kb.len >= 1)) return fail('длина метки меньше клетки');
    if (kb.side !== OPP[ka.side]) return fail(`не стоят лицом к лицу (стороны ${ka.side} и ${kb.side})`);
    const sg = SIGMA[ka.side];
    const lineA = lineOf(ka);
    const d = (lineOf(kb) - lineA) * sg;
    if (d !== gap) {
      return fail(d < 0 ? 'не стоят лицом к лицу (смотрят друг другу в спину)' : `не стоят лицом к лицу: между ними ${d} кл. вместо зазора gap = ${gap}`);
    }
    const ax = alongX(ka.side);
    const sA = startOf(ka), sB = startOf(kb);
    const t0 = Math.max(sA, sB), t1 = Math.min(sA + ka.len, sB + kb.len);
    if (t1 <= t0) return fail('их пролёты не пересекаются');
    const cellAt = (t: number, n: number): number => (ax ? at(t, n) : at(n, t));
    // Владение: пол за проёмом мог достаться третьей комнате, пересекающейся с соседом (в части
    // складчатого прогона соседи между собой пересекаться могут) — клетка, на которую претендует
    // комната связи, отдаётся ей: у порога пол всегда той комнаты, куда ведёт проём.
    const reclaim: [number, number][] = [];
    const claimOf = (g: number, want: number[]): number => {
      const cl = ownMode ? claims.get(g) : undefined;
      return cl ? (want.find((x) => cl.includes(x)) ?? -1) : -1;
    };

    if (gap >= 1) {
      const n0 = sg > 0 ? lineA : lineA - gap;
      const cells: number[] = [];
      for (let t = t0; t < t1; t++) {
        for (let n = n0; n < n0 + gap; n++) {
          const g = cellAt(t, n);
          if (g < 0) return fail('проём вне плана');
          if (cls[g] === FLOOR) return fail(`проём проходит по полу ${instId(own[g])}`);
          cells.push(g);
        }
      }
      for (const g of cells) {
        for (const nb of [g - 1, g + 1, g - W, g + W]) {
          if (cls[nb] === FLOOR && own[nb] !== ia && own[nb] !== ib) {
            const to = claimOf(nb, [ia, ib]);
            if (to < 0) return fail(`проём касается пола третьей комнаты ${instId(own[nb])}`);
            reclaim.push([nb, to]);
          }
        }
      }
      for (const [g, to] of reclaim) own[g] = to;
      for (const g of cells) {
        if (cls[g] !== PORTAL) {
          cls[g] = PORTAL;
          own[g] = li;
        }
      }
      const rect: Rect = ax
        ? { x0: r6(t0 * c), y0: r6(n0 * c), x1: r6(t1 * c), y1: r6((n0 + gap) * c) }
        : { x0: r6(n0 * c), y0: r6(t0 * c), x1: r6((n0 + gap) * c), y1: r6(t1 * c) };
      openings.push({ a: { ...L.a }, b: { ...L.b }, rect, axis: ax ? 'y' : 'x', widthM: r6((t1 - t0) * c), heightM: r6(doorH) });
    } else {
      // gap = 0: проём — отверстие в перегородке на общем ребре клеток A и B.
      const inA = sg > 0 ? lineA - 1 : lineA;
      const inB = sg > 0 ? lineA : lineA - 1;
      const edges: number[] = [];
      for (let t = t0; t < t1; t++) {
        const ga = cellAt(t, inA), gb = cellAt(t, inB);
        const okA = ga >= 0 && cls[ga] === FLOOR && (own[ga] === ia || claimOf(ga, [ia]) >= 0);
        const okB = gb >= 0 && cls[gb] === FLOOR && (own[gb] === ib || claimOf(gb, [ib]) >= 0);
        if (!okA || !okB) return fail('общее ребро проёма не разделяет полы этих двух комнат');
        if (own[ga] !== ia) reclaim.push([ga, ia]);
        if (own[gb] !== ib) reclaim.push([gb, ib]);
        edges.push(ax ? (lineA - gy0) * W + (t - gx0) : (t - gy0) * VW + (lineA - gx0));
      }
      for (const [g, to] of reclaim) own[g] = to;
      for (const e of edges) (ax ? hE : vE)[e] = E_LINTEL;
      const op: Opening = { a: { ...L.a }, b: { ...L.b }, rect: { x0: 0, y0: 0, x1: 0, y1: 0 }, axis: ax ? 'y' : 'x', widthM: 0, heightM: r6(doorH) };
      openings.push(op);
      pending0.push({ op, vertical: !ax, line: lineA, t0, t1 });
    }
    linked.add(nameA);
    linked.add(nameB);
  });

  // 4. Тупики: несвязанные метки и двери, не совпадающие ни с одной меткой.
  const dead: DeadSeg[] = [];
  const overlapSeg = (a: RunSegment, b: RunSegment): boolean =>
    a.side === b.side && lineOf(a) === lineOf(b) && Math.max(startOf(a), startOf(b)) < Math.min(startOf(a) + a.len, startOf(b) + b.len);
  insts.forEach((inst, ii) => {
    if (idx.get(inst.id) !== ii) return;
    const ks = (inst.connectors ?? []).filter((k) => k.len >= 1);
    for (const k of ks) {
      const key = `${inst.id}/${k.id}`;
      if (linked.has(key)) continue;
      if (k.linkedTo && !failed.has(key) && !transit.has(key)) {
        issues.push(`Метка ${key} указывает связь с ${k.linkedTo.inst}/${k.linkedTo.connector}, но в links её нет — закрыта как тупик`);
      }
      // запертая дверь, что закрывается сама (общага: за ней не выросла комната), — закрытое полотно и при глухих тупиках
      const locked = !k.cut && !!o.doors && o.deadEnds !== 'open' && doorStyleFor(k.tag, inst.roomTags ?? [], true, key)?.selfClosing === true;
      dead.push({ ii, seg: k, source: 'connector', mode: k.exit || k.arrival || arrive.has(key) || locked ? 'panel' : k.cut && o.cutEnds ? o.cutEnds : o.deadEnds });
    }
    for (const d of inst.doors ?? []) {
      if (!(d.len >= 1) || ks.some((k) => overlapSeg(k, d))) continue;
      dead.push({ ii, seg: d, source: 'door', mode: o.deadEnds });
    }
  });

  // 4a. 'open' — прорезать тупики наружу сквозь обвязку (клетки перед меткой на глубину R).
  {
    for (const de of dead) {
      if (de.mode !== 'open') continue;
      const { seg, ii } = de;
      const sg = SIGMA[seg.side], line = lineOf(seg), s = startOf(seg), ax = alongX(seg.side);
      const cellAt = (t: number, n: number): number => (ax ? at(t, n) : at(n, t));
      for (let t = s; t < s + seg.len; t++) {
        const inside = cellAt(t, sg > 0 ? line - 1 : line);
        if (inside < 0 || cls[inside] !== FLOOR || own[inside] !== ii) continue;
        for (let k = 1; k <= R; k++) {
          const g = cellAt(t, sg > 0 ? line + k - 1 : line - k);
          if (g < 0 || (cls[g] !== EMPTY && cls[g] !== CARVE)) break;
          let blocked = false;
          for (const nb of [g - 1, g + 1, g - W, g + W]) {
            if ((cls[nb] === FLOOR && own[nb] !== ii) || cls[nb] === PORTAL) blocked = true;
          }
          if (blocked) break;
          cls[g] = CARVE;
          own[g] = ii;
        }
      }
    }
  }

  // 5. Замкнутые пустоты до обвязки: дыра внутри одной комнаты — колонна, между разными — стена.
  if (o.fillVoids) {
    const reach = floodOutside(cls, W, H);
    const stack: number[] = [];
    for (let g = 0; g < N; g++) {
      if (cls[g] !== EMPTY || reach[g]) continue;
      const comp: number[] = [];
      const owners = new Set<number>();
      let mixed = false;
      reach[g] = 2;
      stack.push(g);
      while (stack.length) {
        const p = stack.pop()!;
        comp.push(p);
        for (const nb of [p - 1, p + 1, p - W, p + W]) {
          const k = cls[nb];
          if (k === EMPTY) {
            if (!reach[nb]) {
              reach[nb] = 2;
              stack.push(nb);
            }
          } else if (k === FLOOR) owners.add(own[nb]);
          else mixed = true;
        }
      }
      const kind = !mixed && owners.size === 1 ? COLUMN : WALL;
      for (const p of comp) cls[p] = kind;
    }
  }

  // 6. Обвязка: пустые клетки в пределах R (Чебышёв) от пола и проёмов связей — стеновая масса.
  {
    const rowNear = new Uint8Array(N);
    for (let y = 0; y < H; y++) {
      const b = y * W;
      let last = -1e9;
      for (let x = 0; x < W; x++) {
        const k = cls[b + x];
        if (k === FLOOR || k === PORTAL) last = x;
        if (x - last <= R) rowNear[b + x] = 1;
      }
      let next = 1e9;
      for (let x = W - 1; x >= 0; x--) {
        const k = cls[b + x];
        if (k === FLOOR || k === PORTAL) next = x;
        if (next - x <= R) rowNear[b + x] = 1;
      }
    }
    // вертикальный проход по рядам (а не по столбцам) — последовательный доступ к памяти
    const lastRow = new Int32Array(W).fill(-1e9);
    for (let y = 0; y < H; y++) {
      const b = y * W;
      for (let x = 0; x < W; x++) {
        if (rowNear[b + x]) lastRow[x] = y;
        if (y - lastRow[x] <= R && cls[b + x] === EMPTY) cls[b + x] = WALL;
      }
    }
    const nextRow = new Int32Array(W).fill(1e9);
    for (let y = H - 1; y >= 0; y--) {
      const b = y * W;
      for (let x = 0; x < W; x++) {
        if (rowNear[b + x]) nextRow[x] = y;
        if (nextRow[x] - y <= R && cls[b + x] === EMPTY) cls[b + x] = WALL;
      }
    }
  }

  // 7. Щели между стенами (узкие пустые просветы) и замкнутые после обвязки пустоты — тоже масса.
  if (o.fillVoids) {
    const slit = Math.max(gap, R);
    // ряды: пустой отрезок длиной ≤ slit между непустыми клетками (не проёмом тупика наружу)
    for (let y = 0; y < H; y++) {
      const b = y * W;
      let x = 0;
      while (x < W) {
        if (cls[b + x] !== EMPTY) {
          x++;
          continue;
        }
        let j = x;
        while (j < W && cls[b + j] === EMPTY) j++;
        if (x > 0 && j < W && j - x <= slit && cls[b + x - 1] !== CARVE && cls[b + j] !== CARVE) cls.fill(WALL, b + x, b + j);
        x = j;
      }
    }
    // столбцы: длина текущего пустого отрезка по каждому столбцу, проход по рядам
    const runLen = new Int32Array(W);
    for (let y = 1; y < H; y++) {
      const b = y * W;
      for (let x = 0; x < W; x++) {
        const k = cls[b + x];
        if (k === EMPTY) {
          runLen[x]++;
          continue;
        }
        const n = runLen[x];
        runLen[x] = 0;
        if (n === 0 || n > slit || n >= y || k === CARVE) continue;
        const top = cls[b - (n + 1) * W + x];
        if (top === EMPTY || top === CARVE) continue;
        for (let k2 = 1; k2 <= n; k2++) cls[b - k2 * W + x] = WALL;
      }
    }
    const reach = floodOutside(cls, W, H);
    for (let g = 0; g < N; g++) if (cls[g] === EMPTY && !reach[g]) cls[g] = WALL;
  }

  // 7a. Владение: владелец каждой полуклетки — ближайший пол (Воронов, Чебышёв, ничья — меньший индекс).
  // Считается по клеткам экземпляров из входа (а не по классам), поэтому граница между двумя комнатами
  // зависит только от них двоих — в частях складчатого прогона с разным составом она одна и та же.
  // Шаг сетки владения: полуклетка (gap ≥ 1 — зазор делится пополам точно), при gap = 0 — четверть
  // клетки: во внутреннем углу, где полы двух комнат примыкают к одной клетке массы, каждой достаётся
  // своя четверть (облицовка у перегородки отступает на t/2 > четверти клетки).
  const SUB = gap === 0 ? 4 : 2;
  const hOwn = ownMode ? voronoiHalf(cellLists, W, H, gx0, gy0, SUB) : null;
  const W2 = SUB * W;
  /** владелец подклетки (hx, hy) в координатах сетки ×SUB */
  const ownerHalf = (hx: number, hy: number): number => (hOwn ? hOwn[hy * W2 + hx] : -1);
  /** владелец твёрдого над клеткой пола g (перегородки, четверти узлов) — комната этого пола */
  const ownerCell = (g: number, hx: number, hy: number): number => (cls[g] === FLOOR ? own[g] : ownerHalf(hx, hy));

  // 8. Перегородки gap = 0: рёбра между полами разных экземпляров (кроме уже отмеченных проёмов).
  let partitionEdges = 0;
  for (let ly = 0; ly < H; ly++) {
    for (let lx = 1; lx < W; lx++) {
      const g = ly * W + lx;
      if (cls[g] === FLOOR && cls[g - 1] === FLOOR && own[g] !== own[g - 1]) {
        const e = ly * VW + lx;
        if (!vE[e]) vE[e] = E_PART;
        partitionEdges++;
      }
    }
  }
  for (let ly = 1; ly < H; ly++) {
    for (let lx = 0; lx < W; lx++) {
      const g = ly * W + lx;
      if (cls[g] === FLOOR && cls[g - W] === FLOOR && own[g] !== own[g - W]) {
        const e = ly * W + lx;
        if (!hE[e]) hE[e] = E_PART;
        partitionEdges++;
      }
    }
  }

  const solids: Solid[] = [];
  const edgeSolid = (type: number, x0: number, y0: number, x1: number, y1: number, owner = -1): void => {
    if (type === E_LINTEL && !lintels) return;
    const rect = { x0: r6(Math.min(x0, x1)), y0: r6(Math.min(y0, y1)), x1: r6(Math.max(x0, x1)), y1: r6(Math.max(y0, y1)) };
    if (rect.x1 - rect.x0 <= EPS || rect.y1 - rect.y0 <= EPS) return;
    const inst = owner >= 0 ? { inst: instId(owner) } : {};
    if (type === E_PART) solids.push({ kind: 'partition', rect, z0: 0, z1: r6(wallH), ...inst });
    else solids.push({ kind: 'lintel', rect, z0: r6(doorH), z1: r6(wallH), ...inst });
  };
  /** перегородка/перемычка по ребру при владении — две половины толщины, каждая своей комнате */
  const edgeRun = (type: number, vertical: boolean, at: number, s: number, e: number, oA: number, oB: number): void => {
    if (!ownMode) {
      if (vertical) edgeSolid(type, at - th, s, at + th, e);
      else edgeSolid(type, s, at - th, e, at + th);
      return;
    }
    if (vertical) {
      edgeSolid(type, at - th, s, at, e, oA);
      edgeSolid(type, at, s, at + th, e, oB);
    } else {
      edgeSolid(type, s, at - th, e, at, oA);
      edgeSolid(type, s, at, e, at + th, oB);
    }
  };

  /** занятые четверти квадрата t×t каждого узла (2 бита на четверть: TL, TR, BL, BR; 1 — перегородка, 2 — перемычка) */
  let quad: Uint8Array | null = null;
  if (partitionEdges > 0 || pending0.length > 0) {
    // Флаги «ребро доходит до узла» (занимает свою половину квадрата t×t узла); 0 — обрезано на t/2.
    const vS = new Uint8Array(vE.length).fill(1);
    const vEnd = new Uint8Array(vE.length).fill(1);
    const hS = new Uint8Array(hE.length).fill(1);
    const hEnd = new Uint8Array(hE.length).fill(1);
    const extra: [number, number, number, number, number, number][] = [];
    const q4 = (quad = new Uint8Array(VW * (H + 1)));
    const score = (ty: number): number => (ty === E_PART ? 1 : 0);
    /** индекс четверти: xs, ys — сторона от узла (−1 слева/сверху, +1 справа/снизу) */
    const qi = (xs: number, ys: number): number => (ys < 0 ? 0 : 2) + (xs < 0 ? 0 : 1);
    for (let VY = 1; VY < H; VY++) {
      for (let VX = 1; VX < W; VX++) {
        const eu = (VY - 1) * VW + VX, ed = VY * VW + VX;
        const el = VY * W + VX - 1, er = VY * W + VX;
        const u = vE[eu], d = vE[ed], l = hE[el], r = hE[er];
        if (!(u || d || l || r)) continue;
        const vi = VY * VW + VX;
        if ((u || d) && (l || r)) {
          const X = (VX + gx0) * c, Y = (VY + gy0) * c;
          const shrinkV = (): void => {
            if (u) vEnd[eu] = 0;
            if (d) vS[ed] = 0;
          };
          const shrinkH = (): void => {
            if (l) hEnd[el] = 0;
            if (r) hS[er] = 0;
          };
          /** отдельный бокс на смежные четверти квадрата узла */
          const box = (ty: number, qs: number[]): void => {
            let x0 = X, x1 = X, y0 = Y, y1 = Y;
            for (const q of qs) {
              q4[vi] |= ty << (2 * q);
              if (q & 1) x1 = X + th;
              else x0 = X - th;
              if (q & 2) y1 = Y + th;
              else y0 = Y - th;
              // владение: каждая четверть — комнате клетки под ней
              if (ownMode) {
                const cx = q & 1 ? VX : VX - 1, cy = q & 2 ? VY : VY - 1;
                const ow = ownerCell(cy * W + cx, SUB * cx + (q & 1 ? 0 : SUB - 1), SUB * cy + (q & 2 ? 0 : SUB - 1));
                extra.push([ty, q & 1 ? X : X - th, q & 2 ? Y : Y - th, q & 1 ? X + th : X, q & 2 ? Y + th : Y, ow]);
              }
            }
            if (!ownMode) extra.push([ty, x0, y0, x1, y1, -1]);
          };
          const thrV = !!(u && d), thrH = !!(l && r);
          if (thrV && thrH) {
            // Х-узел: насквозь проходит ось с бо́льшим числом сплошных перегородок (при равенстве — вертикаль).
            if (score(l) + score(r) > score(u) + score(d)) shrinkV();
            else shrinkH();
          } else if (thrV) {
            // Т-узел: насквозь проходит прямая ось, ответвление обрезано на t/2.
            const stub = l || r;
            if (score(u) + score(d) === 0 && score(stub) === 1) {
              // прямая — две перемычки проёмов, ответвление сплошное: ответвление доходит до оси,
              // перемычки обрезаны и добираются половиной квадрата с другой стороны
              shrinkV();
              box(E_LINTEL, r ? [0, 2] : [1, 3]);
            } else shrinkH();
          } else if (thrH) {
            const stub = u || d;
            if (score(l) + score(r) === 0 && score(stub) === 1) {
              shrinkH();
              box(E_LINTEL, d ? [0, 1] : [2, 3]);
            } else shrinkV();
          } else {
            // Угол (L): одно ребро доходит до узла, второе обрезано и добирает свою четверть квадрата.
            // Внешняя четверть угла (если там пол) тоже закрывается — комната видит ровный угол, без выреза t/2.
            const vt = u || d, ht = l || r;
            const sy = u ? -1 : 1, sx = r ? 1 : -1;
            const vClaims = score(ht) <= score(vt);
            const claimT = vClaims ? vt : ht, shrunkT = vClaims ? ht : vt;
            if (vClaims) shrinkH();
            else shrinkV();
            const need = vClaims ? qi(sx, -sy) : qi(-sx, sy);
            const outer = qi(-sx, -sy);
            const ox = -sx < 0 ? VX - 1 : VX, oy = -sy < 0 ? VY - 1 : VY;
            const outerFloor = cls[oy * W + ox] === FLOOR;
            if (outerFloor && claimT === shrunkT) box(shrunkT, [need, outer]);
            else {
              box(shrunkT, [need]);
              if (outerFloor) box(claimT, [outer]);
            }
          }
        }
        // рёбра, дошедшие до узла, занимают две свои четверти
        if (u && vEnd[eu]) q4[vi] |= u | (u << 2);
        if (d && vS[ed]) q4[vi] |= (d << 4) | (d << 6);
        if (l && hEnd[el]) q4[vi] |= l | (l << 4);
        if (r && hS[er]) q4[vi] |= (r << 2) | (r << 6);
      }
    }

    // Слияние коллинеарных рёбер в длинные перегородки.
    for (let lx = 0; lx <= W; lx++) {
      const X = (lx + gx0) * c;
      let rt = 0, rs = 0, re = 0, prevEnd = false, rA = -1, rB = -1;
      for (let ly = 0; ly <= H; ly++) {
        const e = ly < H ? ly * VW + lx : -1;
        const ty = e >= 0 ? vE[e] : 0;
        // владение: половины перегородки — комнатам слева и справа от ребра (смена комнаты рвёт отрезок)
        const oA = ownMode && ty ? own[ly * W + lx - 1] : -1, oB = ownMode && ty ? own[ly * W + lx] : -1;
        if (rt && (ty !== rt || !vS[e] || !prevEnd || oA !== rA || oB !== rB)) {
          edgeRun(rt, true, X, rs, re, rA, rB);
          rt = 0;
        }
        if (ty) {
          const y0 = (ly + gy0) * c, y1 = (ly + 1 + gy0) * c;
          if (!rt) {
            rt = ty;
            rA = oA;
            rB = oB;
            rs = vS[e] ? y0 : y0 + th;
          }
          re = vEnd[e] ? y1 : y1 - th;
          prevEnd = vEnd[e] === 1;
        }
      }
    }
    for (let ly = 0; ly <= H; ly++) {
      const Y = (ly + gy0) * c;
      let rt = 0, rs = 0, re = 0, prevEnd = false, rA = -1, rB = -1;
      for (let lx = 0; lx <= W; lx++) {
        const e = lx < W ? ly * W + lx : -1;
        const ty = e >= 0 ? hE[e] : 0;
        const oA = ownMode && ty ? own[(ly - 1) * W + lx] : -1, oB = ownMode && ty ? own[ly * W + lx] : -1;
        if (rt && (ty !== rt || !hS[e] || !prevEnd || oA !== rA || oB !== rB)) {
          edgeRun(rt, false, Y, rs, re, rA, rB);
          rt = 0;
        }
        if (ty) {
          const x0 = (lx + gx0) * c, x1 = (lx + 1 + gx0) * c;
          if (!rt) {
            rt = ty;
            rA = oA;
            rB = oB;
            rs = hS[e] ? x0 : x0 + th;
          }
          re = hEnd[e] ? x1 : x1 - th;
          prevEnd = hEnd[e] === 1;
        }
      }
    }
    for (const [ty, x0, y0, x1, y1, ow] of extra) edgeSolid(ty, x0, y0, x1, y1, ow);

    // Проёмы gap = 0: прямоугольник в свету (с учётом обрезки у узлов).
    for (const p of pending0) {
      if (p.vertical) {
        const lx = p.line - gx0;
        const e0 = (p.t0 - gy0) * VW + lx, e1 = (p.t1 - 1 - gy0) * VW + lx;
        const s = p.t0 * c + (vS[e0] ? 0 : th), en = p.t1 * c - (vEnd[e1] ? 0 : th);
        p.op.rect = { x0: r6(p.line * c - th), y0: r6(s), x1: r6(p.line * c + th), y1: r6(en) };
        p.op.widthM = r6(en - s);
      } else {
        const ly = p.line - gy0;
        const e0 = ly * W + (p.t0 - gx0), e1 = ly * W + (p.t1 - 1 - gx0);
        const s = p.t0 * c + (hS[e0] ? 0 : th), en = p.t1 * c - (hEnd[e1] ? 0 : th);
        p.op.rect = { x0: r6(s), y0: r6(p.line * c - th), x1: r6(en), y1: r6(p.line * c + th) };
        p.op.widthM = r6(en - s);
      }
    }
  }

  // 9. Слияние классов в прямоугольники.
  const toRect = (r: CellRect): Rect => ({
    x0: r6((r.x + gx0) * c),
    y0: r6((r.y + gy0) * c),
    x1: r6((r.x + r.w + gx0) * c),
    y1: r6((r.y + r.h + gy0) * c),
  });
  const lab = new Int32Array(N);
  let wallCells = 0, floorCells = 0;
  for (let g = 0; g < N; g++) {
    const k = cls[g];
    lab[g] = k === WALL ? 1 : k === COLUMN ? 2 : 0;
    if (lab[g]) wallCells++;
  }
  let massSolids: Solid[];
  /** владение: прямоугольники проёмов (пол, перемычка) по половинам — владелец каждой */
  let portalOwned: { rect: Rect; owner: number }[] | null = null;
  if (hOwn) {
    // Владение: масса и проёмы режутся по полуклеткам между ближайшими полами (сетка ×2).
    const H2 = SUB * H;
    const lab2 = new Int32Array(W2 * H2);
    const toRect2 = (r: CellRect): Rect => ({
      x0: r6((r.x / SUB + gx0) * c),
      y0: r6((r.y / SUB + gy0) * c),
      x1: r6(((r.x + r.w) / SUB + gx0) * c),
      y1: r6(((r.y + r.h) / SUB + gy0) * c),
    });
    const fill2 = (pick: (k: number) => number): void => {
      for (let hy = 0; hy < H2; hy++) {
        const rowC = Math.floor(hy / SUB) * W, rowH = hy * W2;
        for (let hx = 0; hx < W2; hx++) {
          const k = pick(cls[rowC + Math.floor(hx / SUB)]);
          lab2[rowH + hx] = k ? hOwn[rowH + hx] * 4 + k : 0;
        }
      }
    };
    fill2((k) => (k === WALL ? 1 : k === COLUMN ? 2 : 0));
    massSolids = greedyPass(lab2, W2, H2).map((r) => ({
      kind: ((r.lab & 3) === 2 ? 'column' : 'wall') as SolidKind,
      rect: toRect2(r),
      z0: r6(zLo),
      z1: r6(zHi),
      inst: instId(r.lab >> 2),
    }));
    fill2((k) => (k === PORTAL || k === CARVE ? 1 : 0));
    portalOwned = greedyPass(lab2, W2, H2).map((r) => ({ rect: toRect2(r), owner: r.lab >> 2 }));
  } else {
    massSolids = greedyPass(lab, W, H).map((r) => ({
      kind: (r.lab === 2 ? 'column' : 'wall') as SolidKind,
      rect: toRect(r),
      z0: r6(zLo),
      z1: r6(zHi),
    }));
  }

  for (let g = 0; g < N; g++) {
    lab[g] = cls[g] === FLOOR ? own[g] + 1 : 0;
    if (lab[g]) floorCells++;
  }
  const floorBy = new Map<number, Rect[]>();
  for (const r of greedyPass(lab, W, H)) {
    const list = floorBy.get(r.lab - 1) ?? [];
    list.push(toRect(r));
    floorBy.set(r.lab - 1, list);
  }

  let portalRects: Rect[];
  let lintelSolids: Solid[];
  if (portalOwned) {
    portalRects = portalOwned.map((p) => p.rect);
    lintelSolids = lintels ? portalOwned.map((p) => ({ kind: 'lintel' as const, rect: { ...p.rect }, z0: r6(doorH), z1: r6(zHi), inst: instId(p.owner) })) : [];
  } else {
    for (let g = 0; g < N; g++) lab[g] = cls[g] === PORTAL || cls[g] === CARVE ? 1 : 0;
    portalRects = greedyPass(lab, W, H).map(toRect);
    lintelSolids = lintels ? portalRects.map((rect) => ({ kind: 'lintel' as const, rect, z0: r6(doorH), z1: r6(zHi) })) : [];
  }
  const allSolids = [...massSolids, ...lintelSolids, ...solids];

  const floors: Surface[] = [];
  const ceilings: Surface[] = [];
  insts.forEach((inst, i) => {
    const rects = floorBy.get(i);
    if (!rects?.length) return;
    floors.push({ inst: inst.id, rects, finish: finishOf[i].floor, z: 0 });
    if (o.ceilings) ceilings.push({ inst: inst.id, rects: rects.map((r) => ({ ...r })), finish: null, z: r6(wallH) });
  });
  if (portalOwned) {
    // владение: пол (и потолок без перемычек) проёмов — по половинам, у каждой половины свой владелец
    const by = new Map<number, Rect[]>();
    for (const p of portalOwned) {
      const a = by.get(p.owner);
      if (a) a.push({ ...p.rect });
      else by.set(p.owner, [{ ...p.rect }]);
    }
    for (const [ow, rects] of [...by].sort((a, b) => a[0] - b[0])) {
      floors.push({ inst: null, owner: instId(ow), rects, finish: null, z: 0 });
      if (o.ceilings && !lintels) ceilings.push({ inst: null, owner: instId(ow), rects: rects.map((r) => ({ ...r })), finish: null, z: r6(wallH) });
    }
  } else if (portalRects.length) {
    floors.push({ inst: null, rects: portalRects, finish: null, z: 0 });
    // дверь не ниже потолка — перемычки нет, проём закрывается сверху плитой потолка
    if (o.ceilings && !lintels) ceilings.push({ inst: null, rects: portalRects.map((r) => ({ ...r })), finish: null, z: r6(wallH) });
  }

  // 9a. Облицовка: видимые из комнат грани твёрдых объёмов на высоте пола.
  const faces: WallFace[] = [];
  {
    const runs = faceRuns({ W, H, cls, own, vE, hE, quad, lintels });
    const codeM = (code: number, g0: number): number => {
      const n = Math.floor(code / 3), k = code - 3 * n;
      return k === 0 ? r6((n + g0) * c) : k === 1 ? r6((n + g0) * c + th) : r6((n + 1 + g0) * c - th);
    };
    const byInst: WallFace[][] = insts.map(() => []);
    for (let k = 0; k < runs.length; k += 7) {
      const ii = runs[k], horiz = runs[k + 1], ln = runs[k + 2], s0 = runs[k + 3], e0 = runs[k + 4], pos = runs[k + 5], part = runs[k + 6];
      let line: [number, number, number, number];
      let normal: [number, number];
      // линия идёт слева направо, если смотреть на стену из комнаты
      if (horiz) {
        const y = codeM(ln, gy0), xa = codeM(s0, gx0), xb = codeM(e0, gx0);
        normal = pos ? [0, 1] : [0, -1];
        line = pos ? [xa, y, xb, y] : [xb, y, xa, y];
      } else {
        const x = codeM(ln, gx0), ya = codeM(s0, gy0), yb = codeM(e0, gy0);
        normal = pos ? [1, 0] : [-1, 0];
        line = pos ? [x, yb, x, ya] : [x, ya, x, yb];
      }
      byInst[ii].push({
        inst: insts[ii].id,
        line,
        normal,
        z0: part ? r6(doorH) : 0,
        z1: r6(wallH),
        part: part ? 'lintel' : 'wall',
        finish: finishOf[ii].wall,
      });
    }
    for (const list of byInst) faces.push(...list);
  }

  // 10. Тупики (панели).
  const deadEnds: DeadEnd[] = [];
  {
    for (const de of dead) {
      if (de.mode !== 'panel') continue;
      const { seg, ii } = de;
      const sg = SIGMA[seg.side], line = lineOf(seg), s = startOf(seg), ax = alongX(seg.side);
      // за меткой сразу чужой пол (gap = 0) — грань перегородки ближе на t/2
      let facesFloor = false;
      for (let t = s; t < s + seg.len; t++) {
        const g = ax ? at(t, sg > 0 ? line : line - 1) : at(sg > 0 ? line : line - 1, t);
        if (g >= 0 && cls[g] === FLOOR && own[g] !== ii) facesFloor = true;
      }
      const pos = line * c - sg * (facesFloor ? th : 0);
      const a = s * c, b = (s + seg.len) * c;
      deadEnds.push({
        inst: insts[ii].id,
        connector: seg.id,
        line: ax ? [r6(a), r6(pos), r6(b), r6(pos)] : [r6(pos), r6(a), r6(pos), r6(b)],
        normal: ax ? [0, -sg] : [-sg, 0],
        widthM: r6(seg.len * c),
        heightM: r6(doorH),
        source: de.source,
      });
    }
  }

  // 10a. Двери (BlockoutOptions.doors, src/blockout/doors.ts): слот у каждой метки, где есть дверь. Геометрия — как у
  // тупика (грань стены со стороны комнаты) и зависит только от самой комнаты: у закрытого выхода и у того же выхода,
  // открытого (связанного), слот один и тот же — меняется только роль и угол (бесшовное открытие, docs/DOORS.md §4).
  let doorSlots: DoorSlot[] | undefined;
  if (o.doors) {
    const out: DoorSlot[] = (doorSlots = []);
    const deadMode = new Map<string, DeadEndMode>();
    for (const de of dead) if (de.source === 'connector') deadMode.set(`${de.ii}|${(de.seg as RunConnector).id}`, de.mode);
    const MAX_SPACE = 15;
    insts.forEach((inst, ii) => {
      if (idx.get(inst.id) !== ii) return;
      const ks = (inst.connectors ?? []).filter((k) => k.len >= 1);
      let mine: Set<string> | null = null;
      const isMine = (x: number, y: number): boolean => {
        if (!mine) {
          mine = new Set();
          const list = cellLists[ii];
          for (let q = 0; q < list.length; q += 2) mine.add(list[q] + ',' + list[q + 1]);
        }
        return mine.has(x + ',' + y);
      };
      for (const k of ks) {
        const key = `${inst.id}/${k.id}`;
        let role: DoorRole;
        if (linked.has(key)) role = k.opened ? 'opened' : 'open';
        else {
          const mode = deadMode.get(`${ii}|${k.id}`);
          if (!mode || mode === 'wall') continue;
          // связь, срезанная подпрогоном (дверь в другой слой, за край набора), — панель отладочных видов, не дверь
          if (mode === 'panel' && k.cut) continue;
          role = mode === 'open' ? 'open' : k.exit ? 'exit' : k.arrival || arrive.has(key) ? 'arrival' : 'dead';
        }
        // открытый игроком выход — та же дверь, что была закрытой (не сквозная решётка вместо железной)
        const style = doorStyleFor(k.tag, inst.roomTags ?? [], role !== 'open', key);
        if (!style) continue;
        const sg = SIGMA[k.side], line = lineOf(k), s0 = startOf(k), ax = alongX(k.side);
        // грань стены — как у тупика (за меткой сразу чужой пол, gap = 0 — грань перегородки ближе на t/2)
        let facesFloor = false;
        for (let t = s0; t < s0 + k.len; t++) {
          const g = ax ? at(t, sg > 0 ? line : line - 1) : at(sg > 0 ? line : line - 1, t);
          if (g >= 0 && cls[g] === FLOOR && own[g] !== ii) facesFloor = true;
        }
        const pos = line * c - sg * (facesFloor ? th : 0);
        const a = s0 * c, b = (s0 + k.len) * c;
        const normal: [number, number] = ax ? [0, -sg] : [-sg, 0];
        // стена вдоль проёма до угла (или до другой метки) — по клеткам самой комнаты
        const nIn = sg > 0 ? line - 1 : line, nOut = sg > 0 ? line : line - 1;
        const cellXY = (t: number, n: number): [number, number] => (ax ? [t, n] : [n, t]);
        const other = ks.filter((q) => q !== k && q.side === k.side && lineOf(q) === line);
        const wallAt = (t: number): boolean => {
          if (other.some((q) => t >= startOf(q) && t < startOf(q) + q.len)) return false;
          return isMine(...cellXY(t, nIn)) && !isMine(...cellXY(t, nOut));
        };
        let before = 0, after = 0;
        while (before < MAX_SPACE && wallAt(s0 - 1 - before)) before++;
        while (after < MAX_SPACE && wallAt(s0 + k.len + after)) after++;
        // справа, если стоять в комнате лицом к двери: r = (ny, −nx); отрезок идёт по +x (N/S) или +y (E/W)
        const rightIsEnd = (ax ? normal[1] : -normal[0]) > 0;
        const space: [number, number] = rightIsEnd ? [r6(before * c), r6(after * c)] : [r6(after * c), r6(before * c)];
        const hinge = chooseHinge(key, space);
        const widthM = r6(k.len * c);
        const open = role === 'open' || role === 'opened';
        out.push({
          inst: inst.id,
          connector: k.id,
          tag: k.tag,
          style: style.id,
          role,
          leaf: role !== 'open' || leafHere(k.tag),
          line: ax ? [r6(a), r6(pos), r6(b), r6(pos)] : [r6(pos), r6(a), r6(pos), r6(b)],
          normal,
          widthM,
          heightM: r6(doorH),
          hinge,
          angle: open ? restAngle(style, key, widthM, hinge === 'left' ? space[0] : space[1]) : 0,
          space,
          seed: key,
        });
      }
    });
  }

  // 11. Комнаты: якорь — центр наибольшего прямоугольника пола.
  const rooms: RoomInfo3D[] = [];
  insts.forEach((inst, i) => {
    const list = cellLists[i];
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (let k = 0; k < list.length; k += 2) {
      x0 = Math.min(x0, list[k]);
      x1 = Math.max(x1, list[k] + 1);
      y0 = Math.min(y0, list[k + 1]);
      y1 = Math.max(y1, list[k + 1] + 1);
    }
    let area = 0;
    let anchor: [number, number] = [0, 0];
    let bbox: Rect = { x0: 0, y0: 0, x1: 0, y1: 0 };
    if (x0 !== Infinity) {
      bbox = { x0: r6(x0 * c), y0: r6(y0 * c), x1: r6(x1 * c), y1: r6(y1 * c) };
      const best = largestRect(cls, own, W, i, x0 - gx0, y0 - gy0, x1 - gx0, y1 - gy0);
      area = best.cells;
      anchor = best.w > 0
        ? [r6((best.x + best.w / 2 + gx0) * c), r6((best.y + best.h / 2 + gy0) * c)]
        : [r6(((x0 + x1) / 2) * c), r6(((y0 + y1) / 2) * c)];
    }
    rooms.push({
      inst: inst.id,
      roomId: inst.roomId,
      name: inst.roomName,
      tags: [...(inst.roomTags ?? [])],
      bbox,
      anchor,
      tier: inst.tier ?? null,
      floorAreaM2: r6(area * c * c),
      finish: { ...finishOf[i] },
    });
  });

  // 12. Болванки мебели.
  const propsOut: PropBox[] = [];
  if (o.props) {
    const propBy = new Map((run.props ?? []).map((p) => [p.id, p] as const));
    const missing = new Set<string>();
    for (const inst of insts) {
      const add = (source: 'decor' | 'spot', propId: string, x: number, y: number, rot: number, where: string): void => {
        const p = propBy.get(propId);
        if (!p) {
          if (!missing.has(propId)) issues.push(`Предмет ${propId} (${where}) не найден в props — болванка пропущена`);
          missing.add(propId);
          return;
        }
        const h = propHeightM(p.tags ?? [], p.name ?? '');
        // кровать / стол на ножках: коллайдер — плита над просветом (низкая болванка без плиты — сплошная, как была)
        const cv = propCover(propId);
        propsOut.push({
          inst: inst.id,
          source,
          propId,
          name: p.name,
          x: r6(x * c),
          y: r6(y * c),
          rot,
          w: p.w,
          d: p.h,
          h,
          color: p.color,
          tags: [...(p.tags ?? [])],
          ...(cv && h - cv.clear >= COVER_MIN_SLAB_M ? { cover: cv.cover, clear: cv.clear } : {}),
        });
      };
      for (const d of inst.decor ?? []) add('decor', d.propId, d.x, d.y, d.rot, `декор ${inst.id}/${d.id}`);
      if (o.spotProps) {
        for (const s of inst.spots ?? []) {
          if (s.content?.kind !== 'prop') continue;
          const rot = s.contentRot ?? normDeg(s.rot + (s.content.rot ?? 0));
          add('spot', s.content.id, s.x, s.y, rot, `спот ${inst.id}/${s.id}`);
        }
      }
    }
  }

  // 13. Границы и статистика.
  let bx0 = Infinity, by0 = Infinity, bx1 = -Infinity, by1 = -Infinity;
  for (let ly = 0; ly < H; ly++) {
    for (let lx = 0; lx < W; lx++) {
      if (cls[ly * W + lx] === EMPTY) continue;
      if (lx < bx0) bx0 = lx;
      if (lx + 1 > bx1) bx1 = lx + 1;
      if (ly < by0) by0 = ly;
      if (ly + 1 > by1) by1 = ly + 1;
    }
  }
  const bounds: Rect = { x0: r6((bx0 + gx0) * c), y0: r6((by0 + gy0) * c), x1: r6((bx1 + gx0) * c), y1: r6((by1 + gy0) * c) };

  return {
    format: 'room-forge-blockout',
    version: 1,
    units: 'm',
    axes: 'plan: x right, y down, z up',
    cellM: c,
    options: o,
    bounds,
    solids: allSolids,
    floors,
    ceilings,
    openings,
    deadEnds,
    faces,
    finishes,
    props: propsOut,
    rooms,
    stats: {
      floorCells,
      wallCells,
      solids: allSolids.length,
      openings: openings.length,
      deadEnds: deadEnds.length,
      ms: Math.round((nowMs() - tStart) * 10) / 10,
    },
    issues,
    ...(doorSlots ? { doors: doorSlots } : {}),
  };
}

// ───────────────────────── облицовка ─────────────────────────
//
// Каждая клетка пола делится на 3×3 под-клетки по линиям x, x + t/2, x + 1 − t/2 (то же по y): угловые
// под-клетки — четверти квадратов узлов, боковые — полосы перегородок вдоль рёбер, центр — всегда пол.
// Это ровно та сетка, по которой нарезаны перегородки, поэтому грань «свободная под-клетка комнаты |
// твёрдая под-клетка» — точно грань объёма. Координаты линий кодируются целыми: 3n + k, k = 0 → n,
// k = 1 → n + t/2, k = 2 → n + 1 − t/2 (в клетках).

const S_NONE = 0;
/** свободно на уровне пола, принадлежит комнате клетки */
const S_FREE = 1;
/** твёрдое на всю высоту (масса, колонна, перегородка) */
const S_SOLID = 2;
/** свободно внизу, перемычка вверху (проём) */
const S_LINT = 3;

interface FaceGrid {
  W: number;
  H: number;
  cls: Uint8Array;
  own: Int32Array;
  vE: Uint8Array;
  hE: Uint8Array;
  quad: Uint8Array | null;
  lintels: boolean;
}

/** Состояние под-клетки (a, b ∈ 0..2) клетки (x, y) на уровне пола. */
function subState(f: FaceGrid, x: number, y: number, a: number, b: number): number {
  const k = f.cls[y * f.W + x];
  if (k === WALL || k === COLUMN) return S_SOLID;
  if (k === PORTAL || k === CARVE) return f.lintels ? S_LINT : S_NONE;
  if (k !== FLOOR) return S_NONE;
  let t = 0;
  if (a === 1) {
    if (b === 1) return S_FREE;
    t = f.hE[(b === 0 ? y : y + 1) * f.W + x];
  } else if (b === 1) {
    t = f.vE[y * (f.W + 1) + (a === 0 ? x : x + 1)];
  } else if (f.quad) {
    // угол клетки — четверть узла: левый верхний угол клетки = правая нижняя четверть узла (x, y) и т. д.
    const vx = a === 0 ? x : x + 1, vy = b === 0 ? y : y + 1;
    const q = (b === 0 ? 2 : 0) + (a === 0 ? 1 : 0);
    t = (f.quad[vy * (f.W + 1) + vx] >> (2 * q)) & 3;
  }
  return t === 0 ? S_FREE : t === E_PART ? S_SOLID : f.lintels ? S_LINT : S_FREE;
}

/** Отрезки облицовки, слитые по прямым: плоский массив по 7 чисел — экземпляр,
 *  горизонтальная (1) / вертикальная (0), код линии, код начала, код конца, нормаль в + (1) / в − (0),
 *  часть (0 — стена, 1 — перемычка). */
function faceRuns(f: FaceGrid): number[] {
  const { W, H, cls, own } = f;
  const out: number[] = [];
  // слот = линия × нормаль; кусочки одного слота приходят по возрастанию (обход по рядам) и сливаются на лету
  const hn = (3 * H + 1) * 2;
  const n = hn + (3 * W + 1) * 2;
  const rS = new Int32Array(n), rE = new Int32Array(n), rI = new Int32Array(n).fill(-1), rP = new Uint8Array(n);
  const flush = (slot: number): void => {
    if (rI[slot] < 0) return;
    const horiz = slot < hn;
    const loc = horiz ? slot : slot - hn;
    out.push(rI[slot], horiz ? 1 : 0, loc >> 1, rS[slot], rE[slot], loc & 1, rP[slot]);
    rI[slot] = -1;
  };
  const piece = (slot: number, s: number, e: number, inst: number, part: number): void => {
    if (rI[slot] === inst && rP[slot] === part && rE[slot] === s) {
      rE[slot] = e;
      return;
    }
    flush(slot);
    rI[slot] = inst;
    rP[slot] = part;
    rS[slot] = s;
    rE[slot] = e;
  };
  const ring = [-W - 1, -W, -W + 1, -1, 1, W - 1, W, W + 1];
  const st = new Uint8Array(9);
  for (let y = 1; y < H - 1; y++) {
    for (let x = 1; x < W - 1; x++) {
      const g = y * W + x;
      if (cls[g] !== FLOOR) continue;
      const i = own[g];
      // только клетки у границы комнаты (8-окрестность): внутри комнаты граней нет
      let edge = false;
      for (const d of ring) {
        if (cls[g + d] !== FLOOR || own[g + d] !== i) {
          edge = true;
          break;
        }
      }
      if (!edge) continue;
      for (let b = 0; b < 3; b++) for (let a = 0; a < 3; a++) st[b * 3 + a] = subState(f, x, y, a, b);
      for (let b = 0; b < 3; b++) {
        for (let a = 0; a < 3; a++) {
          if (st[b * 3 + a] !== S_FREE) continue;
          const up = b > 0 ? st[(b - 1) * 3 + a] : subState(f, x, y - 1, a, 2);
          const dn = b < 2 ? st[(b + 1) * 3 + a] : subState(f, x, y + 1, a, 0);
          const lf = a > 0 ? st[b * 3 + a - 1] : subState(f, x - 1, y, 2, b);
          const rt = a < 2 ? st[b * 3 + a + 1] : subState(f, x + 1, y, 0, b);
          const cx = 3 * x + a, cy = 3 * y + b;
          if (up >= S_SOLID) piece(cy * 2 + 1, cx, cx + 1, i, up - S_SOLID);
          if (dn >= S_SOLID) piece((cy + 1) * 2, cx, cx + 1, i, dn - S_SOLID);
          if (lf >= S_SOLID) piece(hn + cx * 2 + 1, cy, cy + 1, i, lf - S_SOLID);
          if (rt >= S_SOLID) piece(hn + (cx + 1) * 2, cy, cy + 1, i, rt - S_SOLID);
        }
      }
    }
  }
  for (let slot = 0; slot < n; slot++) flush(slot);
  return out;
}

/**
 * Владелец каждой подклетки сетки ×sub (BlockoutOptions.ownership; sub = 2 — полуклетки, 4 — четверти): индекс экземпляра с ближайшим полом.
 * Расстояние — фасочное (2 за шаг по стороне полуклетки, 3 по диагонали): между параллельными стенами
 * зазор делится ровно пополам (при зазоре g клеток — 2g полуклеток, ничьих нет), а у угла, где полы
 * двух комнат сходятся вершинами (gap = 0), полуклетка достаётся той, к чьему полу она примыкает
 * стороной, а не углом. При равенстве — меньший индекс. На сетке без препятствий фасочная метрика
 * считается Дейкстрой точно, и выбор «наименьший индекс среди ближайших» не зависит от порядка обхода —
 * граница двух комнат определяется только ими двумя. Очередь — корзины по расстоянию (веса 2 и 3).
 */
function voronoiHalf(cellLists: number[][], W: number, H: number, gx0: number, gy0: number, sub = 2): Int32Array {
  const W2 = sub * W, H2 = sub * H, N2 = W2 * H2;
  const INF = 0x3fffffff;
  const dist = new Int32Array(N2).fill(INF);
  const owner = new Int32Array(N2).fill(-1);
  const buckets: number[][] = [[], [], [], []];
  let queued = 0;
  cellLists.forEach((list, i) => {
    for (let k = 0; k < list.length; k += 2) {
      const hx = sub * (list[k] - gx0), hy = sub * (list[k + 1] - gy0);
      for (let b = 0; b < sub; b++) {
        for (let a = 0; a < sub; a++) {
          const h = (hy + b) * W2 + hx + a;
          if (dist[h] === INF) {
            dist[h] = 0;
            owner[h] = i;
            buckets[0].push(h);
            queued++;
          } else if (i < owner[h]) owner[h] = i;
        }
      }
    }
  });
  for (let d = 0; queued > 0; d++) {
    const list = buckets[d & 3];
    for (let j = 0; j < list.length; j++) {
      const h = list[j];
      if (dist[h] !== d) continue;
      const ow = owner[h];
      const hx = h % W2, hy = (h - hx) / W2;
      for (let dy = -1; dy <= 1; dy++) {
        const y = hy + dy;
        if (y < 0 || y >= H2) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const x = hx + dx;
          if ((dx === 0 && dy === 0) || x < 0 || x >= W2) continue;
          const g = y * W2 + x;
          const nd = d + (dx !== 0 && dy !== 0 ? 3 : 2);
          if (nd < dist[g]) {
            dist[g] = nd;
            owner[g] = ow;
            buckets[nd & 3].push(g);
            queued++;
          } else if (nd === dist[g] && ow < owner[g]) owner[g] = ow;
        }
      }
    }
    queued -= list.length;
    list.length = 0;
  }
  return owner;
}

function emptyModel(c: number, o: BlockoutOptions, issues: string[], ms: number): BlockoutModel {
  return {
    format: 'room-forge-blockout',
    version: 1,
    units: 'm',
    axes: 'plan: x right, y down, z up',
    cellM: c,
    options: o,
    bounds: { x0: 0, y0: 0, x1: 0, y1: 0 },
    solids: [],
    floors: [],
    ceilings: [],
    openings: [],
    deadEnds: [],
    faces: [],
    finishes: [],
    props: [],
    rooms: [],
    stats: { floorCells: 0, wallCells: 0, solids: 0, openings: 0, deadEnds: 0, ms: Math.round(ms * 10) / 10 },
    issues,
    ...(o.doors ? { doors: [] } : {}),
  };
}

/** Заливка пустых клеток (4-связно) от края сетки: 1 — связана с внешним пространством. */
function floodOutside(cls: Uint8Array, W: number, H: number): Uint8Array {
  const reach = new Uint8Array(W * H);
  const stack = new Int32Array(W * H);
  let sp = 0;
  const seed = (g: number): void => {
    if (cls[g] === EMPTY && !reach[g]) {
      reach[g] = 1;
      stack[sp++] = g;
    }
  };
  for (let x = 0; x < W; x++) {
    seed(x);
    seed((H - 1) * W + x);
  }
  for (let y = 0; y < H; y++) {
    seed(y * W);
    seed(y * W + W - 1);
  }
  const last = W * (H - 1);
  while (sp > 0) {
    const g = stack[--sp];
    const x = g % W;
    let n: number;
    if (x > 0 && cls[(n = g - 1)] === EMPTY && !reach[n]) {
      reach[n] = 1;
      stack[sp++] = n;
    }
    if (x < W - 1 && cls[(n = g + 1)] === EMPTY && !reach[n]) {
      reach[n] = 1;
      stack[sp++] = n;
    }
    if (g >= W && cls[(n = g - W)] === EMPTY && !reach[n]) {
      reach[n] = 1;
      stack[sp++] = n;
    }
    if (g < last && cls[(n = g + W)] === EMPTY && !reach[n]) {
      reach[n] = 1;
      stack[sp++] = n;
    }
  }
  return reach;
}

/** Наибольший прямоугольник из клеток пола экземпляра inst в окне [x0, x1) × [y0, y1) сетки. */
function largestRect(
  cls: Uint8Array, own: Int32Array, W: number, inst: number,
  x0: number, y0: number, x1: number, y1: number,
): { x: number; y: number; w: number; h: number; cells: number } {
  const bw = x1 - x0;
  const hist = new Int32Array(bw + 1);
  const stack: number[] = [];
  let best = { x: 0, y: 0, w: 0, h: 0, cells: 0 };
  let bestArea = 0;
  let cells = 0;
  for (let y = y0; y < y1; y++) {
    for (let i = 0; i < bw; i++) {
      const g = y * W + x0 + i;
      if (cls[g] === FLOOR && own[g] === inst) {
        hist[i]++;
        cells++;
      } else hist[i] = 0;
    }
    hist[bw] = 0;
    stack.length = 0;
    for (let i = 0; i <= bw; i++) {
      while (stack.length && hist[stack[stack.length - 1]] >= hist[i]) {
        const hgt = hist[stack.pop()!];
        const left = stack.length ? stack[stack.length - 1] + 1 : 0;
        const area = hgt * (i - left);
        if (area > bestArea) {
          bestArea = area;
          best = { x: x0 + left, y: y - hgt + 1, w: i - left, h: hgt, cells: 0 };
        }
      }
      stack.push(i);
    }
  }
  best.cells = cells;
  return best;
}

// ───────────────────────── самопроверка ─────────────────────────

interface VBox {
  x0: number;
  y0: number;
  z0: number;
  x1: number;
  y1: number;
  z1: number;
  name: string;
}

/** Равномерная сетка корзин по плану для прямоугольников (пересечения и точечные запросы без O(n²)). */
class PlanIndex {
  readonly G: number;
  readonly ox: number;
  readonly oy: number;
  readonly nx: number;
  readonly ny: number;
  readonly buckets: number[][];
  private mark: Int32Array;
  private stamp = 0;

  constructor(private rects: readonly { x0: number; y0: number; x1: number; y1: number }[]) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const r of rects) {
      x0 = Math.min(x0, r.x0);
      y0 = Math.min(y0, r.y0);
      x1 = Math.max(x1, r.x1);
      y1 = Math.max(y1, r.y1);
    }
    if (x0 === Infinity) x0 = y0 = x1 = y1 = 0;
    this.ox = x0;
    this.oy = y0;
    this.G = Math.max(0.25, Math.max(x1 - x0, y1 - y0) / 128);
    this.nx = Math.max(1, Math.ceil((x1 - x0) / this.G) + 1);
    this.ny = Math.max(1, Math.ceil((y1 - y0) / this.G) + 1);
    this.buckets = Array.from({ length: this.nx * this.ny }, () => [] as number[]);
    this.mark = new Int32Array(rects.length);
    rects.forEach((r, i) => {
      const [ix0, iy0] = this.cell(r.x0, r.y0);
      const [ix1, iy1] = this.cell(r.x1, r.y1);
      for (let iy = iy0; iy <= iy1; iy++) for (let ix = ix0; ix <= ix1; ix++) this.buckets[iy * this.nx + ix].push(i);
    });
  }

  cell(x: number, y: number): [number, number] {
    const ix = Math.min(this.nx - 1, Math.max(0, Math.floor((x - this.ox) / this.G)));
    const iy = Math.min(this.ny - 1, Math.max(0, Math.floor((y - this.oy) / this.G)));
    return [ix, iy];
  }

  /** все прямоугольники, чьи корзины задевает окно (каждый — один раз) */
  query(x0: number, y0: number, x1: number, y1: number, cb: (i: number) => void): void {
    this.stamp++;
    const [ix0, iy0] = this.cell(x0, y0);
    const [ix1, iy1] = this.cell(x1, y1);
    for (let iy = iy0; iy <= iy1; iy++) {
      for (let ix = ix0; ix <= ix1; ix++) {
        for (const i of this.buckets[iy * this.nx + ix]) {
          if (this.mark[i] === this.stamp) continue;
          this.mark[i] = this.stamp;
          cb(i);
        }
      }
    }
  }
}

const f2 = (v: number): string => (Math.round(v * 100) / 100).toString();

/** Самопроверка модели: пересечения твёрдых объёмов, перекрытие пола стенами, незакрытые края пола
 *  (утечка наружу без стены), проёмы, перекрытые массой. Пустой массив — всё чисто. */
export function validateBlockout(model: BlockoutModel): string[] {
  const out: string[] = [];
  const LIMIT = 200;
  let dropped = 0;
  const report = (s: string): void => {
    if (out.length < LIMIT) out.push(s);
    else dropped++;
  };
  const slab = model.options?.slabM ?? 0;
  const wallH = model.options?.wallHeightM ?? 2.5;
  const step = model.cellM > 0 ? model.cellM : 0.1;
  const rectName = (r: Rect): string => `[${f2(r.x0)}…${f2(r.x1)} × ${f2(r.y0)}…${f2(r.y1)}]`;

  // Все твёрдые объёмы: solids + плиты пола и потолка.
  const boxes: VBox[] = [];
  model.solids.forEach((s, i) => {
    const r = s.rect;
    if (!(r.x1 - r.x0 > EPS && r.y1 - r.y0 > EPS && s.z1 - s.z0 > EPS)) {
      report(`Вырожденный объём ${s.kind} #${i} ${rectName(r)} z ${f2(s.z0)}…${f2(s.z1)}`);
      return;
    }
    boxes.push({ ...r, z0: s.z0, z1: s.z1, name: `${s.kind} #${i} ${rectName(r)}` });
  });
  if (slab > EPS) {
    for (const s of model.floors) {
      for (const r of s.rects) boxes.push({ ...r, z0: s.z - slab, z1: s.z, name: `плита пола ${s.inst ?? 'проёма'} ${rectName(r)}` });
    }
    for (const s of model.ceilings) {
      for (const r of s.rects) boxes.push({ ...r, z0: s.z, z1: s.z + slab, name: `плита потолка ${s.inst ?? 'проёма'} ${rectName(r)}` });
    }
  }

  // 1. Попарные пересечения: пара проверяется в той корзине, где лежит угол их пересечения.
  const bi = new PlanIndex(boxes);
  for (let b = 0; b < bi.buckets.length; b++) {
    const list = bi.buckets[b];
    for (let p = 0; p < list.length; p++) {
      const A = boxes[list[p]];
      for (let q = p + 1; q < list.length; q++) {
        const B = boxes[list[q]];
        const ox = Math.min(A.x1, B.x1) - Math.max(A.x0, B.x0);
        if (ox <= EPS) continue;
        const oy = Math.min(A.y1, B.y1) - Math.max(A.y0, B.y0);
        if (oy <= EPS) continue;
        const oz = Math.min(A.z1, B.z1) - Math.max(A.z0, B.z0);
        if (oz <= EPS) continue;
        const [cx, cy] = bi.cell(Math.max(A.x0, B.x0), Math.max(A.y0, B.y0));
        if (cy * bi.nx + cx !== b) continue;
        report(`Пересекаются объёмы: ${A.name} и ${B.name} (${f2(ox)}×${f2(oy)}×${f2(oz)} м)`);
      }
    }
  }

  // Индексы для точечных запросов.
  const solids = model.solids;
  const si = new PlanIndex(solids.map((s) => s.rect));
  const floorRects: { r: Rect; s: number }[] = [];
  model.floors.forEach((s, k) => s.rects.forEach((r) => floorRects.push({ r, s: k })));
  const fi = new PlanIndex(floorRects.map((f) => f.r));
  const inside = (r: Rect, x: number, y: number): boolean => x > r.x0 + 1e-9 && x < r.x1 - 1e-9 && y > r.y0 + 1e-9 && y < r.y1 - 1e-9;
  const floorAt = (x: number, y: number): number => {
    let found = -1;
    fi.query(x, y, x, y, (i) => {
      if (found < 0 && inside(floorRects[i].r, x, y)) found = floorRects[i].s;
    });
    return found;
  };
  /** стоит ли в точке масса или перегородка на всю высоту комнаты */
  // точка на стыке двух объёмов считается закрытой: при владении (ownership) масса режется и по
  // полуклеткам — стык попадает ровно на середину клетки, где лежат точки проверки края пола
  const onRect = (r: Rect, x: number, y: number): boolean => x >= r.x0 - 1e-9 && x <= r.x1 + 1e-9 && y >= r.y0 - 1e-9 && y <= r.y1 + 1e-9;
  // высоты — от пола (у кусков портального рендера комнаты бывают на своей высоте, src/blockout/stairs.ts)
  const closedAt = (x: number, y: number, z0 = 0): boolean => {
    let ok = false;
    si.query(x, y, x, y, (i) => {
      const s = solids[i];
      if (!ok && s.kind !== 'lintel' && s.z0 <= z0 + EPS && s.z1 >= z0 + wallH - EPS && onRect(s.rect, x, y)) ok = true;
    });
    return ok;
  };
  const baseOf = new Map<string, number>();
  for (const s of model.floors) if (s.inst !== null && !baseOf.has(s.inst)) baseOf.set(s.inst, s.z);
  const openingAt = (x: number, y: number): boolean => model.openings.some((op) => inside(op.rect, x, y));

  // Облицовка: индекс по плану (тонкие прямоугольники вдоль линий).
  const faces = model.faces ?? [];
  const tP = model.options?.partitionM ?? 0;
  const th = tP / 2;
  const fRect = (f: WallFace): Rect => ({
    x0: Math.min(f.line[0], f.line[2]) - 1e-6,
    y0: Math.min(f.line[1], f.line[3]) - 1e-6,
    x1: Math.max(f.line[0], f.line[2]) + 1e-6,
    y1: Math.max(f.line[1], f.line[3]) + 1e-6,
  });
  const fRects = faces.map(fRect);
  const fi2 = new PlanIndex(fRects);
  /** есть ли облицовка стены этой комнаты у точки края пола (на грани массы или перегородки, до t/2 внутрь) */
  const facedAt = (inst: string, px: number, py: number, nx: number, ny: number): boolean => {
    let ok = false;
    const ax = px - nx * (th + 1e-6), ay = py - ny * (th + 1e-6);
    fi2.query(Math.min(px, ax), Math.min(py, ay), Math.max(px, ax), Math.max(py, ay), (k) => {
      const f = faces[k];
      if (ok || f.inst !== inst || f.part !== 'wall' || f.normal[0] !== -nx || f.normal[1] !== -ny) return;
      const r = fRects[k];
      // вдоль грани точка внутри отрезка, поперёк — грань между краем пола и t/2 внутрь
      const along = nx === 0 ? px > r.x0 && px < r.x1 : py > r.y0 && py < r.y1;
      const off = nx === 0 ? (py - f.line[1]) * ny : (px - f.line[0]) * nx;
      if (along && off >= -1e-6 && off <= th + 1e-6) ok = true;
    });
    return ok;
  };
  /** закрытая часть периметра пола по комнатам (без проёмов) — с ней сверяется длина облицовки */
  const closedLen = new Map<string, number>();
  const closedEdge = (inst: string | null, px: number, py: number, nx: number, ny: number, len: number): void => {
    if (inst === null) return;
    closedLen.set(inst, (closedLen.get(inst) ?? 0) + len);
    if (!facedAt(inst, px, py, nx, ny)) report(`Край пола ${inst} у (${f2(px)}; ${f2(py)}) закрыт стеной, но без облицовки`);
  };

  // 2. Края пола: снаружи — масса/перегородка, соседний пол — та же комната, проём или перегородка.
  const delta = Math.min(1e-3, step / 20);
  const openMode = model.options?.deadEnds === 'open' || model.options?.cutEnds === 'open';
  for (const { r, s } of floorRects) {
    const surf = model.floors[s];
    const edges: [number, number, number, number, number, number][] = [
      [r.x0, r.y0, r.x1, r.y0, 0, -1],
      [r.x0, r.y1, r.x1, r.y1, 0, 1],
      [r.x0, r.y0, r.x0, r.y1, -1, 0],
      [r.x1, r.y0, r.x1, r.y1, 1, 0],
    ];
    for (const [ax, ay, bx, by, nx, ny] of edges) {
      const len = Math.hypot(bx - ax, by - ay);
      const n = Math.max(1, Math.round(len / step));
      for (let k = 0; k < n; k++) {
        const f = (k + 0.5) / n;
        const px = ax + (bx - ax) * f, py = ay + (by - ay) * f;
        const qx = px + nx * delta, qy = py + ny * delta;
        // перегородка (gap = 0) стоит на ребре; при владении она поделена по ребру на половины — у края
        // пола своя половина внутри пола, чужая снаружи: смотрим по обе стороны ребра
        const inner = closedAt(px - nx * delta, py - ny * delta, surf.z);
        const other = floorAt(qx, qy);
        if (other === s) continue;
        if (other >= 0) {
          const o = model.floors[other];
          if (o.inst === null || surf.inst === null || o.inst === surf.inst) continue;
          if (closedAt(px, py, surf.z) || inner || closedAt(qx, qy, surf.z)) closedEdge(surf.inst, px, py, nx, ny, len / n);
          else if (!openingAt(px, py)) report(`Полы ${surf.inst} и ${o.inst} соприкасаются у (${f2(px)}; ${f2(py)}) без перегородки`);
        } else if (closedAt(qx, qy, surf.z) || inner) {
          closedEdge(surf.inst, px, py, nx, ny, len / n);
        } else if (!(openMode && (surf.inst === null || openingAt(px, py)))) {
          // открытый край допустим только в режиме 'open': пол проёма наружу или (gap = 0) ребро проёма,
          // за которым нет пола (кусок комнаты без соседа)
          report(`Край пола ${surf.inst ?? 'проёма'} у (${f2(px)}; ${f2(py)}) открыт наружу — нет стены`);
        }
      }
    }
  }

  // 3. Проёмы: ниже высоты двери ни одного твёрдого объёма.
  for (const op of model.openings) {
    const r = op.rect;
    // пол проёма — его половины (inst = null) в нём
    let z0 = 0;
    for (const f of model.floors) if (f.inst === null && f.rects.some((q) => Math.min(q.x1, r.x1) - Math.max(q.x0, r.x0) > EPS && Math.min(q.y1, r.y1) - Math.max(q.y0, r.y0) > EPS)) z0 = Math.max(z0, f.z);
    const z1 = z0 + Math.min(op.heightM, wallH);
    si.query(r.x0, r.y0, r.x1, r.y1, (i) => {
      const s = solids[i];
      const ox = Math.min(r.x1, s.rect.x1) - Math.max(r.x0, s.rect.x0);
      const oy = Math.min(r.y1, s.rect.y1) - Math.max(r.y0, s.rect.y0);
      const oz = Math.min(z1, s.z1) - Math.max(z0, s.z0);
      if (ox > EPS && oy > EPS && oz > EPS) {
        report(`Проём ${op.a.inst}/${op.a.connector} ↔ ${op.b.inst}/${op.b.connector} перекрыт ниже двери: ${s.kind} #${i} ${rectName(s.rect)}`);
      }
    });
  }

  // 4. Облицовка: в плоскости грани твёрдого объёма, не над проёмом, без наложений, длина = периметр.
  const doorH = Math.min(model.options?.doorHeightM ?? wallH, wallH);
  const oi = new PlanIndex(model.openings.map((op) => op.rect));
  const onGrid = (v: number): boolean => Math.abs(v / step - Math.round(v / step)) < 1e-6;
  const faceLen = new Map<string, number>();
  const offGrid = new Map<string, number>();
  const lines = new Map<string, [number, number][]>();
  faces.forEach((f, k) => {
    const [x1, y1, x2, y2] = f.line;
    const name = `Облицовка ${f.inst} #${k} (${f2(x1)}; ${f2(y1)})–(${f2(x2)}; ${f2(y2)})`;
    const horiz = Math.abs(y1 - y2) < 1e-9, vert = Math.abs(x1 - x2) < 1e-9;
    const [nx, ny] = f.normal;
    const len = Math.hypot(x2 - x1, y2 - y1);
    if (!(horiz !== vert && len > EPS && f.z1 - f.z0 > EPS && Math.abs(nx) + Math.abs(ny) === 1 && (horiz ? ny !== 0 : nx !== 0))) {
      report(`${name}: вырожденная или не по осям`);
      return;
    }
    // плоскость: твёрдые объёмы с гранью на линии облицовки со стороны, противоположной нормали
    const c0 = horiz ? Math.min(x1, x2) : Math.min(y1, y2), c1 = horiz ? Math.max(x1, x2) : Math.max(y1, y2);
    const at = horiz ? y1 : x1;
    const cov: [number, number][] = [];
    const r = fRects[k];
    si.query(r.x0, r.y0, r.x1, r.y1, (i) => {
      const sd = solids[i];
      if (sd.z0 > f.z0 + EPS || sd.z1 < f.z1 - EPS) return;
      const face = horiz ? (ny > 0 ? sd.rect.y1 : sd.rect.y0) : nx > 0 ? sd.rect.x1 : sd.rect.x0;
      if (Math.abs(face - at) > EPS) return;
      cov.push(horiz ? [sd.rect.x0, sd.rect.x1] : [sd.rect.y0, sd.rect.y1]);
    });
    cov.sort((a, b) => a[0] - b[0]);
    let reach = c0;
    for (const [a, b] of cov) if (a <= reach + EPS && b > reach) reach = b;
    if (reach < c1 - EPS) report(`${name} не лежит на грани твёрдого объёма (покрыто до ${f2(reach)})`);
    // стена на всю высоту не может стоять поперёк проёма
    const fb = baseOf.get(f.inst) ?? 0;
    if (f.part === 'wall' && f.z0 < fb + doorH - EPS) {
      oi.query(r.x0, r.y0, r.x1, r.y1, (i) => {
        const op = model.openings[i].rect;
        const lo = horiz ? op.y0 : op.x0, hi = horiz ? op.y1 : op.x1;
        const ov = Math.min(c1, horiz ? op.x1 : op.y1) - Math.max(c0, horiz ? op.x0 : op.y0);
        if (at >= lo - EPS && at <= hi + EPS && ov > EPS) report(`${name} висит над проёмом ниже двери`);
      });
    }
    const key = `${f.inst}|${nx},${ny}|${f.part}|${at}`;
    const list = lines.get(key) ?? [];
    list.push([c0, c1]);
    lines.set(key, list);
    if (f.part === 'wall' && f.z0 <= fb + EPS) {
      faceLen.set(f.inst, (faceLen.get(f.inst) ?? 0) + len);
      if (!onGrid(at) || !onGrid(c0) || !onGrid(c1)) offGrid.set(f.inst, (offGrid.get(f.inst) ?? 0) + 1);
    }
  });
  for (const [key, list] of lines) {
    list.sort((a, b) => a[0] - b[0]);
    for (let k = 1; k < list.length; k++) {
      if (list[k][0] < list[k - 1][1] - EPS) report(`Облицовки ${key.split('|')[0]} накладываются на одной линии (${f2(list[k][0])}…${f2(list[k - 1][1])})`);
    }
  }
  // Длина облицовки стен комнаты = закрытая часть периметра пола (периметр минус проёмы и прорези);
  // у перегородок грани смещены на t/2 и концы сдвинуты на ±t/2 — допуск t на каждую такую облицовку.
  for (const [inst, want] of closedLen) {
    const got = faceLen.get(inst) ?? 0;
    const tol = 1e-4 + tP * (offGrid.get(inst) ?? 0);
    if (Math.abs(got - want) > tol) report(`Облицовка комнаты ${inst}: длина ${f2(got)} м, а закрытый периметр пола ${f2(want)} м`);
  }
  for (const [inst, got] of faceLen) if (!closedLen.has(inst)) report(`Облицовка комнаты ${inst} (${f2(got)} м) есть, а закрытого периметра нет`);

  // 5. Без толщины плит объёмная проверка не видит стену на полу — проверяем по плану.
  if (slab <= EPS) {
    solids.forEach((s, i) => {
      if (s.kind !== 'wall' && s.kind !== 'column') return;
      fi.query(s.rect.x0, s.rect.y0, s.rect.x1, s.rect.y1, (k) => {
        const r = floorRects[k].r;
        const ox = Math.min(r.x1, s.rect.x1) - Math.max(r.x0, s.rect.x0);
        const oy = Math.min(r.y1, s.rect.y1) - Math.max(r.y0, s.rect.y0);
        if (ox > EPS && oy > EPS) report(`${s.kind} #${i} ${rectName(s.rect)} стоит на полу ${model.floors[floorRects[k].s].inst ?? 'проёма'}`);
      });
    });
  }

  if (dropped) out.push(`… и ещё ${dropped} проблем(ы)`);
  return out;
}

// ───────────────────────── высота мебели ─────────────────────────

/** Правила по порядку: первое совпадение побеждает. Основа слова (≥ 4 букв) — по началу слова,
 *  короткие и помеченные «=» — только целое слово. */
const PROP_HEIGHTS: [string[], number][] = [
  // подвесное (лампа, труба под потолком) и плоское на полу (лужа, вода) — болванка-коллайдер в 1 см, не мешает пройти
  [['потолок', 'лужа', 'затоплено'], 0.01],
  [['доска'], 0.05],
  [['ковер', 'коврик', 'дорожка', 'половик'], 0.01],
  [['мусор'], 0.25],
  [['лифт'], 2.2],
  [['стенка'], 2.0],
  [['шкаф', 'гардероб'], 1.9],
  [['сервант', 'буфет', 'стеллаж', 'этажерк', 'антресол'], 1.8],
  [['вешалк'], 1.7],
  [['холодильник', 'бак'], 1.5],
  [['трюмо', 'почт'], 1.5],
  [['сушилк'], 1.4],
  [['пианино', 'фортепиано'], 1.25],
  [['фикус', 'растен', 'пальм'], 1.2],
  [['коляск', 'велосипед'], 1.0],
  [['верстак'], 0.9],
  [['плита', 'плиты', 'мойк', 'раковин', 'умывальник', 'тумб'], 0.85],
  [['диван', 'кресл', 'софа'], 0.85],
  [['унитаз'], 0.75],
  [['стол', 'парта', 'конторк'], 0.75],
  [['стиралк', 'стиральн'], 0.7],
  [['=ванна'], 0.6],
  [['батаре', 'радиатор', 'сундук'], 0.6],
  [['обувниц', 'коробк'], 0.5],
  [['кроват', 'раскладушк', 'тахта'], 0.5],
  [['стул', 'табурет', 'скамь', 'лавк', 'сиденье', 'пуф'], 0.45],
  [['трубы', 'труба'], 0.4],
  [['бутылк'], 0.35],
  [['ящик'], 0.5],
  [['перегородк'], 2.0],
  [['столб', 'колонн'], 2.1],
  [['ступен'], 0.9],
  [['банка', 'банки'], 0.3],
  [['двер'], 1.8],
  // общага: настенное (окно, часы, доски, огнетушитель, лейка душа) и накладное (марш-декорация поверх пола, пока нет
  // настоящей лестницы) — коллайдер в 1 см, модель висит на своей высоте; керосиновая лампа — невысокая находка
  [['настенн', 'накладн'], 0.01],
  [['керосин'], 0.35],
];

/** Высота болванки мебели по тегам/имени prop, м (шкаф 2.0, стол 0.75, кровать 0.5 …). */
export function propHeightM(tags: string[], name: string): number {
  const text = `${(tags ?? []).join(' ')} ${name ?? ''}`.toLowerCase().replace(/ё/g, 'е');
  const words = text.split(/[^a-zа-я0-9]+/).filter(Boolean);
  for (const [stems, h] of PROP_HEIGHTS) {
    for (const st of stems) {
      const exact = st.startsWith('=') || st.length < 4;
      const s = st.replace(/^=/, '');
      if (words.some((w) => (exact ? w === s : w.startsWith(s)))) return h;
    }
  }
  return 0.8;
}

// ───────────────────────── укрытия: под кроватью и под столом ─────────────────────────
//
// Игрок от первого лица (src/view3d/posture.ts) пролезает под предметы: на четвереньках эллипсоид занимает
// пол + 0.18…0.59 м, лёжа (сам ложится под низким укрытием) — пол + 0.05…0.25 м; стоя (0…1.7) и присев (0.2…1.1)
// упирается. Поэтому коллайдер укрытия — не бокс от пола, а плита от просвета clear до верха h (babylon.ts), у меша
// коллайдера metadata.cover / metadata.clear — по ним поза и находит укрытие.

/** Просвет под кроватью, м: низ сетки (у железной кровати общаги ~0.33, свес одеяла до 0.27) — пролезть только лёжа. */
export const BED_CLEAR_M = 0.3;
/** Просвет под столом, м: низ царги (у казённого стола общаги царга 0.58…0.67) — пролезть на четвереньках. */
export const TABLE_CLEAR_M = 0.62;
/** Тоньше плиты укрытия не бывает: если болванка ниже clear + 4 см — предмет сплошной, без просвета. */
const COVER_MIN_SLAB_M = 0.04;

/**
 * Под чем можно пролезть: id предмета → вид укрытия и просвет, м. Только на ножках и не меньше ~0.6 м по обеим
 * сторонам: кровати (односпальная, двуспальная, железная общаги, раскладушка — рама на ножках) и столы (кухонный,
 * круглый, казённый). Сплошные до пола — не укрытия: тахта, диван, матрас, тумбовые столы (письменный,
 * канцелярский, вахтёра), стол-книжка сложенный, верстаки с ящиками; шахматный столик мал (0.6 × 0.6).
 * Новая кровать или стол на ножках — допишите id сюда.
 */
export const PROP_COVER: Readonly<Record<string, { cover: PropCoverKind; clear: number }>> = {
  p_bed1: { cover: 'bed', clear: BED_CLEAR_M },
  p_bed2: { cover: 'bed', clear: BED_CLEAR_M },
  p_cot: { cover: 'bed', clear: BED_CLEAR_M },
  p_obsh_bed: { cover: 'bed', clear: BED_CLEAR_M },
  p_table_kitchen: { cover: 'table', clear: TABLE_CLEAR_M },
  p_table_round: { cover: 'table', clear: TABLE_CLEAR_M },
  p_obsh_table: { cover: 'table', clear: TABLE_CLEAR_M },
};

/** Укрытие предмета по id (PROP_COVER) или null — сплошной до пола. */
export function propCover(propId: string): { cover: PropCoverKind; clear: number } | null {
  return Object.prototype.hasOwnProperty.call(PROP_COVER, propId) ? PROP_COVER[propId] : null;
}
