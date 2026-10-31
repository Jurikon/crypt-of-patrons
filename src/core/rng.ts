/**
 * Seeded, serializable RNG (sfc32).
 *
 * An RNG is plain data: `{ key, s }`. Functions advance `s` in place, so the
 * caller owns the object (sim code mutates the RNG inside the state copy that
 * `apply` works on). Everything round-trips through JSON.
 *
 * `fork(rng, label)` derives an independent stream from the parent's `key`,
 * not from its current position. Drawing more numbers in one system therefore
 * never shifts the numbers another system sees.
 */

export interface Rng {
  /** Identity of the stream; forks are derived from it. */
  readonly key: string;
  /** sfc32 state: four unsigned 32-bit words. */
  s: [number, number, number, number];
}

/** cyrb128: hashes a string into four 32-bit words for seeding. */
function hash128(str: string): [number, number, number, number] {
  let h1 = 1779033703;
  let h2 = 3144134277;
  let h3 = 1013904242;
  let h4 = 2773480762;
  for (let i = 0; i < str.length; i++) {
    const k = str.charCodeAt(i);
    h1 = h2 ^ Math.imul(h1 ^ k, 597399067);
    h2 = h3 ^ Math.imul(h2 ^ k, 2869860233);
    h3 = h4 ^ Math.imul(h3 ^ k, 951274213);
    h4 = h1 ^ Math.imul(h4 ^ k, 2716044179);
  }
  h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067);
  h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233);
  h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213);
  h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179);
  h1 ^= h2 ^ h3 ^ h4;
  h2 ^= h1;
  h3 ^= h1;
  h4 ^= h1;
  return [h1 >>> 0, h2 >>> 0, h3 >>> 0, h4 >>> 0];
}

export function createRng(seed: number | string): Rng {
  const key = String(seed);
  const rng: Rng = { key, s: hash128(key) };
  // Warm up so that similar keys diverge quickly.
  for (let i = 0; i < 12; i++) nextU32(rng);
  return rng;
}

/** Next unsigned 32-bit integer. Advances the RNG. */
export function nextU32(rng: Rng): number {
  let [a, b, c, d] = rng.s;
  a >>>= 0;
  b >>>= 0;
  c >>>= 0;
  d >>>= 0;
  let t = (a + b) | 0;
  a = b ^ (b >>> 9);
  b = (c + (c << 3)) | 0;
  c = (c << 21) | (c >>> 11);
  d = (d + 1) | 0;
  t = (t + d) | 0;
  c = (c + t) | 0;
  rng.s = [a >>> 0, b >>> 0, c >>> 0, d >>> 0];
  return t >>> 0;
}

/** Float in [0, 1). */
export function float(rng: Rng): number {
  return nextU32(rng) / 4294967296;
}

/** Integer in [min, max], both inclusive. */
export function int(rng: Rng, min: number, max: number): number {
  if (!Number.isInteger(min) || !Number.isInteger(max) || max < min) {
    throw new Error(`rng.int: bad range [${min}, ${max}]`);
  }
  return min + Math.floor(float(rng) * (max - min + 1));
}

/** True with probability p. */
export function chance(rng: Rng, p: number): boolean {
  return float(rng) < p;
}

export function pick<T>(rng: Rng, items: readonly T[]): T {
  if (items.length === 0) throw new Error('rng.pick: empty array');
  return items[int(rng, 0, items.length - 1)] as T;
}

/** Returns a shuffled copy (Fisher–Yates); the input is not modified. */
export function shuffle<T>(rng: Rng, items: readonly T[]): T[] {
  const out = items.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = int(rng, 0, i);
    const tmp = out[i] as T;
    out[i] = out[j] as T;
    out[j] = tmp;
  }
  return out;
}

export interface Weighted<T> {
  readonly item: T;
  readonly weight: number;
}

/** Picks an item with probability proportional to its weight. */
export function weighted<T>(rng: Rng, options: readonly Weighted<T>[]): T {
  let total = 0;
  for (const o of options) {
    if (!(o.weight >= 0)) throw new Error('rng.weighted: negative or NaN weight');
    total += o.weight;
  }
  if (total <= 0) throw new Error('rng.weighted: total weight must be positive');
  let roll = float(rng) * total;
  for (const o of options) {
    roll -= o.weight;
    if (roll < 0) return o.item;
  }
  // Floating point edge: return the last item with non-zero weight.
  for (let i = options.length - 1; i >= 0; i--) {
    const o = options[i] as Weighted<T>;
    if (o.weight > 0) return o.item;
  }
  throw new Error('unreachable');
}

/** Independent named sub-stream. Does not advance or depend on the parent's position. */
export function fork(rng: Rng, label: string): Rng {
  return createRng(`${rng.key}/${label}`);
}
