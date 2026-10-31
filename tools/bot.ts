// Headless random-play bot. Plays whole fights through `apply` and reports how they ended.
// Run: pnpm bot [fights] [firstSeed]
import { createRng, pick, type Rng } from '../src/core/rng';
import { CLASSES, getAbility, getClass, MODIFIERS } from '../src/content';
import { apply, createGame, preview, validTargets, type Command, type GameState } from '../src/sim';

export interface FightResult {
  readonly seed: number;
  readonly status: GameState['combat']['status'];
  readonly turns: number;
  readonly commands: number;
}

export const TURN_LIMIT = 500;

export type Strategy = 'random' | 'greedy';
/** `class`: the class's own kit. `full`: its whole ability pool plus every modifier (stress test for combos). */
export type Loadout = 'class' | 'full';

function randomAbility(rng: Rng, state: GameState): Command {
  const p = state.players[0]!;
  const abilityId = pick(rng, p.abilities);
  const targets = validTargets(state, p, getAbility(abilityId));
  if (targets.length === 0) return { type: 'useAbility', playerId: p.id, abilityId: p.abilities[0]! };
  return { type: 'useAbility', playerId: p.id, abilityId, target: pick(rng, targets) };
}

function randomAction(rng: Rng, state: GameState): Command {
  const p = state.players[0]!;
  const playerId = p.id;
  return pick<Command>(rng, [
    { type: 'move', playerId, dir: pick(rng, ['forward', 'back', 'left', 'right'] as const) },
    { type: 'turn', playerId, dir: pick(rng, ['left', 'right'] as const) },
    randomAbility(rng, state),
    { type: 'useAbility', playerId, abilityId: p.abilities[0]! },
  ]);
}

/**
 * The best special ability use right now by its preview: damage and kills on enemies, plus summons,
 * minus harm to your own side. Null if nothing scores above zero.
 */
function bestAbility(state: GameState): Command | null {
  const p = state.players[0]!;
  const foes = new Set(state.enemies.map((e) => e.id));
  let best: { cmd: Command; score: number } | null = null;
  for (const abilityId of p.abilities.slice(1)) {
    if (p.cooldowns.some((c) => c.abilityId === abilityId)) continue;
    for (const target of validTargets(state, p, getAbility(abilityId)).slice(0, 6)) {
      const cmd: Command = { type: 'useAbility', playerId: p.id, abilityId, target };
      const pv = preview(state, cmd);
      if (pv.rejected) continue;
      let score = 0;
      for (const [id, dmg] of pv.damage) score += foes.has(id) ? dmg : -2 * dmg;
      for (const id of pv.deaths) score += foes.has(id) ? 4 : -3;
      score += 2 * pv.events.filter((e) => e.type === 'summoned').length;
      if (!best || score > best.score) best = { cmd, score };
    }
  }
  return best && best.score > 0 ? best.cmd : null;
}

const DIRS = [
  { x: 0, y: -1 },
  { x: 1, y: 0 },
  { x: 0, y: 1 },
  { x: -1, y: 0 },
];

/** Turn towards `want`, or null if already facing it. */
function face(playerId: string, dir: number, want: number): Command | null {
  if (want === dir) return null;
  return { type: 'turn', playerId, dir: (want - dir + 4) % 4 === 1 ? 'right' : 'left' };
}

/** First step direction of a shortest walk to any cell next to an enemy, or -1. */
function stepTowardsEnemies(state: GameState): number {
  const g = state.room.grid;
  const p = state.players[0]!;
  const occupied = (x: number, y: number) => [...state.enemies, ...state.allies].some((u) => u.x === x && u.y === y);
  const goal = (x: number, y: number) => state.enemies.some((e) => Math.abs(e.x - x) + Math.abs(e.y - y) === 1);
  const first = new Map<number, number>();
  const queue: { x: number; y: number }[] = [{ x: p.x, y: p.y }];
  first.set(p.y * g.w + p.x, -1);
  for (let qi = 0; qi < queue.length; qi++) {
    const c = queue[qi]!;
    for (let d = 0; d < 4; d++) {
      const n = { x: c.x + DIRS[d]!.x, y: c.y + DIRS[d]!.y };
      const i = n.y * g.w + n.x;
      if (first.has(i) || g.cells[i] !== 'floor' || occupied(n.x, n.y)) continue;
      const via = first.get(c.y * g.w + c.x)!;
      first.set(i, via === -1 ? d : via);
      if (goal(n.x, n.y)) return first.get(i)!;
      queue.push(n);
    }
  }
  return -1;
}

/**
 * A simple-minded fighter: use a special ability when its preview scores well, otherwise hit an
 * adjacent enemy, otherwise walk the shortest path towards the nearest enemy. Ignores intents; a rough
 * balance floor, not a good player.
 */
export function greedyAction(_rng: Rng, state: GameState): Command {
  const p = state.players[0]!;
  const playerId = p.id;
  const sword: Command = { type: 'useAbility', playerId, abilityId: p.abilities[0]! };
  const special = bestAbility(state);
  if (special) return special;
  const adjacent = state.enemies.find((e) => Math.abs(e.x - p.x) + Math.abs(e.y - p.y) === 1);
  if (adjacent) {
    const turn = face(
      playerId,
      p.dir,
      DIRS.findIndex((d) => d.x === adjacent.x - p.x && d.y === adjacent.y - p.y),
    );
    if (turn) return turn;
    return sword;
  }
  const step = stepTowardsEnemies(state);
  // No route (or already in place): swing at the air to let a turn pass.
  if (step < 0) return sword;
  return face(playerId, p.dir, step) ?? { type: 'move', playerId, dir: 'forward' };
}

function startState(seed: number, classId: string, loadout: Loadout): GameState {
  const state = createGame(seed, { classId });
  if (loadout === 'full') {
    const p = state.players[0]!;
    p.abilities = [...p.abilities, ...getClass(classId).pool];
    p.modifiers = MODIFIERS.map((m) => m.id);
  }
  return state;
}

/** Plays one fight until it ends or hits TURN_LIMIT turns. */
export function playFight(
  seed: number,
  strategy: Strategy = 'random',
  classId = 'knight',
  loadout: Loadout = 'class',
): FightResult {
  const rng = createRng(`bot/${seed}/${classId}`);
  let state = startState(seed, classId, loadout);
  let commands = 0;
  // Turning and bumping take no time, so also cap the raw command count.
  while (state.combat.status === 'active' && state.combat.turn <= TURN_LIMIT && commands < TURN_LIMIT * 10) {
    state = apply(state, (strategy === 'greedy' ? greedyAction : randomAction)(rng, state)).state;
    commands++;
  }
  return { seed, status: state.combat.status, turns: state.combat.turn, commands };
}

export function playFights(
  count: number,
  firstSeed = 1,
  strategy: Strategy = 'random',
  classId = 'knight',
  loadout: Loadout = 'class',
): FightResult[] {
  return Array.from({ length: count }, (_, i) => playFight(firstSeed + i, strategy, classId, loadout));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const count = Number(process.argv[2] ?? 200);
  const first = Number(process.argv[3] ?? 1);
  for (const loadout of ['class', 'full'] as const)
    for (const cls of CLASSES)
      for (const strategy of ['random', 'greedy'] as const) {
        const results = playFights(count, first, strategy, cls.id, loadout);
        const by = (s: string) => results.filter((r) => r.status === s).length;
        const turns = results.map((r) => r.turns).sort((a, b) => a - b);
        console.log(
          `${cls.id.padEnd(12)} ${loadout.padEnd(5)} ${strategy.padEnd(6)}: won ${by('won')}  lost ${by('lost')}  ` +
            `unfinished ${by('active')}  turns median ${turns[Math.floor(turns.length / 2)]} max ${turns.at(-1)}`,
        );
      }
}
