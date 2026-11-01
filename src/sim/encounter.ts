import { add, dirVec, floodFill, getCell, index, type Vec2 } from '../core/grid';
import { int, shuffle, weighted, type Rng } from '../core/rng';
import { ACT, encounterWeights, getEnemy, ROOM_CORPSES, type BiomeDef } from '../content';
import { biomeOf, type Enemy, type GameState, type RoomKind, type Surface } from './state';

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

/**
 * Places enemies on floor cells at least MIN_SPAWN_DISTANCE steps from every player: more of them deeper
 * in the act, one more (and tougher) in an elite room, the boss alone in the boss room (farthest cell).
 */
export function placeEncounter(rng: Rng, state: GameState, depth = 1, kind: RoomKind = 'combat'): Enemy[] {
  const g = state.room.grid;
  const count = kind === 'boss' ? 1 : weighted(rng, encounterWeights(depth)) + (kind === 'elite' ? ACT.eliteExtra : 0);
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
  const biome = biomeOf(state);
  if (kind === 'boss') {
    const far = near[0] ?? [];
    const cell = [...candidates].sort((a, b) => (far[index(g, b.x, b.y)] ?? 0) - (far[index(g, a.x, a.y)] ?? 0))[0];
    if (cell) enemies.push(makeEnemy('e1', biome.boss, cell, 2, false));
    return enemies;
  }
  const pool = shuffle(rng, candidates);
  const taken = (c: Vec2) => enemies.some((e) => e.x === c.x && e.y === c.y);
  let groups = 0;
  for (const cell of pool) {
    if (groups >= count) break;
    // Leave a gap between enemies so they do not start glued together.
    if (enemies.some((e) => Math.abs(e.x - cell.x) + Math.abs(e.y - cell.y) < 2)) continue;
    const type = weighted(
      rng,
      biome.enemies.map((x) => ({ item: x.id, weight: x.weight })),
    );
    const dir = int(rng, 0, 3) as 0 | 1 | 2 | 3;
    groups++;
    enemies.push(makeEnemy(`e${enemies.length + 1}`, type, cell, dir, kind === 'elite'));
    // A pack (leeches) fills in on free candidate cells next to the first.
    for (let i = 1; i < (getEnemy(type).pack ?? 1); i++) {
      const spot = candidates.find(
        (c) => !taken(c) && enemies.some((e) => e.type === type && Math.abs(e.x - c.x) + Math.abs(e.y - c.y) === 1),
      );
      if (spot) enemies.push(makeEnemy(`e${enemies.length + 1}`, type, spot, dir, kind === 'elite'));
    }
  }
  return enemies;
}

/** A fresh enemy of a type; elites get extra health. */
export function makeEnemy(id: string, type: string, cell: Vec2, dir: 0 | 1 | 2 | 3, elite: boolean): Enemy {
  const hp = getEnemy(type).maxHp + (elite ? ACT.eliteHp : 0);
  return {
    id,
    type,
    x: cell.x,
    y: cell.y,
    dir,
    hp,
    maxHp: hp,
    statuses: [],
    intent: null,
    moved: false,
    elite,
    strikes: 0,
    phase: 0,
  };
}

/**
 * A biome's hazards lying around at the start of a fight (pools of water, holy fire): patches grown
 * from a seed cell, on free floor away from the players and doorways. Its own RNG fork.
 */
export function placeFeatures(rng: Rng, state: GameState, biome: BiomeDef): Surface[] {
  const g = state.room.grid;
  const doorCells = new Set(state.room.doors.map((d) => index(g, d.x + dirVec(d.dir).x, d.y + dirVec(d.dir).y)));
  const out: Surface[] = [];
  const free = (c: Vec2) =>
    getCell(g, c.x, c.y) === 'floor' &&
    !doorCells.has(index(g, c.x, c.y)) &&
    !state.players.some((p) => Math.abs(p.x - c.x) + Math.abs(p.y - c.y) < 2) &&
    !out.some((s) => s.x === c.x && s.y === c.y);
  for (const f of biome.features) {
    for (let n = 0; n < f.patches; n++) {
      const start = shuffle(rng, allCells(g).filter(free))[0];
      if (!start) break;
      const cells = [start];
      for (let tries = 0; tries < f.size * 4 && cells.length < f.size; tries++) {
        const from = cells[int(rng, 0, cells.length - 1)] as Vec2;
        const next = add(from, dirVec(int(rng, 0, 3) as 0 | 1 | 2 | 3));
        if (free(next) && !cells.some((c) => c.x === next.x && c.y === next.y)) cells.push(next);
      }
      // Hazards that start in a room belong to nobody, so they hurt both sides.
      for (const c of cells) out.push({ id: f.surface, x: c.x, y: c.y, turns: null, side: 'neutral' });
    }
  }
  return out;
}

function allCells(g: GameState['room']['grid']): Vec2[] {
  const out: Vec2[] = [];
  for (let y = 0; y < g.h; y++) for (let x = 0; x < g.w; x++) out.push({ x, y });
  return out;
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
