/**
 * Voxel volume and greedy mesher. Pure: no three.js, so it runs (and is tested) in Node.
 * A volume stores one byte per voxel; 0 is empty, anything else is a material/colour value.
 */

export interface Volume {
  readonly sx: number;
  readonly sy: number;
  readonly sz: number;
  readonly data: Uint8Array;
}

export function createVolume(sx: number, sy: number, sz: number): Volume {
  return { sx, sy, sz, data: new Uint8Array(sx * sy * sz) };
}

export const voxelIndex = (v: Volume, x: number, y: number, z: number) => x + v.sx * (z + v.sz * y);

export function getVoxel(v: Volume, x: number, y: number, z: number): number {
  if (x < 0 || y < 0 || z < 0 || x >= v.sx || y >= v.sy || z >= v.sz) return -1;
  return v.data[voxelIndex(v, x, y, z)] as number;
}

export function setVoxel(v: Volume, x: number, y: number, z: number, value: number): void {
  if (x < 0 || y < 0 || z < 0 || x >= v.sx || y >= v.sy || z >= v.sz) return;
  v.data[voxelIndex(v, x, y, z)] = value;
}

export interface MeshData {
  /** Vertex positions in voxel units, 4 per quad. */
  readonly positions: Float32Array;
  readonly normals: Float32Array;
  /** The voxel value each vertex's quad came from (to look up colour or material). */
  readonly values: Uint8Array;
  readonly indices: Uint32Array;
  readonly quadCount: number;
}

export interface MeshOptions {
  /** Which voxel values get faces. */
  readonly include: (value: number) => boolean;
  /**
   * Which neighbours hide a face. Out-of-bounds counts as `outside` (default: hides),
   * so a volume's outer shell is never drawn.
   */
  readonly occludes: (value: number) => boolean;
  readonly outside?: boolean;
}

/**
 * Builds quads for every visible voxel face, merging coplanar faces with the same value into rectangles.
 * Merging only joins equal values, so colour quantisation directly controls how much it saves.
 */
export function greedyMesh(vol: Volume, opts: MeshOptions): MeshData {
  const dims: readonly number[] = [vol.sx, vol.sy, vol.sz];
  const pos: number[] = [];
  const nrm: number[] = [];
  const val: number[] = [];
  const idx: number[] = [];
  const outsideHides = opts.outside ?? true;
  const at = (p: readonly number[]) => getVoxel(vol, p[0] as number, p[1] as number, p[2] as number);
  const hidden = (n: number) => (n === -1 ? outsideHides : opts.occludes(n));

  for (let d = 0; d < 3; d++) {
    const u = (d + 1) % 3;
    const v = (d + 2) % 3;
    const du = dims[u] as number;
    const dv = dims[v] as number;
    const mask = new Int16Array(du * dv);
    const p = [0, 0, 0];
    const q = [0, 0, 0];
    for (const s of [1, -1]) {
      for (let slice = 0; slice < (dims[d] as number); slice++) {
        // Mask of visible faces in this slice.
        for (let j = 0; j < dv; j++) {
          for (let i = 0; i < du; i++) {
            p[d] = slice;
            p[u] = i;
            p[v] = j;
            q[d] = slice + s;
            q[u] = i;
            q[v] = j;
            const a = at(p);
            mask[i + j * du] = a > 0 && opts.include(a) && !hidden(at(q)) ? a : 0;
          }
        }
        // Greedy rectangles.
        for (let j = 0; j < dv; j++) {
          for (let i = 0; i < du;) {
            const m = mask[i + j * du] as number;
            if (m === 0) {
              i++;
              continue;
            }
            let w = 1;
            while (i + w < du && mask[i + w + j * du] === m) w++;
            let h = 1;
            grow: while (j + h < dv) {
              for (let k = 0; k < w; k++) if (mask[i + k + (j + h) * du] !== m) break grow;
              h++;
            }
            for (let jj = 0; jj < h; jj++) for (let k = 0; k < w; k++) mask[i + k + (j + jj) * du] = 0;
            emitQuad(pos, nrm, val, idx, d, u, v, s, slice, i, j, w, h, m);
            i += w;
          }
        }
      }
    }
  }
  return {
    positions: new Float32Array(pos),
    normals: new Float32Array(nrm),
    values: new Uint8Array(val),
    indices: new Uint32Array(idx),
    quadCount: val.length / 4,
  };
}

function emitQuad(
  pos: number[],
  nrm: number[],
  val: number[],
  idx: number[],
  d: number,
  u: number,
  v: number,
  s: number,
  slice: number,
  i: number,
  j: number,
  w: number,
  h: number,
  value: number,
): void {
  const plane = s > 0 ? slice + 1 : slice;
  const corners: [number, number][] = [
    [i, j],
    [i + w, j],
    [i + w, j + h],
    [i, j + h],
  ];
  const base = pos.length / 3;
  for (const [cu, cv] of corners) {
    const p = [0, 0, 0];
    p[d] = plane;
    p[u] = cu;
    p[v] = cv;
    pos.push(p[0] as number, p[1] as number, p[2] as number);
    const n = [0, 0, 0];
    n[d] = s;
    nrm.push(n[0] as number, n[1] as number, n[2] as number);
    val.push(value);
  }
  // e_u × e_v = e_d, so counter-clockwise (0,1,2,3) faces +d; flip for −d.
  if (s > 0) idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  else idx.push(base, base + 2, base + 1, base, base + 3, base + 2);
}

/** Number of visible unit faces, counted one by one (reference for tests). */
export function countVisibleFaces(vol: Volume, opts: MeshOptions): number {
  const outsideHides = opts.outside ?? true;
  let n = 0;
  for (let y = 0; y < vol.sy; y++)
    for (let z = 0; z < vol.sz; z++)
      for (let x = 0; x < vol.sx; x++) {
        const a = getVoxel(vol, x, y, z);
        if (a <= 0 || !opts.include(a)) continue;
        for (const [dx, dy, dz] of [
          [1, 0, 0],
          [-1, 0, 0],
          [0, 1, 0],
          [0, -1, 0],
          [0, 0, 1],
          [0, 0, -1],
        ] as const) {
          const b = getVoxel(vol, x + dx, y + dy, z + dz);
          if (!(b === -1 ? outsideHides : opts.occludes(b))) n++;
        }
      }
  return n;
}

/** Total area of the quads in a mesh, in unit faces. */
export function meshArea(m: MeshData): number {
  let area = 0;
  for (let q = 0; q < m.quadCount; q++) {
    const o = q * 12;
    const ax = (m.positions[o + 3] as number) - (m.positions[o] as number);
    const ay = (m.positions[o + 4] as number) - (m.positions[o + 1] as number);
    const az = (m.positions[o + 5] as number) - (m.positions[o + 2] as number);
    const bx = (m.positions[o + 9] as number) - (m.positions[o] as number);
    const by = (m.positions[o + 10] as number) - (m.positions[o + 1] as number);
    const bz = (m.positions[o + 11] as number) - (m.positions[o + 2] as number);
    area += Math.hypot(ay * bz - az * by, az * bx - ax * bz, ax * by - ay * bx);
  }
  return area;
}
