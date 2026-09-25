// Детерминированный ГСЧ от строкового сида. Одинаковый сид → одинаковый прогон
// (важно: движок игры должен воспроизводить результат — алгоритм описан в docs/GENERATOR.md).

/** FNV-1a 32 → seed для mulberry32 */
export function hashSeed(seed: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export interface Rng {
  /** [0, 1) */
  next(): number;
  /** целое в [a, b] включительно */
  int(a: number, b: number): number;
  /** true с вероятностью p */
  chance(p: number): boolean;
  pick<T>(arr: readonly T[]): T;
  /** индекс по весам; -1, если сумма весов ≤ 0 */
  weightedIndex(weights: readonly number[]): number;
  shuffle<T>(arr: T[]): T[];
  /** независимый поток: sub("loot:i3") */
  sub(label: string): Rng;
}

export function makeRng(seed: string | number): Rng {
  let a = typeof seed === 'number' ? seed >>> 0 : hashSeed(seed);
  const base = a;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const rng: Rng = {
    next,
    int: (lo, hi) => (hi < lo ? lo : lo + Math.floor(next() * (hi - lo + 1))),
    chance: (p) => next() < p,
    pick: (arr) => arr[Math.floor(next() * arr.length)],
    weightedIndex(weights) {
      let sum = 0;
      for (const w of weights) sum += Math.max(0, w);
      if (sum <= 0) return -1;
      let r = next() * sum;
      for (let i = 0; i < weights.length; i++) {
        r -= Math.max(0, weights[i]);
        if (r < 0) return i;
      }
      return weights.length - 1;
    },
    shuffle(arr) {
      for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(next() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
      }
      return arr;
    },
    sub: (label) => makeRng(hashSeed(`${base}:${label}`)),
  };
  return rng;
}
