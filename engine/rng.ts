/**
 * Seeded deterministic RNG (sfc32). Never use Math.random() in rules code;
 * the engine hands you an Rng derived from (match seed, action number).
 */
export interface Rng {
  /** Float in [0, 1). */
  next(): number;
  /** Integer in [min, max] inclusive. */
  int(min: number, max: number): number;
  /** Random element. Throws on an empty array. */
  pick<T>(items: readonly T[]): T;
  /** New shuffled copy (Fisher-Yates); the input is not modified. */
  shuffle<T>(items: readonly T[]): T[];
  /** true with probability p. */
  chance(p: number): boolean;
}

function hash32(n: number, salt: number): number {
  let h = (n ^ Math.imul(salt + 0x9e3779b9, 0x85ebca6b)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x846ca68b) >>> 0;
  return (h ^ (h >>> 16)) >>> 0;
}

export function createRng(seed: number, stream = 0): Rng {
  let a = hash32(seed, 1 + stream * 4);
  let b = hash32(seed, 2 + stream * 4);
  let c = hash32(seed, 3 + stream * 4);
  let d = hash32(seed, 4 + stream * 4) | 1;

  const next = () => {
    a >>>= 0; b >>>= 0; c >>>= 0; d >>>= 0;
    const t = (((a + b) | 0) + d) | 0;
    d = (d + 1) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    c = (c + t) | 0;
    return (t >>> 0) / 4294967296;
  };
  // Warm up so nearby seeds diverge.
  for (let i = 0; i < 12; i++) next();

  const rng: Rng = {
    next,
    int(min, max) {
      if (max < min) throw new Error(`rng.int: max < min (${min}, ${max})`);
      return min + Math.floor(next() * (max - min + 1));
    },
    pick(items) {
      if (items.length === 0) throw new Error("rng.pick: empty array");
      return items[Math.floor(next() * items.length)];
    },
    shuffle(items) {
      const out = items.slice();
      for (let i = out.length - 1; i > 0; i--) {
        const j = Math.floor(next() * (i + 1));
        [out[i], out[j]] = [out[j], out[i]];
      }
      return out;
    },
    chance(p) {
      return next() < p;
    },
  };
  return rng;
}

/** RNG for setup (seq 0) or for the action that produces seq `seq`. */
export function rngFor(seed: number, seq: number): Rng {
  return createRng(seed, seq);
}

/** A fresh random 31-bit seed (server only; never call from rules). */
export function randomSeed(): number {
  return Math.floor(Math.random() * 0x7fffffff);
}
