// Складчатый (4D) генератор: комнаты стыкуются через пороги, которые могут сдвигать координату W.
// Комнаты разных слоёв W могут занимать одно и то же место в 3D. Контракт — FoldSettings/FoldStats
// в src/model/types.ts; алгоритм и порядок бросков ГСЧ — docs/GENERATOR-4D.md (движок повторяет дословно).
//
// Рост — как у евклидова генератора (§4 docs/GENERATOR.md: пул, ростовые метки, резерв, ленивый
// взвешенный перебор, стыковка лицом к лицу), но коллизия не глобальная: кандидату нужен свободный
// слой W (в пределах maxShift от родителя) и отсутствие пересечений с комнатами в радиусе
// localRadius − 1 по графу от родителя (локальная евклидовость). Предел обзора — по порталам
// (sight4d.ts): линия идёт сквозь проёмы связей независимо от слоёв.
// Складчатая стыковка, петли и PVS — общие с бесконечным миром (stream.ts), в foldcore.ts.
import { OPPOSITE, parseKey } from '../model/cells';
import { makeRng, type Rng } from '../model/rng';
import { segmentMid, tagsCompatible } from '../model/segments';
import type {
  Connector,
  FoldStats,
  GeneratorSettings,
  InstanceContent,
  Project,
  Run,
  RunStop,
} from '../model/types';
import { rollContent, withoutBiomeOnly } from '../gen/generate';
import { compatible, OUT_SIGN, segLine } from '../gen/geom';
import { runMeters, SIGHT_DIRS, sightLimits } from '../gen/sight';
import { walkWarning } from '../gen/walk';
import { runWorld } from '../gen/world';
import { connDz } from '../model/stairs';
import { isAbyss } from '../locations/fractalEntry'; // fractal
import {
  ATTEMPTS, buildPool, doorPoint, failWhy, longSight, growFrom, GROW_BONUS, growOthers, layerKey, LEAF_BONUS, LIMIT, localCells, newLay, normFold, place,
  pickWeighted, PVS_TOL_M, RESERVE, RESERVE_MAX, RESERVE_STEP, SUPPLY_FACTOR, tryLink,
  type Ctx, type Fails, type FoldGenSettings, type Info, type Lay, type Node,
} from './foldcore';
import { roomSightM, Shapes, type Body } from './space';

export { DEFAULT_FOLD, normFold, shiftModeOf } from './foldcore';

type Settings = FoldGenSettings;

function sanitize(p: Project, o?: Partial<GeneratorSettings>): Settings {
  const s = { ...p.generator, ...(o ?? {}) };
  return {
    seed: String(s.seed ?? ''),
    count: Math.max(1, Math.floor(Number(s.count) || 1)),
    gap: Math.min(64, Math.max(0, Math.floor(Number(s.gap) || 0))),
    match: s.match === 'tag' || s.match === 'len' ? s.match : 'exact',
    startRoomId: s.startRoomId ?? null,
    passId: s.passId ?? null,
    sightM: Math.max(0, Number(s.sightM) || 0),
    fill: s.fill === true,
    mode: 'fold',
    fold: normFold({ ...(p.generator.fold ?? {}), ...(o?.fold ?? {}) }),
  };
}

/** Одна попытка раскладки на потоке L: старт, рост, петли (§4.3–4.5 GENERATOR-4D.md). */
function attempt(ctx: Ctx, tagged: Info[], fixedStart: Info | null, L: Rng): Lay {
  const { s, pool } = ctx;
  const lay = newLay(ctx.gap);
  let start = fixedStart;
  if (!start) {
    if (tagged.length) start = tagged[pickWeighted(L, tagged.map((x) => x.weight))];
    else if (pool.length) start = pool[pickWeighted(L, pool.map((x) => x.weight))];
  }
  lay.start = start;
  if (!start) return lay;
  const cnt = (i: Info) => lay.counts.get(i) ?? 0;
  const first = place(ctx, lay, start, 0, 0, 0, 0, null);

  interface Open { pl: Node; ci: number; grow: boolean }
  const open: Open[] = [];
  // метки нового экземпляра (кроме той, которой он пристыкован) — в конец списка
  const pushOpen = (pl: Node) => {
    pl.info.room.connectors.forEach((c, ci) => { if (!pl.linked[ci] && c.len >= 1) open.push({ pl, ci, grow: pl.info.grow[ci] }); });
  };
  pushOpen(first);
  const leafBonus = s.fill ? LEAF_BONUS : 0;
  const keyOf = (o: Open) => o.pl.inst.depth - (o.grow ? GROW_BONUS : 0) - (o.pl.info.leafC[o.ci] ? leafBonus : 0);

  while (lay.instances.length < s.count && open.length > 0) {
    // резерв роста — как в §4.5 GENERATOR.md
    let gOpen = 0;
    for (const o of open) if (o.grow) gOpen++;
    const K = Math.min(RESERVE_MAX, Math.max(RESERVE, RESERVE + Math.floor((s.count - lay.instances.length) / RESERVE_STEP)));
    const few = gOpen > 0 && gOpen <= K;
    let supply = 0;
    for (const o of open) if (!o.grow) supply += o.pl.info.pot[o.ci];
    const reserve = few && supply * SUPPLY_FACTOR < s.count - lay.instances.length;
    let oi: number;
    if (reserve) {
      // рост наружу: ростовая метка, самая далёкая от центра масс (все слои), без ГСЧ
      oi = -1;
      let bestD = -1;
      const cx = lay.sx / lay.sw, cy = lay.sy / lay.sw;
      open.forEach((o, i) => {
        if (!o.grow) return;
        const [mx, my] = segmentMid(o.pl.conns[o.ci]);
        const d = (mx - cx) * (mx - cx) + (my - cy) * (my - cy);
        if (d > bestD + 1e-9) { bestD = d; oi = i; }
      });
    } else {
      let minKey = Infinity;
      for (const o of open) { const k = keyOf(o); if (k < minKey) minKey = k; }
      const cand: number[] = [];
      open.forEach((o, i) => { if (keyOf(o) === minKey) cand.push(i); });
      oi = cand[L.int(0, cand.length - 1)];
    }
    const { pl: parent, ci: aIdx } = open[oi];
    open.splice(oi, 1);
    const A = parent.conns[aIdx];

    const g1: Info[] = [];
    const g2: Info[] = [];
    for (const info of pool) {
      const c = cnt(info);
      if (c >= info.effMax) continue;
      if (!info.room.connectors.some((b) => b.len >= 1 && compatible(A, b, s.match))) continue;
      if (c < info.effMin) g1.push(info);
      else if (info.weight > 0) g2.push(info);
    }

    // при нехватке ростовых меток сначала ростовой проход (только комнаты, дающие рост), затем обычный
    const passes: boolean[] = few && parent.info.grow[aIdx] ? [true, false] : [false];
    let done = false;
    const fails: Fails = { space: 0, rule: 0, sight: 0, seam: 0 };
    for (const growOnly of passes) {
      const okB = (info: Info, b: Connector, bi: number) =>
        b.len >= 1 && compatible(A, b, s.match) && (!growOnly || growOthers(info, bi) > 0);
      const groups = growOnly ? [g1, g2].map((gr) => gr.filter((info) => info.room.connectors.some((b, bi) => okB(info, b, bi)))) : [g1, g2];
      const child = growFrom(ctx, lay, parent, aIdx, groups, okB, L, fails);
      if (child) { pushOpen(child); done = true; break; }
    }
    if (!done) parent.why[aIdx] = failWhy(lay, pool, A, s.match, g1.length + g2.length > 0, fails, () => true);
  }

  closeLoops(ctx, lay);
  return lay;
}

/**
 * Замыкание петель (§4.5 GENERATOR-4D.md): несвязанные метки разных экземпляров, стоящие лицом к лицу
 * в 3D (в любых слоях), связываются, если совместимы, |dw| ≤ maxShift и правила порогов соблюдены,
 * новые короткие пути не сводят пересекающиеся комнаты ближе localRadius, а проём не открывает линию
 * обзора длиннее предела. ГСЧ не используется.
 */
function closeLoops(ctx: Ctx, lay: Lay): number {
  const { gap } = ctx;
  const free: { pl: Node; ci: number }[] = [];
  for (const pl of lay.nodes) pl.conns.forEach((c, ci) => { if (!pl.linked[ci] && c.len >= 1) free.push({ pl, ci }); });
  // индекс по линии: ответная метка лежит на стороне OPPOSITE(A.side) и линии A + gap·σ
  const byLine = new Map<string, number[]>();
  free.forEach((e, i) => {
    const c = e.pl.conns[e.ci];
    const k = `${c.side}:${segLine(c)}`;
    const list = byLine.get(k);
    if (list) list.push(i);
    else byLine.set(k, [i]);
  });
  let added = 0;
  for (let i = 0; i < free.length; i++) {
    const a = free[i];
    if (a.pl.linked[a.ci]) continue;
    const A = a.pl.conns[a.ci];
    const list = byLine.get(`${OPPOSITE[A.side]}:${segLine(A) + gap * OUT_SIGN[A.side]}`);
    if (!list) continue;
    for (const j of list) {
      if (j <= i) continue;
      const b = free[j];
      if (b.pl === a.pl || b.pl.linked[b.ci]) continue;
      // совместимость, лицом к лицу, правила порогов, гарантия 2, обзор, бесшовность — tryLink (foldcore.ts)
      if (!tryLink(ctx, lay, a.pl, a.ci, b.pl, b.ci)) continue;
      added++;
      break;
    }
  }
  return added;
}

/** Дозаполнение листьями (§4.6 GENERATOR-4D.md = §4.7 GENERATOR.md со складчатой стыковкой). */
function fillPass(ctx: Ctx, lay: Lay, F: Rng): number {
  const { s, pool } = ctx;
  const before = lay.instances.length;
  const queue: { pl: Node; ci: number }[] = [];
  const push = (pl: Node) => pl.conns.forEach((c, ci) => { if (!pl.linked[ci] && c.len >= 1) queue.push({ pl, ci }); });
  for (const pl of lay.nodes) push(pl);
  const cnt = (i: Info) => lay.counts.get(i) ?? 0;
  for (let qi = 0; qi < queue.length; qi++) {
    const { pl: parent, ci: aIdx } = queue[qi];
    if (parent.linked[aIdx]) continue;
    const A = parent.conns[aIdx];
    const okB = (info: Info, b: Connector, bi: number) => b.len >= 1 && compatible(A, b, s.match) && growOthers(info, bi) === 0;
    const g1: Info[] = [];
    const g2: Info[] = [];
    for (const info of pool) {
      if (!info.leaf) continue;
      const c = cnt(info);
      if (c >= info.effMax) continue;
      if (!info.room.connectors.some((b, bi) => okB(info, b, bi))) continue;
      if (c < info.effMin) g1.push(info);
      else if (info.weight > 0) g2.push(info);
    }
    const fails: Fails = { space: 0, rule: 0, sight: 0, seam: 0 };
    const child = growFrom(ctx, lay, parent, aIdx, [g1, g2], okB, F, fails);
    if (child) push(child);
    if (!child && parent.why[aIdx] === undefined) {
      parent.why[aIdx] = failWhy(lay, pool, A, s.match, g1.length + g2.length > 0, fails, (i) => i.leaf);
    }
  }
  closeLoops(ctx, lay);
  return lay.instances.length - before;
}

// ───────────────────────── Сводка и диагностика ─────────────────────────

/** Пары экземпляров, пересекающихся в 3D (клетки ближе gap), — по формам прогона. */
function conflictPairs(shapes: Shapes, nodes: Node[]): [Node, Node][] {
  const g = shapes.gap;
  const order = nodes.slice().sort((a, b) => a.x0 - b.x0 || a.inst.order - b.inst.order);
  const out: [Node, Node][] = [];
  for (let i = 0; i < order.length; i++) {
    const a = order[i];
    for (let j = i + 1; j < order.length; j++) {
      const b = order[j];
      if (b.x0 >= a.x1 + g) break;
      if (a.y1 + g <= b.y0 || b.y1 + g <= a.y0) continue;
      if (shapes.conflict(a.body, b.body)) out.push(a.inst.order < b.inst.order ? [a, b] : [b, a]);
    }
  }
  return out;
}

function stopReport(lay: Lay): { st: RunStop; rules: number; seam: number } {
  const st: RunStop = { open: 0, noMatch: 0, atMax: 0, noSpace: 0, sight: 0, maxRooms: [], noMatchTags: [] };
  const tags = new Set<string>();
  let rules = 0, seam = 0;
  for (const pl of lay.nodes) {
    pl.conns.forEach((c, ci) => {
      if (pl.linked[ci] || c.len < 1) return;
      st.open++;
      const why = pl.why[ci] ?? 'space';
      if (why === 'nomatch') { st.noMatch++; tags.add(c.tag); }
      else if (why === 'max') st.atMax++;
      else if (why === 'sight') st.sight++;
      else {
        st.noSpace++;
        if (why === 'rule') rules++;
        if (why === 'seam') seam++;
      }
    });
  }
  st.maxRooms = [...lay.maxBlocked].sort((a, b) => a.index - b.index).map((i) => i.room.id);
  st.noMatchTags = [...tags].sort();
  return { st, rules, seam };
}

function stopWarnings(st: RunStop, rules: number, seam: number, placed: number, s: Settings, p: Project): string[] {
  const out: string[] = [];
  const parts: string[] = [];
  if (st.noSpace - seam) parts.push(`нет места ни в одном допустимом слое — ${st.noSpace - seam}`);
  if (seam) parts.push(`бесшовность (PVS) — ${seam}`);
  if (st.atMax) parts.push(`все подходящие комнаты упёрлись в max — ${st.atMax}`);
  if (st.sight) parts.push(`предел обзора — ${st.sight}`);
  if (st.noMatch) parts.push(`нет совместимых комнат — ${st.noMatch}`);
  out.push(`Поставлено ${placed} из ${s.count} комнат: рост остановился, открытых меток ${st.open} (${parts.join(', ') || 'нет'}).`);
  const name = (id: string) => `«${p.rooms.find((r) => r.id === id)?.name ?? id}»`;
  if (st.maxRooms.length) out.push(`Совет: поднимите max у: ${st.maxRooms.slice(0, 12).map(name).join(', ')}${st.maxRooms.length > 12 ? ' и др.' : ''}.`);
  if (st.sight && st.sight * 4 >= st.open) out.push(`Совет: увеличьте предел обзора (сейчас ${s.sightM} м) — он отверг много стыковок.`);
  if (seam && seam * 4 >= st.open) out.push('Совет: бесшовность (PVS) отвергла много стыковок — уменьшите предел обзора или выключите seamless.');
  if (st.noSpace * 2 >= st.open && st.noSpace > rules + seam) {
    out.push(`Совет: мало места — увеличьте maxShift (сейчас ${s.fold.maxShift}) или maxLayer (${s.fold.maxLayer}), либо уменьшите localRadius (${s.fold.localRadius}).`);
  }
  if (rules) out.push(`Пороги: у ${rules} меток правила сдвига несовместимы (метка 'always' против 'never' или 'always' при maxShift = 0).`);
  if (st.noMatchTags.length) out.push(`Совет: для меток ${st.noMatchTags.map((t) => `«${t}»`).join(', ')} нет совместимых комнат в пуле — добавьте комнаты с ответными метками или уберите лишние.`);
  return out;
}

const now = (): number => (globalThis.performance ? globalThis.performance.now() : Date.now());

/** Сгенерировать складчатый прогон. Детерминирован по (проект, сид). Не мутирует проект.
 *  Instance.w, Link.dw и Run.fold заполнены. */
export function generateFoldRun(p0: Project, overrides?: Partial<GeneratorSettings>): Run {
  const t0 = now();
  // комнаты «только в биоме» растут только в бесконечном мире (docs/GENERATOR-4D.md §19.3)
  const p = withoutBiomeOnly(p0);
  const settings = sanitize(p, overrides);
  const f = settings.fold;
  const root = makeRng(settings.seed);
  const warnings: string[] = [];

  // ── 1. Пул ──
  const cellM = p.settings.cellM > 0 ? p.settings.cellM : 0.1;
  const lim = settings.sightM > 0 ? sightLimits(settings.sightM, cellM) : null;
  const { infos, pool, tooLong } = buildPool(p, settings.match, settings.sightM, cellM);
  if (tooLong.length) {
    const names = tooLong.map((t) => `«${t.room.name}» (${t.m} м)`).join(', ');
    warnings.push(`Предел обзора ${settings.sightM} м: исключены комнаты, внутри которых обзор длиннее — ${names}.`);
  }
  for (const r of p.rooms) {
    if (r.gen.min > 0 && r.cells.size === 0) warnings.push(`Комната «${r.name}» пуста (нет клеток) — пропущена, хотя min = ${r.gen.min}.`);
    const eMax = r.unique ? 1 : r.gen.max;
    if (r.cells.size > 0 && r.gen.min > Math.max(0, eMax)) {
      warnings.push(`Комната «${r.name}»: min = ${r.gen.min} больше max = ${Math.max(0, eMax)}${r.unique ? ' (уникальная)' : ''} — min урезан.`);
    }
  }

  // ── 2. Старт ──
  let fixedStart: Info | null = null;
  if (settings.startRoomId) {
    const i = p.rooms.findIndex((r) => r.id === settings.startRoomId);
    if (i < 0) warnings.push(`Стартовая комната (id ${settings.startRoomId}) не найдена — выбрана автоматически.`);
    else if (!infos[i]) warnings.push(`Стартовая комната «${p.rooms[i].name}» пуста — выбрана автоматически.`);
    else fixedStart = infos[i];
  }
  const tagged = infos.filter((x): x is Info => !!x && x.room.tags.includes('start'));

  // ── 3. Раскладка с перезапусками ──
  const seam = f.seamless && lim ? { reach: settings.sightM / cellM, tol: PVS_TOL_M / cellM } : null;
  if (!f.seamless) warnings.push('Бесшовная видимость выключена: рендер «комната + соседи» может показывать появление и исчезновение дверей.');
  else if (!lim) warnings.push('Бесшовная видимость работает только с пределом обзора (sightM > 0) — PVS не считается.');
  const ctx: Ctx = { s: settings, f, gap: settings.gap, shapes: new Shapes(settings.gap), pool, lim, seam, localC: localCells(f, cellM) };
  let best: Lay | null = null;
  let bestK = 0;
  for (let k = 0; k < ATTEMPTS; k++) {
    const lay = attempt(ctx, tagged, fixedStart, root.sub(k === 0 ? 'fold-layout' : `fold-layout:${k}`));
    if (!best || lay.instances.length > best.instances.length) { best = lay; bestK = k; }
    if (!lay.start || lay.instances.length >= settings.count) break;
  }
  const lay = best!;
  const filled = settings.fill && lay.start ? fillPass(ctx, lay, root.sub('fold-fill')) : 0;
  if (settings.fill && lay.start) warnings.push(`Дозаполнение: +${filled} комнат (итого ${lay.instances.length}).`);
  if (bestK > 0) warnings.push(`Раскладка: взята попытка ${bestK + 1} из ${ATTEMPTS} (предыдущие заглохли раньше count).`);
  const { nodes, instances, links, counts, start } = lay;
  if (start && lim) {
    const sm = roomSightM(start.room, cellM);
    if (sm > settings.sightM + 1e-9) {
      warnings.push(`Стартовая комната «${start.room.name}» сама длиннее предела обзора (${sm} м > ${settings.sightM} м) — поставлена всё равно.`);
    }
  }

  const openConnectors: Run['openConnectors'] = [];
  for (const pl of nodes) pl.conns.forEach((c, ci) => { if (!pl.linked[ci] && c.len >= 1) openConnectors.push({ inst: pl.inst.id, connector: c.id }); });

  if (!start) warnings.push('Нет ни одной комнаты для генерации (нужны клетки и вес > 0 или min > 0).');
  let stop: RunStop | undefined;
  if (start && instances.length < settings.count) {
    const { st, rules, seam } = stopReport(lay);
    stop = st;
    warnings.push(...stopWarnings(st, rules, seam, instances.length, settings, p));
  }
  for (const info of pool) {
    const c = counts.get(info) ?? 0;
    if (c < info.effMin) warnings.push(`Комната «${info.room.name}»: поставлено ${c} из минимума ${info.effMin}.`);
  }

  // ── 4. Сводка складок ──
  let minW = 0, maxW = 0;
  for (const n of nodes) { if (n.w < minW) minW = n.w; if (n.w > maxW) maxW = n.w; }
  let shifted = 0;
  for (const l of links) if (l.dw) shifted++;
  const fold: FoldStats = {
    minW, maxW,
    layers: lay.layers.size,
    overlaps: conflictPairs(ctx.shapes, nodes).length,
    shifted,
  };
  if (start) {
    const sg = (v: number) => (v > 0 ? `+${v}` : `${v}`);
    warnings.push(`Складки: слоёв ${fold.layers} (W от ${sg(minW)} до ${sg(maxW)}), порогов со сдвигом W — ${shifted} из ${links.length}, пар комнат в одном месте 3D — ${fold.overlaps}.`);
  }

  // ── 5. Наполнение — как у евклидова (§5 GENERATOR.md): поток content:id, отделка — finish:id ──
  const pass = settings.passId ? p.economy.passes.find((x) => x.id === settings.passId) ?? null : null;
  if (settings.passId && !pass) warnings.push(`Проходка (id ${settings.passId}) не найдена — розыгрыш без неё.`);
  const content: InstanceContent[] = [];
  const accById = new Map<string, number>();
  for (const pl of nodes) {
    const c = rollContent(p, pl.info.room, pl.inst, root.sub(`content:${pl.inst.id}`), pass, root.sub(`finish:${pl.inst.id}`));
    c.dangerAcc = (pl.inst.parent ? accById.get(pl.inst.parent) ?? 0 : 0) + c.danger;
    accById.set(pl.inst.id, c.dangerAcc);
    content.push(c);
  }
  const walkW = walkWarning(content);
  if (walkW) warnings.push(walkW);
  const totals: Record<string, number> = {};
  for (const c of content) {
    for (const l of c.loot) totals[l.itemId] = (totals[l.itemId] ?? 0) + l.count;
    for (const sp of c.spots) if (sp.content && sp.content.kind === 'item') totals[sp.content.id] = (totals[sp.content.id] ?? 0) + 1;
  }

  return {
    seed: settings.seed,
    settings,
    instances,
    links,
    openConnectors,
    content,
    totals,
    warnings,
    // самая длинная линия по порталам (§13 GENERATOR-4D.md)
    sight: lay.sight.scan(cellM),
    ...(seam ? { pvs: Object.fromEntries(nodes.map((n, i) => [n.inst.id, [...lay.pvs[i]].sort((a, b) => a - b).map((j) => nodes[j].inst.id)])) } : {}),
    ...(stop ? { stop } : {}),
    fold,
    ms: Math.round((now() - t0) * 100) / 100,
  };
}

// ───────────────────────── Видимость и соседство в 4D ─────────────────────────

const adjCache = new WeakMap<Run, Map<string, string[]>>();

function adjacency(run: Run): Map<string, string[]> {
  let adj = adjCache.get(run);
  if (adj && adj.size === run.instances.length) return adj;
  adj = new Map(run.instances.map((i) => [i.id, [] as string[]]));
  for (const l of run.links) {
    if (l.kind === 'descent' || l.kind === 'lift') continue; // переход спец-локации / выход лифта — не дверь
    adj.get(l.a.inst)?.push(l.b.inst);
    adj.get(l.b.inst)?.push(l.a.inst);
  }
  adjCache.set(run, adj);
  return adj;
}

/** Что видит игрок, стоящий в экземпляре instId: он сам + экземпляры на расстоянии ≤ depth по графу
 *  связей (через двери). Гарантия генератора: при depth·2 ≤ localRadius этот набор не пересекается в 3D. */
export function visibleSet(run: Run, instId: string, depth: number): Set<string> {
  const adj = adjacency(run);
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

/** Пары экземпляров, занимающих одно место в 3D (клетки ближе gap, один этаж) — «соседство в 4D» для детекторов.
 *  Комнаты разных этажей (Instance.floor) друг над другом и не пересекаются. Пары [a, b] с order(a) < order(b),
 *  отсортированы по (a, b). */
export function overlapPairs(p: Project, run: Run): [string, string][] {
  const shapes = new Shapes(Math.max(0, run.settings.gap));
  const rooms = new Map(p.rooms.map((r) => [r.id, r]));
  const items: { id: string; order: number; floor: number; body: Body; x0: number; y0: number; x1: number; y1: number }[] = [];
  for (const inst of run.instances) {
    const room = rooms.get(inst.roomId);
    if (!room || room.cells.size === 0) continue;
    const sh = shapes.get(room, inst.rot);
    items.push({ id: inst.id, order: inst.order, floor: inst.floor ?? 0, body: { sh, dx: inst.dx, dy: inst.dy }, x0: sh.x0 + inst.dx, y0: sh.y0 + inst.dy, x1: sh.x1 + inst.dx, y1: sh.y1 + inst.dy });
  }
  const g = shapes.gap;
  items.sort((a, b) => a.x0 - b.x0 || a.order - b.order);
  const out: { a: number; b: number; ids: [string, string] }[] = [];
  for (let i = 0; i < items.length; i++) {
    const a = items[i];
    for (let j = i + 1; j < items.length; j++) {
      const b = items[j];
      if (b.x0 >= a.x1 + g) break;
      if (a.floor !== b.floor || a.y1 + g <= b.y0 || b.y1 + g <= a.y0) continue;
      if (!shapes.conflict(a.body, b.body)) continue;
      const [x, y] = a.order < b.order ? [a, b] : [b, a];
      out.push({ a: x.order, b: y.order, ids: [x.id, y.id] });
    }
  }
  return out.sort((x, y) => x.a - y.a || x.b - y.b).map((x) => x.ids);
}

// ───────────────────────── Независимая проверка ─────────────────────────

// Мировые клетки — через instanceWorld (src/gen/world.ts), а не через формы генератора.

/** Линия метки по нормали и центр вдоль стены (независимо от geom.ts). */
function lineOf(c: Connector): { n: number; mid: number } {
  switch (c.side) {
    case 'N': return { n: c.cy, mid: c.cx + c.len / 2 };
    case 'S': return { n: c.cy + 1, mid: c.cx + c.len / 2 };
    case 'W': return { n: c.cx, mid: c.cy + c.len / 2 };
    case 'E': return { n: c.cx + 1, mid: c.cy + c.len / 2 };
  }
}

interface VLink { a: string; b: string; A: Connector; B: Connector }

/**
 * Выборочная проверка консервативности PVS: из точек пола каждой комнаты (сетка grid клеток, не больше
 * points точек на комнату) и клеток её проёмов — лучи в rays направлениях; марш по клеткам (DDA) с
 * портальной логикой §13.2 до стены или дальности reach. Каждая комната, куда луч зашёл, должна быть в
 * PVS источника (у точки проёма — в PVS обеих его комнат). miss — на каждое нарушение.
 */
function pvsRayCheck(W: PortalWorld, bodies: (VBody | null)[], gap: number, pvs: (Set<number> | null)[], reach: number,
  opts: { grid: number; points: number; rays: number }, miss: (src: number, room: number, x: number, y: number) => void): void {
  const dirs: [number, number][] = [];
  for (let k = 0; k < opts.rays; k++) {
    const t = ((k + 0.31) * 2 * Math.PI) / opts.rays;
    dirs.push([Math.cos(t), Math.sin(t)]);
  }
  const ray = (c0: number, px: number, py: number, cx: number, cy: number, srcs: number[]) => {
    let ix = Math.floor(px), iy = Math.floor(py), c = c0;
    const sx = cx > 0 ? 1 : -1, sy = cy > 0 ? 1 : -1;
    const tdx = cx !== 0 ? Math.abs(1 / cx) : Infinity, tdy = cy !== 0 ? Math.abs(1 / cy) : Infinity;
    let tmx = cx > 0 ? (ix + 1 - px) / cx : cx < 0 ? (px - ix) / -cx : Infinity;
    let tmy = cy > 0 ? (iy + 1 - py) / cy : cy < 0 ? (py - iy) / -cy : Infinity;
    for (;;) {
      let nx = ix, ny = iy, t: number;
      if (tmx <= tmy) { t = tmx; nx += sx; tmx += tdx; } else { t = tmy; ny += sy; tmy += tdy; }
      if (t > reach) return;
      const nc = W.step(c, ix, iy, nx, ny);
      if (nc === null) return;
      if (nc >= 0 && nc !== c) for (const s of srcs) if (!pvs[s]?.has(nc)) miss(s, nc, px, py);
      c = nc; ix = nx; iy = ny;
    }
  };
  const shoot = (c: number, x: number, y: number, srcs: number[]) => {
    const px = x + 0.5 + 0.0137, py = y + 0.5 + 0.0071; // смещение — чтобы лучи не шли ровно через углы клеток
    for (const [cx, cy] of dirs) ray(c, px, py, cx, cy, srcs);
  };
  bodies.forEach((b, i) => {
    if (!b || !pvs[i] || opts.points <= 0) return;
    const pts: number[] = [];
    for (let t = 0; t < b.xs.length; t++) if ((b.xs[t] - b.x0) % opts.grid === 0 && (b.ys[t] - b.y0) % opts.grid === 0) pts.push(t);
    const stride = Math.max(1, Math.ceil(pts.length / opts.points));
    for (let q = 0; q < pts.length; q += stride) shoot(i, b.xs[pts[q]], b.ys[pts[q]], [i]);
  });
  if (gap > 0) {
    W.ps.forEach((P, j) => {
      for (const t of [P.lo, (P.lo + P.hi) >> 1, P.hi - 1]) {
        const n = P.an + P.out * Math.max(1, gap >> 1);
        shoot(-1 - j, P.horiz ? t : n, P.horiz ? n : t, [P.a, P.b]);
      }
    });
  }
}

/** Клетки экземпляра в мире (из instanceWorld): списки и битовая карта по bbox — для проверок валидатора. */
interface VBody { xs: Int32Array; ys: Int32Array; x0: number; y0: number; w: number; h: number; bits: Uint8Array }

function vbody(cells: Set<string>): VBody | null {
  const n = cells.size;
  if (n === 0) return null;
  const xs = new Int32Array(n), ys = new Int32Array(n);
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  let i = 0;
  for (const k of cells) {
    const [x, y] = parseKey(k);
    xs[i] = x; ys[i] = y; i++;
    if (x < x0) x0 = x;
    if (y < y0) y0 = y;
    if (x > x1) x1 = x;
    if (y > y1) y1 = y;
  }
  const w = x1 - x0 + 1, h = y1 - y0 + 1;
  const bits = new Uint8Array(w * h);
  for (let j = 0; j < n; j++) bits[(ys[j] - y0) * w + (xs[j] - x0)] = 1;
  return { xs, ys, x0, y0, w, h, bits };
}

const vhas = (b: VBody | null, x: number, y: number): boolean => {
  if (!b) return false;
  const lx = x - b.x0, ly = y - b.y0;
  return lx >= 0 && lx < b.w && ly >= 0 && ly < b.h && b.bits[ly * b.w + lx] !== 0;
};

/** Модель проёмов валидатора: по мировым клеткам instanceWorld и мировым меткам связей (не через
 *  sight4d.ts). Контексты: комнаты (индекс в bodies) и проёмы (−1 − номер); шаг и диагональ — §13.2. */
interface PortalWorld {
  ps: { a: number; b: number; horiz: boolean; lo: number; hi: number; an: number; out: number }[];
  step: (c: number, x: number, y: number, nx: number, ny: number) => number | null;
  move: (c: number, x: number, y: number, dx: number, dy: number) => number | null;
}

function portalWorld(bodies: (VBody | null)[], index: Map<string, number>, links: VLink[], gap: number): PortalWorld {
  const roomLinks: number[][] = bodies.map(() => []);
  // проём: вдоль стены t ∈ [lo, hi); ряд клеток A у стены an, наружу out (±1)
  const ps: { a: number; b: number; horiz: boolean; lo: number; hi: number; an: number; out: number }[] = [];
  for (const l of links) {
    const a = index.get(l.a), b = index.get(l.b);
    if (a === undefined || b === undefined) continue;
    const { A, B } = l;
    const horiz = A.side === 'N' || A.side === 'S';
    roomLinks[a].push(ps.length);
    roomLinks[b].push(ps.length);
    ps.push({
      a, b, horiz,
      lo: Math.max(horiz ? A.cx : A.cy, horiz ? B.cx : B.cy),
      hi: Math.min((horiz ? A.cx : A.cy) + A.len, (horiz ? B.cx : B.cy) + B.len),
      an: horiz ? A.cy : A.cx,
      out: A.side === 'S' || A.side === 'E' ? 1 : -1,
    });
  }
  /** клетка (x, y) — в зазоре проёма j (gap ≥ 1): по нормали an + out·k, k = 1…gap */
  const inGap = (j: number, x: number, y: number): boolean => {
    const P = ps[j];
    const t = P.horiz ? x : y, k = ((P.horiz ? y : x) - P.an) * P.out;
    return t >= P.lo && t < P.hi && k >= 1 && k <= gap;
  };
  const step = (c: number, x: number, y: number, nx: number, ny: number): number | null => {
    if (c >= 0) {
      if (vhas(bodies[c], nx, ny)) return c;
      for (const j of roomLinks[c]) {
        if (gap > 0) { if (inGap(j, nx, ny)) return -1 - j; continue; }
        // gap = 0: шаг по нормали через стену между рядом A (an) и рядом B (an + out) на пересечении пролётов
        const P = ps[j];
        const t = P.horiz ? x : y, n = P.horiz ? y : x, nn = P.horiz ? ny : nx;
        if ((P.horiz ? nx !== x : ny !== y) || t < P.lo || t >= P.hi) continue;
        const nb = P.an + P.out;
        if (c === P.a && n === P.an && nn === nb) return P.b;
        if (c === P.b && n === nb && nn === P.an) return P.a;
      }
      return null;
    }
    const j = -1 - c;
    if (inGap(j, nx, ny)) return c;
    if (vhas(bodies[ps[j].a], nx, ny)) return ps[j].a;
    if (vhas(bodies[ps[j].b], nx, ny)) return ps[j].b;
    return null;
  };
  const move = (c: number, x: number, y: number, dx: number, dy: number): number | null => {
    if (c >= 0) {
      // внутри комнаты (у диагонали — и через оба угла) — тот же контекст
      const b = bodies[c];
      if (vhas(b, x + dx, y + dy) && (dx === 0 || dy === 0 || (vhas(b, x + dx, y) && vhas(b, x, y + dy)))) return c;
    }
    if (dx === 0 || dy === 0) return step(c, x, y, x + dx, y + dy);
    const c1 = step(c, x, y, x + dx, y);
    const e1 = c1 === null ? null : step(c1, x + dx, y, x + dx, y + dy);
    if (e1 === null) return null;
    const c2 = step(c, x, y, x, y + dy);
    const e2 = c2 === null ? null : step(c2, x, y + dy, x + dx, y + dy);
    return e1 === e2 ? e1 : null;
  };
  return { ps, step, move };
}

/**
 * Независимый полный скан линий обзора по порталам (§13 GENERATOR-4D.md). cb — на каждую максимальную
 * линию: k клеток, диагональ, менялся ли контекст, старт.
 */
function scanPortalLines(W: PortalWorld, bodies: (VBody | null)[], gap: number,
  cb: (k: number, diag: boolean, multi: boolean, start: number, x: number, y: number, dx: number, dy: number, long: boolean, own: number) => void,
  longSight: (room: number) => boolean = () => false,
  /** свой предел обзора комнаты, м (Infinity — без предела, 0 — общий); own в cb — самый мягкий по комнатам линии */
  ownLim: (room: number) => number = () => 0): void {
  const { ps, move } = W;
  for (const [dx, dy] of SIGHT_DIRS) {
    const diag = dx !== 0 && dy !== 0;
    const visit = (c: number, x: number, y: number) => {
      if (move(c, x, y, -dx, -dy) !== null) return; // не начало линии
      let k = 1, cc = c, px = x, py = y, multi = false, long = c >= 0 && longSight(c), own = c >= 0 ? ownLim(c) : 0, room = c >= 0;
      for (;;) {
        const nc = move(cc, px, py, dx, dy);
        if (nc === null) break;
        if (nc !== cc) multi = true;
        if (nc >= 0 && !long && longSight(nc)) long = true;
        if (nc >= 0 && nc !== cc) own = Math.max(own, ownLim(nc));
        if (nc >= 0) room = true;
        cc = nc; px += dx; py += dy; k++;
      }
      // линия целиком в зазоре проёма (вдоль широкого прохода — зал метро): она общая для двух его комнат — как у
      // генератора (sight4d portalOk), длинный обзор и свой предел — по ним
      if (!room && c < 0) {
        const P = ps[-1 - c];
        long = longSight(P.a) || longSight(P.b);
        own = Math.max(ownLim(P.a), ownLim(P.b));
      }
      cb(k, diag, multi, c, x, y, dx, dy, long, own);
    };
    bodies.forEach((b, i) => {
      if (!b) return;
      for (let t = 0; t < b.xs.length; t++) {
        // клетка, у которой шаг назад остаётся в комнате, — не начало линии (быстрая отсечка)
        const lx = b.xs[t] - b.x0, ly = b.ys[t] - b.y0, px = lx - dx, py = ly - dy;
        if (px >= 0 && px < b.w && py >= 0 && py < b.h && b.bits[py * b.w + px] !== 0 &&
          (!diag || (b.bits[ly * b.w + px] !== 0 && b.bits[py * b.w + lx] !== 0))) continue;
        visit(i, b.xs[t], b.ys[t]);
      }
    });
    if (gap > 0) {
      ps.forEach((P, j) => {
        for (let t = P.lo; t < P.hi; t++) {
          for (let k = 1; k <= gap; k++) {
            const n = P.an + P.out * k;
            if (P.horiz) visit(-1 - j, t, n);
            else visit(-1 - j, n, t);
          }
        }
      });
    }
  }
}

export { LONG_SIGHT_TAGS } from './foldcore';

/** Насколько густо проверять консервативность PVS лучами (по умолчанию — легко, для интерфейса). */
export interface ValidateOpts {
  /** точек пола на комнату (из сетки 0.2 м); по умолчанию 4; 0 — только лучи из проёмов */
  pvsPoints?: number;
  /** направлений лучей из точки; по умолчанию 180 */
  pvsRays?: number;
}

/** Независимая проверка складчатого прогона: в одном слое нет пересечений (с зазором gap),
 *  в радиусе localRadius по графу нет пересечений, dw связей = w(b) − w(a), |dw| ≤ maxShift,
 *  пороги 'never' не сдвигают, 'always' сдвигают; при sightM > 0 все линии обзора по порталам ≤ предела
 *  (кроме линий внутри стартовой комнаты, если она сама длиннее), Run.sight сходится с полным сканом;
 *  Run.pvs консервативен (выборочно лучами), при seamless — попарно без пересечений.
 *  Годится и для снимка бесконечного мира (StreamWorld.run()): нераскрытые и заколоченные двери — в openConnectors.
 *  Пустой массив — всё верно. */
export function validateFoldRun(p: Project, run: Run, opts: ValidateOpts = {}): string[] {
  const errs: string[] = [];
  const err = (m: string) => { if (errs.length < 100) errs.push(m); };
  const f = normFold(run.settings.fold);
  const gap = Math.max(0, run.settings.gap);
  const match = run.settings.match;
  const worlds = runWorld(p, run);
  const byId = new Map(worlds.map((w) => [w.inst.id, w]));
  const wOf = (id: string) => byId.get(id)?.inst.w ?? 0;

  // 0. слои
  for (const i of run.instances) {
    const w = i.w ?? 0;
    if (!Number.isInteger(w) || Math.abs(w) > f.maxLayer) err(`${i.id}: слой W = ${w} вне |W| ≤ ${f.maxLayer}`);
    if (!p.rooms.some((r) => r.id === i.roomId)) err(`${i.id}: нет комнаты ${i.roomId}`);
  }

  // 1. связи
  const used = new Set<string>();
  const adj = new Map<string, string[]>(run.instances.map((i) => [i.id, []]));
  // двери связей по экземплярам (для складок по метрам пути): своя метка и середина, сосед и его метка с серединой
  interface VDoor { k: string; pt: [number, number]; to: string; tk: string; tp: [number, number] }
  const doors = new Map<string, VDoor[]>(run.instances.map((i) => [i.id, []]));
  const addDoor = (a: string, A: Connector, b: string, B: Connector) => {
    doors.get(a)?.push({ k: A.id, pt: doorPoint(A), to: b, tk: B.id, tp: doorPoint(B) });
    doors.get(b)?.push({ k: B.id, pt: doorPoint(B), to: a, tk: A.id, tp: doorPoint(A) });
  };
  const pairs = new Set<string>();
  let shifted = 0;
  const vlinks: VLink[] = [];
  const floorOf = (id: string) => byId.get(id)?.inst.floor ?? 0;
  const connDzOf = (roomId: string, cid: string): number => {
    const r = p.rooms.find((x) => x.id === roomId);
    return r?.stair ? connDz(r, r.connectors.findIndex((c) => c.id === cid)) : 0;
  };
  for (const l of run.links) {
    const name = `связь ${l.a.inst}/${l.a.connector} – ${l.b.inst}/${l.b.connector}`;
    const wa = byId.get(l.a.inst), wb = byId.get(l.b.inst);
    if (!wa || !wb) { err(`${name}: нет экземпляра`); continue; }
    if (l.wrap) {
      // шов бесконечного прямого хода подвала: b, сдвинутый на wrap, стоит лицом к a; проёма в 3D нет (портал со
      // сдвигом сцены), соседи по графу — да
      const A = wa.connectors.find((c) => c.id === l.a.connector);
      const B = wb.connectors.find((c) => c.id === l.b.connector);
      if (!A || !B) { err(`${name}: нет метки`); continue; }
      if (l.a.inst === l.b.inst) err(`${name}: шов экземпляра с самим собой`);
      for (const k of [`${l.a.inst}/${l.a.connector}`, `${l.b.inst}/${l.b.connector}`]) {
        if (used.has(k)) err(`${name}: метка ${k} связана дважды`);
        used.add(k);
      }
      const Bs = { ...B, cx: B.cx + l.wrap[0], cy: B.cy + l.wrap[1] };
      const la = lineOf(A), lb = lineOf(Bs);
      const sign = A.side === 'S' || A.side === 'E' ? 1 : -1;
      if (B.side !== OPPOSITE[A.side] || lb.n - la.n !== sign * gap || Math.abs(la.mid - lb.mid) > 0.5 + 1e-9) err(`${name}: шов — метки не стоят лицом к лицу через зазор ${gap} со сдвигом ${l.wrap.join(', ')}`);
      if (floorOf(l.a.inst) !== floorOf(l.b.inst)) err(`${name}: шов между этажами`);
      const exp = wOf(l.b.inst) - wOf(l.a.inst);
      if ((l.dw ?? 0) !== exp) err(`${name}: dw = ${l.dw ?? 0}, а w(b) − w(a) = ${exp}`);
      adj.get(l.a.inst)?.push(l.b.inst);
      adj.get(l.b.inst)?.push(l.a.inst);
      addDoor(l.a.inst, A, l.b.inst, B);
      continue;
    }
    if (l.kind === 'descent' || l.kind === 'lift') {
      // переход спец-локации: a — экземпляр локации, b — комната-выход ниже на floors этажей ('descent') или комната
      // за выходом лифта выше на floors этажей ('lift'), b.connector — метка прихода
      const up = l.kind === 'lift';
      const kind = p.rooms.find((r) => r.id === wa.inst.roomId)?.location?.kind;
      // вниз — из лестницы, ангара, люка, двери в снег (у неё бывает 0 этажей); срыв (сюжет, fall) — с лестницы, из лифта
      const from = l.fall ? ['stairwell', 'lift'] : ['stairwell', 'hangar', 'hatch', 'snowdoor'];
      const minDown = !l.fall && kind === 'snowdoor' ? 0 : 1;
      // fractal: выход из «Фрактальной станции» — спуск из бездонного эскалатора метро (комната без спец-локации)
      const abyss = !up && !l.fall && isAbyss(p.rooms.find((r) => r.id === wa.inst.roomId)?.tags);
      if (!up && !abyss && !from.includes(kind ?? '')) err(`${name}: переход вниз не из спец-локации`);
      if (up && kind !== 'lift') err(`${name}: выход лифта не из лифта`);
      if (up && l.side !== 'straight' && l.side !== 'right') err(`${name}: выход лифта side = ${l.side}`);
      const B = wb.connectors.find((c) => c.id === l.b.connector);
      if (!B) { err(`${name}: нет метки прихода`); continue; }
      const k = `${l.b.inst}/${l.b.connector}`;
      if (used.has(k)) err(`${name}: метка ${k} связана дважды`);
      used.add(k);
      const want = floorOf(l.a.inst) + (up ? 1 : -1) * (l.floors ?? 0);
      // спуск — floors ≥ 1 этажей вниз; лифт — floors ≠ 0 этажей вверх (отрицательное — вниз)
      if (!Number.isInteger(l.floors) || (up ? l.floors === 0 : l.floors! < minDown)) err(`${name}: floors = ${l.floors}`);
      else if (floorOf(l.b.inst) !== want) err(`${name}: этаж ${floorOf(l.b.inst)}, а должен быть ${floorOf(l.a.inst)} ${up ? '+' : '−'} ${l.floors}`);
      pairs.add(`${l.a.inst}>${l.b.inst}`);
      continue;
    }
    if (floorOf(l.a.inst) !== floorOf(l.b.inst)) err(`${name}: дверь между этажами ${floorOf(l.a.inst)} и ${floorOf(l.b.inst)}`);
    const A = wa.connectors.find((c) => c.id === l.a.connector);
    const B = wb.connectors.find((c) => c.id === l.b.connector);
    if (!A || !B) { err(`${name}: нет метки`); continue; }
    if (l.a.inst === l.b.inst) err(`${name}: экземпляр связан сам с собой`);
    for (const k of [`${l.a.inst}/${l.a.connector}`, `${l.b.inst}/${l.b.connector}`]) {
      if (used.has(k)) err(`${name}: метка ${k} связана дважды`);
      used.add(k);
    }
    const la = lineOf(A), lb = lineOf(B);
    const sign = A.side === 'S' || A.side === 'E' ? 1 : -1;
    if (B.side !== OPPOSITE[A.side] || lb.n - la.n !== sign * gap || Math.abs(la.mid - lb.mid) > 0.5 + 1e-9) {
      err(`${name}: метки не стоят лицом к лицу через зазор ${gap}`);
    }
    // дверь в переход (бесконечный мир) — метки любые
    // лестницы (Room.stair): полы у двух меток проёма на одной высоте
    const za = (wa.inst.z ?? 0) + connDzOf(wa.inst.roomId, A.id), zb = (wb.inst.z ?? 0) + connDzOf(wb.inst.roomId, B.id);
    if (Math.abs(za - zb) > 1e-6) err(`${name}: пол у меток на разной высоте (${za} и ${zb} м)`);
    if (!l.loose && match !== 'len' && !tagsCompatible(A.tag, B.tag)) err(`${name}: теги ${A.tag} / ${B.tag} несовместимы`);
    if (!l.loose && match !== 'tag' && A.len !== B.len) err(`${name}: длины ${A.len} / ${B.len} различаются`);
    const exp = wOf(l.b.inst) - wOf(l.a.inst);
    const dw = l.dw ?? 0;
    if (dw !== exp) err(`${name}: dw = ${dw}, а w(b) − w(a) = ${exp}`);
    // sanatorium: вход во flat-биом на свежий слой (Link.fresh) — сдвиг любой
    if (!l.fresh && Math.abs(exp) > f.maxShift) err(`${name}: |dw| = ${Math.abs(exp)} > maxShift = ${f.maxShift}`);
    const ma = A.shift ?? 'auto', mb = B.shift ?? 'auto';
    if ((ma === 'never' || mb === 'never') && exp !== 0) err(`${name}: порог 'never' сдвигает W на ${exp}`);
    if ((ma === 'always' || mb === 'always') && exp === 0) err(`${name}: порог 'always' не сдвигает W`);
    if (exp !== 0) shifted++;
    adj.get(l.a.inst)?.push(l.b.inst);
    adj.get(l.b.inst)?.push(l.a.inst);
    addDoor(l.a.inst, A, l.b.inst, B);
    pairs.add(`${l.a.inst}>${l.b.inst}`);
    if (l.a.inst !== l.b.inst) vlinks.push({ a: l.a.inst, b: l.b.inst, A, B });
  }
  // каждая метка — либо в связи, либо в тупиках
  const open = new Set(run.openConnectors.map((o) => `${o.inst}/${o.connector}`));
  for (const k of open) if (used.has(k)) err(`метка ${k} и в связи, и в тупиках`);
  for (const w of worlds) for (const c of w.connectors) {
    const k = `${w.inst.id}/${c.id}`;
    if (c.len >= 1 && !used.has(k) && !open.has(k)) err(`метка ${k} потеряна`);
  }
  // дерево роста: родитель связан с ребёнком
  for (const i of run.instances) {
    if (i.parent && !pairs.has(`${i.parent}>${i.id}`)) err(`${i.id}: нет связи с родителем ${i.parent}`);
  }

  // 2. пересечения в 3D
  const dist = new Map<string, Map<string, number>>();
  const near = (id: string): Map<string, number> => {
    let d = dist.get(id);
    if (d) return d;
    d = new Map([[id, 0]]);
    let frontier = [id];
    for (let k = 1; k <= f.localRadius && frontier.length > 0; k++) {
      const next: string[] = [];
      for (const x of frontier) for (const y of adj.get(x) ?? []) if (!d.has(y)) { d.set(y, k); next.push(y); }
      frontier = next;
    }
    dist.set(id, d);
    return d;
  };
  // складки по метрам (FoldSettings.localM): путь от комнаты — через двери, внутри комнаты — по прямой между серединами
  // проёмов, проём и шов — 0 (как aroundM генератора)
  const LC = localCells(f, p.settings.cellM > 0 ? p.settings.cellM : 0.1);
  // не меряются: вход квартиры, вставший ближе предела (Link.close: за выходом иначе ничего не вставало), и переходы —
  // лестница и лифт (внутри своя сцена)
  const closeIds = new Set(run.links.filter((l) => l.close).map((l) => l.b.inst));
  for (const i of run.instances) {
    const k = p.rooms.find((r) => r.id === i.roomId)?.location?.kind;
    if (k === 'stairwell' || k === 'lift') closeIds.add(i.id);
  }
  const distM = new Map<string, Map<string, number>>();
  const nearM = (id: string): Map<string, number> => {
    let got = distM.get(id);
    if (got) return got;
    got = new Map([[id, 0]]);
    const done = new Set<string>();
    const q: { c: number; n: string; k: string; pt: [number, number] }[] = (doors.get(id) ?? []).map((d) => ({ c: 0, n: d.to, k: d.tk, pt: d.tp }));
    while (q.length > 0) {
      let bi = 0;
      for (let i = 1; i < q.length; i++) if (q[i].c < q[bi].c) bi = i;
      const { c, n, k, pt } = q[bi];
      q[bi] = q[q.length - 1];
      q.pop();
      if (done.has(`${n}/${k}`)) continue;
      done.add(`${n}/${k}`);
      if (c < (got.get(n) ?? Infinity)) got.set(n, c);
      for (const d of doors.get(n) ?? []) {
        if (d.k === k) continue;
        const c2 = c + Math.hypot(d.pt[0] - pt[0], d.pt[1] - pt[1]);
        if (c2 < LC && !done.has(`${d.to}/${d.tk}`)) q.push({ c: c2, n: d.to, k: d.tk, pt: d.tp });
      }
    }
    distM.set(id, got);
    return got;
  };
  const bodies = worlds.map((w) => vbody(w.cells));
  interface V { id: string; order: number; w: number; floor: number; b: VBody; x0: number; y0: number; x1: number; y1: number }
  const vs: V[] = [];
  worlds.forEach((w, i) => {
    const b = bodies[i];
    if (!b) return;
    if (b.x0 < -LIMIT || b.y0 < -LIMIT || b.x0 + b.w > LIMIT || b.y0 + b.h > LIMIT) { err(`${w.inst.id}: вне мира ±${LIMIT}`); return; }
    vs.push({ id: w.inst.id, order: w.inst.order, w: w.inst.w ?? 0, floor: w.inst.floor ?? 0, b, x0: b.x0, y0: b.y0, x1: b.x0 + b.w, y1: b.y0 + b.h });
  });
  const clash = (a: V, b: V): boolean => {
    const s = a.b.xs.length <= b.b.xs.length ? a : b, t = s === a ? b : a;
    for (let i = 0; i < s.b.xs.length; i++) {
      const x = s.b.xs[i], y = s.b.ys[i];
      if (x < t.x0 - gap || x >= t.x1 + gap || y < t.y0 - gap || y >= t.y1 + gap) continue;
      for (let oy = -gap; oy <= gap; oy++) for (let ox = -gap; ox <= gap; ox++) if (vhas(t.b, x + ox, y + oy)) return true;
    }
    return false;
  };
  vs.sort((a, b) => a.x0 - b.x0 || a.order - b.order);
  let overlaps = 0;
  for (let i = 0; i < vs.length; i++) {
    const a = vs[i];
    for (let j = i + 1; j < vs.length; j++) {
      const b = vs[j];
      if (b.x0 >= a.x1 + gap) break;
      // разные этажи — друг над другом, не пересекаются
      if (a.floor !== b.floor || a.y1 + gap <= b.y0 || b.y1 + gap <= a.y0) continue;
      if (!clash(a, b)) continue;
      overlaps++;
      if (a.w === b.w) err(`${a.id} и ${b.id} в одном слое W = ${a.w} пересекаются (ближе gap = ${gap})`);
      const d = near(a.id).get(b.id);
      if (d !== undefined) err(`${a.id} и ${b.id} на расстоянии ${d} ≤ localRadius = ${f.localRadius} по графу пересекаются в 3D`);
      const m = LC && !closeIds.has(a.id) && !closeIds.has(b.id) ? nearM(a.id).get(b.id) : undefined;
      if (m !== undefined && m < LC - 1e-6) err(`${a.id} и ${b.id} в ${((m * f.localM!) / LC).toFixed(1)} м пути < localM = ${f.localM} м пересекаются в 3D`);
    }
  }

  // 3. дальность обзора по порталам — свой полный скан (не через sight4d.ts)
  const cellM = p.settings.cellM > 0 ? p.settings.cellM : 0.1;
  const sightM = run.settings.sightM ?? 0;
  const lim = sightM > 0 ? sightLimits(sightM, cellM) : null;
  const startIdx = worlds.findIndex((w) => w.inst.order === 0);
  let vmax = 0;
  let long = 0;
  const index = new Map(worlds.map((w, i) => [w.inst.id, i] as const));
  const pw = portalWorld(bodies, index, vlinks, gap);
  // ходы и хабы подвала (теги «ход», «хаб») и переходы в бесконечном мире (Run.settings.longSight) — длинные
  // пространства по замыслу: линии через них предел не ограничивает
  const longOn = (run.settings as { longSight?: boolean }).longSight === true;
  const longRoom = worlds.map((w) => {
    const room = longOn ? p.rooms.find((r) => r.id === w.inst.roomId) : undefined;
    return !!room && longSight(room);
  });
  // свои пределы комнат биомов со своим пределом обзора (Run.settings.sightRooms, Biome.sightM): линия через такую
  // комнату — до самого мягкого предела комнат на ней
  const sightRooms = (run.settings as { sightRooms?: Record<string, number> }).sightRooms;
  const ownLim = worlds.map((w) => {
    const v = sightRooms?.[w.inst.roomId];
    return v === undefined ? 0 : v > 0 ? v : Infinity;
  });
  const ownOk = (k: number, diag: boolean, own: number): boolean => {
    if (own === Infinity) return true;
    if (!(own > 0)) return false;
    const l = sightLimits(own, cellM);
    return k <= (diag ? l.diag : l.ortho);
  };
  scanPortalLines(pw, bodies, gap, (k, diag, multi, c, x, y, dx, dy, longLine, own) => {
    const m = runMeters(k, diag, cellM);
    if (m > vmax) vmax = m;
    // линия целиком внутри стартовой комнаты, которая сама длиннее предела, — допустима (предупреждение генератора)
    if (lim && !longLine && k > (diag ? lim.diag : lim.ortho) && (multi || c !== startIdx) && !ownOk(k, diag, own)) {
      if (++long <= 5) err(`линия обзора ${m.toFixed(2)} м от клетки (${x}, ${y}) по (${dx}, ${dy}) длиннее предела ${sightM} м`);
    }
  }, (i) => longRoom[i], (i) => ownLim[i]);
  if (long > 5) err(`… всего линий длиннее предела: ${long}`);
  if (!run.sight) err('нет Run.sight');
  else if (Math.abs(Math.round(vmax * 1000) / 1000 - run.sight.maxM) > 1e-6) {
    err(`Run.sight.maxM = ${run.sight.maxM} м, а полный скан по порталам даёт ${Math.round(vmax * 1000) / 1000} м`);
  }

  // 4. PVS: содержит всё, куда заходят лучи (выборочно); при бесшовности — ещё и попарно без пересечений
  const fold4 = normFold(run.settings.fold);
  if (fold4.seamless && lim && !run.pvs) err('бесшовность включена, но Run.pvs нет');
  if (run.pvs) {
    const vByIdx = new Map<number, V>();
    for (const v of vs) vByIdx.set(index.get(v.id)!, v);
    const sets: (Set<number> | null)[] = worlds.map(() => null);
    let clashes = 0;
    for (const [id, list] of Object.entries(run.pvs)) {
      const i = index.get(id);
      if (i === undefined) { err(`Run.pvs: нет экземпляра ${id}`); continue; }
      const idx = list.map((x) => index.get(x));
      if (idx.some((x) => x === undefined)) { err(`Run.pvs[${id}]: неизвестный экземпляр`); continue; }
      const set = new Set(idx as number[]);
      if (!set.has(i)) err(`Run.pvs[${id}] не содержит саму комнату`);
      sets[i] = set;
      // попарно без пересечений — только при бесшовности; без неё (потоковый мир) PVS — просто список для
      // портального рендера, наложения в нём допустимы
      const arr = fold4.seamless ? [...set] : [];
      for (let x = 0; x < arr.length; x++) {
        for (let y = x + 1; y < arr.length; y++) {
          const va = vByIdx.get(arr[x]), vb = vByIdx.get(arr[y]);
          if (va && vb && clash(va, vb) && ++clashes <= 5) err(`PVS(${id}): ${va.id} и ${vb.id} пересекаются в 3D`);
        }
      }
    }
    if (clashes > 5) err(`… всего пересечений внутри PVS: ${clashes}`);
    for (const w of worlds) if (!run.pvs[w.inst.id]) err(`Run.pvs: нет набора для ${w.inst.id}`);
    if (lim) {
      let misses = 0;
      pvsRayCheck(pw, bodies, gap, sets, sightM / cellM, { grid: 2, points: opts.pvsPoints ?? 4, rays: opts.pvsRays ?? 180 }, (src, room, x, y) => {
        if (++misses <= 5) err(`PVS(${worlds[src].inst.id}) не содержит ${worlds[room].inst.id}: луч из (${x.toFixed(2)}, ${y.toFixed(2)}) заходит в неё`);
      });
      if (misses > 5) err(`… всего лучей в комнаты вне PVS: ${misses}`);
    }
  }

  // 5. сводка
  if (!run.fold) err('нет сводки Run.fold');
  else {
    let minW = 0, maxW = 0;
    const layers = new Set<number>();
    for (const i of run.instances) { const w = i.w ?? 0; layers.add(layerKey(i.floor ?? 0, w)); if (w < minW) minW = w; if (w > maxW) maxW = w; }
    const fs = run.fold;
    if (run.instances.length > 0 && (fs.minW !== minW || fs.maxW !== maxW || fs.layers !== layers.size)) {
      err(`Run.fold: слои ${fs.minW}…${fs.maxW} (${fs.layers}), а по экземплярам ${minW}…${maxW} (${layers.size})`);
    }
    if (fs.shifted !== shifted) err(`Run.fold.shifted = ${fs.shifted}, а сдвинутых связей ${shifted}`);
    if (fs.overlaps !== overlaps) err(`Run.fold.overlaps = ${fs.overlaps}, а пересекающихся пар ${overlaps}`);
  }
  return errs;
}

