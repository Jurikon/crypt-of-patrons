import { createRng, fork, type Rng } from '../core/rng';
import type { Dir } from '../core/grid';
import { getClass } from '../content';
import { generateRoom, type Room } from './gen/room';
import { placeEncounter } from './encounter';
import { declareIntentsInPlace } from './ai';

export const STATE_VERSION = 3;

export interface Cooldown {
  readonly abilityId: string;
  turns: number;
}

interface UnitBase {
  readonly id: string;
  x: number;
  y: number;
  dir: Dir;
  hp: number;
  maxHp: number;
}

export interface Player extends UnitBase {
  readonly classId: string;
  /** Ability ids in slot order; the first is the base attack (also used by walking into an enemy). */
  abilities: string[];
  passives: string[];
  cooldowns: Cooldown[];
  /** Debug immortality. */
  god: boolean;
}

/** What an enemy will do at the start of the next enemy phase. Direction is fixed; position follows the enemy. */
export type Intent =
  | { readonly kind: 'melee'; readonly dir: Dir; readonly damage: number }
  | { readonly kind: 'line'; readonly dir: Dir; readonly damage: number; readonly range: number };

export interface Enemy extends UnitBase {
  readonly type: string;
  intent: Intent | null;
}

export type Unit = Player | Enemy;

/**
 * Turn structure: every player action that takes time (a step or an ability) is one turn, after which
 * the world answers at once (enemies now; dungeon hazards later). Turning and bumping take no time.
 */
export interface CombatState {
  turn: number;
  phase: 'player' | 'enemy';
  status: 'active' | 'won' | 'lost';
}

/** The whole game state. Plain JSON data; never holds functions, classes or DOM references. */
export interface GameState {
  readonly version: number;
  readonly seed: number;
  /** Combat/runtime RNG. Generation uses separate forks derived from `seed`. */
  rng: Rng;
  room: Room;
  /** Always an array, even in single player (CLAUDE.md rule 6). */
  players: Player[];
  /** In spawn order; that order is also the order enemies act in. */
  enemies: Enemy[];
  combat: CombatState;
}

export interface CreateGameOptions {
  readonly playerIds?: readonly string[];
  readonly classId?: string;
  /** Spawn an encounter (default true). Tests turn this off to build exact situations. */
  readonly enemies?: boolean;
}

export function createPlayer(id: string, classId: string, x: number, y: number, dir: Dir): Player {
  const cls = getClass(classId);
  return {
    id,
    classId,
    x,
    y,
    dir,
    hp: cls.maxHp,
    maxHp: cls.maxHp,
    abilities: [...cls.abilities],
    passives: [...cls.passives],
    cooldowns: [],
    god: false,
  };
}

export function createGame(seed: number, opts: CreateGameOptions = {}): GameState {
  const root = createRng(seed);
  const room = generateRoom(fork(root, 'room:0'));
  const classId = opts.classId ?? 'knight';
  const players = (opts.playerIds ?? ['p1']).map((id) =>
    createPlayer(id, classId, room.spawn.x, room.spawn.y, room.spawn.dir),
  );
  const state: GameState = {
    version: STATE_VERSION,
    seed,
    rng: fork(root, 'sim'),
    room,
    players,
    enemies: [],
    combat: { turn: 1, phase: 'player', status: 'active' },
  };
  if (opts.enemies !== false) {
    state.enemies = placeEncounter(fork(root, 'encounter'), state);
    declareIntentsInPlace(state);
  }
  if (state.enemies.length === 0) state.combat.status = 'won';
  return state;
}

export function findPlayer(state: GameState, id: string): Player | undefined {
  return state.players.find((p) => p.id === id);
}

export function isPlayer(state: GameState, unit: Unit): unit is Player {
  return state.players.includes(unit as Player);
}

export function unitAt(state: GameState, x: number, y: number): Unit | undefined {
  for (const p of state.players) if (p.hp > 0 && p.x === x && p.y === y) return p;
  for (const e of state.enemies) if (e.x === x && e.y === y) return e;
  return undefined;
}

export function unitById(state: GameState, id: string): Unit | undefined {
  return state.players.find((p) => p.id === id) ?? state.enemies.find((e) => e.id === id);
}
