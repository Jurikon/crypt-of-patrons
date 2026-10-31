import { add, dirVec, floodFill, getCell, index, type Vec2 } from '../core/grid';
import { int, shuffle, weighted, type Rng } from '../core/rng';
import { ENEMIES, getEnemy, ROOM_CORPSES } from '../content';
import type { Enemy, GameState, Surface } from './state';

/** Minimum distance (both walking and straight-line) between the players and any enemy at spawn. */
export const MIN_SPAWN_DISTANCE = 3;

/** Walking distances from `start` over floor cells (−1 = unreachable). */
function walkDistances(state: GameState, start: Vec2): number[] {
  const g = state.room.grid;
  const dist = new Array<number>(g.w * g.h).fill(-1);
  dist[index(g, start.x, start.y)] = 0;
  const queue: Vec2[] = [start];
  for (let qi = 0; qi < queue.length; qi++) {
    const p = queue[qi] as Vec2;
    for (const d of [0, 1, 2, 3] as const) {
      const n = add(p, dirVec(d));
      if (getCell(g, n.x, n.y) !== 'floor') continue;
      const ni = index(g, n.x, n.y);
      if (dist[ni] !== -1) continue;
      dist[ni] = (dist[index(g, p.x, p.y)] as number) + 1;
      queue.push(n);
    }
  }
  return dist;
}

/** Places 2–4 enemies on floor cells at least MIN_SPAWN_DISTANCE steps from every player. */
export function placeEncounter(rng: Rng, state: GameState): Enemy[] {
  const g = state.room.grid;
  const count = weighted(rng, [
    { item: 2, weight: 3 },
    { item: 3, weight: 4 },
    { item: 4, weight: 2 },
  ]);
  const near = state.players.map((p) => walkDistances(state, p));
  // Keep the cell right inside each door free: later milestones walk through them.
  const doorCells = new Set(state.room.doors.map((d) => index(g, d.x + dirVec(d.dir).x, d.y + dirVec(d.dir).y)));
  const reachable = floodFill(g, state.room.spawn, (t) => t === 'floor');

  const candidates: Vec2[] = [];
  for (let y = 0; y < g.h; y++) {
    for (let x = 0; x < g.w; x++) {
      const i = index(g, x, y);
      if (getCell(g, x, y) !== 'floor' || !reachable[i] || doorCells.has(i)) continue;
      if (near.some((d) => (d[i] as number) < MIN_SPAWN_DISTANCE)) continue;
      if (state.players.some((p) => Math.abs(p.x - x) + Math.abs(p.y - y) < MIN_SPAWN_DISTANCE)) continue;
      candidates.push({ x, y });
    }
  }

  const enemies: Enemy[] = [];
  const pool = shuffle(rng, candidates);
  for (const cell of pool) {
    if (enemies.length >= count) break;
    // Leave a gap between enemies so they do not start glued together.
    if (enemies.some((e) => Math.abs(e.x - cell.x) + Math.abs(e.y - cell.y) < 2)) continue;
    const def = weighted(
      rng,
      ENEMIES.map((d) => ({ item: d, weight: d.weight })),
    );
    enemies.push({
      id: `e${enemies.length + 1}`,
      type: def.id,
      x: cell.x,
      y: cell.y,
      dir: int(rng, 0, 3) as 0 | 1 | 2 | 3,
      hp: getEnemy(def.id).maxHp,
      maxHp: getEnemy(def.id).maxHp,
      statuses: [],
      intent: null,
      moved: false,
    });
  }
  return enemies;
}

/**
 * Old corpses lying around the crypt at the start of a fight: something for the Necromancer to raise.
 * On free floor cells away from units and doorways; uses its own RNG fork so enemy placement is unchanged.
 */
export function placeCorpses(rng: Rng, state: GameState): Surface[] {
  const g = state.room.grid;
  const doorCells = new Set(state.room.doors.map((d) => index(g, d.x + dirVec(d.dir).x, d.y + dirVec(d.dir).y)));
  const reachable = floodFill(g, state.room.spawn, (t) => t === 'floor');
  const units = [...state.players, ...state.enemies];
  const candidates: Vec2[] = [];
  for (let y = 0; y < g.h; y++)
    for (let x = 0; x < g.w; x++) {
      const i = index(g, x, y);
      if (getCell(g, x, y) !== 'floor' || !reachable[i] || doorCells.has(i)) continue;
      if (units.some((u) => Math.abs(u.x - x) + Math.abs(u.y - y) < 2)) continue;
      candidates.push({ x, y });
    }
  return shuffle(rng, candidates)
    .slice(0, ROOM_CORPSES)
    .map((c) => ({ id: 'corpse', x: c.x, y: c.y, turns: null, side: 'neutral' as const }));
}
