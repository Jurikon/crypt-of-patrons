import { describe, expect, it } from 'vitest';
import { ENEMIES, SUMMONS } from '../../content';
import { CREATURES, PROPS, type CreatureSpec, type PropSpec } from './creatureKit';

const checkParts = (name: string, spec: PropSpec) => {
  for (const p of spec.parts) {
    expect(spec.mats[p.mat], `${name}: material ${p.mat}`).toBeDefined();
    for (const v of [...p.size, ...p.at, ...(p.rot ?? [])]) expect(Number.isFinite(v), name).toBe(true);
  }
};

describe('creature specs', () => {
  it('every enemy and summon has a creature', () => {
    for (const e of ENEMIES) expect(CREATURES[e.model], e.id).toBeDefined();
    for (const s of SUMMONS) expect(CREATURES[s.model], s.id).toBeDefined();
  });

  it.each(Object.entries(CREATURES))('%s is well formed', (name, spec: CreatureSpec) => {
    checkParts(name, spec);
    expect(spec.parts.length).toBeGreaterThan(3);
    // Parts sit on bones that exist (or on the body), eyes too.
    for (const p of spec.parts) if (p.bone !== 'body') expect(spec.bones[p.bone], `${name}: ${p.bone}`).toBeDefined();
    for (const e of spec.eyes) if (e.bone !== 'body') expect(spec.bones[e.bone], `${name}: eye`).toBeDefined();
    // Anything that strikes has something on its striking limb.
    if (spec.poses.windup !== spec.poses.idle)
      expect(
        spec.parts.some((p) => p.bone === 'armR'),
        name,
      ).toBe(true);
    // Walkers have legs.
    if (spec.gait === 'walk') expect(spec.bones.legL && spec.bones.legR, name).toBeTruthy();
    expect(spec.height).toBeGreaterThan(0.3);
  });

  it.each(Object.entries(PROPS))('prop %s is well formed and lies on the body', (name, spec) => {
    checkParts(name, spec);
    for (const p of spec.parts) expect(p.bone).toBe('body');
  });
});
