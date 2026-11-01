import type { Rgb } from './voxel/palette';

/**
 * How each biome looks (GDD 1): the cave's stone colour, the glow in its cracks and pools (lava, cold
 * water, holy light), fog and light colours. The crypt is the reference look.
 */
export interface BiomeLook {
  readonly fog: number;
  readonly background: number;
  readonly hemiSky: number;
  readonly hemiGround: number;
  readonly brazier: number;
  readonly pool: number;
  /** Recolours a stone voxel of the reference palette. */
  readonly stone: (c: Rgb) => Rgb;
  /** Glow colour of cracks and pools: base + wave × k (values above 1 bloom). */
  readonly glowBase: readonly [number, number, number];
  readonly glowWave: readonly [number, number, number];
}

const lum = (c: Rgb) => c[0] * 0.3 + c[1] * 0.59 + c[2] * 0.11;

const CRYPT: BiomeLook = {
  fog: 0x1a0705,
  background: 0x140504,
  hemiSky: 0x5a2a70,
  hemiGround: 0x501008,
  brazier: 0xff8030,
  pool: 0xff5a10,
  stone: (c) => c,
  glowBase: [1.6, 0.33, 0.04],
  glowWave: [0, 0.45, 0.1],
};

const LOOKS: Readonly<Record<string, BiomeLook>> = {
  crypt: CRYPT,
  // Cold wet stone, sickly green-blue water glowing in the cracks.
  catacombs: {
    fog: 0x04121a,
    background: 0x030b10,
    hemiSky: 0x2a5a78,
    hemiGround: 0x0a2a30,
    brazier: 0x60e0c0,
    pool: 0x30c0d0,
    stone: (c) => {
      const l = lum(c) * 1.25;
      return [l * 0.55, l * 0.95, l * 1.2];
    },
    glowBase: [0.05, 0.45, 0.65],
    glowWave: [0.05, 0.3, 0.25],
  },
  // Pale limestone, gold light in the seams.
  cathedral: {
    fog: 0x1c1610,
    background: 0x120e0a,
    hemiSky: 0x5a5260,
    hemiGround: 0x2a2018,
    brazier: 0xffd27a,
    pool: 0xffc860,
    stone: (c) => {
      const l = lum(c) * 1.45;
      return [l * 0.98, l * 0.95, l * 0.9];
    },
    // Faint gold seams, well below the holy fire on the floor.
    glowBase: [0.55, 0.42, 0.18],
    glowWave: [0.1, 0.15, 0.1],
  },
};

export const lookOf = (biome: string): BiomeLook => LOOKS[biome] ?? CRYPT;
