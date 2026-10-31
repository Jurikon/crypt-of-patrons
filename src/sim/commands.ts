import type { CellType, Dir, Vec2 } from '../core/grid';

/** Movement relative to where the player faces. */
export type MoveDir = 'forward' | 'back' | 'left' | 'right';
export type TurnDir = 'left' | 'right';

/** Serializable intents. Input produces these; only `apply` turns them into state changes. */
export type Command =
  | { readonly type: 'move'; readonly playerId: string; readonly dir: MoveDir }
  | { readonly type: 'turn'; readonly playerId: string; readonly dir: TurnDir };

/** What happened, for the renderer and UI to animate. */
export type GameEvent =
  | { readonly type: 'moved'; readonly playerId: string; readonly from: Vec2; readonly to: Vec2 }
  | { readonly type: 'turned'; readonly playerId: string; readonly from: Dir; readonly to: Dir }
  | {
      readonly type: 'bumped';
      readonly playerId: string;
      /** The cell the player tried to enter. */
      readonly at: Vec2;
      readonly cell: CellType;
    }
  | { readonly type: 'rejected'; readonly reason: 'unknown_player' | 'unknown_command' };
