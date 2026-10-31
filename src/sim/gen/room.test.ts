import { describe, expect, it } from 'vitest';
import { createRng, fork } from '../../core/rng';
import { dirVec, floodFill, getCell, index } from '../../core/grid';
import { generateRoom, type Room } from './room';

const SEEDS = 1000;
const roomFor = (seed: number): Room => generateRoom(fork(createRng(seed), 'room:0'));

describe('generateRoom on 1000 seeds', () => {
  const rooms = Array.from({ length: SEEDS }, (_, seed) => roomFor(seed));

  it('interior is 7..11 per side with a solid wall border', () => {
    for (const r of rooms) {
      expect(r.interior.w).toBeGreaterThanOrEqual(7);
      expect(r.interior.w).toBeLessThanOrEqual(11);
      expect(r.interior.h).toBeGreaterThanOrEqual(7);
      expect(r.interior.h).toBeLessThanOrEqual(11);
      expect(r.grid.w).toBe(r.interior.w + 2);
      expect(r.grid.h).toBe(r.interior.h + 2);
      for (let x = 0; x < r.grid.w; x++) {
        expect(['wall', 'door']).toContain(getCell(r.grid, x, 0));
        expect(['wall', 'door']).toContain(getCell(r.grid, x, r.grid.h - 1));
      }
      for (let y = 0; y < r.grid.h; y++) {
        expect(['wall', 'door']).toContain(getCell(r.grid, 0, y));
        expect(['wall', 'door']).toContain(getCell(r.grid, r.grid.w - 1, y));
      }
    }
  });

  it('spawn is on floor, every floor cell is reachable, every door leads to reachable floor', () => {
    for (const [seed, r] of rooms.entries()) {
      expect(getCell(r.grid, r.spawn.x, r.spawn.y), `seed ${seed}`).toBe('floor');
      const seen = floodFill(r.grid, r.spawn, (t) => t === 'floor');
      r.grid.cells.forEach((t, i) => {
        if (t === 'floor') expect(seen[i], `seed ${seed}: unreachable floor at ${i}`).toBe(true);
      });
      for (const d of r.doors) {
        expect(getCell(r.grid, d.x, d.y)).toBe('door');
        const v = dirVec(d.dir);
        expect(seen[index(r.grid, d.x + v.x, d.y + v.y)], `seed ${seed}: door not connected`).toBe(true);
      }
    }
  });

  it('has one entrance and 2–3 exits, and the spawn faces in from the entrance', () => {
    for (const [seed, r] of rooms.entries()) {
      const [entrance, ...exits] = r.doors;
      expect(entrance?.kind, `seed ${seed}`).toBe('entrance');
      expect(exits.length, `seed ${seed}`).toBeGreaterThanOrEqual(2);
      expect(exits.length, `seed ${seed}`).toBeLessThanOrEqual(3);
      for (const e of exits) expect(e.kind).toBe('exit');
      const v = dirVec(entrance!.dir);
      expect(r.spawn).toEqual({ x: entrance!.x + v.x, y: entrance!.y + v.y, dir: entrance!.dir });
    }
  });

  it('is deterministic: the same seed gives the same room', () => {
    for (let seed = 0; seed < SEEDS; seed += 7) {
      expect(JSON.stringify(roomFor(seed))).toBe(JSON.stringify(rooms[seed]));
    }
  });

  it('produces varied rooms', () => {
    const shapes = new Set(rooms.map((r) => r.shape));
    expect(shapes.size).toBe(4);
    const sizes = new Set(rooms.map((r) => `${r.interior.w}x${r.interior.h}`));
    expect(sizes.size).toBeGreaterThan(20);
    const withPillars = rooms.filter((r) => r.grid.cells.includes('pillar')).length;
    const withPits = rooms.filter((r) => r.grid.cells.includes('pit')).length;
    expect(withPillars).toBeGreaterThan(SEEDS * 0.5);
    expect(withPits).toBeGreaterThan(SEEDS * 0.5);
    // Ten consecutive seeds should all differ.
    const layouts = new Set(rooms.slice(0, 10).map((r) => r.grid.cells.join('')));
    expect(layouts.size).toBe(10);
  });
});
