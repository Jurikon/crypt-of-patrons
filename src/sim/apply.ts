import { dirVec, getCell, isWalkable, rotateDir } from '../core/grid';
import type { Command, GameEvent, MoveDir } from './commands';
import type { GameState } from './state';

export interface ApplyResult {
  readonly state: GameState;
  readonly events: readonly GameEvent[];
}

const MOVE_ROTATION: Record<MoveDir, number> = { forward: 0, right: 1, back: 2, left: 3 };

/**
 * The only way game state changes (CLAUDE.md rule 3).
 * Pure: the input state is never modified; a new state is returned with the events produced.
 */
export function apply(prev: GameState, command: Command): ApplyResult {
  const state = structuredClone(prev);
  const events: GameEvent[] = [];
  const player = state.players.find((p) => p.id === command.playerId);
  if (!player) {
    return { state: prev, events: [{ type: 'rejected', reason: 'unknown_player' }] };
  }

  switch (command.type) {
    case 'turn': {
      const from = player.dir;
      player.dir = rotateDir(from, command.dir === 'right' ? 1 : -1);
      events.push({ type: 'turned', playerId: player.id, from, to: player.dir });
      break;
    }
    case 'move': {
      const step = dirVec(rotateDir(player.dir, MOVE_ROTATION[command.dir]));
      const from = { x: player.x, y: player.y };
      const to = { x: player.x + step.x, y: player.y + step.y };
      const cell = getCell(state.room.grid, to.x, to.y);
      const occupied = state.players.some((p) => p !== player && p.x === to.x && p.y === to.y);
      if (isWalkable(cell) && !occupied) {
        player.x = to.x;
        player.y = to.y;
        events.push({ type: 'moved', playerId: player.id, from, to });
      } else {
        events.push({ type: 'bumped', playerId: player.id, at: to, cell });
      }
      break;
    }
    default: {
      const _exhaustive: never = command;
      return { state: prev, events: [{ type: 'rejected', reason: 'unknown_command' }] };
    }
  }
  return { state, events };
}

/** Replays a command list from a fresh state. Used by tests and by bug reports (seed + commands). */
export function replay(initial: GameState, commands: readonly Command[]): GameState {
  let state = initial;
  for (const c of commands) state = apply(state, c).state;
  return state;
}
