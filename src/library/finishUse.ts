// Подробное использование отделки и покрытие комнат правилами — для карточки и вкладки правил.
// Счётчики для удаления — ops.finishUsage; здесь разбивка «где именно».
import type { Finish, FinishRule, FinishSurface, Project, Room } from '../model/types';
import { finishChances, finishRuleFor, finishRuleWeights } from '../model/ops';

export interface FinishRoomUse {
  room: Room;
  wall: boolean;
  floor: boolean;
}

/** Комнаты, которым отделка назначена явно. */
export function roomsWithFinish(p: Project, id: string): FinishRoomUse[] {
  const out: FinishRoomUse[] = [];
  for (const room of p.rooms) {
    const wall = room.finish?.wall === id;
    const floor = room.finish?.floor === id;
    if (wall || floor) out.push({ room, wall, floor });
  }
  return out;
}

export interface FinishRuleUse {
  index: number;
  rule: FinishRule;
  wall: number;
  floor: number;
}

/** Правила, где отделка — один из вариантов. */
export function rulesWithFinish(p: Project, id: string): FinishRuleUse[] {
  const out: FinishRuleUse[] = [];
  p.finishRules.forEach((rule, index) => {
    const wall = rule.wall.filter((v) => v.finishId === id).length;
    const floor = rule.floor.filter((v) => v.finishId === id).length;
    if (wall || floor) out.push({ index, rule, wall, floor });
  });
  return out;
}

/** Отделки, у которых эта — нижняя панель. */
export const dadoUsers = (p: Project, id: string): Finish[] => p.finishes.filter((f) => f.dado?.finishId === id);

/** Комнаты, где отделка может выпасть по правилу (без явного назначения на этой поверхности). */
export function ruleRoomsFor(p: Project, f: Finish): { room: Room; p: number }[] {
  const out: { room: Room; p: number }[] = [];
  for (const room of p.rooms) {
    if (room.finish?.[f.surface]) continue;
    const ch = safeChances(p, room, f.surface).find((c) => c.finishId === f.id);
    if (ch && ch.p > 0) out.push({ room, p: ch.p });
  }
  return out.sort((a, b) => b.p - a.p || a.room.name.localeCompare(b.room.name, 'ru'));
}

/** Индекс правила комнаты в p.finishRules или −1. */
export function ruleIndexFor(p: Project, room: Room): number {
  let r: FinishRule | null = null;
  try {
    r = finishRuleFor(p, room);
  } catch {
    return -1;
  }
  if (!r) return -1;
  const i = p.finishRules.indexOf(r);
  return i >= 0 ? i : p.finishRules.findIndex((x) => x.tag === r!.tag);
}

/** finishChances без падения интерфейса, если модель ещё не готова. */
export function safeChances(p: Project, room: Room, s: FinishSurface): { finishId: string; p: number }[] {
  try {
    return finishChances(p, room, s);
  } catch {
    return [];
  }
}

/** Все теги комнат проекта (для datalist правил). */
export function allRoomTags(p: Project): string[] {
  const s = new Set<string>();
  p.rooms.forEach((r) => r.tags.forEach((t) => s.add(t)));
  return [...s].sort((a, b) => a.localeCompare(b, 'ru'));
}

export function allFinishTags(p: Project): string[] {
  const s = new Set<string>();
  p.finishes.forEach((f) => f.tags.forEach((t) => s.add(t)));
  return [...s].sort((a, b) => a.localeCompare(b, 'ru'));
}

/** Вероятности строк правила на поверхности: w / Σw (строки на удалённую или не ту отделку весят 0 —
 *  как в генераторе). Индексы совпадают с rule[surface]. */
export function ruleShares(p: Project, rule: FinishRule, surface: FinishSurface): number[] {
  const rows = finishRuleWeights(p, rule, surface);
  const sum = rows.reduce((s, v) => s + v.w, 0);
  return rows.map((v) => (sum > 0 ? v.w / sum : 0));
}
