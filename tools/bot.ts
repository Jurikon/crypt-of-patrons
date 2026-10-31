// Headless random-play bot. Plays whole fights through `apply` and reports how they ended.
// Run: pnpm bot [fights] [firstSeed]
import { createRng, pick, type Rng } from '../src/core/rng';
import { ABILITY_SLOTS, CLASSES, getAbility, getClass, MODIFIERS } from '../src/content';
import { apply, createGame, preview, validTargets, type Command, type GameState } from '../src/sim';

export interface FightResult {
  readonly seed: number;
  readonly status: GameState['combat']['status'];
  readonly turns: number;
  readonly commands: number;
}

export const TURN_LIMIT = 500;

export type Strategy = 'random' | 'greedy' | 'careful';
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
  return firstStep(state, (x, y) => state.enemies.some((e) => Math.abs(e.x - x) + Math.abs(e.y - y) === 1));
}

/** First step direction of a shortest walk over free floor to a cell passing `goal`, or -1. */
function firstStep(state: GameState, goal: (x: number, y: number) => boolean): number {
  const g = state.room.grid;
  const p = state.players[0]!;
  // Own summons are no obstacle: walking into one trades places with it.
  const occupied = (x: number, y: number) => state.enemies.some((u) => u.x === x && u.y === y);
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
/**
 * A careful fighter with one turn of lookahead: tries every step, every "turn to a side and hit", and
 * every special ability on its first targets, runs each through the real `apply` (enemy answer included),
 * and keeps the best outcome — health kept, damage dealt, kills, getting closer. A stand-in for a careful
 * human, used to judge how hard whole runs are.
 */
export function carefulAction(_rng: Rng, state: GameState): Command {
  const p = state.players[0]!;
  const id = p.id;
  const plans: Command[][] = [];
  for (const dir of ['forward', 'back', 'left', 'right'] as const) plans.push([{ type: 'move', playerId: id, dir }]);
  for (let d = 0; d < 4; d++) {
    const turn = face(id, p.dir, d);
    const hit: Command = { type: 'useAbility', playerId: id, abilityId: p.abilities[0]! };
    plans.push(turn ? (d === (p.dir + 2) % 4 ? [turn, turn, hit] : [turn, hit]) : [hit]);
  }
  for (const abilityId of p.abilities.slice(1)) {
    if (p.cooldowns.some((c) => c.abilityId === abilityId)) continue;
    for (const target of validTargets(state, p, getAbility(abilityId)).slice(0, 4))
      plans.push([{ type: 'useAbility', playerId: id, abilityId, target }]);
  }
  const foeHp = (s: GameState) => s.enemies.reduce((a, e) => a + e.hp, 0);
  const nearest = (s: GameState) => {
    const q = s.players[0]!;
    return Math.min(99, ...s.enemies.map((e) => Math.abs(e.x - q.x) + Math.abs(e.y - q.y)));
  };
  let best: { plan: Command[]; score: number } | null = null;
  for (const plan of plans) {
    let s = state;
    let ok = true;
    for (const c of plan) {
      const r = apply(s, c);
      // Rejected commands and bumping into walls change nothing; never count them as a plan.
      if (r.events.some((e) => e.type === 'rejected' || e.type === 'bumped')) {
        ok = false;
        break;
      }
      s = r.state;
    }
    if (!ok || s === state) continue;
    const q = s.players[0]!;
    // Damage dealt is worth a bit more than health kept, so it trades blows instead of dancing forever.
    const allyHp = (x: GameState) => x.allies.reduce((a, u) => a + u.hp, 0);
    // Summons are worth their health: a raised skeleton is a second fighter, not a wasted turn.
    let score =
      2 * q.hp +
      2.5 * (foeHp(state) - foeHp(s)) +
      5 * (state.enemies.length - s.enemies.length) +
      1.2 * (allyHp(s) - allyHp(state)) -
      0.3 * nearest(s);
    if (q.hp <= 0) score -= 100;
    if (s.combat.status === 'won') score += 50;
    if (!best || score > best.score) best = { plan, score };
  }
  return best?.plan[0] ?? { type: 'useAbility', playerId: id, abilityId: p.abilities[0]! };
}

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

/** Between fights: take the first reward (replacing the last slot when full), then walk to the first door. */
function runAction(rng: Rng, state: GameState, strategy: Strategy): Command | null {
  const run = state.run;
  const p = state.players[0]!;
  if (!run) return null;
  if (run.phase === 'reward') {
    const index = strategy === 'random' ? pick(rng, [null, ...run.offer.map((_, i) => i)]) : 0;
    const option = index === null ? null : run.offer[index];
    const full = option?.kind === 'ability' && p.abilities.length > ABILITY_SLOTS;
    return full
      ? { type: 'chooseReward', playerId: p.id, index, replace: ABILITY_SLOTS }
      : { type: 'chooseReward', playerId: p.id, index };
  }
  if (run.phase !== 'doors') return null;
  const offer = run.doors[0];
  const door = offer ? state.room.doors[offer.door] : undefined;
  if (!door) return null;
  const inside = { x: door.x + DIRS[door.dir]!.x, y: door.y + DIRS[door.dir]!.y };
  if (p.x === inside.x && p.y === inside.y)
    return face(p.id, p.dir, (door.dir + 2) % 4) ?? { type: 'move', playerId: p.id, dir: 'forward' };
  const step = firstStep(state, (x, y) => x === inside.x && y === inside.y);
  if (step < 0) return null;
  return face(p.id, p.dir, step) ?? { type: 'move', playerId: p.id, dir: 'forward' };
}

export interface RunResult {
  readonly seed: number;
  readonly result: 'won' | 'lost' | 'stuck';
  /** Room reached (ACT.rooms + 1 = the boss). */
  readonly depth: number;
  readonly turns: number;
  /** What the hero ended up with. */
  readonly build: {
    classes: string[];
    hybrid: string | null;
    modifiers: string[];
    items: string[];
    abilities: string[];
  };
}

/** Plays a whole act: fights with `strategy`, takes rewards, walks through doors. */
export function playRun(seed: number, classId: string, strategy: Strategy = 'greedy'): RunResult {
  const rng = createRng(`run/${seed}/${classId}`);
  let state = createGame(seed, { classId });
  // An impatient player: after 15 turns without anyone getting hurt, just go for the enemies.
  let calm = 0;
  let lastHp = -1;
  for (let commands = 0; commands < 4000; commands++) {
    const run = state.run!;
    if (run.phase === 'won' || run.phase === 'lost') break;
    const hp = state.enemies.reduce((a, e) => a + e.hp, 0) + state.players[0]!.hp;
    calm = hp === lastHp ? calm + 1 : 0;
    lastHp = hp;
    const between = runAction(rng, state, strategy);
    const act =
      strategy === 'careful' && calm < 15 ? carefulAction : strategy === 'random' ? randomAction : greedyAction;
    const cmd = between ?? act(rng, state);
    state = apply(state, cmd).state;
  }
  const run = state.run!;
  const result = run.phase === 'won' ? 'won' : run.phase === 'lost' ? 'lost' : 'stuck';
  const p = state.players[0]!;
  return {
    seed,
    result,
    depth: run.depth,
    turns: run.turns + state.combat.turn,
    build: { classes: p.classes, hybrid: p.hybrid, modifiers: p.modifiers, items: p.items, abilities: p.abilities },
  };
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
    const act = strategy === 'careful' ? carefulAction : strategy === 'greedy' ? greedyAction : randomAction;
    state = apply(state, act(rng, state)).state;
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
  for (const cls of CLASSES) {
    const runs = Array.from({ length: Math.min(count, 100) }, (_, i) => playRun(first + i, cls.id, 'careful'));
    const won = runs.filter((r) => r.result === 'won').length;
    const stuck = runs.filter((r) => r.result === 'stuck').length;
    const depth = runs.reduce((a, r) => a + r.depth, 0) / runs.length;
    const turns = runs.map((r) => r.turns).sort((a, b) => a - b);
    console.log(
      `run (careful) ${cls.id.padEnd(12)}: won ${won}/${runs.length}  stuck ${stuck}  avg room ${depth.toFixed(1)}  ` +
        `turns median ${turns[Math.floor(turns.length / 2)]}`,
    );
  }
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
