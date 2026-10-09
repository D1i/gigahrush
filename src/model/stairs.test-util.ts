// Тестовые лестничные залы (не пресеты игры): прямой зал 2.4 × 5.5 м «площадка — марш — площадка» на этаж вверх,
// двустворчатые проёмы 'corridor' на обоих концах — растёт за любым коридором пресетов.
import { createDefaultProject } from '../data/presets';
import { room } from '../data/roomBuilder';
import type { Project, Room } from './types';
import { straightStair } from './stairs';

/** Зал: верх — у северной стены (метка «Верх», dz = 2.7), низ — у южной («Низ», dz = 0). flightW — узкий марш у западной
 *  стены (сбоку низ без марша: перила вдоль марша и у края верхней площадки). */
export function stairHall(id: string, o: { flightW?: number; weight?: number } = {}): Room {
  const r = room(id, 'Тестовый лестничный зал', { tags: ['тест-лестница'], note: 'тест', gen: { weight: o.weight ?? 40, min: 0, max: 9999 }, elite: [] })
    .rect(0, 0, 2.4, 5.5)
    .open('N', 0.55, 'corridor', 'Верх')
    .open('S', 0.55, 'corridor', 'Низ')
    .build();
  r.stair = straightStair({ w: 2.4, l: 5.5, up: 'N', flightW: o.flightW });
  return r;
}

/** Пресеты + тестовые залы. */
export function stairProject(halls: Room[]): Project {
  const p = createDefaultProject();
  p.finishes ??= [];
  p.finishRules ??= [];
  p.rooms.push(...halls);
  return p;
}
