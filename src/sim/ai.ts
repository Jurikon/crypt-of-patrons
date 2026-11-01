import { add, dirVec, getCell, index, rotateDir, DIRS, type Dir, type Vec2 } from '../core/grid';
import {
  getAbility,
  getEnemy,
  getStatus,
  getSummon,
  getSurface,
  type AttackSpec,
  type EnemyBehavior,
} from '../content';
import { dealDamage, moved, ownerPlayer, runEffects, settle, type Engine } from './engine';
import { upgradedEffects } from './run';
import { statOf } from './units';
import { surfaceAt, unitAt, unitById, type Ally, type Enemy, type GameState, type Intent, type Unit } from './state';

/**
 * Enemy behaviour. Fully deterministic: fixed enemy order, BFS with a fixed neighbour order,
 * and explicit tie-breaks on every choice.
 */

const blocksSight = (t: string) => t === 'wall' || t === 'pillar' || t === 'door';

/** An intent for an attack that needs no board knowledge (cells for summons, blasts and aid come later). */
export function makeIntent(attack: AttackSpec, dir: Dir): Intent {
  switch (attack.kind) {
    case 'melee':
      return { kind: 'melee', dir, damage: attack.damage };
    case 'line':
      return { kind: 'line', dir, damage: attack.damage, range: attack.range };
    case 'sweep':
      return { kind: 'sweep', dir, damage: attack.damage };
    case 'burst':
      return { kind: 'burst', dir, damage: attack.damage, radius: attack.radius };
    case 'blast':
      return { kind: 'blast', dir, damage: attack.damage, cells: [] };
    case 'summon':
      return { kind: 'summon', dir, damage: 0, unit: attack.unit, cells: [] };
    case 'aid':
      return { kind: 'aid', dir, damage: 0, cells: [] };
  }
}

/** The boss phase an enemy is in, if any. */
const phaseOf = (e: Enemy) => (e.phase > 0 ? getEnemy(e.type).phases?.[e.phase - 1] : undefined);

/** The attack an enemy uses next: its (phase's) pattern in turn, or its only attack. */
export function nextAttack(e: Enemy): AttackSpec {
  const def = getEnemy(e.type);
  const pattern = phaseOf(e)?.pattern ?? def.pattern;
  return pattern?.[e.strikes % pattern.length] ?? def.attack;
}

const behaviorOf = (e: Enemy): EnemyBehavior => phaseOf(e)?.behavior ?? getEnemy(e.type).behavior;
const moveOf = (e: Enemy): number => phaseOf(e)?.move ?? getEnemy(e.type).move;

/** The square around the nearest hero, floor and pits only: where a blast will land. */
function blastCells(state: GameState, e: Enemy, radius: number): Vec2[] {
  const target = nearestPlayer(state, e);
  if (!target) return [];
  const cells: Vec2[] = [];
  for (let dy = -radius; dy <= radius; dy++)
    for (let dx = -radius; dx <= radius; dx++) {
      const c = { x: target.x + dx, y: target.y + dy };
      if (!blocksSight(getCell(state.room.grid, c.x, c.y))) cells.push(c);
    }
  return cells;
}

/** The enemy an aid goes to: the most hurt one within range (itself included), nearest on ties. */
function aidCell(state: GameState, e: Enemy, range: number): Vec2 {
  const hurt = (u: Enemy) => u.hp / u.maxHp;
  const pick = state.enemies
    .filter((u) => manhattan(u, e) <= range)
    .sort((a, b) => hurt(a) - hurt(b) || manhattan(a, e) - manhattan(b, e) || (a === e ? 1 : b === e ? -1 : 0))[0];
  return pick ? { x: pick.x, y: pick.y } : { x: e.x, y: e.y };
}

/**
 * Where summoned enemies will rise: free floor cells, corpses first, then nearest to the summoner,
 * never right next to a player. Chosen when the summon is telegraphed, so the player sees them coming.
 */
function summonCells(state: GameState, e: Enemy, count: number): Vec2[] {
  const g = state.room.grid;
  const cells: { c: Vec2; corpse: number; d: number; i: number }[] = [];
  for (let y = 0; y < g.h; y++)
    for (let x = 0; x < g.w; x++) {
      const c = { x, y };
      if (getCell(g, x, y) !== 'floor' || unitAt(state, x, y)) continue;
      if (state.players.some((p) => p.hp > 0 && manhattan(p, c) <= 1)) continue;
      cells.push({ c, corpse: surfaceAt(state, c, 'corpse') ? 0 : 1, d: manhattan(e, c), i: index(g, x, y) });
    }
  cells.sort((a, b) => a.corpse - b.corpse || a.d - b.d || a.i - b.i);
  return cells.slice(0, count).map((x) => x.c);
}

/** The enemy's next intent, facing `dir`. */
export function intentFor(state: GameState, e: Enemy, dir: Dir): Intent {
  const attack = nextAttack(e);
  if (attack.kind === 'summon')
    return { kind: 'summon', dir, damage: 0, unit: attack.unit, cells: summonCells(state, e, attack.count) };
  if (attack.kind === 'blast')
    return { kind: 'blast', dir, damage: attack.damage, cells: blastCells(state, e, attack.radius) };
  if (attack.kind === 'aid') return { kind: 'aid', dir, damage: 0, cells: [aidCell(state, e, attack.range)] };
  return makeIntent(attack, dir);
}

/** Cells an intent covers from the enemy's current position, and the units it would hit (`hit`: the first). */
export function intentCells(
  state: GameState,
  enemy: Enemy,
  intent: Intent,
): { cells: Vec2[]; hit: Unit | undefined; hits: Unit[] } {
  const step = dirVec(intent.dir);
  const result = (cells: Vec2[]) => {
    const hits = cells.map((c) => unitAt(state, c.x, c.y)).filter((u): u is Unit => !!u);
    return { cells, hit: hits[0], hits };
  };
  switch (intent.kind) {
    case 'melee': {
      const cell = add(enemy, step);
      return result(blocksSight(getCell(state.room.grid, cell.x, cell.y)) ? [] : [cell]);
    }
    case 'sweep': {
      const front = add(enemy, step);
      const cells = [
        front,
        add(front, dirVec(rotateDir(intent.dir, 1))),
        add(front, dirVec(rotateDir(intent.dir, -1))),
      ];
      return result(cells.filter((c) => !blocksSight(getCell(state.room.grid, c.x, c.y))));
    }
    case 'burst': {
      const cells: Vec2[] = [];
      for (let dy = -intent.radius; dy <= intent.radius; dy++)
        for (let dx = -intent.radius; dx <= intent.radius; dx++) {
          const c = { x: enemy.x + dx, y: enemy.y + dy };
          if ((dx === 0 && dy === 0) || Math.abs(dx) + Math.abs(dy) > intent.radius) continue;
          if (!blocksSight(getCell(state.room.grid, c.x, c.y))) cells.push(c);
        }
      return result(cells);
    }
    case 'blast':
      return result([...intent.cells]);
    case 'summon':
    case 'aid':
      return { cells: [...intent.cells], hit: undefined, hits: [] };
    case 'line': {
      const cells: Vec2[] = [];
      let p: Vec2 = { x: enemy.x, y: enemy.y };
      for (let i = 0; i < intent.range; i++) {
        p = add(p, step);
        if (blocksSight(getCell(state.room.grid, p.x, p.y))) break;
        cells.push(p);
        const u = unitAt(state, p.x, p.y);
        if (u) return { cells, hit: u, hits: [u] };
      }
      return { cells, hit: undefined, hits: [] };
    }
  }
}

const manhattan = (a: Vec2, b: Vec2) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);

/** Grid direction from `from` towards `to`, preferring the longer axis (horizontal on ties). */
export function dirTowards(from: Vec2, to: Vec2): Dir {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  if (Math.abs(dx) >= Math.abs(dy) && dx !== 0) return dx > 0 ? 1 : 3;
  return dy > 0 ? 2 : 0;
}

function livingPlayers(state: GameState): Unit[] {
  return state.players.filter((p) => p.hp > 0);
}

function nearestOf(units: readonly Unit[], from: Vec2): Unit | undefined {
  let best: Unit | undefined;
  for (const u of units) if (!best || manhattan(from, u) < manhattan(from, best)) best = u;
  return best;
}

function nearestPlayer(state: GameState, from: Vec2): Unit | undefined {
  return nearestOf(livingPlayers(state), from);
}

const isStunned = (u: Unit) => u.statuses.some((s) => getStatus(s.id).stun);
const isRooted = (u: Unit) => u.statuses.some((s) => getStatus(s.id).rooted);

/**
 * Who an enemy goes after: whoever taunted it, else the nearest player or summon (players win ties,
 * because they come first in the list).
 */
function targetsFor(state: GameState, e: Enemy): Unit[] {
  for (const s of e.statuses) {
    if (!getStatus(s.id).taunt || !s.sourceId) continue;
    const u = unitById(state, s.sourceId);
    if (u && u.hp > 0) return [u];
  }
  const t = nearestOf([...livingPlayers(state), ...state.allies], e);
  return t ? [t] : [];
}

interface Bfs {
  dist: number[];
  parent: number[];
}

/** A cell an enemy would rather not step on: a hazard laid by the other side (or by nobody). */
const hazardFor = (state: GameState, c: Vec2) =>
  state.surfaces.some((s) => s.x === c.x && s.y === c.y && s.side !== 'foes' && getSurface(s.id).hazard);

/**
 * Shortest paths over floor cells not occupied by other units. Pits, pillars and units block; enemies
 * walk around hazards unless that leaves them nowhere to go.
 */
function bfs(state: GameState, start: Vec2, avoid = true): Bfs {
  const b = search(state, start, avoid);
  return avoid && b.dist.filter((d) => d > 0).length === 0 ? search(state, start, false) : b;
}

function search(state: GameState, start: Vec2, avoid: boolean): Bfs {
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
      if (avoid && hazardFor(state, n)) continue;
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

function planMelee(state: GameState, e: Unit, move: number, players: readonly Unit[]): Plan {
  const b = bfs(state, e);
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
      const p = nearestOf(players, c);
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

function planRanged(
  state: GameState,
  e: Enemy,
  move: number,
  minRange: number,
  maxRange: number,
  players: readonly Unit[],
): Plan {
  const b = bfs(state, e);
  const ideal = Math.round((minRange + maxRange) / 2) - 1;
  const lineScore = (c: Vec2): { score: number[]; victim: Unit } | null => {
    let best: { score: number[]; victim: Unit } | null = null;
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
      const p = nearestOf(players, end);
      return { path, face: p ? dirTowards(end, p) : e.dir };
    }
    // No firing position anywhere (walled off): just get closer.
    target = chooseCell(state, b, move, (c) => {
      const p = nearestOf(players, c);
      return p ? [manhattan(c, p)] : [0];
    });
  }
  const path = target === null ? [] : pathTo(state, b, target);
  const end = path[path.length - 1] ?? { x: e.x, y: e.y };
  const aimed = lineScore(end)?.victim ?? nearestOf(players, end);
  return { path, face: aimed ? dirTowards(end, aimed) : e.dir };
}

function dirFromStep(from: Vec2, to: Vec2): Dir {
  return dirTowards(from, to);
}

function plan(state: GameState, e: Enemy): Plan {
  const behavior = behaviorOf(e);
  const targets = targetsFor(state, e);
  return behavior.kind === 'melee'
    ? planMelee(state, e, moveOf(e), targets)
    : planRanged(state, e, e.moved ? 0 : moveOf(e), behavior.minRange, behavior.maxRange, targets);
}

/** A boss whose health fell to the next phase's threshold enters it (once): new pattern, its entrance. */
function checkPhase(eng: Engine, e: Enemy): void {
  const phases = getEnemy(e.type).phases ?? [];
  const next = phases[e.phase];
  if (!next || e.hp > next.hpAtMost) return;
  e.phase++;
  e.strikes = 0;
  eng.events.push({ type: 'phaseEntered', unitId: e.id, phase: e.phase });
  if (next.onEnter)
    runEffects(eng, next.onEnter, { source: e, target: { x: e.x, y: e.y }, dir: e.dir, tags: [], event: null });
  settle(eng);
}

/** Walks a unit along a planned path, then turns it. Steps can set off traps, so triggers settle after each. */
function walk(eng: Engine, u: Unit, { path, face }: Plan): void {
  const { state, events } = eng;
  for (const step of path) {
    if (!state.enemies.includes(u as Enemy) && !state.allies.includes(u as Ally)) return;
    const from = { x: u.x, y: u.y };
    u.x = step.x;
    u.y = step.y;
    events.push({ type: 'moved', unitId: u.id, from, to: { x: u.x, y: u.y } });
    moved(eng, u, from, u, []);
    settle(eng);
  }
  if (face !== u.dir) {
    events.push({ type: 'turned', unitId: u.id, from: u.dir, to: face });
    u.dir = face;
  }
}

/**
 * Allies act right after the players: hit an adjacent enemy, otherwise step towards the nearest one.
 * They strike at once instead of telegraphing; enemies are the ones that must be readable.
 */
export function actAllies(eng: Engine): void {
  const { state, events } = eng;
  for (const id of state.allies.map((a) => a.id)) {
    const a = state.allies.find((x) => x.id === id);
    if (!a || isStunned(a) || getSummon(a.type).inert || state.combat.status !== 'active') continue;
    const adjacent = state.enemies.find((e) => manhattan(e, a) === 1);
    if (adjacent) {
      const face = dirTowards(a, adjacent);
      if (face !== a.dir) {
        events.push({ type: 'turned', unitId: a.id, from: a.dir, to: face });
        a.dir = face;
      }
      events.push({ type: 'allyAttack', unitId: a.id, target: { x: adjacent.x, y: adjacent.y } });
      const owner = ownerPlayer(state, a);
      const target = { x: adjacent.x, y: adjacent.y };
      const base = owner?.abilities[0];
      if (owner && base && statOf(state, owner, 'summonsUseBaseAttack') > 0) {
        // The lich's crown: summons strike with their owner's base attack.
        runEffects(eng, upgradedEffects(owner, base), {
          source: a,
          target,
          dir: face,
          tags: getAbility(base).tags,
          event: null,
        });
      } else {
        // A war banner: summons next to their owner hit harder.
        const aura = owner && manhattan(owner, a) <= 1 ? statOf(state, owner, 'auraDamage') : 0;
        dealDamage(eng, adjacent, getSummon(a.type).damage + aura, a, 'attack', ['melee']);
      }
      settle(eng);
      continue;
    }
    const foe = nearestOf(state.enemies, a);
    if (foe) walk(eng, a, planMelee(state, a, 1, [foe]));
  }
}

/** Enemy phase, second half: every enemy moves, turns and telegraphs its next attack. Stunned ones skip. */
export function advanceEnemies(eng: Engine): void {
  const { state, events } = eng;
  for (const id of state.enemies.map((e) => e.id)) {
    const e = state.enemies.find((x) => x.id === id);
    if (!e || livingPlayers(state).length === 0 || state.combat.status !== 'active') continue;
    checkPhase(eng, e);
    if (!state.enemies.includes(e) || state.combat.status !== 'active') continue;
    if (isStunned(e)) {
      e.moved = false;
      continue;
    }
    if (isRooted(e)) {
      // Dazed: it cannot move or turn, but telegraphs a blow straight ahead.
      e.moved = false;
      e.intent = intentFor(state, e, e.dir);
      events.push({ type: 'intentDeclared', unitId: e.id, intent: e.intent });
      continue;
    }
    const p = plan(state, e);
    walk(eng, e, p);
    if (!state.enemies.includes(e)) continue; // died on a trap
    e.moved = p.path.length > 0;
    // A ranged enemy either moves or aims in one turn, never both, and after a move it stands for a turn:
    // otherwise it kites forever at the player's own speed.
    if (e.moved && behaviorOf(e).kind === 'ranged') continue;
    e.intent = intentFor(state, e, e.dir);
    events.push({ type: 'intentDeclared', unitId: e.id, intent: e.intent });
  }
}

/** Combat start: enemies face the nearest player and telegraph without moving, so the player acts first. */
export function declareIntentsInPlace(state: GameState): void {
  for (const e of state.enemies) {
    const p = nearestPlayer(state, e);
    if (p) e.dir = dirTowards(e, p);
    e.intent = intentFor(state, e, e.dir);
  }
}
