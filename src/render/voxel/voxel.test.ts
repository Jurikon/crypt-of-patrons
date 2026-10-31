import { describe, expect, it } from 'vitest';
import { createRng, fork, int } from '../../core/rng';
import { getCell, type CellType } from '../../core/grid';
import { generateRoom } from '../../sim';
import { VPC } from '../dims';
import { buildCave, J_CEIL, J_MIN } from './cave';
import { countVisibleFaces, createVolume, getVoxel, greedyMesh, meshArea, setVoxel, type MeshOptions } from './mesher';
import { isRockLike, LAVA_POOL } from './palette';

const solid: MeshOptions = { include: (v) => v > 0, occludes: (v) => v > 0 };

function roomFor(seed: number) {
  return generateRoom(fork(createRng(seed), 'room:0'));
}

describe('greedy mesher', () => {
  it('a single voxel has six faces', () => {
    const v = createVolume(3, 3, 3);
    setVoxel(v, 1, 1, 1, 5);
    const m = greedyMesh(v, solid);
    expect(m.quadCount).toBe(6);
    expect(meshArea(m)).toBe(6);
  });

  it('merges a row of equal voxels into one quad per side', () => {
    const v = createVolume(6, 3, 3);
    for (let x = 1; x <= 4; x++) setVoxel(v, x, 1, 1, 7);
    const m = greedyMesh(v, solid);
    expect(m.quadCount).toBe(6);
    expect(meshArea(m)).toBe(4 * 4 + 2);
  });

  it('never loses or duplicates faces (random volumes)', () => {
    const rng = createRng(99);
    for (let trial = 0; trial < 30; trial++) {
      const v = createVolume(9, 7, 8);
      for (let i = 0; i < v.data.length; i++) v.data[i] = int(rng, 0, 3) === 0 ? 0 : int(rng, 1, 3);
      for (const opts of [solid, { include: (x: number) => x === 2, occludes: (x: number) => x > 0, outside: false }]) {
        const m = greedyMesh(v, opts);
        expect(meshArea(m)).toBe(countVisibleFaces(v, opts));
        expect(m.quadCount).toBeLessThanOrEqual(countVisibleFaces(v, opts));
      }
    }
  });
});

describe('voxel cave', () => {
  it('is deterministic for a seed and differs between seeds', () => {
    const room = roomFor(42);
    const a = buildCave(room.grid, 1234);
    const b = buildCave(room.grid, 1234);
    const c = buildCave(room.grid, 1235);
    expect(Buffer.from(a.volume.data).equals(Buffer.from(b.volume.data))).toBe(true);
    expect(a.braziers).toEqual(b.braziers);
    expect(Buffer.from(a.volume.data).equals(Buffer.from(c.volume.data))).toBe(false);
  });

  it('keeps walkable cells clear, has floor and ceiling everywhere, and no holes in walls (100 seeds)', () => {
    const failures: string[] = [];
    const check = (ok: boolean, what: string) => {
      if (!ok && failures.length < 5) failures.push(what);
    };
    for (let seed = 1; seed <= 100; seed++) {
      const room = roomFor(seed);
      const g = room.grid;
      const cave = buildCave(g, seed * 31);
      const vol = cave.volume;
      const Y = (j: number) => j - J_MIN;
      const isOpen = (t: CellType) => t === 'floor' || t === 'pit' || t === 'pillar';
      for (let cy = 0; cy < g.h; cy++)
        for (let cx = 0; cx < g.w; cx++) {
          const t = getCell(g, cx, cy);
          for (let lz = 0; lz < VPC; lz++)
            for (let lx = 0; lx < VPC; lx++) {
              const x = cx * VPC + lx;
              const z = cy * VPC + lz;
              const where = `seed ${seed} cell ${cx},${cy} voxel ${lx},${lz}`;
              if (t === 'floor' || t === 'pit') {
                check(getVoxel(vol, x, Y(J_CEIL), z) > 0, `${where}: no ceiling`);
                if (t === 'floor')
                  check(getVoxel(vol, x, Y(-1), z) > 0 && isRockLike(getVoxel(vol, x, Y(-2), z)), `${where}: no floor`);
                else check(getVoxel(vol, x, Y(-3), z) === LAVA_POOL, `${where}: no lava`);
                // Nothing in the way below head height inside the cell (decorations may touch its rim).
                if (lx >= 2 && lx < VPC - 2 && lz >= 2 && lz < VPC - 2)
                  for (let j = 0; j < 9; j++) check(getVoxel(vol, x, Y(j), z) === 0, `${where} j ${j}: blocked`);
              } else if (!isOpen(t)) {
                // Wall and door cells: anything more than 3 voxels from open space is solid, so the
                // surface can be rough but never see-through.
                // Only the 4-voxel rim of a wall cell can touch open space (cells are 10 voxels wide).
                let nearOpen = false;
                for (const [dx, dy] of [
                  [-1, -1],
                  [0, -1],
                  [1, -1],
                  [-1, 0],
                  [1, 0],
                  [-1, 1],
                  [0, 1],
                  [1, 1],
                ] as const) {
                  const rimX = dx < 0 ? lx < 4 : dx > 0 ? lx >= VPC - 4 : true;
                  const rimZ = dy < 0 ? lz < 4 : dy > 0 ? lz >= VPC - 4 : true;
                  if (rimX && rimZ && isOpen(getCell(g, cx + dx, cy + dy))) nearOpen = true;
                }
                if (!nearOpen)
                  for (let j = J_MIN; j <= J_CEIL; j++) {
                    check(getVoxel(vol, x, Y(j), z) > 0, `${where} j ${j}: hole in wall`);
                  }
              }
            }
        }
      expect(cave.braziers.length).toBe(g.cells.filter((c) => c === 'door').length * 2);
    }
    expect(failures).toEqual([]);
  }, 60_000);
});
