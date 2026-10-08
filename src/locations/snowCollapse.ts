// Обвал в снежных ходах (биом «Снежные тоннели», docs/GENERATOR-4D.md §20) — механика без движка, в стиле
// stairwell.ts / lift.ts: розыгрыш по ключу, состояние, шаг → события.
//
// Правило для игрока (collapseRule): «Затрещало и сыплется снег — уползай от места, где сыплется: через 2 с свод
// рухнет и навсегда завалит этот лаз. Не успел — засыпало: откапывайся (E), напарник откопает быстрее».
//
//  • Обвалы — только в лазах (не в берлогах): через каждые everyM метров, проползённых в лазах (порог — бросок на
//    каждый обвал, поток makeRng(seed + "/c" + n)). Дошёл до порога — движок выбирает место (проём текущего куска,
//    ближайший к игроку, если его завал не запирает игрока: из куска остаётся путь в ещё не раскрытые ходы) и зовёт
//    startCollapse; места нет — отсрочка на retryM метров.
//  • Треск (warn, warnS с): сыплется снег, трещит свод. Затем — обвал (fall): проём заваливает навсегда (мир —
//    StreamWorld.collapse), игрок ближе buryM к месту обвала — засыпан (buried).
//  • Засыпан: работа откопки 0 → 1; нажатие E — +1/digSelf, напарник снаружи — +1/digMate за нажатие (игра
//    кооперативная). Откопался — freed: игрок вылезает на свою сторону завала (туда, откуда полз). Смерти нет.
import { makeRng } from '../model/rng';

export interface CollapseSpec {
  /** метров ползком в лазах между обвалами: случайно в [min, max] на каждый обвал */
  everyM: [number, number];
  /** треск до обвала, с */
  warnS: number;
  /** игрок ближе стольких метров к месту обвала (по плану) — засыпан */
  buryM: number;
  /** нажатий E, чтобы откопаться самому */
  digSelf: number;
  /** нажатий E напарника, чтобы откопать засыпанного */
  digMate: number;
  /** места нет (завал запер бы игрока) — следующая попытка через столько метров */
  retryM: number;
}

export const DEFAULT_COLLAPSE: CollapseSpec = { everyM: [45, 110], warnS: 2, buryM: 1.1, digSelf: 12, digMate: 4, retryM: 6 };

export type CollapsePhase = 'calm' | 'warn' | 'buried';

export interface CollapseSite {
  /** экземпляр и метка проёма, который заваливает */
  inst: string;
  connector: string;
  /** место обвала (план, метры) */
  x: number;
  y: number;
}

export interface CollapseState {
  seed: string;
  phase: CollapsePhase;
  /** метров ползком в лазах всего */
  crawled: number;
  /** порог следующего обвала (метры ползком) */
  next: number;
  /** сколько обвалов было */
  count: number;
  site: CollapseSite | null;
  /** время в фазе, с */
  t: number;
  /** работа откопки 0…1 */
  dig: number;
  /** засыпало раз */
  buried: number;
}

export type CollapseEvent =
  | { type: 'due' }
  | { type: 'crack'; site: CollapseSite; warnS: number }
  | { type: 'crumbs'; site: CollapseSite; k: number }
  | { type: 'fall'; site: CollapseSite; buried: boolean }
  | { type: 'dig'; progress: number; by: 'self' | 'mate' }
  | { type: 'freed'; site: CollapseSite };

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const fin = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** Толерантный разбор (мусор — по умолчанию, диапазон упорядочен). */
export function normCollapse(v: unknown): CollapseSpec {
  const D = DEFAULT_COLLAPSE;
  const o = v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  const r = Array.isArray(o.everyM) && fin(o.everyM[0]) && fin(o.everyM[1]) ? [clamp(o.everyM[0], 5, 10000), clamp(o.everyM[1], 5, 10000)] : [...D.everyM];
  return {
    everyM: r[0] <= r[1] ? [r[0], r[1]] : [r[1], r[0]],
    warnS: fin(o.warnS) ? clamp(o.warnS, 0.3, 30) : D.warnS,
    buryM: fin(o.buryM) ? clamp(o.buryM, 0, 10) : D.buryM,
    digSelf: fin(o.digSelf) ? clamp(Math.round(o.digSelf), 1, 200) : D.digSelf,
    digMate: fin(o.digMate) ? clamp(Math.round(o.digMate), 1, 200) : D.digMate,
    retryM: fin(o.retryM) ? clamp(o.retryM, 1, 1000) : D.retryM,
  };
}

const threshold = (spec: CollapseSpec, seed: string, n: number, from: number) => {
  const [a, b] = spec.everyM;
  return from + a + (b - a) * makeRng(`${seed}/c${n}`).next();
};

/** Новое состояние (seed — ключ мира/игрока: тот же сид — те же пороги). */
export function createCollapse(spec: CollapseSpec, seed: string): CollapseState {
  return { seed, phase: 'calm', crawled: 0, next: threshold(spec, seed, 0, 0), count: 0, site: null, t: 0, dig: 0, buried: 0 };
}

/**
 * Шаг: dt — секунды, crawledM — сколько метров игрок прополз за шаг в лазе (в берлоге и стоя — 0), player — где он
 * (план, метры). Событие 'due' — пора обвалу: движок выбирает место и зовёт startCollapse (или postponeCollapse).
 */
export function stepCollapse(spec: CollapseSpec, s: CollapseState, dt: number, crawledM: number, player: { x: number; y: number }): CollapseEvent[] {
  const out: CollapseEvent[] = [];
  if (s.phase === 'calm') {
    s.crawled += Math.max(0, crawledM);
    if (s.crawled >= s.next) out.push({ type: 'due' });
    return out;
  }
  s.t += dt;
  if (s.phase === 'warn' && s.site) {
    const k = clamp(s.t / spec.warnS, 0, 1);
    out.push({ type: 'crumbs', site: s.site, k });
    if (s.t >= spec.warnS) {
      const d = Math.hypot(player.x - s.site.x, player.y - s.site.y);
      const buried = d < spec.buryM;
      out.push({ type: 'fall', site: s.site, buried });
      s.count++;
      if (buried) {
        s.phase = 'buried';
        s.t = 0;
        s.dig = 0;
        s.buried++;
      } else endCollapse(spec, s);
    }
  }
  return out;
}

/** Обвал начался у места site (треск). */
export function startCollapse(spec: CollapseSpec, s: CollapseState, site: CollapseSite): CollapseEvent[] {
  if (s.phase !== 'calm') return [];
  s.phase = 'warn';
  s.site = site;
  s.t = 0;
  return [{ type: 'crack', site, warnS: spec.warnS }];
}

/** Места для обвала нет — следующая попытка через retryM метров. */
export function postponeCollapse(spec: CollapseSpec, s: CollapseState): void {
  s.next = s.crawled + spec.retryM;
}

function endCollapse(spec: CollapseSpec, s: CollapseState) {
  s.phase = 'calm';
  s.site = null;
  s.t = 0;
  s.dig = 0;
  s.next = threshold(spec, s.seed, s.count, s.crawled);
}

/** Нажатие E засыпанного (by 'self') или напарника снаружи ('mate'). */
export function digCollapse(spec: CollapseSpec, s: CollapseState, by: 'self' | 'mate' = 'self'): CollapseEvent[] {
  if (s.phase !== 'buried' || !s.site) return [];
  s.dig = Math.min(1, s.dig + 1 / (by === 'self' ? spec.digSelf : spec.digMate));
  const out: CollapseEvent[] = [{ type: 'dig', progress: s.dig, by }];
  if (s.dig >= 1 - 1e-9) {
    const site = s.site;
    endCollapse(spec, s);
    out.push({ type: 'freed', site });
  }
  return out;
}

/** Правило для игрока с числами настроек. */
export function collapseRule(spec: CollapseSpec = DEFAULT_COLLAPSE): string {
  return `Затрещало и сыплется снег — уползай от места, где сыплется: через ${spec.warnS} с свод рухнет и навсегда завалит этот лаз. ` +
    `Не успел — засыпало: откапывайся (E, ~${spec.digSelf} раз), напарник откопает быстрее (~${spec.digMate}).`;
}

// ───────────────────────── место обвала (по JSON прогона «Прогулки») ─────────────────────────

/** Минимум того, что нужно от экспорта прогона (RunExport, src/blockout/types.ts). */
export interface CollapseRun {
  cellM: number;
  settings?: { gap?: number; [k: string]: unknown };
  instances: {
    id: string;
    roomTags: string[];
    connectors: { id: string; side: 'N' | 'S' | 'E' | 'W'; len: number; line: [number, number, number, number]; linkedTo: { inst: string; connector: string } | null; cut?: boolean }[];
  }[];
}

/**
 * Место обвала у игрока (план, метры) в лазе roomId: проём куска, связанный с соседом, — ближайший к игроку, завал
 * которого не запирает игрока (из куска по оставшимся связям достижим ещё не раскрытый проём — мир дальше растёт).
 * В берлоге и в комнатах не из снега — null.
 */
export function collapseSite(run: CollapseRun, roomId: string, px: number, py: number): CollapseSite | null {
  const byId = new Map(run.instances.map((i) => [i.id, i]));
  const room = byId.get(roomId);
  if (!room || !room.roomTags.includes('снег') || room.roomTags.includes('берлога')) return null;
  const cell = run.cellM > 0 ? run.cellM : 0.1;
  const cands = room.connectors
    .filter((k) => k.len >= 1 && k.linkedTo)
    .map((k) => {
      const [x1, y1, x2, y2] = k.line;
      const x = ((x1 + x2) / 2) * cell, y = ((y1 + y2) / 2) * cell;
      return { k, x, y, d: Math.hypot(px - x, py - y) };
    })
    .sort((a, b) => a.d - b.d);
  for (const c of cands) {
    if (frontierWithout(byId, roomId, roomId, c.k.id)) return { inst: roomId, connector: c.k.id, x: c.x, y: c.y };
  }
  return null;
}

/** Из start по связям, кроме связи (inst, conn), достижим нераскрытый проём (cut). */
function frontierWithout(byId: Map<string, CollapseRun['instances'][number]>, start: string, inst: string, conn: string): boolean {
  const seen = new Set([start]);
  const q = [start];
  while (q.length) {
    const id = q.shift()!;
    const i = byId.get(id);
    if (!i) continue;
    for (const k of i.connectors) {
      if (k.len < 1) continue;
      if (k.cut) return true;
      const to = k.linkedTo;
      if (!to) continue;
      if ((id === inst && k.id === conn) || (to.inst === inst && to.connector === conn)) continue;
      if (!seen.has(to.inst)) {
        seen.add(to.inst);
        q.push(to.inst);
      }
    }
    if (seen.size > 4000) return true;
  }
  return false;
}
