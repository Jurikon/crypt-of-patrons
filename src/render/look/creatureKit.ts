/**
 * Creatures as data (MV2): every enemy, boss, summon and floor prop is a list of simple shapes
 * (boxes, cylinders, cones, spheres, rings) hung on a few bones. The renderer turns a spec into
 * meshes and animates the bones: legs walk, the striking arm winds up and swings, the body recoils,
 * and on death the bones come apart. Plain data with no three.js, so specs are checked in Node.
 *
 * Units: metres. Origin: between the feet on the floor. Creatures face +Z.
 */

export type Vec3 = readonly [number, number, number];

/** Bones the animator knows. `armR` is the striking limb (a weapon arm, a leech's head…). */
export type Bone = 'body' | 'head' | 'armR' | 'armL' | 'legL' | 'legR';
export const BONES: readonly Bone[] = ['body', 'head', 'armR', 'armL', 'legL', 'legR'];

/**
 * box: [w, h, d]; cyl: [rTop, h, rBottom]; cone: [r, h, —]; sphere: [rx, ry, rz];
 * ring: [radius, tube, arc] (in the XY plane, arc in radians).
 */
export type ShapeKind = 'box' | 'cyl' | 'cone' | 'sphere' | 'ring';

export interface Part {
  readonly bone: Bone;
  readonly shape: ShapeKind;
  readonly size: Vec3;
  /** Relative to the bone's pivot (for `body`, to the origin). */
  readonly at: Vec3;
  readonly rot?: Vec3;
  readonly mat: string;
}

export interface MatSpec {
  readonly color: number;
  /** Flecks of another colour in the texture. */
  readonly spots?: number;
  readonly stripes?: boolean;
  /** Texture pattern: a flat grain (default), wood planks or dressed stone. */
  readonly pattern?: 'solid' | 'planks' | 'stone';
  readonly rough?: number;
  readonly metal?: number;
  /** Lit from within: drawn at full brightness, no shading (runes, halos, lanterns). */
  readonly glow?: boolean;
}

export interface CreatureSpec {
  readonly mats: Readonly<Record<string, MatSpec>>;
  /** Pivot of each bone in body space; bones not listed hang at the origin and stay still. */
  readonly bones: Readonly<Partial<Record<Bone, Vec3>>>;
  readonly parts: readonly Part[];
  /** Glowing eyes (enemies burn orange, allies green), relative to their bone. */
  readonly eyes: readonly { readonly bone: Bone; readonly at: Vec3; readonly r: number }[];
  /** Striking-arm angles around X (negative swings forward): at rest, telegraphing, end of strike. */
  readonly poses: { readonly idle: number; readonly windup: number; readonly strike: number };
  /** walk: legs stride; hop: no legs, bounces; slither: sways side to side; float: hovers; still: never moves. */
  readonly gait: 'walk' | 'hop' | 'slither' | 'float' | 'still';
  /** Top of the head in metres (before `scale`), for labels and the rise of summons. */
  readonly height: number;
  readonly scale?: number;
}

// ---------------------------------------------------------------------------------------------------
// Shape helpers

const P =
  (shape: ShapeKind) =>
  (bone: Bone, size: Vec3, at: Vec3, mat: string, rot?: Vec3): Part =>
    rot ? { bone, shape, size, at, rot, mat } : { bone, shape, size, at, mat };
const box = P('box');
const cyl = P('cyl');
const cone = P('cone');
const sph = P('sphere');
const ring = P('ring');

const HALF_PI = Math.PI / 2;

// ---------------------------------------------------------------------------------------------------
// Shared bodies

const BONE_MATS = {
  bone: { color: 0xd8ccae, spots: 0x8a7a5a, rough: 0.8 },
  boneDark: { color: 0x8a7a5a, spots: 0x4a3c2a, rough: 0.9 },
  socket: { color: 0x120a06, rough: 1 },
} satisfies Record<string, MatSpec>;

const HIP = 0.95;
const SHOULDER = 1.43;
const NECK = 1.52;

const SKELETON_BONES = {
  head: [0, NECK, 0.01],
  armR: [0.26, SHOULDER, 0],
  armL: [-0.26, SHOULDER, 0],
  legL: [-0.11, HIP, 0],
  legR: [0.11, HIP, 0],
} as const satisfies Partial<Record<Bone, Vec3>>;

function boneLeg(bone: 'legL' | 'legR'): Part[] {
  return [
    cyl(bone, [0.035, 0.42, 0.03], [0, -0.22, 0], 'bone'),
    sph(bone, [0.05, 0.05, 0.05], [0, -0.45, 0.01], 'bone'),
    cyl(bone, [0.03, 0.42, 0.025], [0, -0.68, 0], 'bone'),
    box(bone, [0.09, 0.05, 0.2], [0, -0.91, 0.05], 'boneDark'),
  ];
}

function boneArm(bone: 'armR' | 'armL'): Part[] {
  return [
    sph(bone, [0.05, 0.05, 0.05], [0, 0, 0], 'bone'),
    cyl(bone, [0.03, 0.28, 0.026], [0, -0.16, 0], 'bone'),
    sph(bone, [0.04, 0.04, 0.04], [0, -0.31, 0], 'bone'),
    cyl(bone, [0.025, 0.26, 0.022], [0, -0.45, 0], 'bone'),
    box(bone, [0.07, 0.09, 0.06], [0, -0.62, 0], 'boneDark'),
  ];
}

/** A bare skeleton: pelvis, spine, ribcage, skull with a jaw, thin limbs. */
function skeleton(): Part[] {
  return [
    box('body', [0.3, 0.1, 0.14], [0, HIP, 0], 'bone'),
    cyl('body', [0.03, 0.5, 0.035], [0, 1.2, -0.03], 'boneDark'),
    ...[1.17, 1.25, 1.33, 1.41].map((y, i) =>
      ring('body', [0.15 - i * 0.005, 0.018, Math.PI * 1.6], [0, y, 0], 'bone', [HALF_PI, Math.PI * 1.3, 0]),
    ),
    box('body', [0.04, 0.22, 0.03], [0, 1.3, 0.14], 'bone'),
    box('body', [0.5, 0.04, 0.06], [0, SHOULDER + 0.02, 0], 'bone'),
    sph('head', [0.13, 0.14, 0.14], [0, 0.15, 0], 'bone'),
    box('head', [0.15, 0.06, 0.12], [0, 0.04, 0.05], 'bone'),
    box('head', [0.11, 0.02, 0.01], [0, 0.07, 0.115], 'socket'),
    sph('head', [0.035, 0.035, 0.02], [-0.05, 0.16, 0.12], 'socket'),
    sph('head', [0.035, 0.035, 0.02], [0.05, 0.16, 0.12], 'socket'),
    ...boneLeg('legL'),
    ...boneLeg('legR'),
    ...boneArm('armR'),
    ...boneArm('armL'),
  ];
}

const SKULL_EYES = [
  { bone: 'head', at: [-0.05, 0.16, 0.125], r: 0.022 },
  { bone: 'head', at: [0.05, 0.16, 0.125], r: 0.022 },
] as const;

/** A weapon held in the striking hand points forward (+Z) from the fist. */
const HAND: Vec3 = [0, -0.63, 0];
const inHand = (dz: number, dy = 0): Vec3 => [HAND[0], HAND[1] + dy, HAND[2] + dz];

function sword(bone: 'armR', length: number, width: number): Part[] {
  return [
    box(bone, [width * 3.6, 0.03, 0.04], inHand(0.07), 'brass'),
    box(bone, [width, 0.022, length], inHand(0.09 + length / 2), 'steel'),
    cone(bone, [width * 0.7, 0.12, 0], inHand(0.15 + length), 'steel', [HALF_PI, 0, 0]),
  ];
}

/** A robe falling from the shoulders to the floor, with sleeves on both arms and a hood. */
function robed(cloth: string, shade: string, flare = 0.36): Part[] {
  return [
    cyl('body', [0.17, 1.0, flare], [0, 0.5, 0], cloth),
    cyl('body', [0.2, 0.42, 0.17], [0, 1.22, 0], cloth),
    cyl('body', [flare + 0.01, 0.06, flare + 0.03], [0, 0.03, 0], shade),
    sph('head', [0.15, 0.17, 0.15], [0, 0.15, -0.02], cloth),
    cone('head', [0.1, 0.16, 0], [0, 0.31, -0.07], cloth, [-0.5, 0, 0]),
    sph('head', [0.1, 0.11, 0.06], [0, 0.13, 0.08], 'shadow'),
    cyl('armR', [0.06, 0.5, 0.09], [0, -0.26, 0], cloth),
    cyl('armL', [0.06, 0.5, 0.09], [0, -0.26, 0], cloth),
    box('armR', [0.07, 0.08, 0.07], [0, -0.56, 0], 'hand'),
    box('armL', [0.07, 0.08, 0.07], [0, -0.56, 0], 'hand'),
  ];
}

const HOOD_EYES = [
  { bone: 'head', at: [-0.045, 0.14, 0.13], r: 0.02 },
  { bone: 'head', at: [0.045, 0.14, 0.13], r: 0.02 },
] as const;

// ---------------------------------------------------------------------------------------------------
// Act 1 — the crypt

const warrior: CreatureSpec = {
  mats: {
    ...BONE_MATS,
    iron: { color: 0x4a4644, spots: 0x2a2624, rough: 0.5, metal: 0.3 },
    steel: { color: 0xa8acb4, spots: 0x707680, rough: 0.35, metal: 0.4 },
    brass: { color: 0xb08a30, spots: 0x6a5018, rough: 0.4, metal: 0.4 },
    red: { color: 0x7a1a14, spots: 0x3a0a08, stripes: true },
    wood: { color: 0x5a3a1e, pattern: 'planks' },
  },
  bones: SKELETON_BONES,
  parts: [
    ...skeleton(),
    // Horned helmet with a nose guard.
    sph('head', [0.155, 0.11, 0.155], [0, 0.2, 0], 'iron'),
    box('head', [0.03, 0.09, 0.03], [0, 0.15, 0.15], 'iron'),
    cone('head', [0.03, 0.17, 0], [-0.17, 0.27, 0], 'bone', [0, 0, 0.9]),
    cone('head', [0.03, 0.17, 0], [0.17, 0.27, 0], 'bone', [0, 0, -0.9]),
    // Pauldron, belt and a ragged loincloth.
    sph('armR', [0.11, 0.07, 0.11], [0, 0.03, 0], 'iron'),
    box('body', [0.32, 0.05, 0.16], [0, HIP + 0.06, 0], 'iron'),
    box('body', [0.2, 0.32, 0.02], [0, 0.78, 0.08], 'red'),
    box('body', [0.2, 0.28, 0.02], [0, 0.8, -0.08], 'red'),
    // Round shield on the left arm.
    cyl('armL', [0.27, 0.035, 0.27], [0.02, -0.42, 0.09], 'wood', [HALF_PI, 0, 0]),
    ring('armL', [0.27, 0.02, Math.PI * 2], [0.02, -0.42, 0.11], 'iron'),
    sph('armL', [0.05, 0.05, 0.03], [0.02, -0.42, 0.13], 'brass'),
    ...sword('armR', 0.62, 0.055),
  ],
  eyes: SKULL_EYES,
  poses: { idle: -0.6, windup: -2.4, strike: -0.3 },
  gait: 'walk',
  height: 1.9,
};

const archer: CreatureSpec = {
  mats: {
    ...BONE_MATS,
    hood: { color: 0x3a3428, spots: 0x1a1610, stripes: true },
    leather: { color: 0x5a3a22, spots: 0x2a1a0c },
    wood: { color: 0x6a4424, pattern: 'planks' },
    feather: { color: 0xb8b0a0, spots: 0x6a2a20 },
  },
  bones: SKELETON_BONES,
  parts: [
    ...skeleton(),
    // Hood with a point at the back, mantle and a ragged cape.
    sph('head', [0.165, 0.17, 0.16], [0, 0.16, -0.05], 'hood'),
    cone('head', [0.08, 0.18, 0], [0, 0.24, -0.17], 'hood', [-1.1, 0, 0]),
    cyl('body', [0.14, 0.14, 0.3], [0, SHOULDER - 0.03, 0], 'hood'),
    box('body', [0.38, 0.8, 0.03], [0, 1.0, -0.13], 'hood', [0.1, 0, 0]),
    // Quiver across the back with fletchings.
    cyl('body', [0.055, 0.42, 0.05], [0.08, 1.22, -0.17], 'leather', [0, 0, -0.35]),
    ...[-0.03, 0, 0.03].map((dx) => cone('body', [0.025, 0.08, 0], [0.16 + dx, 1.46, -0.17], 'feather')),
    box('body', [0.32, 0.05, 0.16], [0, HIP + 0.06, 0], 'leather'),
    // Bow: an arc standing upright across the fist, with its string.
    // (an arc in the arm's YZ plane bulging forward, centred so its grip sits in the fist)
    ring('armR', [0.42, 0.02, Math.PI * 0.8], [0, HAND[1] + 0.4, 0.13], 'wood', [0, HALF_PI, Math.PI]),
  ],
  eyes: SKULL_EYES,
  poses: { idle: -0.5, windup: -1.55, strike: -1.45 },
  gait: 'walk',
  height: 1.9,
};

const warden: CreatureSpec = {
  mats: {
    ...BONE_MATS,
    iron: { color: 0x5a5450, spots: 0x5a3010, rough: 0.5, metal: 0.35 },
    steel: { color: 0x9aa0aa, spots: 0x5a6068, rough: 0.35, metal: 0.45 },
    brass: { color: 0xc89a30, spots: 0x7a5a18, rough: 0.35, metal: 0.5 },
    royal: { color: 0x4a1a5a, spots: 0x1a0820, stripes: true },
  },
  bones: SKELETON_BONES,
  parts: [
    ...skeleton(),
    // A crown of spikes.
    cyl('head', [0.14, 0.06, 0.14], [0, 0.26, 0], 'brass'),
    ...[0, 1, 2, 3, 4, 5].map((i) =>
      cone(
        'head',
        [0.025, 0.1, 0],
        [Math.sin((i / 6) * Math.PI * 2) * 0.13, 0.33, Math.cos((i / 6) * Math.PI * 2) * 0.13],
        'brass',
      ),
    ),
    // Breastplate, heavy pauldrons, a tattered royal cape.
    box('body', [0.42, 0.36, 0.24], [0, 1.27, 0], 'iron'),
    box('body', [0.12, 0.2, 0.02], [0, 1.27, 0.125], 'brass'),
    sph('armR', [0.11, 0.07, 0.11], [0.02, 0.04, 0], 'steel'),
    sph('armL', [0.11, 0.07, 0.11], [-0.02, 0.04, 0], 'steel'),
    ring('armR', [0.1, 0.015, Math.PI * 2], [0.02, 0.02, 0], 'brass', [HALF_PI, 0, 0]),
    ring('armL', [0.1, 0.015, Math.PI * 2], [-0.02, 0.02, 0], 'brass', [HALF_PI, 0, 0]),
    box('body', [0.5, 1.15, 0.03], [0, 0.85, -0.15], 'royal', [0.08, 0, 0]),
    box('body', [0.34, 0.06, 0.18], [0, HIP + 0.05, 0], 'iron'),
    box('body', [0.24, 0.4, 0.02], [0, 0.74, 0.09], 'royal'),
    // A huge greatsword.
    box('armR', [0.07, 0.24, 0.07], inHand(0, 0.02), 'royal'),
    ...sword('armR', 0.95, 0.09),
  ],
  eyes: SKULL_EYES,
  poses: { idle: -0.7, windup: -2.8, strike: -0.3 },
  gait: 'walk',
  height: 2.05,
  scale: 1.3,
};

const sarcophagus: CreatureSpec = {
  mats: {
    stone: { color: 0x6a6258, pattern: 'stone' },
    lid: { color: 0x8a8274, spots: 0x4a4438, rough: 0.9 },
    relief: { color: 0x9a9284, spots: 0x5a5448 },
    crack: { color: 0xffa040, glow: true },
  },
  bones: {},
  parts: [
    box('body', [0.72, 0.56, 1.5], [0, 0.28, 0], 'stone'),
    box('body', [0.8, 0.08, 1.6], [0, 0.04, 0], 'lid'),
    // The lid pushed a little ajar, light leaking from inside.
    box('body', [0.8, 0.12, 1.62], [0.04, 0.62, 0.03], 'lid', [0, 0.06, 0]),
    box('body', [0.66, 0.02, 0.04], [0.0, 0.565, -0.78], 'crack'),
    box('body', [0.02, 0.02, 1.4], [-0.36, 0.565, 0], 'crack'),
    // A knight carved on the lid, hands folded over a sword.
    sph('body', [0.13, 0.08, 0.13], [0.04, 0.72, 0.52], 'relief'),
    box('body', [0.34, 0.07, 0.62], [0.04, 0.715, 0.05], 'relief'),
    box('body', [0.07, 0.04, 0.7], [0.04, 0.76, -0.05], 'relief'),
    box('body', [0.22, 0.06, 0.3], [0.04, 0.705, -0.5], 'relief'),
  ],
  eyes: [],
  poses: { idle: 0, windup: 0, strike: 0 },
  gait: 'still',
  height: 0.8,
};

const totem: CreatureSpec = {
  mats: {
    ...BONE_MATS,
    wood: { color: 0x4a3420, pattern: 'planks' },
    rag: { color: 0x6a1a14, spots: 0x2a0806, stripes: true },
    feather: { color: 0x1a1614, spots: 0x4a4440 },
  },
  bones: {},
  parts: [
    cyl('body', [0.09, 1.7, 0.12], [0, 0.85, 0], 'wood'),
    cyl('body', [0.3, 0.12, 0.34], [0, 0.06, 0], 'boneDark'),
    // Three skulls stacked on the pole.
    ...[0.62, 1.05, 1.48].map((y, i) => sph('body', [0.15 - i * 0.01, 0.15, 0.15], [0, y, 0.04], 'bone')),
    ...[0.62, 1.05, 1.48].map((y) => box('body', [0.13, 0.05, 0.1], [0, y - 0.11, 0.09], 'bone')),
    // Antlers, rags and black feathers.
    cone('body', [0.03, 0.4, 0], [-0.16, 1.78, 0], 'bone', [0, 0, 0.7]),
    cone('body', [0.03, 0.4, 0], [0.16, 1.78, 0], 'bone', [0, 0, -0.7]),
    box('body', [0.06, 0.5, 0.01], [0.12, 1.2, 0.08], 'rag', [0, 0, -0.15]),
    box('body', [0.05, 0.4, 0.01], [-0.12, 0.8, 0.06], 'rag', [0, 0, 0.2]),
    ...[-0.5, 0, 0.5].map((a) =>
      cone('body', [0.03, 0.28, 0], [Math.sin(a) * 0.14, 1.28, -0.06], 'feather', [0, 0, a]),
    ),
  ],
  eyes: [0.62, 1.05, 1.48].flatMap((y) => [
    { bone: 'body' as const, at: [-0.055, y + 0.02, 0.17] as const, r: 0.025 },
    { bone: 'body' as const, at: [0.055, y + 0.02, 0.17] as const, r: 0.025 },
  ]),
  poses: { idle: 0, windup: 0, strike: 0 },
  gait: 'still',
  height: 1.95,
};

// ---------------------------------------------------------------------------------------------------
// Summons

const boneWall: CreatureSpec = {
  mats: { ...BONE_MATS },
  bones: {},
  parts: [
    sph('body', [0.75, 0.45, 0.5], [0, 0.2, 0], 'boneDark'),
    sph('body', [0.5, 0.35, 0.38], [0.15, 0.55, 0], 'boneDark'),
    ...[
      [-0.5, 0.4, 0.3, 0.6, 0.3],
      [0.4, 0.55, 0.25, -0.8, 0.1],
      [-0.1, 0.8, 0.2, 0.2, -0.5],
      [0.6, 0.3, 0.35, 1.2, 0.4],
      [-0.65, 0.2, 0.1, -1.3, 0.2],
    ].map(([x, y, z, rz, rx]) => cyl('body', [0.035, 0.6, 0.03], [x!, y!, z!], 'bone', [rx!, 0, rz!])),
    ...[
      [-0.3, 0.45, 0.35],
      [0.25, 0.8, 0.25],
      [0.45, 0.35, 0.38],
    ].map(([x, y, z]) => sph('body', [0.12, 0.12, 0.12], [x!, y!, z!], 'bone')),
  ],
  eyes: [
    [-0.3, 0.47, 0.46],
    [0.25, 0.82, 0.36],
    [0.45, 0.37, 0.49],
  ].flatMap(([x, y, z]) => [
    { bone: 'body' as const, at: [x! - 0.04, y!, z!] as const, r: 0.018 },
    { bone: 'body' as const, at: [x! + 0.04, y!, z!] as const, r: 0.018 },
  ]),
  poses: { idle: 0, windup: 0, strike: 0 },
  gait: 'still',
  height: 1.0,
};

const decoy: CreatureSpec = {
  mats: {
    wood: { color: 0x5a3a1e, pattern: 'planks' },
    sack: { color: 0x9a8058, spots: 0x5a4428, stripes: true },
    rag: { color: 0x4a3a5a, spots: 0x1a1220, stripes: true },
    straw: { color: 0xc8a850, spots: 0x8a6a20 },
    socket: BONE_MATS.socket,
  },
  bones: {},
  parts: [
    cyl('body', [0.04, 1.7, 0.05], [0, 0.85, 0], 'wood'),
    box('body', [1.0, 0.06, 0.06], [0, 1.35, 0], 'wood'),
    sph('body', [0.17, 0.19, 0.16], [0, 1.72, 0], 'sack'),
    sph('body', [0.03, 0.03, 0.02], [-0.06, 1.75, 0.14], 'socket'),
    sph('body', [0.03, 0.03, 0.02], [0.06, 1.75, 0.14], 'socket'),
    cone('body', [0.2, 0.18, 0], [0, 1.9, 0], 'straw'),
    cyl('body', [0.22, 0.6, 0.3], [0, 1.05, 0], 'rag'),
    ...[-0.5, 0.5].map((x) => cone('body', [0.06, 0.18, 0], [x, 1.33, 0], 'straw', [0, 0, x > 0 ? -HALF_PI : HALF_PI])),
  ],
  eyes: [],
  poses: { idle: 0, windup: 0, strike: 0 },
  gait: 'still',
  height: 2.0,
};

// ---------------------------------------------------------------------------------------------------
// Act 2 — the flooded catacombs

const fleshLimbs = (flesh: string, claw: string, reach = 1): Part[] =>
  (['armR', 'armL'] as const).flatMap((b) => [
    sph(b, [0.07, 0.07, 0.07], [0, 0, 0], flesh),
    cyl(b, [0.05, 0.36 * reach, 0.042], [0, -0.19 * reach, 0], flesh),
    cyl(b, [0.042, 0.36 * reach, 0.032], [0, -0.55 * reach, 0], flesh),
    ...[-0.03, 0, 0.03].map((dx) => cone(b, [0.014, 0.1, 0], [dx, -0.77 * reach, 0.02], claw, [Math.PI, 0, 0])),
  ]);

const ghoul: CreatureSpec = {
  mats: {
    flesh: { color: 0x7a8670, spots: 0x4a5040, rough: 0.7 },
    dark: { color: 0x3a4232, spots: 0x1a2014, stripes: true },
    claw: { color: 0x2a2018 },
    teeth: { color: 0xd8ccae },
    rag: { color: 0x3a2a1a, spots: 0x1a1008, stripes: true },
    socket: BONE_MATS.socket,
  },
  bones: {
    head: [0, 1.32, 0.22],
    armR: [0.24, 1.3, 0.12],
    armL: [-0.24, 1.3, 0.12],
    legL: [-0.13, 0.8, 0],
    legR: [0.13, 0.8, 0],
  },
  parts: [
    // Hunched: the torso leans far forward, ribs showing through grey skin.
    sph('body', [0.21, 0.3, 0.17], [0, 1.08, 0.05], 'dark', [0.55, 0, 0]),
    sph('body', [0.17, 0.12, 0.13], [0, 0.82, 0.02], 'flesh'),
    box('body', [0.22, 0.24, 0.02], [0, 0.66, 0.1], 'rag'),
    sph('head', [0.12, 0.12, 0.15], [0, 0.04, 0.05], 'flesh'),
    box('head', [0.13, 0.05, 0.1], [0, -0.06, 0.12], 'flesh', [0.35, 0, 0]),
    box('head', [0.11, 0.02, 0.02], [0, -0.03, 0.18], 'teeth'),
    cone('head', [0.03, 0.12, 0], [-0.12, 0.1, 0.02], 'flesh', [0, 0, 1.1]),
    cone('head', [0.03, 0.12, 0], [0.12, 0.1, 0.02], 'flesh', [0, 0, -1.1]),
    ...fleshLimbs('flesh', 'claw', 1.1),
    ...(['legL', 'legR'] as const).flatMap((b) => [
      cyl(b, [0.06, 0.4, 0.05], [0, -0.18, 0.08], 'flesh', [-0.4, 0, 0]),
      cyl(b, [0.045, 0.42, 0.035], [0, -0.55, 0.04], 'flesh', [0.25, 0, 0]),
      box(b, [0.1, 0.05, 0.22], [0, -0.77, 0.08], 'dark'),
    ]),
  ],
  eyes: [
    { bone: 'head', at: [-0.045, 0.06, 0.18], r: 0.022 },
    { bone: 'head', at: [0.045, 0.06, 0.18], r: 0.022 },
  ],
  poses: { idle: -0.6, windup: -2.4, strike: -0.3 },
  gait: 'walk',
  height: 1.55,
};

const drowned: CreatureSpec = {
  mats: {
    skin: { color: 0x6a8a88, spots: 0x3a5a58, rough: 0.5 },
    cloth: { color: 0x2a3a3a, spots: 0x101a1a, stripes: true },
    weed: { color: 0x2a5a2a, spots: 0x103010 },
    hair: { color: 0x141a14 },
    rust: { color: 0x6a3a1a, spots: 0x3a1a08, rough: 0.6, metal: 0.3 },
    coral: { color: 0xc86a5a, spots: 0x8a3a30 },
  },
  bones: {
    head: [0, 1.5, 0.04],
    armR: [0.25, 1.42, 0],
    armL: [-0.25, 1.42, 0],
    legL: [-0.12, 0.92, 0],
    legR: [0.12, 0.92, 0],
  },
  parts: [
    cyl('body', [0.2, 0.55, 0.18], [0, 1.18, 0], 'cloth'),
    cyl('body', [0.18, 0.3, 0.26], [0, 0.82, 0], 'cloth'),
    box('body', [0.08, 0.6, 0.01], [0.12, 1.0, 0.18], 'weed', [0, 0, 0.1]),
    box('body', [0.06, 0.5, 0.01], [-0.1, 1.05, -0.2], 'weed', [0, 0, -0.15]),
    cone('body', [0.05, 0.14, 0], [-0.17, 1.42, 0.06], 'coral', [0, 0, 0.6]),
    cone('body', [0.04, 0.1, 0], [-0.21, 1.38, 0.0], 'coral', [0, 0, 1.0]),
    // Head lolling forward, hair hanging in wet strands.
    sph('head', [0.12, 0.14, 0.13], [0, 0.1, 0.03], 'skin', [0.3, 0, 0]),
    ...[-0.08, -0.03, 0.03, 0.08].map((x) =>
      box('head', [0.03, 0.34, 0.03], [x, -0.03, -0.08 + Math.abs(x) * 0.5], 'hair'),
    ),
    box('head', [0.2, 0.08, 0.12], [0, 0.22, -0.02], 'hair'),
    ...(['armR', 'armL'] as const).flatMap((b) => [
      cyl(b, [0.055, 0.32, 0.05], [0, -0.17, 0], 'skin'),
      cyl(b, [0.05, 0.3, 0.045], [0, -0.48, 0], 'skin'),
      box(b, [0.08, 0.1, 0.07], [0, -0.66, 0], 'skin'),
    ]),
    ...(['legL', 'legR'] as const).flatMap((b) => [
      cyl(b, [0.07, 0.48, 0.06], [0, -0.25, 0], 'cloth'),
      cyl(b, [0.055, 0.42, 0.05], [0, -0.68, 0], 'skin'),
    ]),
    // A rusty anchor hook dragged along.
    cyl('armR', [0.02, 0.6, 0.02], inHand(0.25), 'rust', [HALF_PI, 0, 0]),
    ring('armR', [0.14, 0.025, Math.PI], inHand(0.58, -0.05), 'rust', [0, HALF_PI, Math.PI]),
  ],
  eyes: [
    { bone: 'head', at: [-0.045, 0.12, 0.15], r: 0.02 },
    { bone: 'head', at: [0.045, 0.12, 0.15], r: 0.02 },
  ],
  poses: { idle: -0.5, windup: -2.6, strike: -1.3 },
  gait: 'walk',
  height: 1.8,
};

const bloated: CreatureSpec = {
  mats: {
    bloat: { color: 0x8a9a6a, spots: 0x5a3a4a, rough: 0.4 },
    vein: { color: 0x5a3a4a, spots: 0x3a1a2a, stripes: true },
    skin: { color: 0x6a7a5a, spots: 0x3a4a2a },
    rag: { color: 0x3a3022, stripes: true },
    pus: { color: 0xc8d050, glow: true },
  },
  bones: {
    head: [0, 1.42, 0.04],
    armR: [0.42, 1.08, 0],
    armL: [-0.42, 1.08, 0],
    legL: [-0.18, 0.4, 0],
    legR: [0.18, 0.4, 0],
  },
  parts: [
    sph('body', [0.48, 0.5, 0.46], [0, 0.85, 0.04], 'bloat'),
    sph('body', [0.3, 0.22, 0.12], [0.1, 0.9, 0.38], 'vein'),
    sph('body', [0.06, 0.06, 0.03], [-0.18, 0.75, 0.46], 'pus'),
    sph('body', [0.05, 0.05, 0.03], [0.24, 1.05, 0.38], 'pus'),
    box('body', [0.5, 0.18, 0.4], [0, 0.42, 0], 'rag'),
    sph('head', [0.1, 0.11, 0.1], [0, 0.06, 0.04], 'skin'),
    ...(['armR', 'armL'] as const).flatMap((b) => [
      cyl(b, [0.07, 0.3, 0.06], [0, -0.15, 0], 'skin'),
      sph(b, [0.07, 0.07, 0.07], [0, -0.34, 0], 'skin'),
    ]),
    ...(['legL', 'legR'] as const).flatMap((b) => [
      cyl(b, [0.1, 0.36, 0.09], [0, -0.2, 0], 'skin'),
      box(b, [0.14, 0.06, 0.2], [0, -0.38, 0.04], 'vein'),
    ]),
  ],
  eyes: [
    { bone: 'head', at: [-0.035, 0.08, 0.13], r: 0.017 },
    { bone: 'head', at: [0.035, 0.08, 0.13], r: 0.017 },
  ],
  poses: { idle: -0.3, windup: -1.8, strike: -0.6 },
  gait: 'walk',
  height: 1.6,
};

const leech: CreatureSpec = {
  mats: {
    hide: { color: 0x3a2a30, spots: 0x1a1018, stripes: true, rough: 0.35 },
    belly: { color: 0x8a5a5a, spots: 0x5a3a3a, rough: 0.4 },
    teeth: { color: 0xe8dcc0 },
    maw: { color: 0x3a0808 },
  },
  bones: { armR: [0, 0.32, 0.25] },
  parts: [
    // Segments trailing back along the floor.
    ...[0, 1, 2, 3, 4].map((i) =>
      sph(
        'body',
        [0.22 - i * 0.03, 0.16 - i * 0.02, 0.2],
        [0, 0.15 - i * 0.015, 0.05 - i * 0.28],
        i % 2 ? 'hide' : 'belly',
      ),
    ),
    sph('body', [0.06, 0.05, 0.12], [0, 0.07, -1.25], 'hide'),
    // The striking part is the head: a rearing neck ending in a round, toothed maw.
    sph('armR', [0.18, 0.15, 0.2], [0, 0, 0.08], 'hide'),
    sph('armR', [0.15, 0.13, 0.15], [0, 0.0, 0.3], 'belly'),
    cyl('armR', [0.13, 0.04, 0.13], [0, 0, 0.44], 'maw', [HALF_PI, 0, 0]),
    ring('armR', [0.12, 0.03, Math.PI * 2], [0, 0, 0.45], 'hide'),
    ...[0, 1, 2, 3, 4, 5, 6, 7].map((i) => {
      const a = (i / 8) * Math.PI * 2;
      return cone('armR', [0.015, 0.06, 0], [Math.cos(a) * 0.09, Math.sin(a) * 0.09, 0.45], 'teeth', [HALF_PI, 0, 0]);
    }),
  ],
  eyes: [
    { bone: 'armR', at: [-0.1, 0.1, 0.32], r: 0.018 },
    { bone: 'armR', at: [0.1, 0.1, 0.32], r: 0.018 },
  ],
  poses: { idle: 0, windup: -0.6, strike: 0.35 },
  gait: 'slither',
  height: 0.6,
};

const mother: CreatureSpec = {
  mats: {
    skin: { color: 0x7a9a98, spots: 0x4a6a68, rough: 0.45 },
    dress: { color: 0x1e3434, spots: 0x0a1414, stripes: true },
    hair: { color: 0x0e1612, spots: 0x1a3020 },
    coral: { color: 0xd0705a, spots: 0x8a3a30 },
    pearl: { color: 0x9adcd8, glow: true },
    claw: { color: 0x1a1414 },
    weed: { color: 0x2a5a2a, spots: 0x103010 },
  },
  bones: {
    head: [0, 1.62, 0.02],
    armR: [0.27, 1.5, 0],
    armL: [-0.27, 1.5, 0],
  },
  parts: [
    // A tall, gaunt figure in a sodden gown that spreads on the floor.
    cyl('body', [0.15, 1.15, 0.5], [0, 0.58, 0], 'dress'),
    cyl('body', [0.52, 0.05, 0.6], [0, 0.03, 0], 'weed'),
    cyl('body', [0.2, 0.4, 0.15], [0, 1.35, 0], 'skin'),
    box('body', [0.42, 0.06, 0.12], [0, 1.52, 0], 'skin'),
    // Long hair hanging past the waist; a crown of coral and pearls.
    sph('head', [0.12, 0.15, 0.13], [0, 0.13, 0.02], 'skin'),
    ...[-0.12, -0.06, 0, 0.06, 0.12].map((x) =>
      box('head', [0.05, 0.75, 0.04], [x, -0.16, -0.1 + Math.abs(x) * 0.4], 'hair', [-0.08, 0, x * 0.6]),
    ),
    box('head', [0.26, 0.1, 0.2], [0, 0.25, -0.03], 'hair'),
    ...[-0.1, -0.05, 0, 0.05, 0.1].map((x) =>
      cone('head', [0.025, 0.12 + (0.1 - Math.abs(x)) * 0.8, 0], [x, 0.34, 0.03], 'coral', [0, 0, -x * 3]),
    ),
    sph('head', [0.025, 0.025, 0.025], [0, 0.31, 0.11], 'pearl'),
    ...fleshLimbs('skin', 'claw', 1.25),
  ],
  eyes: [
    { bone: 'head', at: [-0.045, 0.14, 0.135], r: 0.022 },
    { bone: 'head', at: [0.045, 0.14, 0.135], r: 0.022 },
  ],
  poses: { idle: -0.5, windup: -2.7, strike: -0.6 },
  gait: 'float',
  height: 2.0,
  scale: 1.5,
};

// ---------------------------------------------------------------------------------------------------
// Act 3 — the cathedral

const templar: CreatureSpec = {
  mats: {
    steel: { color: 0x9aa0aa, spots: 0x5a6068, rough: 0.35, metal: 0.45 },
    dark: { color: 0x3a3c40, spots: 0x1a1c20, rough: 0.5, metal: 0.3 },
    tabard: { color: 0xc8c0b0, spots: 0x8a8070, stripes: true },
    red: { color: 0x8a1a14, spots: 0x4a0a08 },
    brass: { color: 0xb08a30, spots: 0x6a5018, rough: 0.4, metal: 0.4 },
    slit: { color: 0x050302 },
  },
  bones: {
    head: [0, 1.56, 0],
    armR: [0.3, 1.45, 0],
    armL: [-0.3, 1.45, 0],
    legL: [-0.12, 0.95, 0],
    legR: [0.12, 0.95, 0],
  },
  parts: [
    box('body', [0.44, 0.52, 0.26], [0, 1.22, 0], 'steel'),
    box('body', [0.32, 0.72, 0.02], [0, 0.95, 0.14], 'tabard'),
    box('body', [0.06, 0.4, 0.01], [0, 1.05, 0.155], 'red'),
    box('body', [0.22, 0.06, 0.01], [0, 1.15, 0.155], 'red'),
    box('body', [0.36, 0.08, 0.22], [0, 0.96, 0], 'dark'),
    // Great helm with a dark eye slit.
    cyl('head', [0.14, 0.3, 0.15], [0, 0.14, 0], 'steel'),
    box('head', [0.22, 0.03, 0.02], [0, 0.17, 0.145], 'slit'),
    box('head', [0.025, 0.12, 0.02], [0, 0.1, 0.15], 'brass'),
    sph('armR', [0.12, 0.09, 0.12], [0.02, 0.03, 0], 'steel'),
    sph('armL', [0.12, 0.09, 0.12], [-0.02, 0.03, 0], 'steel'),
    ...(['armR', 'armL'] as const).flatMap((b) => [
      cyl(b, [0.06, 0.32, 0.055], [0, -0.18, 0], 'dark'),
      cyl(b, [0.06, 0.28, 0.05], [0, -0.47, 0], 'steel'),
      box(b, [0.09, 0.1, 0.08], [0, -0.64, 0], 'dark'),
    ]),
    ...(['legL', 'legR'] as const).flatMap((b) => [
      cyl(b, [0.08, 0.46, 0.07], [0, -0.24, 0], 'dark'),
      cyl(b, [0.07, 0.42, 0.06], [0, -0.66, 0], 'steel'),
      box(b, [0.11, 0.06, 0.22], [0, -0.91, 0.04], 'dark'),
    ]),
    // Tower shield with a red cross.
    box('armL', [0.5, 0.86, 0.05], [-0.02, -0.4, 0.13], 'tabard'),
    box('armL', [0.09, 0.7, 0.01], [-0.02, -0.38, 0.16], 'red'),
    box('armL', [0.4, 0.09, 0.01], [-0.02, -0.25, 0.16], 'red'),
    // A flanged mace.
    cyl('armR', [0.022, 0.55, 0.022], inHand(0.22), 'dark', [HALF_PI, 0, 0]),
    sph('armR', [0.09, 0.09, 0.11], inHand(0.52), 'steel'),
    ...[0, 1, 2, 3].map((i) => box('armR', [0.02, 0.2, 0.14], inHand(0.52), 'steel', [0, 0, (i * Math.PI) / 4])),
  ],
  eyes: [
    { bone: 'head', at: [-0.05, 0.17, 0.14], r: 0.016 },
    { bone: 'head', at: [0.05, 0.17, 0.14], r: 0.016 },
  ],
  poses: { idle: -0.9, windup: -2.8, strike: -0.55 },
  gait: 'walk',
  height: 1.9,
  scale: 1.05,
};

const ROBE_BONES = {
  head: [0, 1.48, 0.02],
  armR: [0.24, 1.4, 0],
  armL: [-0.24, 1.4, 0],
} as const satisfies Partial<Record<Bone, Vec3>>;

const acolyte: CreatureSpec = {
  mats: {
    robe: { color: 0x4a1a4a, spots: 0x20081e, stripes: true },
    trim: { color: 0x2a0a28, spots: 0x0a0208 },
    shadow: { color: 0x050204 },
    hand: { color: 0xb8a890, spots: 0x7a6a50 },
    gold: { color: 0xc89a30, spots: 0x7a5a18, rough: 0.35, metal: 0.5 },
    steel: { color: 0xb0b4bc, rough: 0.3, metal: 0.5 },
    ember: { color: 0xff7a2a, glow: true },
  },
  bones: ROBE_BONES,
  parts: [
    ...robed('robe', 'trim'),
    box('body', [0.08, 0.7, 0.01], [0, 0.95, 0.27], 'gold', [-0.24, 0, 0]),
    sph('body', [0.06, 0.08, 0.02], [0, 1.25, 0.2], 'gold'),
    // A curved ritual knife.
    box('armR', [0.03, 0.08, 0.05], inHand(0.04, 0.05), 'gold'),
    ring('armR', [0.22, 0.016, 1.0], inHand(0.07, -0.18), 'steel', [0, -HALF_PI, 0.3]),
    // A censer swinging from the other hand.
    box('armL', [0.004, 0.25, 0.004], [0, -0.72, 0], 'gold'),
    sph('armL', [0.06, 0.07, 0.06], [0, -0.88, 0], 'gold'),
    sph('armL', [0.03, 0.03, 0.03], [0, -0.85, 0.05], 'ember'),
  ],
  eyes: HOOD_EYES,
  poses: { idle: -0.4, windup: -1.9, strike: -1.2 },
  gait: 'float',
  height: 1.8,
};

const bellringer: CreatureSpec = {
  mats: {
    robe: { color: 0x3a2e24, spots: 0x1a140c, stripes: true },
    trim: { color: 0x1a140e },
    shadow: { color: 0x050302 },
    hand: { color: 0xa89878, spots: 0x6a5a40 },
    bronze: { color: 0x9a7030, spots: 0x4a5a3a, rough: 0.35, metal: 0.55 },
    rope: { color: 0x8a7a5a, spots: 0x5a4a30, stripes: true },
    wood: { color: 0x4a3018, pattern: 'planks' },
  },
  bones: { head: [0, 1.32, 0.18], armR: [0.26, 1.32, 0.05], armL: [-0.26, 1.32, 0.05] },
  parts: [
    ...robed('robe', 'trim', 0.4),
    // A hunched back with a hump.
    sph('body', [0.26, 0.24, 0.24], [0, 1.32, -0.08], 'robe'),
    box('body', [0.04, 0.9, 0.04], [0.12, 0.9, -0.22], 'rope', [0.25, 0, 0.1]),
    // A great bronze bell on a haft, swung like a hammer.
    cyl('armR', [0.025, 0.6, 0.025], inHand(0.26), 'wood', [HALF_PI, 0, 0]),
    cyl('armR', [0.12, 0.32, 0.26], inHand(0.68), 'bronze', [HALF_PI, 0, 0]),
    ring('armR', [0.26, 0.03, Math.PI * 2], inHand(0.84), 'bronze'),
    sph('armR', [0.05, 0.05, 0.05], inHand(0.86), 'bronze'),
  ],
  eyes: HOOD_EYES,
  poses: { idle: -0.3, windup: -2.6, strike: -0.9 },
  gait: 'hop',
  height: 1.7,
  scale: 1.1,
};

const voice: CreatureSpec = {
  mats: {
    robe: { color: 0xd0c4a8, spots: 0x8a7a5a },
    trim: { color: 0xa88a40, spots: 0x5a4818, rough: 0.4, metal: 0.4 },
    shadow: { color: 0x050302 },
    hand: { color: 0x2a2420, spots: 0x0a0806 },
    gold: { color: 0xd8a838, spots: 0x8a6a20, rough: 0.3, metal: 0.6 },
    halo: { color: 0xffd880, glow: true },
  },
  bones: { head: [0, 1.6, 0.02], armR: [0.28, 1.5, 0], armL: [-0.28, 1.5, 0] },
  parts: [
    // A floating priest in tattered vestments, its face a golden mask, a halo behind its head.
    cyl('body', [0.19, 1.25, 0.44], [0, 0.78, 0], 'robe'),
    cyl('body', [0.45, 0.06, 0.47], [0, 0.17, 0], 'trim'),
    cyl('body', [0.22, 0.45, 0.19], [0, 1.38, 0], 'robe'),
    box('body', [0.1, 0.9, 0.01], [0, 1.0, 0.26], 'trim', [-0.15, 0, 0]),
    sph('head', [0.16, 0.18, 0.16], [0, 0.14, -0.02], 'robe'),
    sph('head', [0.11, 0.13, 0.05], [0, 0.13, 0.11], 'gold'),
    box('head', [0.12, 0.015, 0.01], [0, 0.08, 0.16], 'shadow'),
    ring('head', [0.32, 0.025, Math.PI * 2], [0, 0.22, -0.2], 'halo'),
    ...[0, 1, 2, 3, 4, 5, 6, 7].map((i) => {
      const a = (i / 8) * Math.PI * 2;
      return cone('head', [0.02, 0.12, 0], [Math.cos(a) * 0.4, 0.22 + Math.sin(a) * 0.4, -0.2], 'halo', [
        0,
        0,
        a - HALF_PI,
      ]);
    }),
    cyl('armR', [0.07, 0.55, 0.11], [0, -0.28, 0], 'robe'),
    cyl('armL', [0.07, 0.55, 0.11], [0, -0.28, 0], 'robe'),
    box('armR', [0.07, 0.09, 0.07], [0, -0.6, 0], 'hand'),
    box('armL', [0.07, 0.09, 0.07], [0, -0.6, 0], 'hand'),
    // A staff crowned with a sun disc.
    cyl('armR', [0.025, 1.3, 0.025], inHand(0.1, 0.1), 'gold', [HALF_PI, 0, 0]),
    cyl('armR', [0.16, 0.03, 0.16], inHand(0.8, 0.1), 'gold', [HALF_PI, 0, 0]),
    sph('armR', [0.06, 0.06, 0.04], inHand(0.82, 0.1), 'halo'),
  ],
  eyes: [
    { bone: 'head', at: [-0.04, 0.15, 0.16], r: 0.02 },
    { bone: 'head', at: [0.04, 0.15, 0.16], r: 0.02 },
  ],
  poses: { idle: -0.8, windup: -2.9, strike: -0.4 },
  gait: 'float',
  height: 2.0,
  scale: 1.55,
};

/** Every creature by model id (the `model` field of enemies and summons). */
export const CREATURES: Readonly<Record<string, CreatureSpec>> = {
  warrior,
  archer,
  warden,
  sarcophagus,
  totem,
  boneWall,
  decoy,
  ghoul,
  drowned,
  bloated,
  leech,
  mother,
  templar,
  acolyte,
  bellringer,
  voice,
};

// ---------------------------------------------------------------------------------------------------
// Props lying on the floor (surfaces with a body): all on `body`, nothing moves.

export type PropSpec = Pick<CreatureSpec, 'mats' | 'parts'>;

const corpse: PropSpec = {
  mats: { ...BONE_MATS },
  parts: [
    sph('body', [0.13, 0.12, 0.14], [-0.25, 0.1, 0.15], 'bone', [0, 0.6, 1.4]),
    sph('body', [0.03, 0.03, 0.02], [-0.2, 0.15, 0.27], 'socket'),
    ...[-0.12, -0.02, 0.08].map((z) =>
      ring('body', [0.13, 0.016, Math.PI * 1.3], [0.1, 0.02, z], 'bone', [HALF_PI, 0, 0.4]),
    ),
    cyl('body', [0.03, 0.45, 0.03], [0.05, 0.03, -0.32], 'bone', [HALF_PI, 0, 0.9]),
    cyl('body', [0.03, 0.4, 0.025], [0.38, 0.03, 0.2], 'bone', [HALF_PI, 0, -0.3]),
    box('body', [0.28, 0.08, 0.13], [0.15, 0.04, -0.15], 'boneDark', [0, 0.5, 0]),
  ],
};

const trap: PropSpec = {
  mats: {
    iron: { color: 0x3a3634, spots: 0x5a3010, rough: 0.5, metal: 0.3 },
    steel: { color: 0x9aa0aa, rough: 0.35, metal: 0.45 },
    rune: { color: 0x50c8ff, glow: true },
  },
  parts: [
    box('body', [0.68, 0.04, 0.68], [0, 0.02, 0], 'iron'),
    ...[-0.2, 0, 0.2].flatMap((x) => [-0.2, 0, 0.2].map((z) => cone('body', [0.03, 0.1, 0], [x, 0.09, z], 'steel'))),
    ...[
      [-0.3, -0.3],
      [0.3, -0.3],
      [-0.3, 0.3],
      [0.3, 0.3],
    ].map(([x, z]) => box('body', [0.06, 0.01, 0.06], [x!, 0.045, z!], 'rune')),
  ],
};

const spikes: PropSpec = {
  mats: {
    iron: { color: 0x3a3634, spots: 0x5a3010, rough: 0.5, metal: 0.3 },
    rust: { color: 0x7a4a2a, spots: 0x3a1a08, rough: 0.6, metal: 0.3 },
  },
  parts: [
    box('body', [0.7, 0.04, 0.7], [0, 0.02, 0], 'iron'),
    ...[-0.24, -0.08, 0.08, 0.24].flatMap((x) =>
      [-0.24, -0.08, 0.08, 0.24].map((z, i) => cone('body', [0.035, 0.22, 0], [x, 0.13, z], i % 2 ? 'rust' : 'iron')),
    ),
  ],
};

// ---------------------------------------------------------------------------------------------------
// Peaceful rooms (M6c): the merchant and what stands in an event's room. Static, on `body`.

const WOOD = { color: 0x5a3a1e, pattern: 'planks' } as const satisfies MatSpec;
const STONE = { color: 0x7a7266, spots: 0x4a443a, rough: 0.9 } as const satisfies MatSpec;

/** The merchant: a hunched figure in a patched hood, lantern raised, beside a laden cart. */
const merchant: PropSpec = {
  mats: {
    robe: { color: 0x4a3a2a, spots: 0x2a2014, stripes: true },
    patch: { color: 0x6a2a20, spots: 0x3a1410 },
    shadow: { color: 0x050302 },
    hand: { color: 0xb8a890, spots: 0x7a6a50 },
    wood: WOOD,
    iron: { color: 0x3a3634, spots: 0x5a3010, rough: 0.5, metal: 0.3 },
    lamp: { color: 0xffc060, glow: true },
    eyes: { color: 0xffd080, glow: true },
    cloth: { color: 0x2a4a5a, spots: 0x14242a, stripes: true },
    gold: { color: 0xd8a838, spots: 0x8a6a20, rough: 0.3, metal: 0.6 },
    pot: { color: 0x8a5a3a, spots: 0x4a2a18 },
  },
  parts: [
    // The figure.
    cyl('body', [0.17, 1.0, 0.36], [0, 0.5, 0], 'robe'),
    sph('body', [0.24, 0.22, 0.22], [0, 1.15, -0.06], 'robe'),
    box('body', [0.12, 0.14, 0.01], [-0.12, 0.6, 0.3], 'patch', [-0.3, 0, 0.2]),
    sph('body', [0.15, 0.16, 0.15], [0, 1.36, 0.08], 'robe'),
    cone('body', [0.1, 0.18, 0], [0, 1.52, 0.02], 'robe', [-0.6, 0, 0]),
    sph('body', [0.1, 0.1, 0.06], [0, 1.33, 0.18], 'shadow'),
    sph('body', [0.018, 0.018, 0.01], [-0.04, 1.35, 0.235], 'eyes'),
    sph('body', [0.018, 0.018, 0.01], [0.04, 1.35, 0.235], 'eyes'),
    // Lantern raised in the right hand.
    cyl('body', [0.07, 0.5, 0.09], [0.26, 1.2, 0.12], 'robe', [-0.9, 0, -0.3]),
    box('body', [0.07, 0.08, 0.07], [0.33, 1.38, 0.3], 'hand'),
    box('body', [0.01, 0.12, 0.01], [0.33, 1.28, 0.3], 'iron'),
    box('body', [0.14, 0.18, 0.14], [0.33, 1.12, 0.3], 'iron'),
    box('body', [0.1, 0.13, 0.1], [0.33, 1.12, 0.3], 'lamp'),
    cone('body', [0.1, 0.08, 0], [0.33, 1.25, 0.3], 'iron'),
    // The cart: a crate on two wheels, a cloth over the wares, pots and a purse on top.
    box('body', [0.9, 0.42, 0.6], [-0.75, 0.55, -0.1], 'wood'),
    cyl('body', [0.26, 0.05, 0.26], [-0.75, 0.26, 0.23], 'wood', [Math.PI / 2, 0, 0]),
    cyl('body', [0.26, 0.05, 0.26], [-0.75, 0.26, -0.43], 'wood', [Math.PI / 2, 0, 0]),
    box('body', [0.95, 0.04, 0.66], [-0.75, 0.78, -0.1], 'cloth', [0, 0, 0.05]),
    box('body', [0.05, 0.05, 0.9], [-0.25, 0.5, 0.25], 'wood', [0, 0.4, 0]),
    cyl('body', [0.08, 0.2, 0.1], [-0.95, 0.9, -0.2], 'pot'),
    cyl('body', [0.06, 0.14, 0.08], [-0.75, 0.87, 0.05], 'pot'),
    sph('body', [0.08, 0.07, 0.08], [-0.55, 0.86, -0.25], 'gold'),
    box('body', [0.2, 0.08, 0.14], [-0.55, 0.84, 0.05], 'gold'),
  ],
};

const well: PropSpec = {
  mats: { stone: STONE, blood: { color: 0x8a0a08, glow: true }, wood: WOOD, iron: { color: 0x3a3634, metal: 0.3 } },
  parts: [
    cyl('body', [0.55, 0.6, 0.6], [0, 0.3, 0], 'stone'),
    cyl('body', [0.45, 0.02, 0.45], [0, 0.55, 0], 'blood'),
    box('body', [0.08, 1.2, 0.08], [-0.55, 0.9, 0], 'wood'),
    box('body', [0.08, 1.2, 0.08], [0.55, 0.9, 0], 'wood'),
    box('body', [1.3, 0.08, 0.1], [0, 1.5, 0], 'wood'),
    cyl('body', [0.15, 0.2, 0.12], [0.1, 1.1, 0], 'iron'),
  ],
};

const sarcophagusProp: PropSpec = { mats: sarcophagus.mats, parts: sarcophagus.parts };

const dice: PropSpec = {
  mats: { ...BONE_MATS, wood: WOOD, pip: { color: 0x0a0604 } },
  parts: [
    // A coffin lid on two skulls for a table, dice and a bone cup on it.
    box('body', [1.0, 0.08, 0.55], [0, 0.42, 0], 'wood'),
    sph('body', [0.18, 0.18, 0.18], [-0.32, 0.18, 0], 'bone'),
    sph('body', [0.18, 0.18, 0.18], [0.32, 0.18, 0], 'bone'),
    box('body', [0.08, 0.08, 0.08], [0.1, 0.5, 0.1], 'bone', [0, 0.4, 0]),
    box('body', [0.08, 0.08, 0.08], [0.22, 0.5, -0.05], 'bone', [0, 1.1, 0]),
    cyl('body', [0.07, 0.16, 0.05], [-0.2, 0.54, 0], 'boneDark'),
    // Two skeletons slumped over it.
    ...skeleton()
      .filter((p) => p.bone === 'head' || p.bone === 'body')
      .map((p) => ({ ...p, at: [p.at[0] - 0.75, p.at[1] - 0.6, p.at[2]] as Vec3, bone: 'body' as const })),
  ],
};

const pilgrim: PropSpec = {
  mats: {
    robe: { color: 0x6a5a40, spots: 0x3a3020, stripes: true },
    skin: { color: 0xb8987a, spots: 0x7a5a40 },
    blood: { color: 0x6a0a08 },
    gold: { color: 0xd8a838, metal: 0.6, rough: 0.3 },
    wood: WOOD,
  },
  parts: [
    // Sitting against the wall: legs out, head bowed, a staff and a purse.
    cyl('body', [0.2, 0.55, 0.28], [0, 0.45, -0.2], 'robe', [-0.15, 0, 0]),
    box('body', [0.3, 0.14, 0.6], [0, 0.1, 0.2], 'robe'),
    sph('body', [0.12, 0.13, 0.12], [0, 0.82, -0.08], 'skin', [0.4, 0, 0]),
    sph('body', [0.15, 0.1, 0.15], [0, 0.9, -0.12], 'robe'),
    box('body', [0.14, 0.04, 0.12], [0.12, 0.5, 0.0], 'blood'),
    sph('body', [0.07, 0.06, 0.07], [-0.15, 0.32, 0.1], 'gold'),
    cyl('body', [0.025, 1.4, 0.025], [0.32, 0.6, -0.1], 'wood', [0.2, 0, -0.3]),
  ],
};

const mushrooms: PropSpec = {
  mats: {
    cap: { color: 0xd8d0b8, spots: 0x8a7a5a },
    gill: { color: 0x8a9a7a, spots: 0x4a5a3a },
    glow: { color: 0x7affc0, glow: true },
  },
  parts: [
    ...[
      [0, 0, 0.32],
      [0.3, 0.1, 0.2],
      [-0.25, 0.2, 0.24],
      [0.1, -0.3, 0.16],
      [-0.1, 0.35, 0.12],
      [0.35, -0.25, 0.1],
    ].flatMap(([x, z, r]) => [
      cyl('body', [r! * 0.25, r! * 1.6, r! * 0.3], [x!, r! * 0.8, z!], 'gill'),
      sph('body', [r!, r! * 0.45, r!], [x!, r! * 1.6, z!], 'cap'),
    ]),
    ...[
      [0.2, 0.25],
      [-0.3, -0.15],
      [0.05, 0.4],
    ].map(([x, z]) => sph('body', [0.03, 0.03, 0.03], [x!, 0.04, z!], 'glow')),
  ],
};

const mirror: PropSpec = {
  mats: {
    frame: { color: 0x8a6a30, spots: 0x4a3410, rough: 0.35, metal: 0.5 },
    glass: { color: 0x2a1a3a, glow: true },
  },
  parts: [
    box('body', [0.9, 1.7, 0.08], [0, 0.95, 0], 'frame'),
    box('body', [0.72, 1.5, 0.02], [0, 0.95, 0.045], 'glass'),
    cone('body', [0.15, 0.25, 0], [0, 1.95, 0], 'frame'),
    box('body', [1.0, 0.1, 0.4], [0, 0.05, 0], 'frame'),
  ],
};

const bell: PropSpec = {
  mats: {
    bronze: { color: 0x9a7030, spots: 0x4a5a3a, rough: 0.35, metal: 0.55 },
    wood: WOOD,
    crack: { color: 0x0a0604 },
  },
  parts: [
    box('body', [0.12, 2.2, 0.12], [-0.7, 1.1, 0], 'wood'),
    box('body', [0.12, 2.2, 0.12], [0.7, 1.1, 0], 'wood'),
    box('body', [1.6, 0.14, 0.16], [0, 2.2, 0], 'wood'),
    box('body', [0.02, 0.3, 0.02], [0, 2.0, 0], 'wood'),
    cyl('body', [0.22, 0.6, 0.48], [0, 1.55, 0], 'bronze'),
    ring('body', [0.48, 0.04, Math.PI * 2], [0, 1.25, 0], 'bronze', [Math.PI / 2, 0, 0]),
    box('body', [0.02, 0.4, 0.01], [0.15, 1.5, 0.4], 'crack', [0.4, 0, 0.3]),
  ],
};

const bargainAltar: PropSpec = {
  mats: {
    stone: { color: 0x3a3438, spots: 0x1a1418, rough: 0.9 },
    blood: { color: 0x6a0a08 },
    wax: { color: 0xd8d0b0, spots: 0xa89870 },
    flame: { color: 0xffa040, glow: true },
    eye: { color: 0xff3020, glow: true },
  },
  parts: [
    box('body', [1.1, 0.8, 0.6], [0, 0.4, 0], 'stone'),
    box('body', [1.2, 0.08, 0.7], [0, 0.84, 0], 'stone'),
    box('body', [0.5, 0.01, 0.3], [0, 0.885, 0], 'blood'),
    // A horned head carved above it, eyes burning.
    box('body', [0.4, 0.45, 0.2], [0, 1.2, -0.2], 'stone'),
    cone('body', [0.05, 0.35, 0], [-0.25, 1.5, -0.2], 'stone', [0, 0, 0.6]),
    cone('body', [0.05, 0.35, 0], [0.25, 1.5, -0.2], 'stone', [0, 0, -0.6]),
    sph('body', [0.04, 0.04, 0.02], [-0.09, 1.28, -0.09], 'eye'),
    sph('body', [0.04, 0.04, 0.02], [0.09, 1.28, -0.09], 'eye'),
    ...[-0.45, 0.45].flatMap((x) => [
      cyl('body', [0.035, 0.2, 0.04], [x, 0.98, 0.15], 'wax'),
      cone('body', [0.02, 0.06, 0], [x, 1.11, 0.15], 'flame'),
    ]),
  ],
};

/** A patron's altar (M6c): stone with candles; its sign and light take the patron's colour (render/altarView). */
const patronAltar: PropSpec = {
  mats: {
    stone: { color: 0x6a6258, spots: 0x3a342c, rough: 0.9 },
    cloth: { color: 0x5a1a1a, spots: 0x2a0808, stripes: true },
    wax: { color: 0xd8d0b0, spots: 0xa89870 },
    flame: { color: 0xffb050, glow: true },
  },
  parts: [
    box('body', [1.0, 0.85, 0.55], [0, 0.42, 0], 'stone'),
    box('body', [1.15, 0.08, 0.68], [0, 0.88, 0], 'stone'),
    box('body', [0.35, 0.8, 0.01], [0, 0.48, 0.28], 'cloth'),
    ...[-0.42, -0.3, 0.3, 0.42].flatMap((x, i) => {
      const h = 0.12 + (i % 2) * 0.1;
      return [
        cyl('body', [0.03, h, 0.035], [x, 0.92 + h / 2, 0.12 - (i % 2) * 0.12], 'wax'),
        cone('body', [0.018, 0.05, 0], [x, 0.95 + h, 0.12 - (i % 2) * 0.12], 'flame'),
      ];
    }),
  ],
};

export const PROPS: Readonly<Record<string, PropSpec>> = {
  corpse,
  trap,
  spikes,
  merchant,
  well,
  sarcophagusProp,
  dice,
  pilgrim,
  mushrooms,
  mirror,
  bell,
  bargainAltar,
  patronAltar,
};
