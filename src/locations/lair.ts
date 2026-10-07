// «Логово босса» — заглушка спец-локации: боссов в игре пока нет. Комната помечена для движка
// (Room.location.kind 'lair'); в Room Forge — тёмная комната с табличкой «здесь будет босс». Ставится только
// как выход лифта (src/locations/lift.ts, StreamWorld.ascend), вес роста у пресета 0.
import type { LairSpec } from '../model/types';

export const DEFAULT_LAIR: LairSpec = { kind: 'lair', boss: '', darkness: 0.9 };

export function newLair(): LairSpec {
  return { ...DEFAULT_LAIR };
}

/** Толерантный разбор: не объект или kind ≠ 'lair' — null; мусорные поля — по умолчанию. */
export function normLair(v: unknown): LairSpec | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  if (o.kind !== 'lair') return null;
  const d = o.darkness;
  return {
    kind: 'lair',
    boss: typeof o.boss === 'string' ? o.boss.trim().slice(0, 64) : DEFAULT_LAIR.boss,
    darkness: typeof d === 'number' && Number.isFinite(d) ? Math.min(1, Math.max(0, d)) : DEFAULT_LAIR.darkness,
  };
}

/** Табличка в комнате. */
export function lairSign(spec: LairSpec): string {
  return spec.boss ? `Логово: ${spec.boss}` : 'Здесь будет босс';
}
