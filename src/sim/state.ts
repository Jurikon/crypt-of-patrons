import { createRng, fork, type Rng } from '../core/rng';
import type { Dir, Vec2 } from '../core/grid';
import { BIOMES, getClass, type BiomeDef, type RewardKind, type UpgradeKind } from '../content';
import { generateRoom, type Room } from './gen/room';
import { placeCorpses, placeEncounter, placeFeatures } from './encounter';
import { declareIntentsInPlace } from './ai';

export const STATE_VERSION = 9;

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
  /** The class picked at the start of the run (its base attack stays). */
  readonly classId: string;
  /** Every class the hero has: the first one, then any taken through Initiation. */
  classes: string[];
  /** Hybrid formed by two of the classes (GDD idea of the owner), or null. */
  hybrid: string | null;
  /** Items (rules that change how you play), in the order they were found. */
  items: string[];
  /** Rules with a once-per-room trigger that already fired in this room. */
  ruleUses: string[];
  /** Rules with a once-per-turn trigger that already fired this turn. */
  turnUses: string[];
  /** Patron gifts and duo gifts, in the order they were taken. */
  gifts: string[];
  /** Ability ids in slot order; the first is the base attack (also used by walking into an enemy). */
  abilities: string[];
  passives: string[];
  /** Active modifiers (GDD 2), in the order they were gained. */
  modifiers: string[];
  cooldowns: Cooldown[];
  /** Actions the world will not answer (from "free action" effects). */
  freeActions: number;
  /** Ability upgrades collected in the run (each one counts). */
  upgrades: { readonly abilityId: string; readonly kind: UpgradeKind }[];
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
  | { readonly kind: 'line'; readonly dir: Dir; readonly damage: number; readonly range: number }
  | { readonly kind: 'sweep'; readonly dir: Dir; readonly damage: number }
  /** Every cell within `radius` of the enemy. */
  | { readonly kind: 'burst'; readonly dir: Dir; readonly damage: number; readonly radius: number }
  /** A square around where a hero stood when it was telegraphed. */
  | { readonly kind: 'blast'; readonly dir: Dir; readonly damage: number; readonly cells: readonly Vec2[] }
  /** Helps the enemy standing on the one cell (shield, healing). */
  | { readonly kind: 'aid'; readonly dir: Dir; readonly damage: 0; readonly cells: readonly Vec2[] }
  /** New enemies will rise on these cells. */
  | {
      readonly kind: 'summon';
      readonly dir: Dir;
      readonly damage: 0;
      readonly unit: string;
      readonly cells: readonly Vec2[];
    };

export interface Enemy extends UnitBase {
  readonly type: string;
  intent: Intent | null;
  /** Moved during the last enemy phase. Ranged enemies must then stand still for a turn. */
  moved: boolean;
  /** Elite: tougher, marked with a red glow. */
  elite: boolean;
  /** Strikes made so far; picks the next attack of a `pattern`. */
  strikes: number;
  /** Boss phase reached (0 = none yet). */
  phase: number;
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

export type RoomKind = 'combat' | 'elite' | 'rest' | 'boss';

/** A door's offer once the room is cleared: which door (index into `room.doors`) and what lies behind it. */
export interface DoorOffer {
  readonly door: number;
  readonly reward: RewardKind;
  /** Altars: whose. */
  readonly patron?: string;
}

/** One reward option on the pick-1-of-3 screen. */
export type RewardOption =
  | { readonly kind: 'ability'; readonly id: string }
  | { readonly kind: 'modifier'; readonly id: string }
  | { readonly kind: 'item'; readonly id: string }
  | { readonly kind: 'class'; readonly id: string }
  | { readonly kind: 'gift'; readonly id: string }
  | { readonly kind: 'upgrade'; readonly abilityId: string; readonly upgrade: UpgradeKind };

/** Run journal entries (for the results screen now, analytics later). */
export type RunLogEntry =
  | { readonly type: 'room'; readonly depth: number; readonly kind: RoomKind }
  | { readonly type: 'reward'; readonly depth: number; readonly option: RewardOption | null }
  | { readonly type: 'cleared'; readonly depth: number; readonly turns: number }
  | { readonly type: 'end'; readonly depth: number; readonly result: 'won' | 'lost' }
  | { readonly type: 'act'; readonly act: number };

/**
 * The run (GDD 1): an act of rooms joined by doors. Everything comes from the run seed, so seed +
 * commands replays a whole run.
 */
export interface RunState {
  /** Act (biome), 1-based. */
  act: number;
  /** Room number in the act, 1-based; ACT.rooms + 1 is the boss room. */
  depth: number;
  kind: RoomKind;
  /** fighting → (reward) → doors → next room; or the run is over. */
  phase: 'combat' | 'reward' | 'doors' | 'won' | 'lost';
  /** Reward for clearing the current room (from the door taken into it). */
  pending: RewardKind | null;
  /** For an altar room: whose altar. */
  patron: string | null;
  altars: number;
  /** Debug: the next doors include an altar. */
  forceAltar: boolean;
  /** The options on screen while choosing. */
  offer: RewardOption[];
  doors: DoorOffer[];
  elites: number;
  /** An Initiation door has been offered in this act. */
  initiation: boolean;
  treasures: number;
  /** Turns spent in finished rooms. */
  turns: number;
  log: RunLogEntry[];
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
  /** The run around this room; null for single test fights. */
  run: RunState | null;
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
    classes: [classId],
    hybrid: null,
    items: [],
    ruleUses: [],
    turnUses: [],
    gifts: [],
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
    upgrades: [],
    god: false,
  };
}

/** Starts a run: the first room of act 1 (or a lone fight without a run, for tests). */
export function createGame(seed: number, opts: CreateGameOptions = {}): GameState {
  const root = createRng(seed);
  const classId = opts.classId ?? 'knight';
  const state: GameState = {
    version: STATE_VERSION,
    seed,
    rng: fork(root, 'sim'),
    room: generateRoom(fork(root, 'room:0')),
    players: [],
    allies: [],
    enemies: [],
    surfaces: [],
    combat: { turn: 1, phase: 'player', status: 'active' },
    nextId: 1,
    run: {
      act: 1,
      depth: 1,
      kind: 'combat',
      phase: 'combat',
      pending: 'ability',
      patron: null,
      altars: 0,
      forceAltar: false,
      offer: [],
      doors: [],
      elites: 0,
      initiation: false,
      treasures: 0,
      turns: 0,
      log: [{ type: 'room', depth: 1, kind: 'combat' }],
    },
  };
  state.players = (opts.playerIds ?? ['p1']).map((id) =>
    createPlayer(id, classId, state.room.spawn.x, state.room.spawn.y, state.room.spawn.dir),
  );
  populateRoom(state, 1, 'combat', opts.enemies !== false);
  return state;
}

/**
 * RNG labels for a room. Act 1 keeps the labels it had before acts existed, and its first room the ones
 * from before runs existed (same seeds, same rooms).
 */
const label = (name: string, depth: number, act = 1) =>
  act > 1 ? `${name}:a${act}:${depth}` : depth === 1 ? name : `${name}:${depth}`;

/** The biome of an act (the crypt outside a run). */
export function biomeOf(state: GameState): BiomeDef {
  return BIOMES[(state.run?.act ?? 1) - 1] ?? (BIOMES[0] as BiomeDef);
}

/**
 * Fills the current room with its encounter, corpses and the biome's hazards (by depth and kind) and
 * starts the fight. Rest rooms are empty and start cleared.
 */
export function populateRoom(state: GameState, depth: number, kind: RoomKind, enemies = true): void {
  const root = createRng(state.seed);
  const act = state.run?.act ?? 1;
  state.allies = [];
  state.enemies = [];
  state.surfaces = [];
  state.combat = { turn: 1, phase: 'player', status: 'active' };
  if (enemies && kind !== 'rest') {
    state.enemies = placeEncounter(fork(root, label('encounter', depth, act)), state, depth, kind);
    state.surfaces = [
      ...placeCorpses(fork(root, label('corpses', depth, act)), state),
      ...placeFeatures(fork(root, label('features', depth, act)), state, biomeOf(state)),
    ];
    declareIntentsInPlace(state);
  }
  if (state.enemies.length === 0) state.combat.status = 'won';
}

/** Generates the room for a depth of an act, in its biome's style: the boss room is the biggest square. */
export function roomFor(seed: number, depth: number, kind: RoomKind, act = 1): Room {
  const rng = fork(createRng(seed), act > 1 ? `room:a${act}:${depth}` : depth === 1 ? 'room:0' : `room:${depth}`);
  const layout = BIOMES[act - 1]?.layout;
  const size = kind === 'boss' ? { minSize: 11, maxSize: 11 } : {};
  return generateRoom(rng, layout ? { ...size, layout } : size);
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
  // Enemies carry an intent field, so one that just died (and left the list) is still a foe.
  return isEnemy(state, unit) || 'intent' in unit ? 'foes' : 'heroes';
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
