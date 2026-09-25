// Операции над проектом: создание, дублирование, каскадное удаление, счётчики, комбинации.
// Все функции мутируют переданный проект на месте (вызывать внутри mutate()).
// Контракт зафиксирован оркестратором; реализации TODO(core) дописывает агент ядра.
import type { Assign, Item, Project, Prop, Room, SpotGroup, Variant } from './types';

/** Уникальный строковый id: `${prefix}_${base36}`; уникален в пределах сессии и проекта. */
export function uid(prefix: string): string {
  throw new Error('TODO(core) uid');
}

/** Новая комната: прямоугольник wM×hM метров с углом в (0,0), gen {1,0,99}, пустое содержимое. */
export function createRoom(p: Project, name: string, wM?: number, hM?: number): Room {
  throw new Error('TODO(core) createRoom');
}

/** Дублирование (ТЗ §4): все внутренние id выдаются заново, assign перевешиваются на новые споты,
 *  spot.groupId — на новые группы. Копия вставляется сразу после оригинала. Возвращает копию. */
export function duplicateRoom(p: Project, roomId: string): Room {
  throw new Error('TODO(core) duplicateRoom');
}

export function deleteRoom(p: Project, roomId: string): void {
  throw new Error('TODO(core) deleteRoom');
}

export function createProp(p: Project, partial?: Partial<Prop>): Prop {
  throw new Error('TODO(core) createProp');
}

export function createItem(p: Project, partial?: Partial<Item>): Item {
  throw new Error('TODO(core) createItem');
}

/** Каскад (ТЗ §6): экземпляры декора в комнатах + назначения в вариантах. */
export function deleteProp(p: Project, propId: string): { decor: number; assigns: number } {
  throw new Error('TODO(core) deleteProp');
}

/** Каскад (ТЗ §6): строки лута + назначения на спотах; плюс экономика: строки тиров,
 *  товары магазинов, itemBoost проходок; магазины с этой валютой удаляются. */
export function deleteItem(p: Project, itemId: string): { loot: number; assigns: number; economy: number } {
  throw new Error('TODO(core) deleteItem');
}

/** Удалить спот: из вариантов его группы тоже. */
export function deleteSpot(room: Room, spotId: string): void {
  throw new Error('TODO(core) deleteSpot');
}

/** Удалить группу: споты группы становятся без группы (groupId = null). */
export function deleteSpotGroup(room: Room, groupId: string): void {
  throw new Error('TODO(core) deleteSpotGroup');
}

/** Перевод спота в другую группу (или null): удалить его ключи из вариантов старой группы. */
export function setSpotGroup(room: Room, spotId: string, groupId: string | null): void {
  throw new Error('TODO(core) setSpotGroup');
}

export interface Usage {
  rooms: number;
  decor: number;
  loot: number;
  assigns: number;
  economy: number;
  total: number;
}

export function propUsage(p: Project, propId: string): Usage {
  throw new Error('TODO(core) propUsage');
}

export function itemUsage(p: Project, itemId: string): Usage {
  throw new Error('TODO(core) itemUsage');
}

/**
 * «Все комбинации» (ТЗ §7): для группы из n ≤ 6 спотов создаёт 2ⁿ вариантов с весом 1.
 * Вариант k заполняет спот i (i — индекс в порядке room.spots), если бит i установлен.
 * Содержимое спота — шаблон: первое назначение этого спота среди существующих вариантов,
 * иначе fallback; если нет и его — спот пропускается. Старые варианты заменяются.
 * Бросает Error при n > 6.
 */
export function allCombinations(room: Room, groupId: string, fallback: Assign | null): Variant[] {
  throw new Error('TODO(core) allCombinations');
}

/** Шанс варианта: w / Σw (0, если Σw = 0). */
export function variantChance(group: SpotGroup, variantId: string): number {
  throw new Error('TODO(core) variantChance');
}

/** Площадь комнаты, м². */
export function roomArea(p: Project, room: Room): number {
  throw new Error('TODO(core) roomArea');
}
