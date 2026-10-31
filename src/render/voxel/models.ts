import type { Rgb } from './palette';
import { hash3 } from './noise';

/**
 * Voxel character models as plain data. Coordinates are in model voxels: x right, y up (0 = feet),
 * z forward (the model faces +Z). The arm is a separate part so it can swing around its shoulder.
 */

export type ModelVoxel = readonly [x: number, y: number, z: number, color: number];

export interface VoxelModel {
  /** Voxel edge in world units. */
  readonly voxel: number;
  /** Index 0 is unused (empty). Linear RGB. */
  readonly palette: readonly Rgb[];
  readonly body: readonly ModelVoxel[];
  /** Swinging arm with its weapon, relative to `pivot` (the shoulder). Hanging straight down is angle 0. */
  readonly arm: { readonly pivot: readonly [number, number, number]; readonly voxels: readonly ModelVoxel[] };
  /** Glowing eye voxels. */
  readonly eyes: readonly (readonly [number, number, number])[];
  /**
   * Arm angles in radians around the shoulder's X axis (negative swings forward):
   * at rest, while an attack is telegraphed, and at the end of the strike.
   */
  readonly poses: { readonly idle: number; readonly windup: number; readonly strike: number };
}

/** About 46 voxels from feet to crown: roughly 1.9 world units. */
const VOXEL = 0.04;

// Palette indices.
const BONE = [1, 2, 3] as const;
const BONE_DARK = 4;
const STEEL = 5;
const STEEL_EDGE = 6;
const LEATHER = 7;
const IRON = 8;
const RUST = 9;
const CLOTH = 10;
const CLOTH_DARK = 11;
const WOOD = 12;
const WOOD_DARK = 13;
const STRING = 14;
const FEATHER = 15;
const SOCKET = 16;
const BRASS = 17;

const PALETTE: readonly Rgb[] = [
  [0, 0, 0],
  [0.86, 0.79, 0.64],
  [0.76, 0.68, 0.53],
  [0.94, 0.88, 0.74],
  [0.42, 0.34, 0.26],
  [0.66, 0.66, 0.72],
  [0.92, 0.92, 0.97],
  [0.36, 0.17, 0.08],
  [0.24, 0.22, 0.26],
  [0.5, 0.23, 0.1],
  [0.42, 0.06, 0.06],
  [0.24, 0.03, 0.05],
  [0.46, 0.25, 0.11],
  [0.3, 0.14, 0.06],
  [0.84, 0.79, 0.64],
  [0.78, 0.7, 0.56],
  [0.07, 0.02, 0.02],
  [0.78, 0.55, 0.18],
];

const boneAt = (x: number, y: number, z: number) => BONE[Math.floor(hash3(x + 40, y + 40, z + 40) * 3)] as number;

/** Collects voxels by position; later writes replace earlier ones. */
class Shape {
  private readonly cells = new Map<string, ModelVoxel>();

  set(x: number, y: number, z: number, c: number): void {
    this.cells.set(`${x},${y},${z}`, [x, y, z, c]);
  }

  has(x: number, y: number, z: number): boolean {
    return this.cells.has(`${x},${y},${z}`);
  }

  clear(x: number, y: number, z: number): void {
    this.cells.delete(`${x},${y},${z}`);
  }

  /** Fills the box between two corners (inclusive, in any order). */
  box(x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, c: number | 'bone'): void {
    for (let y = Math.min(y0, y1); y <= Math.max(y0, y1); y++)
      for (let z = Math.min(z0, z1); z <= Math.max(z0, z1); z++)
        for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x++)
          this.set(x, y, z, c === 'bone' ? boneAt(x, y, z) : c);
  }

  /** Voxels inside an ellipsoid; `shell` keeps only the outer layer of that relative thickness (0..1). */
  ellipsoid(
    cx: number,
    cy: number,
    cz: number,
    rx: number,
    ry: number,
    rz: number,
    c: number | 'bone',
    shell = 1,
  ): void {
    for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++)
      for (let z = Math.floor(cz - rz); z <= Math.ceil(cz + rz); z++)
        for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
          const r = Math.hypot((x - cx) / rx, (y - cy) / ry, (z - cz) / rz);
          if (r > 1 || r < 1 - shell) continue;
          this.set(x, y, z, c === 'bone' ? boneAt(x, y, z) : c);
        }
  }

  voxels(): ModelVoxel[] {
    return [...this.cells.values()];
  }
}

/**
 * The shared skeleton without its swinging arm: feet, shins, knees, thighs, pelvis, spine, ribcage,
 * collarbones, the other arm with a hand, and a big skull with brow, cheekbones, sockets and a jaw.
 * `side` is the static arm's side (+1 right, −1 left).
 */
function skeleton(side: 1 | -1): { body: Shape; eyes: [number, number, number][] } {
  const s = new Shape();
  for (const out of [-1, 1] as const) {
    const x = out > 0 ? 2 : -2; // inner column of each leg
    s.box(x - out, x + 2 * out, 0, 1, -1, 4, 'bone'); // foot
    for (const tz of [1, 3]) s.set(x + 2 * out, 1, tz, BONE_DARK); // toe gaps
    s.box(x, x + out, 2, 11, 0, 1, 'bone'); // shin
    s.box(x - out, x + 2 * out, 12, 13, -1, 2, BONE_DARK); // knee
    s.box(x, x + out, 12, 13, 0, 2, 'bone');
    s.box(x, x + out, 14, 19, 0, 1, 'bone'); // thigh
  }
  // Pelvis: a wide bowl with a gap at the front.
  s.ellipsoid(0, 21, 0, 5.6, 2.2, 3.2, 'bone', 0.5);
  for (let y = 19; y <= 23; y++) s.clear(0, y, 3);
  // Spine with vertebra spurs.
  for (let y = 20; y <= 33; y++) {
    s.box(0, 0, y, y, -3, -2, 'bone');
    if (y % 2 === 0) s.box(-1, 1, y, y, -3, -3, BONE_DARK);
  }
  // Ribcage: curved ribs around the chest, open at the front except the sternum.
  for (const y of [24, 26, 28, 30]) {
    const rx = y === 24 ? 4.6 : 5.6;
    for (let a = 0; a < 64; a++) {
      const t = (a / 64) * Math.PI * 2;
      const x = Math.round(Math.sin(t) * rx);
      const z = Math.round(Math.cos(t) * 3.4);
      if (z >= 2 && Math.abs(x) <= 1) continue;
      s.set(x, y, z, boneAt(x, y, z));
    }
  }
  s.box(0, 0, 24, 31, 3, 3, 'bone'); // sternum
  s.box(-7, 7, 32, 33, 0, 1, 'bone'); // collarbones and shoulder girdle
  s.box(0, 0, 34, 35, -1, 0, 'bone'); // neck

  // Static arm: shoulder joint, upper arm, elbow, two forearm bones, hand with fingers and thumb.
  const ax = side * 7;
  s.ellipsoid(ax, 32, 0.5, 1.6, 1.6, 1.6, BONE_DARK);
  s.box(ax, ax - side, 25, 31, 0, 1, 'bone');
  s.box(ax + side, ax - 2 * side, 24, 24, 0, 1, BONE_DARK);
  s.box(ax, ax, 17, 23, 0, 0, 'bone');
  s.box(ax - side, ax - side, 17, 23, 1, 1, 'bone');
  s.box(ax, ax - side, 15, 16, -1, 2, 'bone'); // palm
  for (const fz of [-1, 1]) s.box(ax, ax - side, 13, 14, fz, fz, 'bone'); // fingers
  s.box(ax - 2 * side, ax - 2 * side, 14, 15, 2, 2, 'bone'); // thumb

  // Skull: big and rounded, with brow ridge, cheekbones, sockets, nose hole, and a jaw with teeth.
  s.ellipsoid(0, 41, 0, 5, 5, 5, 'bone');
  for (let y = 36; y <= 38; y++) s.box(-4, 4, y, y, -2, 4, 'bone'); // face block under the dome
  s.box(-4, 4, 41, 41, 5, 5, BONE_DARK); // brow ridge
  for (const cx of [-4, 4]) s.box(cx, cx, 38, 38, 3, 5, BONE_DARK); // cheekbones
  const eyes: [number, number, number][] = [];
  for (const ex of [-3, -2, 2, 3]) {
    for (const ey of [39, 40]) {
      s.clear(ex, ey, 5);
      s.clear(ex, ey, 4);
      s.set(ex, ey, 3, SOCKET);
    }
    eyes.push([ex, 39, 4]);
  }
  s.clear(0, 37, 5);
  s.clear(0, 37, 4);
  s.set(0, 37, 3, SOCKET); // nose hole
  // Jaw, with two rows of teeth.
  s.box(-3, 3, 33, 34, 0, 4, 'bone');
  for (let x = -3; x <= 3; x++) {
    s.set(x, 35, 4, x % 2 === 0 ? BONE[2] : SOCKET);
    s.set(x, 36, 4, x % 2 === 0 ? SOCKET : BONE[2]);
  }
  return { body: s, eyes };
}

/** Upper arm, elbow, forearm bones and a wrapped fist hanging from the pivot (the shoulder at 0,0,0). */
function armBones(s: Shape, side: 1 | -1): void {
  const inward = -side;
  s.box(0, inward, -1, -7, 0, 1, 'bone');
  s.box(side, 2 * inward, -8, -8, 0, 1, BONE_DARK);
  s.box(0, 0, -9, -15, 0, 0, 'bone');
  s.box(inward, inward, -9, -15, 1, 1, 'bone');
  s.box(0, inward, -16, -18, -1, 2, LEATHER);
}

function warrior(): VoxelModel {
  const { body, eyes } = skeleton(-1);
  // Horned helmet with a rim, cheek guards and a nose guard.
  body.ellipsoid(0, 42, -0.3, 5.9, 4.6, 5.9, IRON, 0.25);
  for (let y = 38; y <= 41; y++) body.clear(0, y, 6);
  for (let x = -5; x <= 5; x++) for (const z of [-5, 5]) body.set(x, 41, z, RUST);
  for (const x of [-6, 6]) {
    body.box(x, x, 41, 41, -5, 5, RUST);
    body.box(x, x, 36, 40, 1, 4, IRON);
    body.set(x, 39, 2, BRASS);
  }
  body.box(0, 0, 37, 42, 6, 6, RUST);
  for (const hx of [-1, 1]) {
    for (const [px, py] of [
      [6, 44],
      [7, 45],
      [8, 46],
      [8, 47],
      [9, 48],
      [9, 49],
    ] as const)
      body.box(hx * px, hx * px, py, py, -1, 0, BONE_DARK);
    body.set(hx * 9, 50, -1, BONE[2]);
  }
  // Pauldron with rivets on the sword shoulder.
  body.ellipsoid(7.5, 32.5, 0.5, 3, 2.4, 3.4, IRON, 0.45);
  for (const z of [-2, 1, 3]) body.set(10, 32, z, BRASS);
  // Greaves on both shins.
  for (const [gx0, gx1] of [
    [2, 3],
    [-2, -3],
  ] as const) {
    body.box(gx0, gx1, 3, 10, 2, 2, IRON);
    body.box(gx0, gx1, 9, 9, 2, 2, RUST);
  }
  // Belt with a buckle, and a ragged red loincloth front and back.
  body.ellipsoid(0, 21.5, 0, 6.2, 1.2, 3.8, LEATHER, 0.35);
  body.box(-1, 1, 21, 22, 4, 4, BRASS);
  for (const lz of [4, -4]) {
    for (let y = 12; y <= 20; y++)
      for (let x = -3; x <= 3; x++) {
        if (y < 15 && hash3(x, y, lz) < 0.25 + (15 - y) * 0.2) continue;
        body.set(x, y, lz, (x + y) % 4 === 0 ? CLOTH_DARK : CLOTH);
      }
  }
  // Big round shield on the left arm: planks, a red band, iron rim, brass boss.
  for (let y = 12; y <= 30; y++)
    for (let z = -8; z <= 10; z++) {
      const r = Math.hypot(y - 21, z - 1);
      if (r > 8.6) continue;
      const band = Math.abs(y - 21 - (z - 1)) <= 1.2;
      const c = r > 7.6 ? IRON : r < 1.8 ? BRASS : band ? CLOTH : Math.floor(z + 20) % 3 === 0 ? WOOD_DARK : WOOD;
      body.set(-9, y, z, c);
      if (r > 7.6) body.set(-8, y, z, IRON);
      if (r < 1.4) body.set(-10, y, z, BRASS);
    }
  // Sword arm: bones, fist, crossguard, broad blade with bright edges and a dark fuller.
  const arm = new Shape();
  armBones(arm, 1);
  arm.box(0, -1, -19, -19, -4, 5, IRON);
  for (const z of [-5, 6]) arm.box(0, -1, -19, -20, z, z, BRASS);
  for (let y = -20; y >= -40; y--) {
    const tip = y <= -38;
    arm.box(0, -1, y, y, tip ? 0 : -1, tip ? 1 : 2, STEEL);
    if (!tip) {
      arm.box(0, -1, y, y, -1, -1, STEEL_EDGE);
      arm.box(0, -1, y, y, 2, 2, STEEL_EDGE);
      if (y > -34) arm.box(0, -1, y, y, 0, 0, IRON);
    }
  }
  arm.box(0, -1, -41, -41, 0, 1, STEEL_EDGE);
  return {
    voxel: VOXEL,
    palette: PALETTE,
    body: body.voxels(),
    arm: { pivot: [7, 32, 0], voxels: arm.voxels() },
    eyes,
    // Guard stance with the blade forward-down, sword raised overhead, chop through to the front.
    poses: { idle: -0.9, windup: -2.8, strike: -0.55 },
  };
}

function archer(): VoxelModel {
  const { body, eyes } = skeleton(1);
  // Hood around the skull, open at the face, with a point at the back.
  body.ellipsoid(0, 41.5, -0.6, 6.2, 6, 6.2, CLOTH, 0.22);
  for (let y = 33; y <= 42; y++) for (let x = -4; x <= 4; x++) for (let z = 3; z <= 6; z++) body.clear(x, y, z);
  body.box(-1, 1, 46, 48, -6, -5, CLOTH_DARK);
  body.set(0, 49, -7, CLOTH_DARK);
  // Mantle over the shoulders.
  body.ellipsoid(0, 31, -0.5, 8.4, 3.2, 5, CLOTH_DARK, 0.3);
  for (let y = 29; y <= 34; y++) for (let x = -2; x <= 2; x++) body.clear(x, y, 4);
  // Cape down the back, widening, with a ragged hem.
  for (let y = 9; y <= 31; y++) {
    const half = 5 + Math.floor((31 - y) / 6);
    for (let x = -half; x <= half; x++) {
      if (y < 14 && hash3(x, y, 9) < 0.3 + (14 - y) * 0.13) continue;
      body.set(x, y, -5, (x * 3 + y) % 7 === 0 ? CLOTH_DARK : CLOTH);
    }
  }
  // Quiver across the back, arrows with fletchings.
  for (let y = 18; y <= 33; y++) {
    const qx = 1 + Math.floor((y - 18) / 4);
    body.box(qx, qx + 2, y, y, -8, -6, (y + qx) % 5 === 0 ? BRASS : LEATHER);
  }
  for (const [fx, fy] of [
    [5, 34],
    [6, 35],
    [4, 35],
    [5, 36],
    [7, 36],
    [6, 37],
  ] as const)
    body.set(fx, fy, -7, FEATHER);
  // Belt with a pouch, dark loincloth, bracer on the static forearm.
  body.ellipsoid(0, 21.5, 0, 6.2, 1.2, 3.8, LEATHER, 0.35);
  body.box(3, 5, 17, 20, 3, 4, LEATHER);
  body.set(4, 20, 5, BRASS);
  for (let y = 13; y <= 20; y++)
    for (let x = -3; x <= 2; x++) {
      if (y < 16 && hash3(x, y, 2) < 0.3 + (16 - y) * 0.2) continue;
      body.set(x, y, 4, CLOTH_DARK);
    }
  body.box(6, 7, 18, 22, -1, 2, LEATHER);
  // Bow arm: the bow lies across the fist (along local Z), so it stands upright when the arm points forward.
  const arm = new Shape();
  armBones(arm, -1);
  for (let z = -18; z <= 18; z++) {
    const bend = Math.round(4 * (1 - (z / 18) ** 2));
    const c = Math.abs(z) <= 2 ? LEATHER : Math.abs(z) > 15 ? WOOD_DARK : WOOD;
    arm.box(0, 1, -17 - bend, -17 - bend, z, z, c);
    if (Math.abs(z) < 12) arm.box(0, 1, -18 - bend, -18 - bend, z, z, c); // thicker limbs
    if (bend > 0 && !arm.has(0, -17, z)) arm.set(0, -17, z, STRING);
  }
  return {
    voxel: VOXEL,
    palette: PALETTE,
    body: body.voxels(),
    arm: { pivot: [-7, 32, 0], voxels: arm.voxels() },
    eyes,
    // Bow held low and tilted, raised and aimed, small recoil after the shot.
    poses: { idle: -0.85, windup: -1.57, strike: -1.35 },
  };
}

/** The crypt warden (act 1 boss): a bigger skeleton king with a crown, a cape and a huge sword. */
function warden(): VoxelModel {
  const { body, eyes } = skeleton(-1);
  // Crown with spikes.
  for (let a = 0; a < 48; a++) {
    const t = (a / 48) * Math.PI * 2;
    const x = Math.round(Math.sin(t) * 5.2);
    const z = Math.round(Math.cos(t) * 5.2);
    body.set(x, 45, z, BRASS);
    if (a % 6 === 0) body.box(x, x, 46, 47, z, z, BRASS);
  }
  // Heavy pauldrons on both shoulders, a tattered royal cape.
  for (const sx of [-1, 1]) {
    body.ellipsoid(sx * 7.5, 32.5, 0.5, 3.2, 2.6, 3.6, IRON, 0.45);
    body.box(sx * 9, sx * 9, 34, 36, 0, 0, RUST);
  }
  for (let y = 8; y <= 33; y++) {
    const half = 6 + Math.floor((33 - y) / 5);
    for (let x = -half; x <= half; x++) {
      if (y < 13 && hash3(x, y, 21) < 0.3 + (13 - y) * 0.12) continue;
      body.set(x, y, -5, (x + y) % 6 === 0 ? CLOTH_DARK : CLOTH);
    }
  }
  body.ellipsoid(0, 21.5, 0, 6.2, 1.2, 3.8, BRASS, 0.35);
  // A huge greatsword.
  const arm = new Shape();
  armBones(arm, 1);
  arm.box(0, -1, -19, -20, -5, 6, BRASS);
  for (let y = -21; y >= -46; y--) {
    const tip = y <= -43;
    arm.box(0, -1, y, y, tip ? -1 : -2, tip ? 2 : 3, STEEL);
    if (!tip) {
      arm.box(0, -1, y, y, -2, -2, STEEL_EDGE);
      arm.box(0, -1, y, y, 3, 3, STEEL_EDGE);
      arm.box(0, -1, y, y, 0, 1, IRON);
    }
  }
  return {
    voxel: 0.05,
    palette: PALETTE,
    body: body.voxels(),
    arm: { pivot: [7, 32, 0], voxels: arm.voxels() },
    eyes,
    poses: { idle: -0.7, windup: -2.9, strike: -0.4 },
  };
}

/** A heap of bones knitted into a wall (the Necromancer's Bone wall): no arms, no eyes worth the name. */
function boneWall(): VoxelModel {
  const body = new Shape();
  for (let y = 0; y <= 30; y++) {
    const half = 9 - Math.floor(y / 6);
    for (let x = -half; x <= half; x++)
      for (let z = -2; z <= 2; z++) {
        if (hash3(x, y, z + 7) < 0.25 + y / 70) continue;
        body.set(x, y, z, (x * 3 + y * 5 + z) % 7 === 0 ? BONE_DARK : boneAt(x, y, z));
      }
  }
  // Skulls stuck in the heap, glowing faintly.
  const eyes: [number, number, number][] = [];
  for (const [x, y] of [
    [-4, 10],
    [4, 16],
    [0, 24],
  ] as const) {
    body.ellipsoid(x, y, 2.5, 2, 2, 1.6, 'bone');
    eyes.push([x - 1, y, 4], [x + 1, y, 4]);
  }
  const arm = new Shape();
  arm.set(0, -1, 0, BONE_DARK);
  return {
    voxel: 0.05,
    palette: PALETTE,
    body: body.voxels(),
    arm: { pivot: [0, 12, 0], voxels: arm.voxels() },
    eyes,
    poses: { idle: 0, windup: 0, strike: 0 },
  };
}

/** The mirror dagger's decoy: a hooded figure of smoke-dark cloth. */
function decoy(): VoxelModel {
  const { body, eyes } = skeleton(1);
  body.ellipsoid(0, 41.5, -0.6, 6.2, 6, 6.2, CLOTH_DARK, 0.22);
  for (let y = 8; y <= 33; y++) {
    const half = 4 + Math.floor((33 - y) / 4);
    for (let x = -half; x <= half; x++)
      for (const z of [-4, 4]) if (hash3(x, y, z) > 0.2) body.set(x, y, z, CLOTH_DARK);
  }
  const arm = new Shape();
  armBones(arm, -1);
  return {
    voxel: 0.04,
    palette: PALETTE,
    body: body.voxels(),
    arm: { pivot: [-7, 32, 0], voxels: arm.voxels() },
    eyes,
    poses: { idle: -0.3, windup: -0.3, strike: -0.3 },
  };
}

export const MODELS: Readonly<Record<string, VoxelModel>> = {
  warrior: warrior(),
  archer: archer(),
  warden: warden(),
  boneWall: boneWall(),
  decoy: decoy(),
};

/** Top of the model in world units, for placing labels. */
export function modelHeight(m: VoxelModel): number {
  let top = 0;
  for (const v of m.body) top = Math.max(top, v[1]);
  return (top + 1) * m.voxel;
}

/** A static prop lying on the floor (corpses, traps): voxels only, no moving parts. */
export interface PropModel {
  readonly voxel: number;
  readonly palette: readonly Rgb[];
  readonly voxels: readonly ModelVoxel[];
  /** Voxels drawn glowing (trap runes), as palette indices. */
  readonly glow: readonly number[];
}

function corpse(): PropModel {
  const s = new Shape();
  // A collapsed skeleton: skull on its side, scattered ribs, a long bone, a few loose pieces.
  s.ellipsoid(-6, 2.5, 3, 3.2, 2.6, 3, 'bone');
  s.set(-4, 3, 5, SOCKET);
  s.set(-4, 2, 5, SOCKET);
  s.set(-6, 1, 6, SOCKET);
  for (const z of [-3, -1, 1]) for (let x = -1; x <= 5; x++) if ((x + z) % 7 !== 0) s.set(x, 0, z, boneAt(x, 0, z));
  s.box(-1, 5, 1, 1, -3, -3, BONE_DARK);
  s.box(-4, 8, 0, 0, 5, 6, 'bone');
  s.box(-5, -5, 0, 1, 4, 7, BONE_DARK);
  s.box(7, 8, 0, 1, 4, 7, BONE_DARK);
  s.box(2, 3, 0, 0, -8, -6, 'bone');
  s.box(-9, -8, 0, 0, -4, -3, 'bone');
  s.set(6, 0, 0, BONE_DARK);
  return { voxel: 0.045, palette: PALETTE, voxels: s.voxels(), glow: [] };
}

function trap(): PropModel {
  const s = new Shape();
  // An iron plate with spikes and four glowing runes at the corners.
  s.box(-7, 7, 0, 0, -7, 7, IRON);
  for (let x = -6; x <= 6; x += 3) for (let z = -6; z <= 6; z += 3) s.box(x, x, 1, 2, z, z, STEEL);
  for (const [x, z] of [
    [-7, -7],
    [7, -7],
    [-7, 7],
    [7, 7],
  ] as const)
    s.set(x, 1, z, RUNE);
  return { voxel: 0.045, palette: [...PALETTE, [0.3, 1.6, 2.4]], voxels: s.voxels(), glow: [RUNE] };
}

const RUNE = PALETTE.length;

export const PROPS: Readonly<Record<string, PropModel>> = {
  corpse: corpse(),
  trap: trap(),
};
