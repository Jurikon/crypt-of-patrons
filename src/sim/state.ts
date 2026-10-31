import { createRng, fork, type Rng } from '../core/rng';
import type { Dir, Vec2 } from '../core/grid';
import { getClass } from '../content';
import { generateRoom, type Room } from './gen/room';
import { placeCorpses, placeEncounter } from './encounter';
import { declareIntentsInPlace } from './ai';

export const STATE_VERSION = 5;

export interface Cooldown {
  readonly abilityId: string;
  turns: number;
}

/** A status on a unit (bleeding, stunned, shielded…). Turns tick down at the end of each world turn. */
export interface StatusInstance {
  readonly id: string;
  turns: number;
  /** Size, for statuses that have one (shield points). */
  amount: number;
  /** Who applied it (a taunted enemy targets this unit). */
  readonly sourceId: string | null;
}

interface UnitBase {
  readonly id: string;
  x: number;
  y: number;
  dir: Dir;
  hp: number;
  maxHp: number;
  statuses: StatusInstance[];
}

export interface Player extends UnitBase {
  readonly classId: string;
  /** Ability ids in slot order; the first is the base attack (also used by walking into an enemy). */
  abilities: string[];
  passives: string[];
  /** Active modifiers (GDD 2), in the order they were gained. */
  modifiers: string[];
  cooldowns: Cooldown[];
  /** Actions the world will not answer (from "free action" effects). */
  freeActions: number;
  /** Debug immortality. */
  god: boolean;
}

/** A unit fighting on the players' side (a raised skeleton). Allies act right after the players. */
export interface Ally extends UnitBase {
  readonly type: string;
  /** The player who summoned it. */
  readonly owner: string;
}

/** What an enemy will do at the start of the next enemy phase. Direction is fixed; position follows the enemy. */
export type Intent =
  | { readonly kind: 'melee'; readonly dir: Dir; readonly damage: number }
  | { readonly kind: 'line'; readonly dir: Dir; readonly damage: number; readonly range: number };

export interface Enemy extends UnitBase {
  readonly type: string;
  intent: Intent | null;
  /** Moved during the last enemy phase. Ranged enemies must then stand still for a turn. */
  moved: boolean;
}

export type Unit = Player | Ally | Enemy;

/** Players and their allies are heroes; corpses lying around belong to nobody. */
export type Side = 'heroes' | 'foes' | 'neutral';

/** Something lying on a floor cell: a corpse, a trap. One of each kind per cell. */
export interface Surface {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  /** Turns left; null = until used. */
  turns: number | null;
  readonly side: Side;
}

/**
 * Turn structure: every player action that takes time (a step or an ability) is one turn, after which
 * the world answers at once: allies act, enemies strike and move, statuses tick.
 * Turning and bumping take no time.
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
  /** In summon order; that order is also the order allies act in. */
  allies: Ally[];
  /** In spawn order; that order is also the order enemies act in. */
  enemies: Enemy[];
  surfaces: Surface[];
  combat: CombatState;
  /** Counter for ids of units created during play (summons). */
  nextId: number;
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
    statuses: [],
    abilities: [...cls.abilities],
    passives: [...cls.passives],
    modifiers: [],
    cooldowns: [],
    freeActions: 0,
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
    allies: [],
    enemies: [],
    surfaces: [],
    combat: { turn: 1, phase: 'player', status: 'active' },
    nextId: 1,
  };
  if (opts.enemies !== false) {
    state.enemies = placeEncounter(fork(root, 'encounter'), state);
    state.surfaces = placeCorpses(fork(root, 'corpses'), state);
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

export function isAlly(state: GameState, unit: Unit): unit is Ally {
  return state.allies.includes(unit as Ally);
}

export function isEnemy(state: GameState, unit: Unit): unit is Enemy {
  return state.enemies.includes(unit as Enemy);
}

export function sideOf(state: GameState, unit: Unit): Side {
  return isEnemy(state, unit) ? 'foes' : 'heroes';
}

/** Living units in acting order: players, allies, enemies. */
export function allUnits(state: GameState): Unit[] {
  return [...state.players.filter((p) => p.hp > 0), ...state.allies, ...state.enemies];
}

export function unitAt(state: GameState, x: number, y: number): Unit | undefined {
  for (const p of state.players) if (p.hp > 0 && p.x === x && p.y === y) return p;
  for (const a of state.allies) if (a.x === x && a.y === y) return a;
  for (const e of state.enemies) if (e.x === x && e.y === y) return e;
  return undefined;
}

export function unitById(state: GameState, id: string): Unit | undefined {
  return (
    state.players.find((p) => p.id === id) ??
    state.allies.find((a) => a.id === id) ??
    state.enemies.find((e) => e.id === id)
  );
}

export function surfaceAt(state: GameState, cell: Vec2, id: string): Surface | undefined {
  return state.surfaces.find((s) => s.id === id && s.x === cell.x && s.y === cell.y);
}

export function hasStatus(unit: Unit, id: string): boolean {
  return unit.statuses.some((s) => s.id === id);
}
