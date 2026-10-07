// Игровой цикл прогулки — без движка: лут на полу и в мебели, инвентарь (валюты и товары),
// элитность при заходе в комнату, опасность за пройденные комнаты, сохранение.
// Контракт зафиксирован оркестратором; реализацию пишет агент игровой логики.

/** Находка в мире: что лежит, где (мировые клетки плана), откуда взялась. */
export interface Pickup {
  /** стабильный id: `${inst}:${источник}` — не зависит от порядка обхода */
  id: string;
  inst: string;
  itemId: string;
  count: number;
  /** точка на полу (мировые клетки, план: x вправо, y вниз) */
  x: number;
  y: number;
  /** высота над полом, м: 0 — на полу; > 0 — на/в мебели (сервант, стол) */
  z: number;
  from: 'spot' | 'room' | 'tier';
  /** в каком декоре лежит (для строк тира с where) */
  decorId?: string;
  /** готовый предмет из магазина (строка тира с source shop) */
  shopId?: string;
}

export type GameEvent =
  /** первый заход в комнату: тир, прирост опасности, итог */
  | { type: 'enter'; inst: string; tierId: string | null; dangerAdd: number; danger: number; first: boolean }
  | { type: 'pickup'; pickupId: string; itemId: string; count: number }
  /** опасность впервые перешла порог economy.dangerLimit */
  | { type: 'danger-limit'; danger: number; limit: number };

export interface GameState {
  format: 'room-forge-game';
  version: 1;
  /** к какому миру относится (worldKey) */
  worldKey: string;
  /** инвентарь: itemId → количество */
  inventory: Record<string, number>;
  /** id подобранных находок */
  taken: string[];
  /** экземпляры, в которых игрок уже был (опасность начисляется только за первый заход) */
  visited: string[];
  /** накопленная опасность */
  danger: number;
  /** порог уже был перейдён */
  overLimit: boolean;
  /** глубже всего: этаж */
  minFloor: number;
}
