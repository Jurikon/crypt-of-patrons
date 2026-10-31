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

const BONE = [1, 2, 3];
const DARK_BONE = 4;
const STEEL = 5;
const LEATHER = 6;
const IRON = 7;
const RUST = 8;
const CLOTH = 9;
const WOOD = 10;
const STRING = 11;
const FEATHER = 12;

const PALETTE: readonly Rgb[] = [
  [0, 0, 0],
  [0.86, 0.78, 0.62],
  [0.78, 0.7, 0.55],
  [0.92, 0.85, 0.7],
  [0.5, 0.42, 0.33],
  [0.66, 0.64, 0.7],
  [0.38, 0.16, 0.08],
  [0.26, 0.24, 0.28],
  [0.46, 0.2, 0.09],
  [0.3, 0.07, 0.1],
  [0.42, 0.22, 0.1],
  [0.8, 0.75, 0.6],
  [0.7, 0.62, 0.5],
];

const boneAt = (x: number, y: number, z: number) => BONE[Math.floor(hash3(x + 20, y + 20, z + 20) * 3)] as number;

/** The shared skeleton: legs, pelvis, spine, ribs, shoulders, one arm (the other is a part), skull. */
function skeleton(staticArmX: number): { body: ModelVoxel[]; eyes: [number, number, number][] } {
  const body: ModelVoxel[] = [];
  const bone = (x: number, y: number, z: number) => body.push([x, y, z, boneAt(x, y, z)]);
  for (let y = 0; y < 6; y++) {
    bone(-1, y, 0);
    bone(1, y, 0);
  }
  bone(-1, 0, 1);
  bone(1, 0, 1);
  for (let x = -1; x <= 1; x++) bone(x, 6, 0);
  for (let y = 7; y < 12; y++) bone(0, y, 0);
  for (const y of [8, 10]) {
    for (let x = -2; x <= 2; x++) bone(x, y, 1);
    for (const x of [-2, 2]) {
      bone(x, y, 0);
      bone(x, y, -1);
    }
  }
  for (let x = -3; x <= 3; x++) bone(x, 11, 0);
  for (let y = 7; y < 11; y++) bone(staticArmX, y, 0);
  const eyes: [number, number, number][] = [
    [-1, 14, 1],
    [1, 14, 1],
  ];
  for (let x = -1; x <= 1; x++)
    for (let y = 12; y < 16; y++)
      for (let z = -1; z <= 1; z++) {
        if (z === 1 && y === 14 && x !== 0) continue; // eye sockets
        if (z === 1 && y === 12 && x !== 0) {
          body.push([x, y, z, DARK_BONE]); // teeth shadow
          continue;
        }
        bone(x, y, z);
      }
  return { body, eyes };
}

function warrior(): VoxelModel {
  const { body, eyes } = skeleton(-3);
  // Rusty helmet with a nose guard.
  for (let x = -1; x <= 1; x++) for (let z = -1; z <= 1; z++) body.push([x, 16, z, IRON]);
  for (const x of [-2, 2]) for (let z = -1; z <= 1; z++) body.push([x, 15, z, IRON]);
  for (let x = -1; x <= 1; x++) body.push([x, 15, -2, IRON]);
  body.push([0, 15, 2, RUST], [0, 14, 2, RUST]);
  // Round shield on the left forearm.
  for (let y = 6; y <= 11; y++)
    for (let z = -2; z <= 3; z++) {
      const r = Math.hypot(y - 8.5, z - 0.5);
      if (r > 3) continue;
      body.push([-4, y, z, r < 1 ? IRON : r > 2.3 ? IRON : RUST]);
    }
  // Sword arm: upper arm and forearm, hand, crossguard, blade continuing past the hand.
  const arm: ModelVoxel[] = [];
  for (let y = -1; y >= -4; y--) arm.push([0, y, 0, boneAt(3, y, 0)]);
  arm.push([0, -5, 0, LEATHER]);
  for (const z of [-1, 1]) arm.push([0, -6, z, IRON]);
  arm.push([0, -6, 0, IRON]);
  for (let y = -7; y >= -14; y--) arm.push([0, y, 0, STEEL]);
  return {
    voxel: 0.088,
    palette: PALETTE,
    body,
    arm: { pivot: [3, 11, 0], voxels: arm },
    eyes,
    // Guard stance with the blade forward-down, sword raised overhead, chop through to the front.
    poses: { idle: -0.9, windup: -2.8, strike: -0.55 },
  };
}

function archer(): VoxelModel {
  const { body, eyes } = skeleton(3);
  // Hood: a cloth shell around the skull, open at the front.
  for (let y = 12; y <= 16; y++)
    for (let x = -2; x <= 2; x++)
      for (let z = -2; z <= 1; z++) {
        const shell = Math.abs(x) === 2 || z === -2 || y === 16;
        if (!shell || (y === 16 && Math.abs(x) === 2)) continue;
        body.push([x, y, z, CLOTH]);
      }
  body.push([0, 17, -1, CLOTH], [0, 17, 0, CLOTH]);
  // Cape down the back.
  for (let y = 6; y <= 11; y++) for (let x = -2; x <= 2; x++) body.push([x, y, -2, CLOTH]);
  // Quiver with fletchings.
  for (let y = 8; y <= 13; y++) body.push([1, y, -3, LEATHER], [2, y, -3, LEATHER]);
  body.push([1, 14, -3, FEATHER], [2, 15, -3, FEATHER], [1, 15, -3, FEATHER]);
  // Bow arm: the bow lies across the hand (along local Z), so it stands upright when the arm points forward.
  const arm: ModelVoxel[] = [];
  for (let y = -1; y >= -4; y--) arm.push([0, y, 0, boneAt(-3, y, 0)]);
  for (let z = -6; z <= 6; z++) {
    const bend = Math.round(1.6 * (1 - (z / 6) ** 2));
    arm.push([0, -5 - bend, z, z === 0 ? LEATHER : WOOD]);
    if (bend > 0 && Math.abs(z) < 6) arm.push([0, -5, z, STRING]);
  }
  return {
    voxel: 0.088,
    palette: PALETTE,
    body,
    arm: { pivot: [-3, 11, 0], voxels: arm },
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
