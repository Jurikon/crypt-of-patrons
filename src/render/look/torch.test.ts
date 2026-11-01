import { describe, expect, it } from 'vitest';
import { TORCH_AHEAD, TORCH_REACH, torchAheadFor, torchDimming } from './torch';

describe("hero's torch", () => {
  it('hangs at full distance and brightness in open space', () => {
    expect(torchAheadFor(TORCH_REACH)).toBe(TORCH_AHEAD);
    expect(torchDimming(TORCH_REACH - TORCH_AHEAD)).toBe(1);
  });

  it('backs off and dims facing a near wall, so the lit spot stays below open-space brightness', () => {
    for (const free of [0.5, 1, 1.5, 2, 3, 4]) {
      const ahead = torchAheadFor(free);
      expect(ahead).toBeLessThanOrEqual(TORCH_AHEAD);
      expect(ahead).toBeGreaterThan(0.5); // never back over the hands
      const gap = Math.max(0.2, free - ahead);
      // Light on the wall falls off as 1 / d^1.1: dimmed, it never beats a wall at the full gap.
      const onWall = torchDimming(free - ahead) / gap ** 1.1;
      const reference = 1 / (TORCH_REACH - TORCH_AHEAD) ** 1.1;
      expect(onWall).toBeLessThanOrEqual(reference + 1e-9);
    }
  });
});
