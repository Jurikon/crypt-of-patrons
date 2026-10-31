// Headless random-play bot. Plays whole fights through `apply` and reports how they ended.
// Run: pnpm bot [fights] [firstSeed]
import { createRng, int, pick, type Rng } from '../src/core/rng';
import { apply, createGame, type Command, type GameState } from '../src/sim';

export interface FightResult {
  readonly seed: number;
  readonly status: GameState['combat']['status'];
  readonly turns: number;
  readonly commands: number;
}

export const TURN_LIMIT = 300;

function randomAction(rng: Rng, state: GameState): Command {
  const p = state.players[0]!;
  const playerId = p.id;
  return pick<Command>(rng, [
    { type: 'move', playerId, dir: pick(rng, ['forward', 'back', 'left', 'right'] as const) },
    { type: 'turn', playerId, dir: pick(rng, ['left', 'right'] as const) },
    { type: 'useAbility', playerId, abilityId: pick(rng, p.abilities) },
    { type: 'useAbility', playerId, abilityId: p.abilities[0]! },
  ]);
}

/** Plays one fight with random actions (a few per turn, then end turn) until it ends or hits TURN_LIMIT. */
export function playFight(seed: number): FightResult {
  const rng = createRng(`bot/${seed}`);
  let state = createGame(seed);
  let commands = 0;
  while (state.combat.status === 'active' && state.combat.turn <= TURN_LIMIT) {
    const actions = int(rng, 0, 5);
    for (let i = 0; i < actions && state.combat.status === 'active'; i++) {
      state = apply(state, randomAction(rng, state)).state;
      commands++;
    }
    if (state.combat.status !== 'active') break;
    state = apply(state, { type: 'endTurn', playerId: state.players[0]!.id }).state;
    commands++;
  }
  return { seed, status: state.combat.status, turns: state.combat.turn, commands };
}

export function playFights(count: number, firstSeed = 1): FightResult[] {
  return Array.from({ length: count }, (_, i) => playFight(firstSeed + i));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const count = Number(process.argv[2] ?? 200);
  const first = Number(process.argv[3] ?? 1);
  const results = playFights(count, first);
  const by = (s: string) => results.filter((r) => r.status === s).length;
  const turns = results.map((r) => r.turns).sort((a, b) => a - b);
  console.log(`fights: ${count}  won: ${by('won')}  lost: ${by('lost')}  unfinished: ${by('active')}`);
  console.log(`turns: min ${turns[0]}  median ${turns[Math.floor(turns.length / 2)]}  max ${turns.at(-1)}`);
}
