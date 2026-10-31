import { add, dirVec, getCell, index, DIRS, type Dir, type Vec2 } from '../core/grid';
import { getEnemy, type AttackSpec } from '../content';
import type { GameEvent } from './commands';
import { unitAt, type Enemy, type GameState, type Intent, type Player, type Unit } from './state';

/**
 * Enemy behaviour. Fully deterministic: fixed enemy order, BFS with a fixed neighbour order,
 * and explicit tie-breaks on every choice.
 */

const blocksSight = (t: string) => t === 'wall' || t === 'pillar' || t === 'door';

export function makeIntent(attack: AttackSpec, dir: Dir): Intent {
  return attack.kind === 'melee'
    ? { kind: 'melee', dir, damage: attack.damage }
    : { kind: 'line', dir, damage: attack.damage, range: attack.range };
}

/** Cells an intent covers from the enemy's current position, and the unit it would hit. */
export function intentCells(state: GameState, enemy: Enemy, intent: Intent): { cells: Vec2[]; hit: Unit | undefined } {
  const step = dirVec(intent.dir);
  if (intent.kind === 'melee') {
    const cell = add(enemy, step);
    if (blocksSight(getCell(state.room.grid, cell.x, cell.y))) return { cells: [], hit: undefined };
    return { cells: [cell], hit: unitAt(state, cell.x, cell.y) };
  }
  const cells: Vec2[] = [];
  let p: Vec2 = { x: enemy.x, y: enemy.y };
  for (let i = 0; i < intent.range; i++) {
    p = add(p, step);
    if (blocksSight(getCell(state.room.grid, p.x, p.y))) break;
    cells.push(p);
    const u = unitAt(state, p.x, p.y);
    if (u) return { cells, hit: u };
  }
  return { cells, hit: undefined };
}

const manhattan = (a: Vec2, b: Vec2) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);

/** Grid direction from `from` towards `to`, preferring the longer axis (horizontal on ties). */
export function dirTowards(from: Vec2, to: Vec2): Dir {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  if (Math.abs(dx) >= Math.abs(dy) && dx !== 0) return dx > 0 ? 1 : 3;
  return dy > 0 ? 2 : 0;
}

function livingPlayers(state: GameState): Player[] {
  return state.players.filter((p) => p.hp > 0);
}

function nearestPlayer(state: GameState, from: Vec2): Player | undefined {
  let best: Player | undefined;
  for (const p of livingPlayers(state)) if (!best || manhattan(from, p) < manhattan(from, best)) best = p;
  return best;
}

interface Bfs {
  dist: number[];
  parent: number[];
}

/** Shortest paths over floor cells not occupied by other units. Pits, pillars and units block. */
function bfs(state: GameState, start: Vec2): Bfs {
  const g = state.room.grid;
  const dist = new Array<number>(g.w * g.h).fill(-1);
  const parent = new Array<number>(g.w * g.h).fill(-1);
  const startI = index(g, start.x, start.y);
  dist[startI] = 0;
  const queue: Vec2[] = [start];
  for (let qi = 0; qi < queue.length; qi++) {
    const p = queue[qi] as Vec2;
    const pi = index(g, p.x, p.y);
    for (const d of DIRS) {
      const n = add(p, dirVec(d));
      if (getCell(g, n.x, n.y) !== 'floor') continue;
      const ni = index(g, n.x, n.y);
      if (dist[ni] !== -1) continue;
      if (unitAt(state, n.x, n.y)) continue;
      dist[ni] = (dist[pi] as number) + 1;
      parent[ni] = pi;
      queue.push(n);
    }
  }
  return { dist, parent };
}

function pathTo(state: GameState, b: Bfs, target: number): Vec2[] {
  const w = state.room.grid.w;
  const path: Vec2[] = [];
  for (let i = target; (b.dist[i] as number) > 0; i = b.parent[i] as number)
    path.push({ x: i % w, y: Math.floor(i / w) });
  return path.reverse();
}

/** Lexicographic comparison of score tuples; lower is better. */
function better(a: readonly number[], b: readonly number[] | null): boolean {
  if (!b) return true;
  for (let i = 0; i < a.length; i++) {
    if ((a[i] as number) !== (b[i] as number)) return (a[i] as number) < (b[i] as number);
  }
  return false;
}

/** Picks the cell with the lowest score among those reachable within `move` steps (including staying put). */
function chooseCell(state: GameState, b: Bfs, move: number, score: (c: Vec2) => number[] | null): number | null {
  const g = state.room.grid;
  let bestI: number | null = null;
  let bestScore: number[] | null = null;
  for (let i = 0; i < b.dist.length; i++) {
    const d = b.dist[i] as number;
    if (d < 0 || d > move) continue;
    const s = score({ x: i % g.w, y: Math.floor(i / g.w) });
    if (!s) continue;
    const full = [...s, d, i];
    if (better(full, bestScore)) {
      bestScore = full;
      bestI = i;
    }
  }
  return bestI;
}

/** The reachable cell (any distance) with the shortest path among those `score` accepts; ties by score, then index. */
function nearestCell(state: GameState, b: Bfs, score: (c: Vec2) => number[] | null): number | null {
  const g = state.room.grid;
  let bestI: number | null = null;
  let bestScore: number[] | null = null;
  for (let i = 0; i < b.dist.length; i++) {
    const d = b.dist[i] as number;
    if (d < 0) continue;
    const s = score({ x: i % g.w, y: Math.floor(i / g.w) });
    if (!s) continue;
    const full = [d, ...s, i];
    if (better(full, bestScore)) {
      bestScore = full;
      bestI = i;
    }
  }
  return bestI;
}

/** True if no wall/pillar/door lies strictly between a and b (which share a row or column). */
function clearLine(state: GameState, a: Vec2, b: Vec2, ignore: Unit): { clear: boolean; unitsBetween: number } {
  const d = dirTowards(a, b);
  const step = dirVec(d);
  let units = 0;
  for (let p = add(a, step); p.x !== b.x || p.y !== b.y; p = add(p, step)) {
    if (blocksSight(getCell(state.room.grid, p.x, p.y))) return { clear: false, unitsBetween: units };
    const u = unitAt(state, p.x, p.y);
    if (u && u !== ignore) units++;
  }
  return { clear: true, unitsBetween: units };
}

interface Plan {
  readonly path: Vec2[];
  readonly face: Dir;
}

function planMelee(state: GameState, e: Enemy, move: number): Plan {
  const b = bfs(state, e);
  const players = livingPlayers(state);
  const adjacentTo = (c: Vec2) => players.find((p) => manhattan(c, p) === 1);
  // Prefer a cell next to a player; otherwise get as close as possible.
  const g = state.room.grid;
  let target = chooseCell(state, b, move, (c) => (adjacentTo(c) ? [0] : null));
  if (target === null) {
    // Not reachable this turn: walk along the shortest route towards the nearest attack position.
    let goal: number | null = null;
    let goalScore: number[] | null = null;
    for (let i = 0; i < b.dist.length; i++) {
      const d = b.dist[i] as number;
      if (d < 0) continue;
      const c = { x: i % g.w, y: Math.floor(i / g.w) };
      if (!adjacentTo(c)) continue;
      const s = [d, i];
      if (better(s, goalScore)) {
        goalScore = s;
        goal = i;
      }
    }
    if (goal !== null) {
      const full = pathTo(state, b, goal);
      const path = full.slice(0, move);
      const end = path[path.length - 1] ?? e;
      return {
        path,
        face: path.length ? dirFromStep(path.length > 1 ? (path[path.length - 2] as Vec2) : e, end) : e.dir,
      };
    }
    // Completely blocked off: shuffle as close as possible by straight-line distance.
    target = chooseCell(state, b, move, (c) => {
      const p = nearestPlayer(state, c);
      return p ? [manhattan(c, p)] : [0];
    });
  }
  const path = target === null ? [] : pathTo(state, b, target);
  const end = path[path.length - 1] ?? { x: e.x, y: e.y };
  const victim = adjacentTo(end);
  const face = victim
    ? dirTowards(end, victim)
    : path.length
      ? dirFromStep(path.length > 1 ? (path[path.length - 2] as Vec2) : e, end)
      : e.dir;
  return { path, face };
}

function planRanged(state: GameState, e: Enemy, move: number, minRange: number, maxRange: number): Plan {
  const b = bfs(state, e);
  const players = livingPlayers(state);
  const ideal = Math.round((minRange + maxRange) / 2) - 1;
  const lineScore = (c: Vec2): { score: number[]; victim: Player } | null => {
    let best: { score: number[]; victim: Player } | null = null;
    for (const p of players) {
      if (c.x !== p.x && c.y !== p.y) continue;
      const d = manhattan(c, p);
      if (d < minRange || d > maxRange) continue;
      const line = clearLine(state, c, p, e);
      if (!line.clear) continue;
      const score = [line.unitsBetween > 0 ? 1 : 0, Math.abs(d - ideal)];
      if (!best || better(score, best.score)) best = { score, victim: p };
    }
    return best;
  };
  // Already able to shoot: hold position. Kiting to the "ideal" range every turn made archers uncatchable.
  const here = lineScore(e);
  if (here) return { path: [], face: dirTowards(e, here.victim) };
  let target = chooseCell(state, b, move, (c) => lineScore(c)?.score ?? null);
  if (target === null) {
    // No firing position this turn: walk the shortest route to the nearest one. (Greedily improving
    // alignment gets stuck in corners: bot seed 171.)
    const goal = nearestCell(state, b, (c) => lineScore(c)?.score ?? null);
    if (goal !== null) {
      const path = pathTo(state, b, goal).slice(0, move);
      const end = path[path.length - 1] ?? { x: e.x, y: e.y };
      const p = nearestPlayer(state, end);
      return { path, face: p ? dirTowards(end, p) : e.dir };
    }
    // No firing position anywhere (walled off): just get closer.
    target = chooseCell(state, b, move, (c) => {
      const p = nearestPlayer(state, c);
      return p ? [manhattan(c, p)] : [0];
    });
  }
  const path = target === null ? [] : pathTo(state, b, target);
  const end = path[path.length - 1] ?? { x: e.x, y: e.y };
  const aimed = lineScore(end)?.victim ?? nearestPlayer(state, end);
  return { path, face: aimed ? dirTowards(end, aimed) : e.dir };
}

function dirFromStep(from: Vec2, to: Vec2): Dir {
  return dirTowards(from, to);
}

function plan(state: GameState, e: Enemy): Plan {
  const def = getEnemy(e.type);
  return def.behavior.kind === 'melee'
    ? planMelee(state, e, def.move)
    : planRanged(state, e, e.moved ? 0 : def.move, def.behavior.minRange, def.behavior.maxRange);
}

/** Enemy phase, second half: every enemy moves, turns and telegraphs its next attack. */
export function advanceEnemies(state: GameState, events: GameEvent[]): void {
  for (const id of state.enemies.map((e) => e.id)) {
    const e = state.enemies.find((x) => x.id === id);
    if (!e || livingPlayers(state).length === 0) continue;
    const { path, face } = plan(state, e);
    for (const step of path) {
      const from = { x: e.x, y: e.y };
      e.x = step.x;
      e.y = step.y;
      events.push({ type: 'moved', unitId: e.id, from, to: { x: e.x, y: e.y } });
    }
    if (face !== e.dir) {
      events.push({ type: 'turned', unitId: e.id, from: e.dir, to: face });
      e.dir = face;
    }
    e.moved = path.length > 0;
    // A ranged enemy either moves or aims in one turn, never both, and after a move it stands for a turn:
    // otherwise it kites forever at the player's own speed.
    if (e.moved && getEnemy(e.type).behavior.kind === 'ranged') continue;
    e.intent = makeIntent(getEnemy(e.type).attack, e.dir);
    events.push({ type: 'intentDeclared', unitId: e.id, intent: e.intent });
  }
}

/** Combat start: enemies face the nearest player and telegraph without moving, so the player acts first. */
export function declareIntentsInPlace(state: GameState): void {
  for (const e of state.enemies) {
    const p = nearestPlayer(state, e);
    if (p) e.dir = dirTowards(e, p);
    e.intent = makeIntent(getEnemy(e.type).attack, e.dir);
  }
}
