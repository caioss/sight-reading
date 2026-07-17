/** Deterministic pseudo-random source returning uniform values in [0, 1). */
export type Rng = () => number;

/** mulberry32 — tiny, fast, good-enough distribution for music generation. */
export function createRng(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function pick<T>(rng: Rng, items: readonly T[]): T {
  if (items.length === 0) {
    throw new Error('pick() requires a non-empty list');
  }
  return items[Math.min(items.length - 1, Math.floor(rng() * items.length))];
}

export function pickWeighted<T>(rng: Rng, entries: ReadonlyArray<readonly [T, number]>): T {
  const total = entries.reduce((sum, [, weight]) => sum + weight, 0);
  if (total <= 0) {
    throw new Error('pickWeighted() requires positive total weight');
  }
  let roll = rng() * total;
  for (const [item, weight] of entries) {
    roll -= weight;
    if (roll < 0) {
      return item;
    }
  }
  return entries[entries.length - 1][0];
}

export function chance(rng: Rng, probability: number): boolean {
  return rng() < probability;
}
