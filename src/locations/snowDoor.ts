// Переход сюжета «Дверь в снег» (погреб / общага → снежные тоннели, src/game/story.ts; docs/LOCATIONS.md «Дверь в
// снег») — сценарий без движка, в стиле snowCollapse.ts / hangar.ts: состояние, шаг → события, вид (пелена, тряска).
//
//  • Дверь — метка SNOWDOOR_CONN ('snowdoor') на стене комнаты «Дверь в снег» (Room.location.kind 'snowdoor'); место
//    и нормаль внутрь комнаты — snowDoorPlace. Ближе SNOWDOOR_NEAR м — «E — открыть дверь».
//  • E: дверь распахивается (DOOR_S) — за ней плотный снег до притолоки; треск (CRACK_S): сыплется, гудит, трясёт
//    сильнее; обвал (FALL_S): снег валит в комнату, игрока опрокидывает на спину — белая пелена, засыпало.
//  • «Засыпало! E — выкапываться (n/N)»: N = розыгрыш digs (мир: LocationInfo 'snowdoor'); каждое нажатие убирает часть
//    пелены. Последнее — событие 'descend': движок зовёт операцию мира descend (кооп — через лобби), сажает игрока в
//    снежный ход и зовёт arriveSnowDoor(ok) — выбрался: пелена спадает, подъём из лёжа (RISE_S), 'done'.
//    Не вышло — то же на месте (без перехода).
//  • От E до конца подъёма игрок не ходит (frozen) — как засыпанный обвалом в снежных ходах.

/** id метки двери в снег на стене комнаты (контракт мира). */
export const SNOWDOOR_CONN = 'snowdoor';
/** Подойти к двери: ближе стольких метров к середине проёма (по плану). */
export const SNOWDOOR_NEAR = 1.3;
/** Дверь распахивается, с. */
export const SNOWDOOR_DOOR_S = 1.1;
/** Треск: снег за дверью сыплется и гудит, с. */
export const SNOWDOOR_CRACK_S = 1.4;
/** Обвал: снег валит в комнату, пелена 0 → 1, с. */
export const SNOWDOOR_FALL_S = 0.6;
/** Выбрался: пелена спадает, подъём из лёжа, с. */
export const SNOWDOOR_RISE_S = 1.6;
/** Пелена засыпанного до первого нажатия и сколько её уходит за всю откопку (остаток спадает при подъёме). */
export const SNOWDOOR_WHITE = 0.97;
export const SNOWDOOR_DIG_CLEAR = 0.6;
/** Нажатий по умолчанию (нет розыгрыша) и пределы. */
export const SNOWDOOR_DIGS = 8;

export const SNOWDOOR_PROMPT = 'E — открыть дверь';

export type SnowDoorPhase = 'idle' | 'open' | 'crack' | 'fall' | 'buried' | 'out' | 'rise';

export interface SnowDoorState {
  phase: SnowDoorPhase;
  /** время в фазе, с */
  t: number;
  /** нажатий нужно / сделано */
  need: number;
  dug: number;
  /** переход не удался — выбрался на месте */
  failed: boolean;
}

export type SnowDoorEvent =
  /** E: дверь пошла */
  | { type: 'open' }
  /** за дверью снег — треск */
  | { type: 'crack' }
  /** обвал: снег в комнату */
  | { type: 'fall' }
  /** засыпало */
  | { type: 'buried' }
  /** нажатие E засыпанного */
  | { type: 'dig'; dug: number; need: number }
  /** откопался: пора в снег (операция мира) */
  | { type: 'descend' }
  /** выбрался — сценарий окончен */
  | { type: 'done' };

/** Вид сценария в момент. */
export interface SnowDoorView {
  /** белая пелена 0…1; null — нет */
  white: number | null;
  /** треск: тёмная виньетка 0…1; null — нет */
  crack: number | null;
  /** тряска 0…1+ (сверху движок добавляет толчки откопки) */
  shake: number;
  /** лёжа на спине 0…1: опрокинуло обвалом (взгляд вверх, крен), подъём — обратно к горизонту */
  lie: number;
  /** снег в проёме виден (дверь пошла) */
  snow: boolean;
  /** снег выпирает из проёма (треск) 0…1 */
  bulge: number;
  /** куча снега у порога 0…1 */
  heap: number;
  /** дверь 0…1 (угол от закрытой до распахнутой) */
  door: number;
  frozen: boolean;
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const smooth = (t: number) => {
  const x = clamp01(t);
  return x * x * (3 - 2 * x);
};

/** Нажатий откопки из розыгрыша: целое 1…60, мусор — по умолчанию. */
export function normDigs(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? Math.min(60, Math.max(1, Math.round(v))) : SNOWDOOR_DIGS;
}

export function createSnowDoor(digs: number = SNOWDOOR_DIGS): SnowDoorState {
  return { phase: 'idle', t: 0, need: normDigs(digs), dug: 0, failed: false };
}

/** E у двери: только из покоя. */
export function openSnowDoor(s: SnowDoorState): SnowDoorEvent[] {
  if (s.phase !== 'idle') return [];
  s.phase = 'open';
  s.t = 0;
  s.dug = 0;
  s.failed = false;
  return [{ type: 'open' }];
}

/** Шаг: dt — секунды. 'buried' ждёт нажатий (digSnowDoor), 'out' — arriveSnowDoor. */
export function stepSnowDoor(s: SnowDoorState, dt: number): SnowDoorEvent[] {
  if (s.phase === 'idle' || s.phase === 'buried' || s.phase === 'out') return [];
  s.t += Math.max(0, dt);
  const next = (phase: SnowDoorPhase, e: SnowDoorEvent): SnowDoorEvent[] => {
    s.phase = phase;
    s.t = 0;
    return [e];
  };
  if (s.phase === 'open' && s.t >= SNOWDOOR_DOOR_S) return next('crack', { type: 'crack' });
  if (s.phase === 'crack' && s.t >= SNOWDOOR_CRACK_S) return next('fall', { type: 'fall' });
  if (s.phase === 'fall' && s.t >= SNOWDOOR_FALL_S) return next('buried', { type: 'buried' });
  if (s.phase === 'rise' && s.t >= SNOWDOOR_RISE_S) return next('idle', { type: 'done' });
  return [];
}

/** Нажатие E засыпанного: последнее — 'descend'. */
export function digSnowDoor(s: SnowDoorState): SnowDoorEvent[] {
  if (s.phase !== 'buried') return [];
  s.dug = Math.min(s.need, s.dug + 1);
  const out: SnowDoorEvent[] = [{ type: 'dig', dug: s.dug, need: s.need }];
  if (s.dug >= s.need) {
    s.phase = 'out';
    s.t = 0;
    out.push({ type: 'descend' });
  }
  return out;
}

/** Переход состоялся (ok — игрок уже в снежном ходе) или нет: выбирается из снега. */
export function arriveSnowDoor(s: SnowDoorState, ok: boolean): void {
  if (s.phase !== 'out') return;
  s.phase = 'rise';
  s.t = 0;
  s.failed = !ok;
}

/** Пелена засыпанного после dug нажатий из need. */
export function buriedWhite(dug: number, need: number): number {
  return SNOWDOOR_WHITE - SNOWDOOR_DIG_CLEAR * clamp01(need > 0 ? dug / need : 1);
}

export function snowDoorView(s: SnowDoorState): SnowDoorView {
  const rest = buriedWhite(s.dug, s.need);
  switch (s.phase) {
    case 'idle':
      return { white: null, crack: null, shake: 0, lie: 0, snow: false, bulge: 0, heap: 0, door: 0, frozen: false };
    case 'open': {
      const k = s.t / SNOWDOOR_DOOR_S;
      // ручка, потом полотно; снег в проёме — как только полотно отошло от стены
      return { white: null, crack: null, shake: 0.1 * k, lie: 0, snow: k > 0.45, bulge: 0, heap: 0, door: smooth((k - 0.2) / 0.8), frozen: true };
    }
    case 'crack': {
      const k = clamp01(s.t / SNOWDOOR_CRACK_S);
      return { white: null, crack: k, shake: 0.25 + 0.6 * k, lie: 0, snow: true, bulge: k * k, heap: 0.15 * k, door: 1, frozen: true };
    }
    case 'fall': {
      const k = smooth(s.t / SNOWDOOR_FALL_S);
      return { white: k * SNOWDOOR_WHITE, crack: 1 - k, shake: 1.3, lie: k, snow: true, bulge: 1, heap: 0.15 + 0.85 * k, door: 1, frozen: true };
    }
    case 'buried':
      return { white: rest, crack: null, shake: 0, lie: 1, snow: true, bulge: 1, heap: 1, door: 1, frozen: true };
    case 'out':
      return { white: rest, crack: null, shake: 0, lie: 1, snow: true, bulge: 1, heap: 1, door: 1, frozen: true };
    case 'rise': {
      // пелена спадает быстрее, чем игрок встаёт; на месте (не вышло) — снег у двери так и лежит
      const k = s.t / SNOWDOOR_RISE_S;
      return { white: rest * (1 - smooth(k / 0.6)), crack: null, shake: 0.3 * (1 - clamp01(k * 3)), lie: 1 - smooth(k), snow: true, bulge: 1, heap: 1, door: 1, frozen: k < 0.8 };
    }
  }
}

/** Подсказка: у двери в покое — «E — открыть дверь», засыпанному — «Засыпало! E — выкапываться (n/N)». */
export function snowDoorPrompt(s: SnowDoorState, near: boolean): string | null {
  if (s.phase === 'buried') return `Засыпало! E — выкапываться (${s.dug}/${s.need})`;
  return s.phase === 'idle' && near ? SNOWDOOR_PROMPT : null;
}

// ───────────────────────── место двери (по JSON прогона) ─────────────────────────

/** Минимум метки экспорта (RunConnector, src/blockout/types.ts): клетка начала, сторона, длина в клетках. */
export interface SnowDoorConn {
  id: string;
  cx: number;
  cy: number;
  side: 'N' | 'S' | 'E' | 'W';
  len: number;
}

/**
 * Проём метки на плане (метры): середина по линии стены (грань со стороны комнаты — по углам клеток, как у тупика в
 * src/blockout/core.ts), нормаль внутрь комнаты (план: x вправо, y вниз) и ширина. Babylon: (x, −y).
 */
export function snowDoorPlace(k: SnowDoorConn, cellM: number): { x: number; y: number; nx: number; ny: number; widthM: number } {
  const c = cellM > 0 ? cellM : 0.1;
  const alongX = k.side === 'N' || k.side === 'S';
  // как lineOf / SIGMA ядра: N — верхняя грань клетки, S — нижняя, W — левая, E — правая; нормаль — внутрь
  const line = k.side === 'N' ? k.cy : k.side === 'S' ? k.cy + 1 : k.side === 'W' ? k.cx : k.cx + 1;
  const sg = k.side === 'N' || k.side === 'W' ? -1 : 1;
  const mid = ((alongX ? k.cx : k.cy) + k.len / 2) * c;
  return alongX
    ? { x: mid, y: line * c, nx: 0, ny: -sg, widthM: k.len * c }
    : { x: line * c, y: mid, nx: -sg, ny: 0, widthM: k.len * c };
}
