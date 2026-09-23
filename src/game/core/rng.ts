/** Générateur pseudo-aléatoire déterministe (mulberry32), pour des tests reproductibles. */
export interface Rng {
  /** Réel dans [0, 1[. */
  next(): number;
  /** Réel dans [min, max[. */
  range(min: number, max: number): number;
  /** Entier dans [min, max] (bornes incluses). */
  int(min: number, max: number): number;
  /** Élément au hasard d'un tableau non vide. */
  pick<T>(items: readonly T[]): T;
}

export function createRng(seed: number): Rng {
  let a = seed >>> 0;
  const next = (): number => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    range: (min, max) => min + (max - min) * next(),
    int: (min, max) => Math.floor(min + (max - min + 1) * next()),
    pick: (items) => {
      if (items.length === 0) throw new Error('pick() sur un tableau vide');
      return items[Math.floor(next() * items.length)];
    },
  };
}
