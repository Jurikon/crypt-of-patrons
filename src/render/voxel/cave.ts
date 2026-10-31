import { dirVec, getCell, type CellType, type Dir, type Grid } from '../../core/grid';
import { VPC, VS } from '../dims';
import { createVolume, setVoxel, getVoxel, type Volume } from './mesher';
import { hash3, noise2, noise3 } from './noise';
import { ceilingValue, FRAME, IRON, LAVA_CRACK, LAVA_POOL, rockValue, WOOD_A, WOOD_B } from './palette';

/**
 * Turns a room grid into a voxel cave. Pure and seeded: the same grid and seed always give the same
 * voxels. Only looks change; walkable cells stay clear (decorations sit above head height or in walls).
 */

/** Lowest voxel layer (j = −4 spans y ∈ [−0.8, −0.6]). */
export const J_MIN = -4;
/** Ceiling layer: its underside is at WALL_H. */
export const J_CEIL = 13;
/** Floor rock occupies j = −4..−1; lava in pits sits at j = −3 (surface at y = −0.4). */
const J_LAVA = -3;
/** How deep (in voxels) the wall surface may be chipped back into a wall cell. */
const MAX_CARVE = 3;

export interface FirePoint {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface LavaPool {
  /** Centre in world units. */
  readonly x: number;
  readonly z: number;
  readonly cells: number;
}

export interface Cave {
  readonly volume: Volume;
  /** World position of each brazier flame beside the doors. */
  readonly braziers: readonly FirePoint[];
  readonly lavaPools: readonly LavaPool[];
}

/** World-space corner of voxel (x, yIndex, z). */
export const voxelToWorld = (x: number, y: number, z: number) => ({ x: x * VS, y: (y + J_MIN) * VS, z: z * VS });

const isOpen = (t: CellType) => t === 'floor' || t === 'pit' || t === 'pillar';
const isWallish = (t: CellType) => t === 'wall' || t === 'door';

interface Door {
  readonly cx: number;
  readonly cy: number;
  /** Direction from the door cell to the open cell in front of it. */
  readonly out: Dir;
}

/** Local door coordinates (a: along the wall 0..9, depth: into the door cell from its face) → voxel x, z. */
function doorToXZ(door: Door, a: number, depth: number): [number, number] {
  const x0 = door.cx * VPC;
  const z0 = door.cy * VPC;
  switch (door.out) {
    case 0:
      return [x0 + a, z0 + depth];
    case 2:
      return [x0 + a, z0 + VPC - 1 - depth];
    case 3:
      return [x0 + depth, z0 + a];
    case 1:
      return [x0 + VPC - 1 - depth, z0 + a];
  }
}

function xzToDoor(door: Door, x: number, z: number): [number, number] {
  const lx = x - door.cx * VPC;
  const lz = z - door.cy * VPC;
  switch (door.out) {
    case 0:
      return [lx, lz];
    case 2:
      return [lx, VPC - 1 - lz];
    case 3:
      return [lz, lx];
    case 1:
      return [lz, VPC - 1 - lx];
  }
}

export function buildCave(grid: Grid, seed: number): Cave {
  const sx = grid.w * VPC;
  const sz = grid.h * VPC;
  const sy = J_CEIL - J_MIN + 2; // one empty layer above the ceiling so wall tops get faces in top view
  const vol = createVolume(sx, sy, sz);
  const Y = (j: number) => j - J_MIN;
  const cellAt = (x: number, z: number): CellType => getCell(grid, Math.floor(x / VPC), Math.floor(z / VPC));

  // Per-column distances (in voxels, Chebyshev) to the nearest column whose cell passes `test`,
  // as one multi-source breadth-first search over the whole floor plan.
  const distanceField = (test: (t: CellType) => boolean): Uint16Array => {
    const far = 0xffff;
    const dist = new Uint16Array(sx * sz).fill(far);
    const queue = new Int32Array(sx * sz);
    let tail = 0;
    for (let z = 0; z < sz; z++)
      for (let x = 0; x < sx; x++)
        if (test(cellAt(x, z))) {
          dist[z * sx + x] = 0;
          queue[tail++] = z * sx + x;
        }
    for (let head = 0; head < tail; head++) {
      const i = queue[head] as number;
      const x = i % sx;
      const z = (i - x) / sx;
      const d = (dist[i] as number) + 1;
      for (let dz = -1; dz <= 1; dz++)
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx;
          const zz = z + dz;
          if (xx < 0 || zz < 0 || xx >= sx || zz >= sz) continue;
          const j = zz * sx + xx;
          if ((dist[j] as number) <= d) continue;
          dist[j] = d;
          queue[tail++] = j;
        }
    }
    return dist;
  };
  const toOpen = distanceField(isOpen);
  const toWall = distanceField(isWallish);
  const toPit = distanceField((c) => c === 'pit');
  const at = (field: Uint16Array, x: number, z: number) => field[z * sx + x] as number;

  // Doors: each faces the one open cell next to it.
  const doors = new Map<number, Door>();
  for (let cy = 0; cy < grid.h; cy++)
    for (let cx = 0; cx < grid.w; cx++) {
      if (getCell(grid, cx, cy) !== 'door') continue;
      for (const d of [0, 1, 2, 3] as const) {
        const v = dirVec(d);
        if (isOpen(getCell(grid, cx + v.x, cy + v.y))) {
          doors.set(cy * grid.w + cx, { cx, cy, out: d });
          break;
        }
      }
    }

  const wallRock = (x: number, j: number, z: number) => {
    const along = x * 0.6 + z * 0.4;
    const strata = noise2(j, along * 0.15, 3, seed + 11);
    const t = 0.15 + strata * 0.55 + (hash3(x, j, z, seed + 1) - 0.5) * 0.1;
    const ao = j < 3 ? 0.6 + Math.max(0, j) * 0.13 : 1;
    return rockValue(t, ao * (0.85 + hash3(x, j + 7, z, seed + 2) * 0.25));
  };

  for (let z = 0; z < sz; z++)
    for (let x = 0; x < sx; x++) {
      const t = cellAt(x, z);
      if (isOpen(t)) {
        // Floor slab, or lava over a rock bed in pits.
        const dWall = at(toWall, x, z);
        const dPit = at(toPit, x, z);
        for (let j = J_MIN; j < 0; j++) {
          if (t === 'pit') {
            if (j === J_LAVA) setVoxel(vol, x, Y(j), z, LAVA_POOL);
            else if (j < J_LAVA) setVoxel(vol, x, Y(j), z, wallRock(x, j, z));
            continue;
          }
          if (j === -1) {
            let tone = 0.25 + noise2(x, z, 9, seed + 3) * 0.45 + (hash3(x, z, 5, seed) - 0.5) * 0.12;
            if (dPit <= 2) tone = Math.min(1, tone * 1.6); // warm glow near lava
            let k = Math.min(1, 0.5 + Math.min(dWall, 5) * 0.11) * (0.9 + hash3(x, z, 9, seed) * 0.2);
            // Faint seams on cell borders keep the grid readable.
            if (x % VPC === 0 || z % VPC === 0) k *= 0.82;
            setVoxel(vol, x, Y(j), z, rockValue(tone, k));
          } else {
            setVoxel(vol, x, Y(j), z, wallRock(x, j, z));
          }
        }
        // Ceiling.
        setVoxel(
          vol,
          x,
          Y(J_CEIL),
          z,
          ceilingValue(0.15 + noise2(x, z, 7, seed + 9) * 0.3, 0.55 + hash3(x, z, 3, seed) * 0.2),
        );
        // Pillars: rough round columns, wider at the base and top.
        if (t === 'pillar') {
          const pcx = (Math.floor(x / VPC) + 0.5) * VPC;
          const pcz = (Math.floor(z / VPC) + 0.5) * VPC;
          const d = Math.hypot(x + 0.5 - pcx, z + 0.5 - pcz);
          const ang = Math.atan2(z + 0.5 - pcz, x + 0.5 - pcx);
          for (let j = 0; j < J_CEIL; j++) {
            const bulge = j < 3 ? (3 - j) * 0.45 : j > 9 ? (j - 9) * 0.4 : 0;
            const r =
              3.1 + bulge + noise3(ang * 3, j, Math.floor(x / VPC) * 13 + Math.floor(z / VPC), 3, seed + 21) * 0.8;
            if (d > r) continue;
            const tone = 0.2 + noise2(j, ang * 6, 3, seed + 40) * 0.55;
            setVoxel(vol, x, Y(j), z, rockValue(tone, 0.9 + hash3(x, j, z, seed + 4) * 0.2));
          }
        }
        continue;
      }

      // Wall and door columns: solid from the bottom to the ceiling layer.
      const door = doors.get(Math.floor(z / VPC) * grid.w + Math.floor(x / VPC));
      const dOpen = at(toOpen, x, z);
      for (let j = J_MIN; j <= J_CEIL; j++) {
        let v = wallRock(x, j, z);
        if (j >= 0 && j < J_CEIL && !door) {
          // Chip the surface back by 0..3 voxels with smooth noise: rough rock, not flat tiles.
          const carve = Math.floor(noise3(x, j, z, 5, seed + 3) * (MAX_CARVE + 0.2));
          if (dOpen - 1 < carve) continue;
        }
        if (door) {
          const [a, depth] = xzToDoor(door, x, z);
          const off = Math.abs(a + 0.5 - VPC / 2);
          // Arched opening, 6 voxels wide, recessed 4 deep, with a plank door at the back.
          const archTop = 8 + Math.round(Math.sqrt(Math.max(0, 9 - off * off)) * 0.8);
          const inArch = off <= 3 && j >= 0 && j < archTop;
          if (inArch && depth < 4) continue;
          if (inArch && depth === 4) v = j === 2 || j === 6 ? IRON : a % 2 === 0 ? WOOD_A : WOOD_B;
          else if (j >= 0 && j <= archTop && off <= 4 && depth < 4) v = FRAME;
        }
        setVoxel(vol, x, Y(j), z, v);
      }
    }

  // Braziers beside each door: an iron bracket and bowl sticking out of the wall at head height.
  const braziers: FirePoint[] = [];
  for (const door of doors.values()) {
    for (const a of [0, VPC - 1]) {
      const bowl: [number, number, number][] = [];
      for (let da = -1; da <= 1; da++) for (let dd = -1; dd >= -2; dd--) bowl.push([a + da, 8, dd]);
      bowl.push([a, 7, -1]);
      for (const [ba, bj, bd] of bowl) {
        const [x, z] = doorToXZ(door, ba, bd);
        if (getVoxel(vol, x, Y(bj), z) === 0) setVoxel(vol, x, Y(bj), z, IRON);
      }
      const [fx, fz] = doorToXZ(door, a, -1.5);
      const w = { x: (fx + 0.5) * VS, y: 9 * VS + 0.05, z: (fz + 0.5) * VS };
      braziers.push(w);
    }
  }

  // Stalactites: small rock cones hanging from the ceiling, well above head height.
  for (let cy = 0; cy < grid.h; cy++)
    for (let cx = 0; cx < grid.w; cx++) {
      if (!isOpen(getCell(grid, cx, cy)) || getCell(grid, cx, cy) === 'pillar') continue;
      if (hash3(cx, cy, 1, seed + 77) > 0.45) continue;
      const scx = cx * VPC + 2 + Math.floor(hash3(cx, cy, 2, seed + 77) * 6);
      const scz = cy * VPC + 2 + Math.floor(hash3(cx, cy, 3, seed + 77) * 6);
      const len = 2 + Math.floor(hash3(cx, cy, 4, seed + 77) * 3);
      const rad = 1 + hash3(cx, cy, 5, seed + 77) * 0.8;
      for (let jj = 1; jj <= len; jj++) {
        const r = rad * (1 - jj / (len + 1));
        for (let dz = -2; dz <= 2; dz++)
          for (let dx = -2; dx <= 2; dx++) {
            if (Math.hypot(dx, dz) > r + 0.3) continue;
            setVoxel(vol, scx + dx, Y(J_CEIL - jj), scz + dz, ceilingValue(0.2 + (jj / len) * 0.2, 0.7));
          }
      }
    }

  // Lava cracks: thin winding veins (iso-lines of smooth noise) on the floor and on exposed wall rock.
  // The band is about one voxel wide: value noise changes by roughly 1/scale per voxel.
  const vein = (u: number, v: number, scale: number, salt: number) =>
    Math.abs(noise2(u, v, scale, seed + salt) - 0.5) < 0.7 / scale;
  for (let z = 0; z < sz; z++)
    for (let x = 0; x < sx; x++) {
      const t = cellAt(x, z);
      if (
        t === 'floor' &&
        noise2(x, z, 40, seed + 51) > 0.45 &&
        Math.min(at(toPit, x, z), at(toWall, x, z)) > 3 &&
        vein(x, z, 14, 50)
      )
        setVoxel(vol, x, Y(-1), z, LAVA_CRACK);
    }
  const exposed = (x: number, y: number, z: number) =>
    getVoxel(vol, x + 1, y, z) === 0 ||
    getVoxel(vol, x - 1, y, z) === 0 ||
    getVoxel(vol, x, y, z + 1) === 0 ||
    getVoxel(vol, x, y, z - 1) === 0;
  const cracks: [number, number, number][] = [];
  for (let z = 0; z < sz; z++)
    for (let x = 0; x < sx; x++) {
      if (cellAt(x, z) !== 'wall') continue;
      for (let j = 0; j < J_CEIL; j++) {
        const y = Y(j);
        if (getVoxel(vol, x, y, z) === 0 || !exposed(x, y, z)) continue;
        // Measure along the wall's own plane so the rough surface depth doesn't break the vein.
        const facesZ = getVoxel(vol, x, y, z + 1) === 0 || getVoxel(vol, x, y, z - 1) === 0;
        const along = facesZ ? x : z;
        if (noise2(along, facesZ ? 0 : 500, 26, seed + 5) < 0.5) continue;
        if (vein(along, j * 1.4, 10, 60)) cracks.push([x, y, z]);
      }
    }
  for (const [x, y, z] of cracks) setVoxel(vol, x, y, z, LAVA_CRACK);

  // Lava pools: one light per connected group of pit cells.
  const lavaPools: LavaPool[] = [];
  const seen = new Set<number>();
  for (let cy = 0; cy < grid.h; cy++)
    for (let cx = 0; cx < grid.w; cx++) {
      const k = cy * grid.w + cx;
      if (seen.has(k) || getCell(grid, cx, cy) !== 'pit') continue;
      const stack = [[cx, cy] as const];
      seen.add(k);
      let sumX = 0;
      let sumZ = 0;
      let n = 0;
      while (stack.length) {
        const [px, py] = stack.pop() as readonly [number, number];
        sumX += px;
        sumZ += py;
        n++;
        for (const d of [0, 1, 2, 3] as const) {
          const v = dirVec(d);
          const nx = px + v.x;
          const ny = py + v.y;
          const nk = ny * grid.w + nx;
          if (seen.has(nk) || getCell(grid, nx, ny) !== 'pit') continue;
          seen.add(nk);
          stack.push([nx, ny]);
        }
      }
      lavaPools.push({ x: (sumX / n + 0.5) * VPC * VS, z: (sumZ / n + 0.5) * VPC * VS, cells: n });
    }

  return { volume: vol, braziers, lavaPools };
}
