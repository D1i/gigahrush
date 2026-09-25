// Сериализация и разбор (ТЗ §3, §4). Внутреннее представление (Set клеток) и внешний формат
// (сжатые строки) меняются независимо — вся конверсия только здесь.
// Контракт зафиксирован оркестратором; реализации TODO(core) дописывает агент ядра.
import type { Project, Room } from './types';

export const FORMAT = 'room-forge';
export const FORMAT_VERSION = 1;

/** Внешний вид комнаты: cells — string[] сжатых рядов, плюс вычисленное areaM2. */
export type RoomJSON = Omit<Room, 'cells'> & { cells: string[]; areaM2: number };

export type ProjectJSON = Omit<Project, 'rooms'> & {
  format: typeof FORMAT;
  version: number;
  rooms: RoomJSON[];
};

/** Проект → JSON-совместимый объект (без Set). Не мутирует. */
export function serializeProject(p: Project): ProjectJSON {
  throw new Error('TODO(core) serializeProject');
}

/**
 * Разбор (из localStorage или импорта). Толерантен: недостающие поля заполняются значениями
 * по умолчанию, висячие ссылки (декор на несуществующий prop, assign на несуществующий
 * спот/предмет, loot на несуществующий item, тиры и т.п.) вычищаются.
 * Бросает Error с человекочитаемым текстом, если это вообще не проект.
 */
export function parseProject(json: unknown): Project {
  throw new Error('TODO(core) parseProject');
}

export function serializeRoom(r: Room, cellM: number): RoomJSON {
  throw new Error('TODO(core) serializeRoom');
}

export function parseRoom(json: unknown): Room {
  throw new Error('TODO(core) parseRoom');
}

/** Пустой проект со значениями по умолчанию (без пресетов). */
export function emptyProject(): Project {
  throw new Error('TODO(core) emptyProject');
}
