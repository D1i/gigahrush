// Слияние свежих пресетов в существующий проект: добавляется только то, чего нет (по id),
// правки автора не трогаются. Нужно, когда пресеты пополнились, а проект уже сохранён.
import type { FinishRule, Project } from './types';
import { createDefaultProject } from '../data/presets';

export interface MergeReport {
  rooms: number;
  props: number;
  items: number;
  economy: number;
  /** отделки (по id) + правила отделки (по тегу) */
  finishes: number;
}

const cloneRule = (r: FinishRule): FinishRule => ({
  tag: r.tag,
  wall: r.wall.map((x) => ({ ...x })),
  floor: r.floor.map((x) => ({ ...x })),
});

/** Сколько всего добавилось бы (без изменений проекта). */
export function missingPresets(p: Project, fresh: Project = createDefaultProject()): MergeReport {
  const has = <T extends { id: string }>(a: T[]) => new Set(a.map((x) => x.id));
  const count = <T extends { id: string }>(src: T[], dst: T[]) => {
    const ids = has(dst);
    return src.filter((x) => !ids.has(x.id)).length;
  };
  return {
    rooms: count(fresh.rooms, p.rooms),
    props: count(fresh.props, p.props),
    items: count(fresh.items, p.items),
    economy:
      count(fresh.economy.tiers, p.economy.tiers) +
      count(fresh.economy.shops, p.economy.shops) +
      count(fresh.economy.passes, p.economy.passes),
    finishes: count(fresh.finishes, p.finishes ?? []) + missingRules(fresh.finishRules, p.finishRules ?? []).length,
  };
}

/** Правила пресетов, тегов которых в проекте нет. */
function missingRules(src: FinishRule[], dst: FinishRule[]): FinishRule[] {
  const tags = new Set(dst.map((r) => r.tag));
  return src.filter((r) => !tags.has(r.tag));
}

/** Добавить недостающее (мутирует p — вызывать внутри mutate). Сначала библиотеки и экономика,
 *  потом комнаты, чтобы их ссылки были валидны. */
export function mergePresets(p: Project, fresh: Project = createDefaultProject()): MergeReport {
  const add = <T extends { id: string }>(src: T[], dst: T[]) => {
    const ids = new Set(dst.map((x) => x.id));
    const extra = src.filter((x) => !ids.has(x.id));
    dst.push(...extra);
    return extra.length;
  };
  const props = add(fresh.props, p.props);
  const items = add(fresh.items, p.items);
  const economy =
    add(fresh.economy.tiers, p.economy.tiers) +
    add(fresh.economy.shops, p.economy.shops) +
    add(fresh.economy.passes, p.economy.passes);
  // отделки — до правил (ссылки строк правил должны быть валидны); правила — только недостающие теги
  p.finishes ??= [];
  p.finishRules ??= [];
  const extraRules = missingRules(fresh.finishRules, p.finishRules).map(cloneRule);
  p.finishRules.push(...extraRules);
  const finishes = add(fresh.finishes, p.finishes) + extraRules.length;
  const rooms = add(fresh.rooms, p.rooms);
  return { rooms, props, items, economy, finishes };
}

/** Сколько пресетных сущностей в проекте отличаются от свежих пресетов (по id). */
export function outdatedPresets(p: Project, fresh: Project = createDefaultProject()): number {
  // устойчивая подпись: порядок ключей не важен, Set — отсортированный массив
  const norm = (v: unknown): unknown => {
    if (v instanceof Set) return [...v].sort();
    if (Array.isArray(v)) return v.map(norm);
    if (v && typeof v === 'object') {
      const o: Record<string, unknown> = {};
      for (const k of Object.keys(v).sort()) o[k] = norm((v as Record<string, unknown>)[k]);
      return o;
    }
    return v;
  };
  const sig = (x: unknown) => JSON.stringify(norm(x));
  let n = 0;
  const cmp = <T extends { id: string }>(src: T[], dst: T[]) => {
    const by = new Map(dst.map((x) => [x.id, x]));
    for (const s of src) {
      const d = by.get(s.id);
      if (d && sig(d) !== sig(s)) n++;
    }
  };
  cmp(fresh.rooms, p.rooms);
  cmp(fresh.props.map((x) => ({ ...x, tex: null })), p.props.map((x) => ({ ...x, tex: null })));
  cmp(fresh.items, p.items);
  cmp(fresh.economy.tiers, p.economy.tiers);
  // отделки — без текстур (JPEG с canvas может отличаться между браузерами), правила — по тегу
  cmp(fresh.finishes.map((x) => ({ ...x, tex: null })), (p.finishes ?? []).map((x) => ({ ...x, tex: null })));
  const rulesBy = new Map((p.finishRules ?? []).map((r) => [r.tag, r]));
  for (const r of fresh.finishRules) {
    const d = rulesBy.get(r.tag);
    if (d && sig(d) !== sig(r)) n++;
  }
  return n;
}

/** Обновить пресеты до последней версии: сущности с id из пресетов заменяются свежими
 *  (правки автора в них теряются), недостающие добавляются, собственные — не трогаются.
 *  Настройки генератора: старт, обзор, дозаполнение — из пресетов; сид, count, gap, проходка — прежние. */
export function updatePresets(p: Project, fresh: Project = createDefaultProject()): MergeReport {
  const put = <T extends { id: string }>(src: T[], dst: T[]) => {
    const idx = new Map(dst.map((x, i) => [x.id, i]));
    let n = 0;
    for (const s of src) {
      const i = idx.get(s.id);
      if (i === undefined) dst.push(s);
      else dst[i] = s;
      n++;
    }
    return n;
  };
  const props = put(fresh.props, p.props);
  const items = put(fresh.items, p.items);
  const economy =
    put(fresh.economy.tiers, p.economy.tiers) + put(fresh.economy.shops, p.economy.shops) + put(fresh.economy.passes, p.economy.passes);
  p.finishes ??= [];
  p.finishRules ??= [];
  let finishes = put(fresh.finishes, p.finishes);
  // правила пресетных тегов заменяются свежими, свои теги остаются
  for (const r of fresh.finishRules) {
    const i = p.finishRules.findIndex((x) => x.tag === r.tag);
    if (i < 0) p.finishRules.push(cloneRule(r));
    else p.finishRules[i] = cloneRule(r);
    finishes++;
  }
  const rooms = put(fresh.rooms, p.rooms);
  // свои правила, комнаты и dado могли ссылаться на пресетную отделку, сменившую поверхность, — чистим
  const surf = new Map(p.finishes.map((f) => [f.id, f.surface]));
  for (const r of p.finishRules) {
    r.wall = r.wall.filter((x) => surf.get(x.finishId) === 'wall');
    r.floor = r.floor.filter((x) => surf.get(x.finishId) === 'floor');
  }
  for (const r of p.rooms) {
    if (!r.finish) r.finish = { wall: null, floor: null };
    if (r.finish.wall && surf.get(r.finish.wall) !== 'wall') r.finish.wall = null;
    if (r.finish.floor && surf.get(r.finish.floor) !== 'floor') r.finish.floor = null;
  }
  for (const f of p.finishes) if (f.dado && (f.surface !== 'wall' || surf.get(f.dado.finishId) !== 'wall')) f.dado = null;
  // из пресетов — старт, стыковка, обзор, дозаполнение; сид, цель, зазор и проходка — авторские
  const g = p.generator;
  p.generator = {
    ...fresh.generator,
    seed: g.seed,
    count: g.count,
    gap: g.gap,
    passId: g.passId && p.economy.passes.some((x) => x.id === g.passId) ? g.passId : fresh.generator.passId,
  };
  return { rooms, props, items, economy, finishes };
}
