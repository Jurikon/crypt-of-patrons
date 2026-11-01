import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DOOR_WEIGHTS } from '../content';
import type { RewardKind } from '../content/types';

describe('door labels', () => {
  it('every door kind has a solid label colour (an unstyled label is see-through)', () => {
    const css = readFileSync(new URL('../style.css', import.meta.url), 'utf8');
    const kinds: RewardKind[] = [...DOOR_WEIGHTS.map((d) => d.kind), 'boss', 'initiation', 'merchant'];
    for (const kind of kinds) expect(css, kind).toMatch(new RegExp(`\\.door-${kind} \\{\\s*background:`));
  });
});
