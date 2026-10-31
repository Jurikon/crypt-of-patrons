/** Integer hashing and value noise. Pure and deterministic: the same inputs always give the same cave. */

/** Hash of three integers (plus a seed folded into the first) to [0, 1). */
export function hash3(a: number, b: number, c: number, seed = 0): number {
  let n =
    Math.imul((a + Math.imul(seed, 7919)) | 0, 374761393) + Math.imul(b | 0, 668265263) + Math.imul(c | 0, 1274126177);
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  n ^= n >>> 16;
  return (n >>> 0) / 4294967296;
}

const smooth = (t: number) => t * t * (3 - 2 * t);

/** Smooth 2D value noise in [0, 1) with feature size `scale`. */
export function noise2(x: number, y: number, scale: number, seed: number): number {
  const fx = x / scale;
  const fy = y / scale;
  const ix = Math.floor(fx);
  const iy = Math.floor(fy);
  const sx = smooth(fx - ix);
  const sy = smooth(fy - iy);
  const a = hash3(ix, iy, 0, seed);
  const b = hash3(ix + 1, iy, 0, seed);
  const c = hash3(ix, iy + 1, 0, seed);
  const d = hash3(ix + 1, iy + 1, 0, seed);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}

/** Smooth 3D value noise in [0, 1). */
export function noise3(x: number, y: number, z: number, scale: number, seed: number): number {
  const fx = x / scale;
  const fy = y / scale;
  const fz = z / scale;
  const ix = Math.floor(fx);
  const iy = Math.floor(fy);
  const iz = Math.floor(fz);
  const sx = smooth(fx - ix);
  const sy = smooth(fy - iy);
  const sz = smooth(fz - iz);
  const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
  const h = (dx: number, dy: number, dz: number) => hash3(ix + dx, iy + dy, iz + dz, seed);
  const x00 = lerp(h(0, 0, 0), h(1, 0, 0), sx);
  const x10 = lerp(h(0, 1, 0), h(1, 1, 0), sx);
  const x01 = lerp(h(0, 0, 1), h(1, 0, 1), sx);
  const x11 = lerp(h(0, 1, 1), h(1, 1, 1), sx);
  return lerp(lerp(x00, x10, sy), lerp(x01, x11, sy), sz);
}
