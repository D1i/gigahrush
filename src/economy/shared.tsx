// Общие помощники страницы экономики: выборки, математика элитности, селекты предметов.
import type { Economy, Item, Pass, Project, Room, Tier } from '../model/types';
import { mutate } from '../model/store';
import { stepsStats, stepsText, tierRuleLines } from '../gen/rules';
import type { LootStep } from '../model/types';

export const TIER_COLORS = ['#8fb86f', '#5fa596', '#6f9fd8', '#a58fd8', '#e8b04b', '#e0864a', '#d8604a', '#c24a7a'];

export const isCurrency = (it: Item) => it.tags.includes('currency');

/** Изменить экономику (ключ — для слияния ввода в один шаг undo). */
export function editEco(fn: (e: Economy, p: Project) => void, key?: string) {
  mutate((p) => fn(p.economy, p), key ? { key: 'eco-' + key } : undefined);
}

export const sortedTiers = (p: Project) => [...p.economy.tiers].sort((a, b) => a.level - b.level || a.name.localeCompare(b.name, 'ru'));

export const itemName = (p: Project, id: string) => p.items.find((i) => i.id === id)?.name ?? '— удалён —';
export const itemColor = (p: Project, id: string) => p.items.find((i) => i.id === id)?.color ?? '#555';

/** Вероятности тиров в комнате: tierId → P. С проходкой веса тиров level ≥ 2 умножаются на tierBoost. */
export function roomTierChances(p: Project, room: Room, pass: Pass | null = null): Map<string, number> {
  const out = new Map<string, number>();
  let sum = 0;
  for (const e of room.elite) {
    const t = p.economy.tiers.find((x) => x.id === e.tierId);
    if (!t || e.weight <= 0) continue;
    const w = e.weight * (pass && t.level >= 2 ? pass.tierBoost : 1);
    out.set(t.id, (out.get(t.id) ?? 0) + w);
    sum += w;
  }
  if (sum > 0) out.forEach((w, k) => out.set(k, w / sum));
  return out;
}

/** Ожидаемый прирост опасности за проход комнаты. */
export function roomExpectedDanger(p: Project, room: Room, pass: Pass | null = null): number {
  let d = 0;
  roomTierChances(p, room, pass).forEach((pr, id) => {
    d += pr * (p.economy.tiers.find((t) => t.id === id)?.danger ?? 0);
  });
  return d;
}

// Правила из gen/rules — в обёртке, чтобы ошибка в одной строке не роняла всю страницу.
export function safeRuleLines(p: Project, t: Tier): string[] {
  try {
    return tierRuleLines(p, t);
  } catch (e) {
    return [`(правила не построены: ${String((e as Error)?.message ?? e)})`];
  }
}
export function safeStepsText(steps: LootStep[]): string {
  try {
    return stepsText(steps);
  } catch {
    return '—';
  }
}
export function safeStepsStats(steps: LootStep[]): { pAny: number; mean: number } | null {
  try {
    return stepsStats(steps);
  } catch {
    return null;
  }
}

/** Селект предмета: валюты отдельной группой. */
export function ItemSelect(props: {
  p: Project;
  value: string;
  onChange: (id: string) => void;
  /** подпись пустого варианта; если не задана — пустого варианта нет */
  empty?: string;
  only?: 'currency';
  className?: string;
}) {
  const { p } = props;
  const cur = p.items.filter(isCurrency);
  const rest = props.only === 'currency' ? [] : p.items.filter((i) => !isCurrency(i));
  const missing = props.value && ![...cur, ...rest].some((i) => i.id === props.value);
  return (
    <select className={'select ' + (props.className ?? '')} value={missing ? '' : props.value} onChange={(e) => props.onChange(e.target.value)}>
      {(props.empty !== undefined || missing || !props.value) && <option value="">{props.empty ?? '— выберите —'}</option>}
      {cur.length > 0 && (
        <optgroup label="Валюты">
          {cur.map((i) => (
            <option key={i.id} value={i.id}>
              {i.name}
            </option>
          ))}
        </optgroup>
      )}
      {rest.length > 0 && (
        <optgroup label="Предметы">
          {rest.map((i) => (
            <option key={i.id} value={i.id}>
              {i.name}
            </option>
          ))}
        </optgroup>
      )}
    </select>
  );
}

/** Множитель «×1.5» */
export const mult = (v: number) => `×${+v.toFixed(2)}`;
