// Подпрогоны: часть JSON прогона как самостоятельный прогон. Без зависимостей от приложения и движка.
//
// Нужны складчатому (4D) прогону: в нём комнаты разных слоёв W занимают одно место в 3D, поэтому
// болванку всего прогона строить нельзя (ядро классифицирует клетки глобально). Строят по частям:
//  • видимое множество — комната + всё в ≤ depth дверях (visibleIds): при 2·depth ≤ localRadius
//    комнаты в нём не пересекаются — кусок обычного дома (docs/GENERATOR-4D.md §2, §6);
//  • слой — все комнаты одного W (layerRun): плоский план без пересечений.
// Связи, ведущие за границу части, становятся тупиками (linkedTo = null) — ядро закроет их стеной
// или дверью-заглушкой (deadEnds).
import type { RunExport, RunInstance } from './types';

type Ref = { inst: string; connector: string };

const keyOf = (r: Ref): string => `${r.inst}/${r.connector}`;

/** Слой экземпляра (нет поля — 0). */
export const layerOf = (i: { w?: number }): number => (typeof i.w === 'number' && Number.isFinite(i.w) ? i.w : 0);

/** Складчатый ли прогон: mode/settings.mode = 'fold' или есть экземпляры вне слоя 0. */
export function isFoldRun(run: RunExport | null | undefined): boolean {
  if (!run) return false;
  if (run.mode === 'fold' || run.settings?.mode === 'fold') return true;
  return (run.instances ?? []).some((i) => layerOf(i) !== 0);
}

/** Занятые слои по возрастанию. */
export function layersOf(run: RunExport): number[] {
  return [...new Set((run.instances ?? []).map(layerOf))].sort((a, b) => a - b);
}

/** localRadius складчатого прогона (нет настроек — 2, как по умолчанию у генератора). */
export function localRadiusOf(run: RunExport): number {
  const f = run.settings?.fold as { localRadius?: unknown } | undefined;
  const r = typeof f?.localRadius === 'number' && Number.isFinite(f.localRadius) ? Math.floor(f.localRadius) : 2;
  return Math.max(1, r);
}

/** Безопасная глубина видимого множества: 2·depth ≤ localRadius, но не меньше 1 (иначе в дверь не войти).
 *  При localRadius = 1 соседи между собой могут пересекаться — см. порталы в docs/GENERATOR-4D.md §6. */
export function safeDepth(run: RunExport): number {
  return Math.max(1, Math.floor(localRadiusOf(run) / 2));
}

/**
 * Подпрогон: только экземпляры из набора (в исходном порядке), связи с обоими концами внутри набора.
 * У меток, связанных с экземпляром вне набора, linkedTo = null — они станут тупиками; openConnectors
 * пересчитаны (метки len ≥ 1 без связи). Остальные поля прогона (settings, props, finishes, …)
 * копируются как есть — totals, sight, fold относятся ко всему прогону. Вход не мутируется.
 */
export function subRun(run: RunExport, instIds: Iterable<string>): RunExport {
  const keep = new Set(instIds);
  const all = new Set<string>();
  for (const l of run.links ?? []) {
    all.add(keyOf(l.a));
    all.add(keyOf(l.b));
  }
  const links = (run.links ?? []).filter((l) => keep.has(l.a?.inst) && keep.has(l.b?.inst));
  const peer = new Map<string, Ref>();
  for (const l of links) {
    peer.set(keyOf(l.a), { ...l.b });
    peer.set(keyOf(l.b), { ...l.a });
  }
  const instances: RunInstance[] = [];
  const openConnectors: Ref[] = [];
  for (const inst of run.instances ?? []) {
    if (!keep.has(inst.id)) continue;
    const connectors = (inst.connectors ?? []).map((k) => {
      const key = `${inst.id}/${k.id}`;
      const to = peer.get(key) ?? null;
      if (!to && k.len >= 1) openConnectors.push({ inst: inst.id, connector: k.id });
      // срезанная связь: во всём прогоне метка связана, партнёр — вне части (ядро: cutEnds)
      const { cut: _was, ...rest } = k;
      return !to && (all.has(key) || k.cut) ? { ...rest, linkedTo: null, cut: true } : { ...rest, linkedTo: to };
    });
    instances.push({ ...inst, connectors });
  }
  return { ...run, instances, links: links.map((l) => ({ ...l, a: { ...l.a }, b: { ...l.b } })), openConnectors };
}

/** Один слой W складчатого прогона — плоский план без пересечений (гарантия 1 генератора). */
export function layerRun(run: RunExport, w: number): RunExport {
  return subRun(run, (run.instances ?? []).filter((i) => layerOf(i) === w).map((i) => i.id));
}

// ───────────────────────── граф связей ─────────────────────────

const adjCache = new WeakMap<RunExport, Map<string, string[]>>();

/** Переход спец-локации на другой этаж ('descent' — вниз, 'lift' — выход лифта): не проём, не соседство. */
const transit = (l: RunExport['links'][number]): boolean => l.kind === 'descent' || l.kind === 'lift';

/** Соседи по связям-дверям (кэш на объект прогона; прогон после этого не мутировать). */
export function adjacencyOf(run: RunExport): Map<string, string[]> {
  let adj = adjCache.get(run);
  if (adj) return adj;
  adj = new Map((run.instances ?? []).map((i) => [i.id, [] as string[]]));
  for (const l of run.links ?? []) {
    if (transit(l)) continue;
    adj.get(l.a?.inst)?.push(l.b.inst);
    adj.get(l.b?.inst)?.push(l.a.inst);
  }
  adjCache.set(run, adj);
  return adj;
}

/** Видимое множество: экземпляр + все в ≤ depth дверях от него (BFS по links) — то же, что
 *  visibleSet ядра складчатого генератора, но по JSON прогона. Нет экземпляра — пустое множество. */
export function visibleIds(run: RunExport, instId: string, depth: number): Set<string> {
  const adj = adjacencyOf(run);
  const seen = new Set<string>();
  if (!adj.has(instId)) return seen;
  seen.add(instId);
  let frontier = [instId];
  for (let k = 0; k < depth && frontier.length > 0; k++) {
    const next: string[] = [];
    for (const x of frontier) for (const y of adj.get(x)!) if (!seen.has(y)) { seen.add(y); next.push(y); }
    frontier = next;
  }
  return seen;
}

/** Есть ли в прогоне потенциально видимые наборы (RunExport.pvs, складчатый генератор с seamless). */
export function hasPvs(run: RunExport | null | undefined): boolean {
  const p = run?.pvs;
  return !!p && typeof p === 'object' && Object.keys(p).length > 0;
}

/**
 * Что рендерить, стоя в экземпляре instId: его потенциально видимый набор run.pvs[instId] (генератор
 * гарантирует, что комнаты набора не пересекаются в 3D и что в нём всё, что видно из пола и проёмов
 * комнаты по прямой сквозь проёмы), а если PVS в прогоне нет — видимое множество visibleIds(depth)
 * (depth по умолчанию — safeDepth). Сам instId в наборе всегда; id, которых нет в прогоне, отброшены.
 */
export function pvsIds(run: RunExport, instId: string, depth = safeDepth(run)): Set<string> {
  const list = hasPvs(run) ? run.pvs![instId] : undefined;
  if (!Array.isArray(list)) return visibleIds(run, instId, depth);
  const adj = adjacencyOf(run);
  if (!adj.has(instId)) return new Set();
  const out = new Set<string>([instId]);
  for (const id of list) if (adj.has(id)) out.add(id);
  return out;
}

/** Связь-дверь между двумя экземплярами (первая найденная) и сдвиг W при переходе from → to. */
export function linkBetween(run: RunExport, from: string, to: string): { link: RunExport['links'][number]; dw: number } | null {
  for (const l of run.links ?? []) {
    if (transit(l)) continue;
    const dw = typeof l.dw === 'number' ? l.dw : 0;
    if (l.a.inst === from && l.b.inst === to) return { link: l, dw };
    if (l.b.inst === from && l.a.inst === to) return { link: l, dw: dw ? -dw : 0 };
  }
  return null;
}

// ───────────────────────── соседство в 4D ─────────────────────────

interface CellBody {
  set: Set<number>;
  xs: Int32Array;
  ys: Int32Array;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

const OFF = 1 << 15;
const pack = (x: number, y: number): number => (x + OFF) * 65536 + (y + OFF);
const bodyCache = new WeakMap<RunExport, Map<string, CellBody>>();

function bodyOf(run: RunExport, inst: RunInstance): CellBody {
  let m = bodyCache.get(run);
  if (!m) bodyCache.set(run, (m = new Map()));
  let b = m.get(inst.id);
  if (b) return b;
  const xs: number[] = [], ys: number[] = [];
  for (const row of inst.cells ?? []) {
    const i = row.indexOf(':');
    const y = Number(row.slice(0, i));
    if (i <= 0 || !Number.isInteger(y)) continue;
    for (const part of row.slice(i + 1).split(',')) {
      const [a, c] = parseSeg(part);
      const lo = Math.min(a, c), hi = Math.max(a, c);
      if (!Number.isInteger(lo) || !Number.isInteger(hi)) continue;
      for (let x = lo; x <= hi; x++) { xs.push(x); ys.push(y); }
    }
  }
  const set = new Set<number>();
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let k = 0; k < xs.length; k++) {
    set.add(pack(xs[k], ys[k]));
    x0 = Math.min(x0, xs[k]); x1 = Math.max(x1, xs[k] + 1);
    y0 = Math.min(y0, ys[k]); y1 = Math.max(y1, ys[k] + 1);
  }
  b = { set, xs: Int32Array.from(xs), ys: Int32Array.from(ys), x0, y0, x1, y1 };
  m.set(inst.id, b);
  return b;
}

/** Отрезок "a-b" с отрицательными числами ("-5--2", "-3-4"). */
function parseSeg(part: string): [number, number] {
  const m = /^(-?\d+)(?:-(-?\d+))?$/.exec(part.trim());
  if (!m) return [NaN, NaN];
  return [+m[1], m[2] !== undefined ? +m[2] : +m[1]];
}

/**
 * Экземпляры, занимающие то же место в 3D, что и instId (клетки ближе gap по Чебышёву — критерий
 * пересечения генератора, docs/GENERATOR-4D.md §2). В складчатом прогоне это всегда другие слои и
 * дальше localRadius по графу — «соседство в 4D» для детекторов. Порядок — как в run.instances.
 */
export function overlapIds(run: RunExport, instId: string, gap = Math.max(0, Math.round(Number(run.settings?.gap) || 0))): string[] {
  const insts = run.instances ?? [];
  const me = insts.find((i) => i.id === instId);
  if (!me) return [];
  const a = bodyOf(run, me);
  if (!a.xs.length) return [];
  const out: string[] = [];
  for (const inst of insts) {
    if (inst.id === instId) continue;
    const bb = inst.bbox;
    // грубо по bbox экспорта (клетки), затем по клеткам
    if (bb && (bb.x0 >= a.x1 + gap || bb.x1 + gap <= a.x0 || bb.y0 >= a.y1 + gap || bb.y1 + gap <= a.y0)) continue;
    const b = bodyOf(run, inst);
    if (b.x0 >= a.x1 + gap || b.x1 + gap <= a.x0 || b.y0 >= a.y1 + gap || b.y1 + gap <= a.y0) continue;
    const [s, t] = a.xs.length <= b.xs.length ? [a, b] : [b, a];
    let hit = false;
    for (let k = 0; k < s.xs.length && !hit; k++) {
      const x = s.xs[k], y = s.ys[k];
      if (x < t.x0 - gap || x >= t.x1 + gap || y < t.y0 - gap || y >= t.y1 + gap) continue;
      for (let oy = -gap; oy <= gap && !hit; oy++) for (let ox = -gap; ox <= gap; ox++) if (t.set.has(pack(x + ox, y + oy))) { hit = true; break; }
    }
    if (hit) out.push(inst.id);
  }
  return out;
}
