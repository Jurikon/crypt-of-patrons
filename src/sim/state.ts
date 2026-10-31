import { createRng, fork, type Rng } from '../core/rng';
import type { Dir } from '../core/grid';
import { generateRoom, type Room } from './gen/room';

export const STATE_VERSION = 1;

export interface Player {
  readonly id: string;
  x: number;
  y: number;
  dir: Dir;
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
}

export function createGame(seed: number, playerIds: readonly string[] = ['p1']): GameState {
  const root = createRng(seed);
  const room = generateRoom(fork(root, 'room:0'));
  const players: Player[] = playerIds.map((id) => ({ id, x: room.spawn.x, y: room.spawn.y, dir: room.spawn.dir }));
  return {
    version: STATE_VERSION,
    seed,
    rng: fork(root, 'sim'),
    room,
    players,
  };
}

export function findPlayer(state: GameState, id: string): Player | undefined {
  return state.players.find((p) => p.id === id);
}
