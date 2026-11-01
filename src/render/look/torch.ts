/**
 * The hero's torch (MV): it hangs ahead of the eyes, backs off from the wall in front and dims as it
 * nears it, so a light pressed against stone never blows it out to white.
 */

/**
 * How far ahead of the eyes the hero's torch hangs, how close to it the nearest wall may be at full
 * brightness (closer, it dims), and how far back it may come towards the eyes.
 */
export const TORCH_AHEAD = 2.2;
const TORCH_WALL_GAP = 2.2;
/** How far ahead the wall is looked for: beyond it, the torch hangs at full distance and brightness. */
export const TORCH_REACH = TORCH_AHEAD + TORCH_WALL_GAP;
const TORCH_MIN_AHEAD = 0.8;

/** Where the hero's torch wants to hang, given the free distance to the wall ahead. */
export function torchAheadFor(free: number): number {
  return Math.max(TORCH_MIN_AHEAD, Math.min(TORCH_AHEAD, free - TORCH_WALL_GAP));
}

/** How much the torch dims with the wall `gap` away from it, so the lit spot never burns white. */
export function torchDimming(gap: number): number {
  return Math.min(1, Math.max(0.2, gap) / TORCH_WALL_GAP) ** 1.1;
}
