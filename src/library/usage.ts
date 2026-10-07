// Подробное использование декора/предметов: по комнатам и по экономике.
// Счётчики для каскадного удаления берутся из ops.propUsage/itemUsage; здесь — разбивка
// «где именно», чтобы показать список комнат и ссылок в карточке библиотеки.
import type { Project, Room } from '../model/types';

export interface RoomPropUse {
  room: Room;
  decor: number;
  assigns: number;
}

export interface RoomItemUse {
  room: Room;
  loot: number;
  assigns: number;
}

function countAssigns(room: Room, kind: 'prop' | 'item', id: string): number {
  let n = 0;
  for (const g of room.spotGroups)
    for (const v of g.variants)
      for (const a of Object.values(v.assign)) if (a.kind === kind && a.id === id) n++;
  return n;
}

export function roomsUsingProp(p: Project, propId: string): RoomPropUse[] {
  const out: RoomPropUse[] = [];
  for (const room of p.rooms) {
    const decor = room.decor.filter((d) => d.propId === propId).length;
    const assigns = countAssigns(room, 'prop', propId);
    if (decor || assigns) out.push({ room, decor, assigns });
  }
  return out;
}

export function roomsUsingItem(p: Project, itemId: string): RoomItemUse[] {
  const out: RoomItemUse[] = [];
  for (const room of p.rooms) {
    const loot = room.loot.filter((l) => l.itemId === itemId).length;
    const assigns = countAssigns(room, 'item', itemId);
    if (loot || assigns) out.push({ room, loot, assigns });
  }
  return out;
}

/** Человекочитаемые ссылки на предмет из экономики. */
export function economyRefsItem(p: Project, itemId: string): string[] {
  const out: string[] = [];
  const e = p.economy;
  for (const t of e.tiers) {
    const n = t.loot.filter((r) => r.source.kind === 'item' && r.source.id === itemId).length;
    if (n) out.push(`тир «${t.name}» (Э${t.level}): строк лута — ${n}`);
  }
  for (const s of e.shops) {
    if (s.currencyItemId === itemId) out.push(`валюта магазина «${s.name}» — магазин будет удалён`);
    const n = s.offers.filter((o) => o.itemId === itemId).length;
    if (n) out.push(`товар в магазине «${s.name}»`);
  }
  for (const ps of e.passes) {
    if (ps.priceItemId === itemId) out.push(`оплата проходки «${ps.name}» — проходка будет удалена`);
    if (itemId in ps.itemBoost) out.push(`буст в проходке «${ps.name}» ×${ps.itemBoost[itemId]}`);
  }
  return out;
}

/** Все теги декора проекта (для фильтров и datalist). */
export function allPropTags(p: Project): string[] {
  const s = new Set<string>();
  p.props.forEach((x) => x.tags.forEach((t) => s.add(t)));
  return [...s].sort((a, b) => a.localeCompare(b, 'ru'));
}

export function allItemTags(p: Project): string[] {
  const s = new Set<string>();
  p.items.forEach((x) => x.tags.forEach((t) => s.add(t)));
  return [...s].sort((a, b) => a.localeCompare(b, 'ru'));
}

export const isCurrency = (it: { tags: string[] }) => it.tags.includes('currency');

/** Склонение: plural(3, 'комната', 'комнаты', 'комнат') */
export function plural(n: number, one: string, few: string, many: string): string {
  const a = Math.abs(n) % 100;
  const b = a % 10;
  if (a > 10 && a < 20) return many;
  if (b > 1 && b < 5) return few;
  if (b === 1) return one;
  return many;
}
