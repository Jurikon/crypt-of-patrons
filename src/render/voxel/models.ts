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

/** About 34 voxels from feet to crown: roughly 1.7 world units. */
const VOXEL = 0.05;

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

const PALETTE: readonly Rgb[] = [
  [0, 0, 0],
  [0.86, 0.79, 0.64],
  [0.78, 0.7, 0.55],
  [0.93, 0.87, 0.72],
  [0.46, 0.38, 0.29],
  [0.68, 0.67, 0.73],
  [0.9, 0.9, 0.95],
  [0.36, 0.16, 0.08],
  [0.25, 0.23, 0.27],
  [0.48, 0.22, 0.1],
  [0.32, 0.07, 0.1],
  [0.2, 0.04, 0.07],
  [0.44, 0.23, 0.1],
  [0.3, 0.14, 0.06],
  [0.82, 0.77, 0.62],
  [0.72, 0.64, 0.52],
  [0.08, 0.03, 0.03],
];

/** Collects voxels by position; later writes replace earlier ones. */
class Shape {
  private readonly cells = new Map<string, ModelVoxel>();

  set(x: number, y: number, z: number, c: number): void {
    this.cells.set(`${x},${y},${z}`, [x, y, z, c]);
  }

  clear(x: number, y: number, z: number): void {
    this.cells.delete(`${x},${y},${z}`);
  }

  box(x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, c: number | (() => number)): void {
    for (let y = y0; y <= y1; y++)
      for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) this.set(x, y, z, typeof c === 'number' ? c : c());
  }

  /** Bone-coloured box with slight per-voxel variation. */
  bone(x0: number, x1: number, y0: number, y1: number, z0: number, z1: number): void {
    for (let y = y0; y <= y1; y++)
      for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) this.set(x, y, z, boneAt(x, y, z));
  }

  voxels(): ModelVoxel[] {
    return [...this.cells.values()];
  }
}

const boneAt = (x: number, y: number, z: number) => BONE[Math.floor(hash3(x + 40, y + 40, z + 40) * 3)] as number;

/**
 * The shared skeleton without its swinging arm: feet, shins, knees, thighs, pelvis, spine, ribcage,
 * collarbones, the other arm, and a skull with sockets, nose hole and jaw.
 */
function skeleton(staticSide: 1 | -1): { body: Shape; eyes: [number, number, number][] } {
  const s = new Shape();
  for (const side of [-1, 1]) {
    const x0 = side < 0 ? -3 : 2;
    s.bone(x0 - (side < 0 ? 1 : 0), x0 + (side > 0 ? 1 : 0), 0, 1, -1, 2); // foot
    s.bone(x0, x0, 2, 8, 0, 0); // shin
    s.bone(x0 - 1 + (side > 0 ? 1 : 0), x0 + (side > 0 ? 1 : 0), 9, 9, 0, 1); // knee
    s.bone(x0, x0, 10, 15, 0, 0); // thigh
  }
  s.bone(-4, 4, 16, 17, -1, 1); // pelvis
  s.clear(0, 16, 1);
  s.clear(0, 17, 1);
  for (let y = 16; y <= 25; y++) {
    s.set(0, y, -1, boneAt(0, y, -1)); // spine
    if (y % 2 === 0) s.set(0, y, -2, BONE_DARK); // vertebra spurs
  }
  for (const y of [19, 21, 23]) {
    // Ribs: a ring around the chest, open at the front except for the sternum.
    for (let x = -4; x <= 4; x++) {
      s.set(x, y, -2, boneAt(x, y, -2));
      if (Math.abs(x) >= 2) s.set(x, y, 2, boneAt(x, y, 2));
    }
    for (let z = -1; z <= 1; z++) {
      s.set(-4, y, z, boneAt(-4, y, z));
      s.set(4, y, z, boneAt(4, y, z));
    }
  }
  s.bone(0, 0, 19, 24, 2, 2); // sternum
  s.bone(-5, 5, 25, 25, 0, 0); // collarbones
  s.bone(0, 0, 26, 26, -1, 0); // neck
  // Static arm: upper arm, elbow, forearm, hand.
  const ax = staticSide * 5;
  s.bone(ax, ax, 19, 24, 0, 0);
  s.set(ax, 18, 0, BONE_DARK);
  s.bone(ax, ax, 12, 17, 0, 0);
  s.bone(Math.min(ax, ax + staticSide), Math.max(ax, ax + staticSide), 10, 11, 0, 1);

  // Skull: a rounded block with sockets, nose hole and a jaw with teeth.
  for (let y = 28; y <= 34; y++)
    for (let z = -3; z <= 3; z++)
      for (let x = -3; x <= 3; x++) {
        const corner = (Math.abs(x) === 3 ? 1 : 0) + (Math.abs(z) === 3 ? 1 : 0) + (y === 28 || y === 34 ? 1 : 0);
        if (corner >= 2) continue;
        s.set(x, y, z, boneAt(x, y, z));
      }
  // Eye sockets: the glowing eye fills the lower half, the upper half is a dark recess.
  for (const ex of [-2, -1, 1, 2]) {
    s.clear(ex, 30, 3);
    s.clear(ex, 31, 3);
    s.set(ex, 31, 2, SOCKET);
  }
  s.set(0, 29, 3, SOCKET); // nose
  s.bone(-2, 2, 26, 27, 0, 3); // jaw
  for (let x = -2; x <= 2; x++) s.set(x, 27, 3, x % 2 === 0 ? BONE[2] : SOCKET); // teeth
  s.clear(-2, 26, 3);
  s.clear(2, 26, 3);
  const eyes: [number, number, number][] = [
    [-2, 30, 3],
    [-1, 30, 3],
    [1, 30, 3],
    [2, 30, 3],
  ];
  return { body: s, eyes };
}

/** Upper arm, elbow, forearm and hand hanging from the pivot (shoulder at 0,0,0). */
function armBones(s: Shape, side: number): void {
  for (let y = -1; y >= -6; y--) s.set(0, y, 0, boneAt(side * 5, y, 0));
  s.set(0, -7, 0, BONE_DARK);
  for (let y = -8; y >= -13; y--) s.set(0, y, 0, boneAt(side * 5, y, 1));
  s.box(0, 0, -15, -14, -1, 1, LEATHER); // gripping hand, wrapped
}

function warrior(): VoxelModel {
  const { body, eyes } = skeleton(-1);
  // Helmet: rusted dome with a rim and a nose guard.
  for (let y = 33; y <= 36; y++)
    for (let z = -4; z <= 3; z++)
      for (let x = -4; x <= 4; x++) {
        const r = Math.hypot(x / 4.2, (z + 0.5) / 4, (y - 32) / 4.6);
        if (r > 1 || r < 0.72) continue;
        body.set(x, y, z, (x + z) % 3 === 0 ? RUST : IRON);
      }
  for (let x = -4; x <= 4; x++) for (const z of [-4, 3]) body.set(x, 32, z, IRON);
  for (let z = -3; z <= 2; z++) for (const x of [-4, 4]) body.set(x, 32, z, IRON);
  body.box(0, 0, 28, 32, 4, 4, RUST);
  // Pauldron on the sword shoulder.
  body.box(4, 7, 25, 26, -2, 2, IRON);
  body.box(5, 7, 24, 24, -2, 2, RUST);
  // Round shield on the left forearm: planks, iron rim, central boss.
  for (let y = 9; y <= 22; y++)
    for (let z = -6; z <= 8; z++) {
      const r = Math.hypot(y - 15.5, z - 1);
      if (r > 6.8) continue;
      const c = r > 5.9 ? IRON : r < 1.6 ? RUST : Math.floor(z + 20) % 3 === 0 ? WOOD_DARK : WOOD;
      body.set(-7, y, z, c);
      if (r < 1.2) body.set(-8, y, z, IRON);
    }
  // Sword arm: bones, crossguard, grip, long blade with a bright edge.
  const arm = new Shape();
  armBones(arm, 1);
  arm.box(0, 0, -16, -16, -3, 3, IRON);
  arm.set(0, -16, -4, RUST);
  arm.set(0, -16, 4, RUST);
  for (let y = -17; y >= -33; y--) {
    arm.set(0, y, 0, STEEL);
    arm.set(0, y, 1, y < -31 ? STEEL_EDGE : STEEL);
    arm.set(0, y, -1, STEEL_EDGE);
  }
  arm.clear(0, -33, 1);
  arm.clear(0, -33, -1);
  return {
    voxel: VOXEL,
    palette: PALETTE,
    body: body.voxels(),
    arm: { pivot: [5, 25, 0], voxels: arm.voxels() },
    eyes,
    // Guard stance with the blade forward-down, sword raised overhead, chop through to the front.
    poses: { idle: -0.9, windup: -2.8, strike: -0.55 },
  };
}

function archer(): VoxelModel {
  const { body, eyes } = skeleton(1);
  // Hood: a cloth shell around the skull, open at the face, with a point at the back.
  for (let y = 27; y <= 36; y++)
    for (let z = -5; z <= 3; z++)
      for (let x = -5; x <= 5; x++) {
        const r = Math.hypot(x / 4.6, (z + 0.6) / 4.4, (y - 31.5) / 4.8);
        if (r > 1 || r < 0.8) continue;
        if (z >= 2 && y <= 33 && Math.abs(x) <= 3) continue; // face opening
        body.set(x, y, z, y > 34 ? CLOTH_DARK : CLOTH);
      }
  body.box(-1, 1, 35, 37, -5, -4, CLOTH_DARK);
  // Cape from the shoulders, widening down the back, with a ragged hem.
  for (let y = 8; y <= 26; y++) {
    const half = 4 + Math.floor((26 - y) / 5);
    for (let x = -half; x <= half; x++) {
      if (y < 12 && hash3(x, y, 9) < 0.35 + (12 - y) * 0.12) continue;
      body.set(x, y, -4, (x + y) % 5 === 0 ? CLOTH_DARK : CLOTH);
    }
  }
  // Quiver slung across the back with arrow fletchings.
  for (let y = 15; y <= 27; y++) {
    const qx = 1 + Math.floor((y - 15) / 4);
    body.box(qx, qx + 1, y, y, -6, -5, LEATHER);
  }
  for (const [fx, fy] of [
    [4, 28],
    [5, 29],
    [3, 29],
    [4, 30],
  ] as const)
    body.set(fx, fy, -5, FEATHER);
  // Bow arm: the bow lies across the hand (along local Z), so it stands upright when the arm points forward.
  const arm = new Shape();
  armBones(arm, -1);
  for (let z = -13; z <= 13; z++) {
    const bend = Math.round(3 * (1 - (z / 13) ** 2));
    const c = Math.abs(z) <= 1 ? LEATHER : Math.abs(z) > 11 ? WOOD_DARK : WOOD;
    arm.set(0, -14 - bend, z, c);
    if (Math.abs(z) < 4) arm.set(0, -15 - bend, z, c); // thicker grip
    if (bend > 0 && Math.abs(z) < 13) arm.set(0, -14, z, STRING);
  }
  return {
    voxel: VOXEL,
    palette: PALETTE,
    body: body.voxels(),
    arm: { pivot: [-5, 25, 0], voxels: arm.voxels() },
    eyes,
    // Bow low at the side, raised and aimed, small recoil after the shot.
    poses: { idle: -0.35, windup: -1.57, strike: -1.35 },
  };
}

export const MODELS: Readonly<Record<string, VoxelModel>> = {
  warrior: warrior(),
  archer: archer(),
};

/** Top of the model in world units, for placing labels. */
export function modelHeight(m: VoxelModel): number {
  let top = 0;
  for (const v of m.body) top = Math.max(top, v[1]);
  return (top + 1) * m.voxel;
}
