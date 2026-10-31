/**
 * Voxel values → colours. Values are quantised so the greedy mesher can merge neighbours.
 *   1..128   rock (16 hues along the dark purple → maroon → orange ramp × 8 brightness steps)
 *   129..192 ceiling rock (same scheme, 8 × 8, drawn as a separate mesh that top view hides)
 *   193..223 fixed materials (wood, iron, frame stone)
 *   224..255 lava (colour is animated in the shader; the value picks the pattern)
 */

export type Rgb = readonly [number, number, number];

export const ROCK_MIN = 1;
export const ROCK_MAX = 128;
export const CEIL_MIN = 129;
export const CEIL_MAX = 192;
export const WOOD_A = 193;
export const WOOD_B = 194;
export const IRON = 195;
export const FRAME = 196;
export const LAVA_POOL = 224;
export const LAVA_CRACK = 225;
export const LAVA_MIN = 224;

export const isLava = (v: number) => v >= LAVA_MIN;
export const isCeiling = (v: number) => v >= CEIL_MIN && v <= CEIL_MAX;
export const isRockLike = (v: number) => v > 0 && !isLava(v) && !isCeiling(v);

const A: Rgb = [0.13, 0.06, 0.11];
const B: Rgb = [0.4, 0.14, 0.08];
const C: Rgb = [0.7, 0.36, 0.14];

/** The reference palette: t = 0 dark purple, 0.5 maroon, 1 warm orange; k scales brightness. */
export function ramp(t: number, k: number): Rgb {
  const [from, to, u] = t < 0.5 ? [A, B, t * 2] : [B, C, (t - 0.5) * 2];
  return [
    (from[0] + (to[0] - from[0]) * u) * k,
    (from[1] + (to[1] - from[1]) * u) * k,
    (from[2] + (to[2] - from[2]) * u) * k,
  ];
}

const clampInt = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, Math.round(x)));

const ROCK_K0 = 0.45;
const ROCK_KSTEP = 0.1;
const CEIL_T0 = 0.1;
const CEIL_TSTEP = 0.05;
const CEIL_K0 = 0.35;
const CEIL_KSTEP = 0.06;

export function rockValue(t: number, k: number): number {
  return ROCK_MIN + clampInt(t * 15, 0, 15) * 8 + clampInt((k - ROCK_K0) / ROCK_KSTEP, 0, 7);
}

export function ceilingValue(t: number, k: number): number {
  return CEIL_MIN + clampInt((t - CEIL_T0) / CEIL_TSTEP, 0, 7) * 8 + clampInt((k - CEIL_K0) / CEIL_KSTEP, 0, 7);
}

const FIXED: Record<number, Rgb> = {
  [WOOD_A]: [0.3, 0.13, 0.06],
  [WOOD_B]: [0.24, 0.1, 0.05],
  [IRON]: [0.16, 0.13, 0.15],
  [FRAME]: [0.2, 0.09, 0.08],
};

/** Linear RGB for a non-lava voxel value. */
export function colorOf(v: number): Rgb {
  if (v >= ROCK_MIN && v <= ROCK_MAX) {
    const i = v - ROCK_MIN;
    return ramp(Math.floor(i / 8) / 15, ROCK_K0 + (i % 8) * ROCK_KSTEP);
  }
  if (isCeiling(v)) {
    const i = v - CEIL_MIN;
    return ramp(CEIL_T0 + Math.floor(i / 8) * CEIL_TSTEP, CEIL_K0 + (i % 8) * CEIL_KSTEP);
  }
  return FIXED[v] ?? [1, 0, 1];
}
