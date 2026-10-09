// Группировка комнат по тегу и роль в росте карты (хаб / лист).
import { analyzeGrowth } from '../gen/generate';
import type { Project, Room } from '../model/types';

export const GROUPS = [
  'лестница',
  'коридор',
  'лифт',
  'подвал',
  'сарай',
  'снег',
  'завод',
  'общага',
  'служебное',
  'общежитие',
  'прихожая',
  'кухня',
  'санузел',
  'жилая',
  'балкон',
  'кладовка',
  // metro
  'метро',
] as const;
export const OTHER = 'другое';

export const GROUP_COLORS: Record<string, string> = {
  лестница: '#e8b04b',
  коридор: '#d8904a',
  лифт: '#c24a7a',
  подвал: '#7a6a5a',
  сарай: '#9a7a4a',
  снег: '#c9d6e6',
  завод: '#b0703a',
  общага: '#c9b98a',
  служебное: '#8f8fa8',
  общежитие: '#a58fd8',
  прихожая: '#6f9fd8',
  кухня: '#5fa596',
  санузел: '#4ab0c8',
  жилая: '#8fb86f',
  балкон: '#b8c86f',
  кладовка: '#9a8f7a',
  [OTHER]: '#5a5e66',
  // metro
  метро: '#b8423a',
};

/** Группа комнаты: первый её тег из списка групп, иначе «другое». */
export function roomGroup(r: Room): string {
  for (const t of r.tags) if ((GROUPS as readonly string[]).includes(t)) return t;
  return OTHER;
}

export const groupOrder = (g: string) => {
  const i = (GROUPS as readonly string[]).indexOf(g);
  return i < 0 ? GROUPS.length : i;
};

/** Комната в пуле генератора (как buildInfo): есть клетки и (вес > 0 или min > 0) и max > 0. */
export function inPool(r: Room): boolean {
  if (r.cells.size === 0) return false;
  const effMax = r.unique ? 1 : Math.max(0, Math.floor(r.gen.max));
  const effMin = Math.min(Math.max(0, Math.floor(r.gen.min)), effMax);
  return (r.gen.weight > 0 || effMin > 0) && effMax > 0;
}

export type Role = 'hub' | 'leaf' | 'none';
export interface RoleInfo {
  role: Role;
  /** ростовых меток (ведут к продолжению карты) */
  grow: number;
  total: number;
}

/**
 * Роль в росте: хаб — ≥ 2 ростовых меток (вошли через одну, карта растёт через другую);
 * лист — иначе. Если analyzeGrowth недоступен — хаб при ≥ 2 метках.
 */
export function roomRoles(p: Project): Record<string, RoleInfo> {
  const out: Record<string, RoleInfo> = {};
  let g: ReturnType<typeof analyzeGrowth> | null = null;
  try {
    g = analyzeGrowth(p);
  } catch {
    g = null;
  }
  for (const r of p.rooms) {
    const total = r.connectors.length;
    const flags = g?.[r.id]?.grow;
    const grow = flags ? flags.filter(Boolean).length : total;
    out[r.id] = { role: total === 0 ? 'none' : grow >= 2 ? 'hub' : 'leaf', grow, total };
  }
  return out;
}
