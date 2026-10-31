import type { CellType, Dir, Vec2 } from '../core/grid';
import type { CombatState, Intent } from './state';

/** Movement relative to where the player faces. */
export type MoveDir = 'forward' | 'back' | 'left' | 'right';
export type TurnDir = 'left' | 'right';
export type DebugAction = 'killAll' | 'heal' | 'toggleGod';

/** Serializable intents. Input produces these; only `apply` turns them into state changes. */
export type Command =
  | { readonly type: 'move'; readonly playerId: string; readonly dir: MoveDir }
  | { readonly type: 'turn'; readonly playerId: string; readonly dir: TurnDir }
  | { readonly type: 'useAbility'; readonly playerId: string; readonly abilityId: string }
  | { readonly type: 'endTurn'; readonly playerId: string }
  /** Debug cheats are commands too, so a bug report that used them still replays exactly. */
  | { readonly type: 'debug'; readonly playerId: string; readonly action: DebugAction };

export type RejectReason =
  'unknown_player' | 'unknown_command' | 'unknown_ability' | 'not_enough_ap' | 'on_cooldown' | 'combat_over' | 'dead';

/** What happened, in order, for the renderer and UI to animate. */
export type GameEvent =
  | { readonly type: 'moved'; readonly unitId: string; readonly from: Vec2; readonly to: Vec2 }
  | { readonly type: 'turned'; readonly unitId: string; readonly from: Dir; readonly to: Dir }
  | {
      readonly type: 'bumped';
      readonly unitId: string;
      /** The cell the unit tried to enter. */
      readonly at: Vec2;
      readonly cell: CellType;
    }
  | {
      readonly type: 'abilityUsed';
      readonly unitId: string;
      readonly abilityId: string;
      readonly target: Vec2;
      readonly dir: Dir;
    }
  | { readonly type: 'enemyAttack'; readonly unitId: string; readonly intent: Intent; readonly cells: readonly Vec2[] }
  | {
      readonly type: 'damaged';
      readonly unitId: string;
      readonly amount: number;
      readonly hp: number;
      readonly cause: 'attack' | 'collision';
    }
  | { readonly type: 'pushed'; readonly unitId: string; readonly from: Vec2; readonly to: Vec2 }
  /** A pushed unit stopped against a wall, pillar, door or another unit (`withId`). */
  | { readonly type: 'collided'; readonly unitId: string; readonly at: Vec2; readonly withId: string | null }
  | { readonly type: 'fell'; readonly unitId: string; readonly at: Vec2 }
  | { readonly type: 'died'; readonly unitId: string }
  | { readonly type: 'intentDeclared'; readonly unitId: string; readonly intent: Intent }
  | { readonly type: 'phaseChanged'; readonly phase: CombatState['phase']; readonly turn: number }
  | { readonly type: 'combatEnded'; readonly status: 'won' | 'lost' }
  | { readonly type: 'debug'; readonly action: DebugAction }
  | { readonly type: 'rejected'; readonly reason: RejectReason };
