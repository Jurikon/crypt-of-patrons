import { describe, expect, it } from 'vitest';
import { createRng, int } from '../../core/rng';
import { countVisibleFaces, createVolume, greedyMesh, meshArea, setVoxel, type MeshOptions } from './mesher';

const solid: MeshOptions = { include: (v) => v > 0, occludes: (v) => v > 0 };

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
