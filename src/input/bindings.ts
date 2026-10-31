import type { Command } from '../sim';

/** Abstract actions. Keys map to actions, actions map to commands; touch input can reuse the same actions later. */
export type Action =
  | 'moveForward'
  | 'moveBack'
  | 'moveLeft'
  | 'moveRight'
  | 'turnLeft'
  | 'turnRight'
  | 'topView'
  | 'toggleDebug'
  | 'newSeed';

/** Keyed by KeyboardEvent.code, so bindings work on any keyboard layout (including Cyrillic). */
export type Bindings = Readonly<Record<string, Action>>;

export const DEFAULT_BINDINGS: Bindings = {
  KeyW: 'moveForward',
  ArrowUp: 'moveForward',
  KeyS: 'moveBack',
  ArrowDown: 'moveBack',
  KeyA: 'moveLeft',
  KeyD: 'moveRight',
  KeyQ: 'turnLeft',
  ArrowLeft: 'turnLeft',
  KeyE: 'turnRight',
  ArrowRight: 'turnRight',
  Tab: 'topView',
  Backquote: 'toggleDebug',
  KeyR: 'newSeed',
};

export function actionToCommand(action: Action, playerId: string): Command | null {
  switch (action) {
    case 'moveForward':
      return { type: 'move', playerId, dir: 'forward' };
    case 'moveBack':
      return { type: 'move', playerId, dir: 'back' };
    case 'moveLeft':
      return { type: 'move', playerId, dir: 'left' };
    case 'moveRight':
      return { type: 'move', playerId, dir: 'right' };
    case 'turnLeft':
      return { type: 'turn', playerId, dir: 'left' };
    case 'turnRight':
      return { type: 'turn', playerId, dir: 'right' };
    default:
      return null;
  }
}
