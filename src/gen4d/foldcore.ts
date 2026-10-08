// Общее ядро складчатого (4D) генератора: пул, складчатая стыковка, петли, PVS, индекс занятости.
// Им пользуются прогон фиксированного размера (fold.ts) и бесконечный потоковый мир (stream.ts).
// Порядок бросков ГСЧ и проверки — docs/GENERATOR-4D.md §4 (движок повторяет дословно).
import { OPPOSITE } from '../model/cells';
import type { Rng } from '../model/rng';
import type { Connector, FoldSettings, GeneratorSettings, Instance, Link, Project, Room, Rot, ShiftMode } from '../model/types';
import { analyzeGrowth } from '../gen/generate';
import { compatible, dockTarget, facing, rotFor } from '../gen/geom';
import { computePvs } from './pvs';
import { SightSpace } from './sight4d';
import { roomSightM, type Body, type FShape, type Shapes } from './space';

export const DEFAULT_FOLD: FoldSettings = {
  shiftChance: 0.2,
  maxShift: 2,
  localRadius: 2,
  maxLayer: 12,
  seamless: true,
};

/** Теги комнат с длинным обзором: ходы и хабы подвала (docs/GENERATOR-4D.md §17) — линии обзора через них пределом
 *  не ограничены (рост, петли, проверка validateFoldRun). */
export const LONG_SIGHT_TAGS: readonly string[] = ['ход', 'хаб'];
export const longSight = (room: Room): boolean => room.tags.some((t) => LONG_SIGHT_TAGS.includes(t));

// Константы роста — те же, что у евклидова генератора (§4.2 GENERATOR.md).
export const ATTEMPTS = 6;
export const RESERVE = 2;
export const RESERVE_STEP = 15;
export const RESERVE_MAX = 10;
export const SUPPLY_FACTOR = 0.5;
export const GROW_BONUS = 1;
export const LEAF_BONUS = 1;
/** bbox экземпляра (с запасом gap) обязан лежать в [−LIMIT, LIMIT] — как у евклидова */
export const LIMIT = 16000;
/** Допуск расширения проёмов при расчёте PVS, м. */
export const PVS_TOL_M = 0.05;

/** Нормализация настроек складчатого генератора (частичные и мусорные значения → в допустимые рамки). */
export function normFold(f?: Partial<FoldSettings> | null): FoldSettings {
  const s = { ...DEFAULT_FOLD, ...(f ?? {}) };
  const num = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
  return {
    shiftChance: Math.min(1, Math.max(0, num(s.shiftChance, DEFAULT_FOLD.shiftChance))),
    maxShift: Math.min(64, Math.max(0, Math.floor(num(s.maxShift, DEFAULT_FOLD.maxShift)))),
    localRadius: Math.min(16, Math.max(1, Math.floor(num(s.localRadius, DEFAULT_FOLD.localRadius)))),
    maxLayer: Math.min(1000, Math.max(0, Math.floor(num(s.maxLayer, DEFAULT_FOLD.maxLayer)))),
    seamless: s.seamless !== false,
  };
}

/** Нормализованные настройки складчатого генератора. */
export type FoldGenSettings = GeneratorSettings & { mode: 'fold'; fold: FoldSettings };

/** Режим порога для пары меток: 'never' у любой — без сдвига; 'always' у любой — сдвиг обязателен;
 *  'never' + 'always' — пара несовместима (null). Нет поля — 'auto'. */
export function shiftModeOf(a: ShiftMode | undefined, b: ShiftMode | undefined): ShiftMode | null {
  const x = a ?? 'auto', y = b ?? 'auto';
  if (x === 'never' || y === 'never') return x === 'always' || y === 'always' ? null : 'never';
  return x === 'always' || y === 'always' ? 'always' : 'auto';
}

/** Допустим ли сдвиг dw для пары меток с режимом mode. */
export function shiftOk(f: FoldSettings, mode: ShiftMode | null, dw: number): boolean {
  if (!mode || Math.abs(dw) > f.maxShift) return false;
  if (mode === 'never') return dw === 0;
  if (mode === 'always') return dw !== 0;
  return true;
}

// ───────────────────────── Пул ─────────────────────────

export interface Info {
  room: Room;
  /** индекс в p.rooms — порядок пула */
  index: number;
  /** ростовые метки и потенциал — из analyzeGrowth (§4.2 GENERATOR.md) */
  grow: boolean[];
  pot: number[];
  leaf: boolean;
  /** листовая метка: к ней можно пристыковать лист тихой меткой (§4.7) */
  leafC: boolean[];
  inPool: boolean;
  weight: number;
  effMin: number;
  effMax: number;
}

export const growOthers = (info: Info, bi: number): number => {
  let n = 0;
  info.grow.forEach((g, j) => { if (g && j !== bi) n++; });
  return n;
};

/** Пул (§4.1 GENERATOR.md). При пределе обзора комнаты, внутри которых обзор длиннее, исключаются
 *  до расчёта ростовых меток (§7.3 GENERATOR.md) — их список в tooLong. */
export function buildPool(p: Project, match: GeneratorSettings['match'], sightM: number, cellM: number):
  { infos: (Info | null)[]; pool: Info[]; tooLong: { room: Room; m: number }[] } {
  const ga = analyzeGrowth(p, { match, sightM });
  const infos = p.rooms.map((room, index): Info | null => {
    if (room.cells.size === 0) return null;
    const effMax = room.unique ? 1 : Math.max(0, Math.floor(room.gen.max));
    const effMin = Math.min(Math.max(0, Math.floor(room.gen.min)), effMax);
    const weight = Math.max(0, room.gen.weight);
    const a = ga[room.id];
    return {
      room, index,
      grow: a ? a.grow.slice() : room.connectors.map(() => false),
      pot: a ? a.pot.slice() : room.connectors.map(() => 0),
      leaf: a ? a.leaf : false,
      leafC: [],
      inPool: (weight > 0 || effMin > 0) && effMax > 0,
      weight, effMin, effMax,
    };
  });
  const tooLong: { room: Room; m: number }[] = [];
  if (sightM > 0) {
    for (const info of infos) {
      if (!info) continue;
      const m = roomSightM(info.room, cellM);
      if (m > sightM + 1e-9 && info.inPool) {
        info.inPool = false;
        tooLong.push({ room: info.room, m });
      }
    }
  }
  const pool = infos.filter((x): x is Info => !!x && x.inPool);
  const quiet: Connector[] = [];
  for (const s of pool) if (s.leaf) s.room.connectors.forEach((b, bi) => { if (b.len >= 1 && growOthers(s, bi) === 0) quiet.push(b); });
  for (const info of infos) {
    if (info) info.leafC = info.room.connectors.map((c) => c.len >= 1 && quiet.some((b) => compatible(c, b, match)));
  }
  return { infos, pool, tooLong };
}

// ───────────────────────── Раскладка ─────────────────────────

export type Why = 'nomatch' | 'max' | 'space' | 'rule' | 'sight' | 'seam';

/** Поставленный экземпляр. */
export interface Node {
  inst: Instance;
  info: Info;
  sh: FShape;
  body: Body;
  w: number;
  /** этаж (0 — этаж старта): меняется только переходом спец-локации (stream.ts, descend). Этаж — ещё одно
   *  измерение занятости, как W: комнаты разных этажей не пересекаются никогда (они друг над другом) */
  floor: number;
  x0: number; y0: number; x1: number; y1: number;
  /** мировые метки (порядок room.connectors) */
  conns: Connector[];
  linked: boolean[];
  /** причина, по которой метка осталась тупиком (последняя неудачная попытка) */
  why: (Why | undefined)[];
  /** соседи по связям (с повторами, если связей несколько) */
  nb: Node[];
  /** служебная метка обхода индекса занятости (Buckets) */
  mark?: number;
}

/** Ключ слоя занятости: (этаж, W). На этаже 0 — просто W (|W| ≤ 1000 < 2048 — ключи этажей не пересекаются). */
export const layerKey = (floor: number, w: number): number => (floor ? floor * 4096 + w : w);

export interface Lay {
  nodes: Node[];
  instances: Instance[];
  links: Link[];
  counts: Map<Info, number>;
  /** экземпляры по слоям: ключ layerKey(этаж, W) */
  layers: Map<number, Node[]>;
  /** индекс занятости по слоям (корзины, ключ layerKey) — если есть, проверка слоя идёт по нему, а не перебором слоя */
  grid?: Map<number, Buckets>;
  start: Info | null;
  maxBlocked: Set<Info>;
  /** центр масс поставленных клеток (все слои): Σx, Σy, Σвес */
  sx: number; sy: number; sw: number;
  /** пространство лучей обзора: комната на экземпляр (индекс = order), проём на связь (индекс = номер связи) */
  sight: SightSpace;
  /** PVS по экземплярам (индекс = order); наборы только растут */
  pvs: Set<number>[];
}

export function newLay(gap: number, indexed = false): Lay {
  return {
    nodes: [], instances: [], links: [], counts: new Map(), layers: new Map(), start: null, maxBlocked: new Set(),
    sx: 0, sy: 0, sw: 0, sight: new SightSpace(gap), pvs: [], ...(indexed ? { grid: new Map<number, Buckets>() } : {}),
  };
}

export interface Ctx {
  s: FoldGenSettings;
  f: FoldSettings;
  gap: number;
  shapes: Shapes;
  pool: Info[];
  /** предел обзора в клетках (null — без предела) */
  lim: { ortho: number; diag: number } | null;
  /** бесшовная видимость: дальность PVS и допуск проёмов, клетки (null — выключена) */
  seam: { reach: number; tol: number } | null;
  /** ходы и хабы подвала — длинный обзор (только бесконечный мир в режиме квартир; прогоны — строго по пределу) */
  long?: boolean;
}

/** Счётчики неудачных кандидатов метки — для причины тупика. */
export interface Fails { space: number; rule: number; sight: number; seam: number }

export function pickWeighted(rng: Rng, weights: number[]): number {
  if (weights.length === 0) return -1;
  const i = rng.weightedIndex(weights);
  return i < 0 ? 0 : i;
}

/** Поставить экземпляр в слой w этажа floor (по умолчанию — этаж родителя, у старта 0). */
export function place(ctx: Ctx, lay: Lay, info: Info, rot: Rot, dx: number, dy: number, w: number, parent: Node | null,
  floor: number = parent ? parent.floor : 0): Node {
  const sh = ctx.shapes.get(info.room, rot);
  const n = lay.instances.length;
  const inst: Instance = {
    id: `i${n}`, roomId: info.room.id, rot, dx, dy, order: n,
    parent: parent ? parent.inst.id : null,
    depth: parent ? parent.inst.depth + 1 : 0,
    w,
    // этаж пишется, только если не 0 (прогоны без спец-локаций не меняются)
    ...(floor ? { floor } : {}),
  };
  const node: Node = {
    inst, info, sh, body: { sh, dx, dy }, w, floor,
    x0: sh.x0 + dx, y0: sh.y0 + dy, x1: sh.x1 + dx, y1: sh.y1 + dy,
    conns: sh.conns.map((c) => ({ ...c, cx: c.cx + dx, cy: c.cy + dy })),
    linked: info.room.connectors.map(() => false),
    why: info.room.connectors.map(() => undefined),
    nb: [],
  };
  lay.nodes.push(node);
  lay.instances.push(inst);
  const lk = layerKey(floor, w);
  let layer = lay.layers.get(lk);
  if (!layer) lay.layers.set(lk, (layer = []));
  layer.push(node);
  if (lay.grid) {
    let g = lay.grid.get(lk);
    if (!g) lay.grid.set(lk, (g = new Buckets()));
    g.add(node);
  }
  lay.counts.set(info, (lay.counts.get(info) ?? 0) + 1);
  lay.sight.addRoom(sh, dx, dy, !!ctx.long && longSight(info.room));
  lay.pvs.push(new Set([n]));
  const k = sh.xs.length;
  lay.sx += ((node.x0 + node.x1) / 2) * k;
  lay.sy += ((node.y0 + node.y1) / 2) * k;
  lay.sw += k;
  return node;
}

export function link(lay: Lay, a: Node, ai: number, b: Node, bi: number): void {
  a.linked[ai] = true;
  b.linked[bi] = true;
  a.nb.push(b);
  b.nb.push(a);
  lay.sight.addPortal(a.inst.order, a.conns[ai], b.inst.order, b.conns[bi]);
  lay.links.push({ a: { inst: a.inst.id, connector: a.conns[ai].id }, b: { inst: b.inst.id, connector: b.conns[bi].id }, dw: b.w - a.w });
}

/** Экземпляры на расстоянии ≤ depth по графу связей от from (BFS), с расстояниями. */
export function around(from: Node, depth: number): Map<Node, number> {
  const d = new Map<Node, number>([[from, 0]]);
  let frontier = [from];
  for (let k = 1; k <= depth && frontier.length > 0; k++) {
    const next: Node[] = [];
    for (const x of frontier) for (const y of x.nb) if (!d.has(y)) { d.set(y, k); next.push(y); }
    frontier = next;
  }
  return d;
}

/** Свободно ли тело в слое w этажа floor (гарантия 1: в одном слое нет пересечений). */
export function layerFree(ctx: Ctx, lay: Lay, w: number, body: Body, floor = 0): boolean {
  const lk = layerKey(floor, w);
  if (lay.grid) {
    const g = lay.grid.get(lk);
    if (!g) return true;
    const sh = body.sh;
    return !g.some(sh.x0 + body.dx, sh.y0 + body.dy, sh.x1 + body.dx, sh.y1 + body.dy, ctx.gap, (x) => ctx.shapes.conflict(body, x.body));
  }
  const list = lay.layers.get(lk);
  if (!list) return true;
  for (const x of list) if (ctx.shapes.conflict(body, x.body)) return false;
  return true;
}

/**
 * Порядок проб сдвига dw для порога с режимом mode у родителя в слое wP (§4.4 GENERATOR-4D.md).
 * Первый — розыгрыш: 'never' → 0; 'always' → случайный ненулевой; 'auto' → с вероятностью shiftChance
 * случайный ненулевой, иначе 0. Затем остальные допустимые по |dw| (0, 1, 2…), при равном |dw| —
 * сначала в сторону слоя 0. Слои с |W| > maxLayer отбрасываются.
 */
export function dwOrder(f: FoldSettings, mode: ShiftMode, wP: number, rng: Rng): number[] {
  const M = f.maxShift;
  const randNZ = () => {
    const k = rng.int(1, 2 * M);
    return k <= M ? k : M - k;
  };
  let first = 0;
  if (mode === 'always') first = randNZ();
  else if (mode === 'auto' && M > 0 && f.shiftChance > 0 && rng.chance(f.shiftChance)) first = randNZ();
  const out = [first];
  if (mode !== 'never') {
    if (mode === 'auto' && first !== 0) out.push(0);
    for (let k = 1; k <= M; k++) {
      const a = wP <= 0 ? k : -k;
      if (a !== first) out.push(a);
      if (-a !== first) out.push(-a);
    }
  }
  return out.filter((d) => Math.abs(wP + d) <= f.maxLayer);
}

/** Настройки складчатой стыковки для потокового мира. */
export interface GrowOpts {
  /** вес комнаты при взвешенном выборе (по умолчанию room.gen.weight; поток — ветвистость и модификаторы сида) */
  weightOf?: (info: Info) => number;
  /** выпавшую комнату ставить нельзя (unique уже есть, max в окрестности) — пропустить без бросков. Комната
   *  остаётся в списке весов, поэтому выбор остальных не зависит от того, где она уже встала */
  skip?: (info: Info) => boolean;
  /** «комната важнее слоя»: кандидат сразу пробует все свои dw (без отложенной фазы 2) — выбор комнаты не
   *  зависит от занятости слоёв, от неё зависит только W */
  stick?: boolean;
}

/** Кандидат стыковки, прошедший правила порогов и локальную проверку: тело в 3D и порядок проб dw. */
interface Cand { info: Info; bi: number; rot: Rot; body: Body; order: number[]; pvs: number[] | null }

/**
 * Складчатая стыковка к метке ai родителя (§4.4 GENERATOR-4D.md).
 * Фаза 1: кандидаты (комната, её метка) — ленивый взвешенный перебор по группам, метки комнаты —
 * rng.shuffle (как в §4.5 GENERATOR.md). Для каждого: правила порогов → границы мира → нет пересечений
 * с near (комнаты в радиусе localRadius − 1 от родителя, гарантия 2) → предел обзора → бесшовность (PVS) →
 * розыгрыш порядка dw →
 * проба только первого dw. Фаза 2 — складка «по нужде»: если никто не встал, те же кандидаты в том же
 * порядке пробуют остальные dw, без бросков ГСЧ. Возвращает новый экземпляр или null.
 * opts — настройки потокового мира (stream.ts); прогон fold.ts их не передаёт.
 */
export function growFrom(ctx: Ctx, lay: Lay, parent: Node, ai: number, groups: Info[][], okB: (info: Info, b: Connector, bi: number) => boolean,
  rng: Rng, fails: Fails, opts: GrowOpts = {}): Node | null {
  const weightOf = opts.weightOf ?? ((x: Info) => x.weight);
  const A = parent.conns[ai];
  const g = ctx.gap;
  let near: Node[] | null = null;
  const tried: Cand[] = [];
  const put = (c: Cand, dw: number): Node => {
    const child = place(ctx, lay, c.info, c.rot, c.body.dx, c.body.dy, parent.w + dw, parent);
    link(lay, parent, ai, child, c.bi);
    if (c.pvs) addPvs(lay, child.inst.order, c.pvs);
    return child;
  };
  for (const group of groups) {
    const rest = group.slice();
    while (rest.length > 0) {
      const info = rest.splice(pickWeighted(rng, rest.map(weightOf)), 1)[0];
      if (opts.skip?.(info)) continue;
      const bIdx: number[] = [];
      info.room.connectors.forEach((b, i) => { if (okB(info, b, i)) bIdx.push(i); });
      rng.shuffle(bIdx);
      for (const bi of bIdx) {
        const B0 = info.room.connectors[bi];
        const mode = shiftModeOf(A.shift, B0.shift);
        if (!mode || (mode === 'always' && ctx.f.maxShift === 0)) { fails.rule++; continue; }
        const rot = rotFor(B0.side, OPPOSITE[A.side]);
        const sh = ctx.shapes.get(info.room, rot);
        const Bw = sh.conns[bi];
        const t = dockTarget(A, Bw.len, g);
        const dx = t.cx - Bw.cx, dy = t.cy - Bw.cy;
        if (sh.x0 + dx - g < -LIMIT || sh.y0 + dy - g < -LIMIT || sh.x1 + dx + g > LIMIT || sh.y1 + dy + g > LIMIT) { fails.space++; continue; }
        const body: Body = { sh, dx, dy };
        // гарантия 2: родитель и его соседи окажутся на расстоянии ≤ localRadius от новой комнаты
        near ??= [...around(parent, ctx.f.localRadius - 1).keys()];
        if (near.some((x) => x.floor === parent.floor && ctx.shapes.conflict(body, x.body))) { fails.space++; continue; }
        // предел обзора и бесшовность — по пробной геометрии (комната + проём); слой на них не влияет,
        // поэтому отказ — повод пробовать следующего кандидата, а не другой dw
        let pvs: number[] | null = null;
        if (ctx.lim || ctx.seam) {
          const why = probe(ctx, lay, parent, A, body, { ...Bw, cx: Bw.cx + dx, cy: Bw.cy + dy }, !!ctx.long && longSight(info.room));
          if (why === 'sight') { fails.sight++; continue; }
          if (why === 'seam') { fails.seam++; continue; }
          pvs = why;
        }
        const c: Cand = { info, bi, rot, body, order: dwOrder(ctx.f, mode, parent.w, rng), pvs };
        if (opts.stick) {
          for (const dw of c.order) if (layerFree(ctx, lay, parent.w + dw, body, parent.floor)) return put(c, dw);
          fails.space++;
          continue;
        }
        if (c.order.length > 0 && layerFree(ctx, lay, parent.w + c.order[0], body, parent.floor)) return put(c, c.order[0]);
        tried.push(c);
        fails.space++;
      }
    }
  }
  for (const c of tried) {
    for (let k = 1; k < c.order.length; k++) if (layerFree(ctx, lay, parent.w + c.order[k], c.body, parent.floor)) return put(c, c.order[k]);
  }
  return null;
}

/**
 * Пробная стыковка: комната-кандидат и проём связи добавляются в пространство лучей и снимаются.
 * 1) Предел обзора: все линии через клетки проёма (назад — в родителя и дальше, вперёд — в кандидата) ≤ предела.
 * 2) Бесшовность: PVS кандидата по пробной геометрии. Видимость симметрична, поэтому кандидат попадёт ровно
 *    в PVS(A) для A ∈ PVS(R) — он не должен пересекаться ни с одной комнатой этих наборов; и сам PVS(R)
 *    попарно не пересекается (пары, уже лежащие в PVS родителя, проверены раньше).
 * Возвращает PVS кандидата (null — бесшовность выключена) или причину отказа.
 */
function probe(ctx: Ctx, lay: Lay, parent: Node, A: Connector, body: Body, B: Connector, long = false): number[] | null | 'sight' | 'seam' {
  const S = lay.sight;
  const ci = S.addRoom(body.sh, body.dx, body.dy, long);
  const pi = S.addPortal(parent.inst.order, A, ci, B);
  let res: number[] | null | 'sight' | 'seam' = null;
  if (ctx.lim && !S.portalOk(pi, ctx.lim)) res = 'sight';
  else if (ctx.seam) {
    const pvs = computePvs(S, ci, ctx.seam.reach, ctx.seam.tol);
    res = pvsOk(ctx, lay, parent.inst.order, body, pvs, ci) ? pvs : 'seam';
  }
  S.popPortal();
  S.popRoom();
  return res;
}

function pvsOk(ctx: Ctx, lay: Lay, par: number, body: Body, pvs: number[], ci: number): boolean {
  const nodes = lay.nodes;
  const seen = new Set<number>([ci]);
  for (const a of pvs) {
    if (a === ci) continue;
    for (const m of [a, ...lay.pvs[a]]) {
      if (seen.has(m)) continue;
      seen.add(m);
      if (ctx.shapes.conflict(body, nodes[m].body)) return false;
    }
  }
  const pp = lay.pvs[par];
  const others = pvs.filter((a) => a !== ci);
  for (let i = 0; i < others.length; i++) {
    for (let j = i + 1; j < others.length; j++) {
      const x = others[i], y = others[j];
      if (pp.has(x) && pp.has(y)) continue;
      if (ctx.shapes.conflict(nodes[x].body, nodes[y].body)) return false;
    }
  }
  return true;
}

/** Записать PVS нового экземпляра r и добавить его в наборы тех, кого он видит (симметрия видимости). */
export function addPvs(lay: Lay, r: number, pvs: number[]): void {
  const own = lay.pvs[r];
  for (const a of pvs) {
    own.add(a);
    if (a !== r) lay.pvs[a].add(r);
  }
}

/**
 * PVS для петли X–Y (проём уже добавлен — на пробу или насовсем): новые прямые проходят через X и Y,
 * поэтому затронуты только комнаты, видящие X или Y, — {X, Y} ∪ PVS(X) ∪ PVS(Y). Их наборы пересчитываются
 * (объединяются со старыми). check — бесшовность: новые члены не должны пересекаться с остальными
 * (иначе null — петлю не замыкать). Возвращает новые наборы изменившихся комнат.
 */
export function loopPvs(ctx: Ctx, lay: Lay, x: number, y: number, reach: number, tol: number, check: boolean): Map<number, Set<number>> | null {
  const aff = [...new Set([x, y, ...lay.pvs[x], ...lay.pvs[y]])].sort((a, b) => a - b);
  const upd = new Map<number, Set<number>>();
  const nodes = lay.nodes;
  for (const z of aff) {
    const old = lay.pvs[z];
    const nw = new Set(old);
    for (const m of computePvs(lay.sight, z, reach, tol)) nw.add(m);
    if (nw.size === old.size) continue;
    if (check) {
      const mem = [...nw];
      for (const m of mem) {
        if (old.has(m)) continue;
        for (const q of mem) {
          if (q !== m && ctx.shapes.conflict(nodes[m].body, nodes[q].body)) return null;
        }
      }
    }
    upd.set(z, nw);
  }
  return upd;
}

export function failWhy(lay: Lay, pool: Info[], A: Connector, match: GeneratorSettings['match'], hadCand: boolean, fails: Fails,
  filter: (info: Info) => boolean): Why {
  if (hadCand) return fails.sight > 0 ? 'sight' : fails.seam > 0 ? 'seam' : fails.rule > 0 && fails.space === 0 ? 'rule' : 'space';
  const blocked = pool.filter((info) => filter(info) && (lay.counts.get(info) ?? 0) >= info.effMax &&
    info.room.connectors.some((b) => b.len >= 1 && compatible(A, b, match)));
  for (const b of blocked) lay.maxBlocked.add(b);
  return blocked.length ? 'max' : 'nomatch';
}

/** Новая связь A–B укорачивает пути: d'(X, Y) = d(X, A) + 1 + d(B, Y). Все пары, попавшие так
 *  в радиус localRadius, не должны пересекаться (гарантия 2). */
export function loopLocalOk(ctx: Ctx, A: Node, B: Node): boolean {
  const R = ctx.f.localRadius;
  const da = around(A, R - 1);
  const db = around(B, R - 1);
  for (const [x, ix] of da) {
    for (const [y, iy] of db) {
      if (x === y || ix + 1 + iy > R || x.floor !== y.floor) continue;
      if (ctx.shapes.conflict(x.body, y.body)) return false;
    }
  }
  return true;
}

/**
 * Замкнуть петлю: связать несвязанную метку ai экземпляра a с меткой bi экземпляра b (§4.5 GENERATOR-4D.md),
 * если метки совместимы и стоят лицом к лицу в 3D, dw допустим правилами порогов, гарантия 2 цела, проём
 * не открывает линию длиннее предела и (при бесшовности) не делает пересекающиеся комнаты взаимно видимыми.
 * pvs — пересчитать PVS затронутых комнат и без бесшовности (потоковый мир хранит PVS всегда).
 * ГСЧ не используется. true — связь добавлена.
 */
export function tryLink(ctx: Ctx, lay: Lay, a: Node, ai: number, b: Node, bi: number, pvs?: { reach: number; tol: number } | null): boolean {
  const A = a.conns[ai], B = b.conns[bi];
  if (!compatible(A, B, ctx.s.match) || !facing(A, B, ctx.gap)) return false;
  if (!shiftOk(ctx.f, shiftModeOf(A.shift, B.shift), b.w - a.w)) return false;
  if (!loopLocalOk(ctx, a, b)) return false;
  let upd: Map<number, Set<number>> | null = null;
  if (ctx.lim || ctx.seam) {
    // петля не должна открыть линию длиннее предела и нарушить бесшовность
    const S = lay.sight;
    const pi = S.addPortal(a.inst.order, A, b.inst.order, B);
    let ok = !ctx.lim || S.portalOk(pi, ctx.lim);
    if (ok && ctx.seam) {
      upd = loopPvs(ctx, lay, a.inst.order, b.inst.order, ctx.seam.reach, ctx.seam.tol, true);
      ok = upd !== null;
    }
    S.popPortal();
    if (!ok) return false;
  }
  link(lay, a, ai, b, bi);
  if (!upd && pvs) upd = loopPvs(ctx, lay, a.inst.order, b.inst.order, pvs.reach, pvs.tol, false);
  if (upd) for (const [z, set] of upd) lay.pvs[z] = set;
  return true;
}

// ───────────────────────── Индекс занятости ─────────────────────────

/** Сторона корзины индекса, клетки. */
const BUCKET = 32;
let STAMP = 0;
const bkey = (bx: number, by: number) => (bx + 2048) * 4096 + (by + 2048);

/** Корзины по плану: экземпляр лежит во всех корзинах, которые задевает его bbox. Порядок обхода на
 *  результат не влияет (проверки — «есть ли хоть один»/«сколько»). */
export class Buckets {
  private readonly m = new Map<number, Node[]>();

  add(n: Node): void {
    for (let bx = Math.floor(n.x0 / BUCKET); bx <= Math.floor((n.x1 - 1) / BUCKET); bx++) {
      for (let by = Math.floor(n.y0 / BUCKET); by <= Math.floor((n.y1 - 1) / BUCKET); by++) {
        const k = bkey(bx, by);
        const list = this.m.get(k);
        if (list) list.push(n);
        else this.m.set(k, [n]);
      }
    }
  }

  /** Есть ли экземпляр с bbox ближе g к [x0, x1) × [y0, y1), для которого hit — true. Каждый — не больше раза. */
  some(x0: number, y0: number, x1: number, y1: number, g: number, hit: (n: Node) => boolean): boolean {
    const st = ++STAMP;
    for (let bx = Math.floor((x0 - g) / BUCKET); bx <= Math.floor((x1 + g - 1) / BUCKET); bx++) {
      for (let by = Math.floor((y0 - g) / BUCKET); by <= Math.floor((y1 + g - 1) / BUCKET); by++) {
        const list = this.m.get(bkey(bx, by));
        if (!list) continue;
        for (const n of list) {
          if (n.mark === st) continue;
          n.mark = st;
          if (n.x1 + g <= x0 || x1 + g <= n.x0 || n.y1 + g <= y0 || y1 + g <= n.y0) continue;
          if (hit(n)) return true;
        }
      }
    }
    return false;
  }
}
