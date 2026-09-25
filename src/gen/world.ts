// Мировая геометрия экземпляров прогона — для предпросмотра и экспорта раскладки.
// Контракт зафиксирован оркестратором; реализацию пишет агент генератора.
import type { CellKey, Connector, Decor, Door, Instance, Project, Run, Spot } from '../model/types';

export interface InstanceWorld {
  inst: Instance;
  cells: Set<CellKey>;
  doors: Door[];
  connectors: Connector[];
  /** декор в мировых координатах (x, y, rot уже с учётом поворота экземпляра) */
  decor: Decor[];
  spots: Spot[];
  bbox: { x0: number; y0: number; x1: number; y1: number };
}

/** Мировая геометрия одного экземпляра (поворот rot вокруг (0,0), затем сдвиг dx, dy). */
export function instanceWorld(p: Project, inst: Instance): InstanceWorld {
  throw new Error('TODO(gen) instanceWorld');
}

/** Все экземпляры прогона (с кэшем по run внутри не нужно — вызывающий мемоизирует). */
export function runWorld(p: Project, run: Run): InstanceWorld[] {
  throw new Error('TODO(gen) runWorld');
}

/** Экспорт готовой раскладки для движка (ТЗ §1, машинный сценарий): самодостаточный JSON,
 *  всё в мировых координатах, cells сжаты, ссылки на props/items по id + их таблицы. */
export function exportRunJSON(p: Project, run: Run): unknown {
  throw new Error('TODO(gen) exportRunJSON');
}
