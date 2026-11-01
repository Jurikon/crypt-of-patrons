import type { CellType, Dir, Vec2 } from '../core/grid';
import type { CombatState, DoorOffer, Intent, RewardOption, RoomKind, Side } from './state';

/** Movement relative to where the player faces. */
export type MoveDir = 'forward' | 'back' | 'left' | 'right';
export type TurnDir = 'left' | 'right';
export type DebugAction = 'killAll' | 'heal' | 'toggleGod' | 'toBoss' | 'altarNext';

/** Serializable intents. Input produces these; only `apply` turns them into state changes. */
export type Command =
  | { readonly type: 'move'; readonly playerId: string; readonly dir: MoveDir }
  | { readonly type: 'turn'; readonly playerId: string; readonly dir: TurnDir }
  /** `target` is a cell; without it the ability picks its default target (the cell in front, the nearest unit…). */
  | { readonly type: 'useAbility'; readonly playerId: string; readonly abilityId: string; readonly target?: Vec2 }
  /** Debug cheats are commands too, so a bug report that used them still replays exactly. */
  | { readonly type: 'debug'; readonly playerId: string; readonly action: DebugAction }
  /** Debug: put any ability in slot 1..4 (slot 0 is the base attack). */
  | { readonly type: 'debugGrant'; readonly playerId: string; readonly abilityId: string; readonly slot: number }
  /** Debug: switch a modifier on or off. */
  | { readonly type: 'debugModifier'; readonly playerId: string; readonly modifierId: string }
  /** Debug: give or take away an item. */
  | { readonly type: 'debugItem'; readonly playerId: string; readonly itemId: string }
  /** Debug: give or take away a patron gift. */
  | { readonly type: 'debugGift'; readonly playerId: string; readonly giftId: string }
  /** Show other options on the reward screen (a Chapel reroll). */
  | { readonly type: 'reroll'; readonly playerId: string }
  /** Debug: jump to a room of an act (depth ACT.rooms + 1 is the boss). */
  | { readonly type: 'debugJump'; readonly playerId: string; readonly act: number; readonly depth: number }
  /** Debug: add a second class (as Initiation would). */
  | { readonly type: 'debugClass'; readonly playerId: string; readonly classId: string }
  /**
   * Take one of the offered rewards (`index`), or none (null). A new ability with every slot full needs
   * `replace`: the slot (1..4) it takes over.
   */
  | {
      readonly type: 'chooseReward';
      readonly playerId: string;
      readonly index: number | null;
      readonly replace?: number;
    };

export type RejectReason =
  | 'unknown_player'
  | 'unknown_command'
  | 'unknown_ability'
  | 'on_cooldown'
  | 'combat_over'
  | 'dead'
  | 'no_target'
  | 'invalid_target'
  | 'choose_reward'
  | 'no_reward'
  | 'slot_needed'
  | 'cannot_retreat';

/** What happened, in order, for the renderer and UI to animate. */
export type GameEvent =
  | { readonly type: 'moved'; readonly unitId: string; readonly from: Vec2; readonly to: Vec2 }
  | { readonly type: 'teleported'; readonly unitId: string; readonly from: Vec2; readonly to: Vec2 }
  | {
      readonly type: 'swapped';
      readonly unitId: string;
      readonly otherId: string;
      readonly from: Vec2;
      readonly to: Vec2;
    }
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
  /** An ally hit an adjacent enemy. */
  | { readonly type: 'allyAttack'; readonly unitId: string; readonly target: Vec2 }
  | { readonly type: 'enemyAttack'; readonly unitId: string; readonly intent: Intent; readonly cells: readonly Vec2[] }
  /** A projectile flew from `from` to `to` (the last cell it reached). */
  | { readonly type: 'projectile'; readonly unitId: string; readonly from: Vec2; readonly to: Vec2 }
  /** An area effect went off over these cells (explosions). */
  | { readonly type: 'area'; readonly center: Vec2; readonly cells: readonly Vec2[] }
  | {
      readonly type: 'damaged';
      readonly unitId: string;
      readonly amount: number;
      /** Taken by a shield instead. */
      readonly absorbed: number;
      readonly hp: number;
      readonly cause: 'attack' | 'collision' | 'effect';
      /** Doubled (or more) by a hit from behind. */
      readonly backstab: boolean;
    }
  | { readonly type: 'healed'; readonly unitId: string; readonly amount: number; readonly hp: number }
  | { readonly type: 'pushed'; readonly unitId: string; readonly from: Vec2; readonly to: Vec2 }
  /** A pushed unit stopped against a wall, pillar, door or another unit (`withId`). */
  | { readonly type: 'collided'; readonly unitId: string; readonly at: Vec2; readonly withId: string | null }
  | { readonly type: 'fell'; readonly unitId: string; readonly at: Vec2 }
  | { readonly type: 'died'; readonly unitId: string }
  | {
      readonly type: 'summoned';
      readonly unitId: string;
      /** Summon id (heroes) or enemy type (foes). */
      readonly summon: string;
      readonly side: Side;
      readonly owner: string;
      readonly at: Vec2;
      readonly dir: Dir;
      readonly hp: number;
    }
  | { readonly type: 'statusApplied'; readonly unitId: string; readonly status: string; readonly turns: number }
  | { readonly type: 'statusExpired'; readonly unitId: string; readonly status: string }
  /** A second wind: the hero stood back up instead of dying. */
  | { readonly type: 'revived'; readonly unitId: string; readonly hp: number }
  /** An enemy left when the room's goal was met (a survived siege, a broken totem). */
  | { readonly type: 'fled'; readonly unitId: string }
  /** The place marks cells it will strike next turn (light through the windows). */
  | { readonly type: 'omen'; readonly cells: readonly Vec2[] }
  /** A status did not take hold (the unit is immune). */
  | { readonly type: 'resisted'; readonly unitId: string; readonly status: string }
  /** A boss enters a new phase (1-based). */
  | { readonly type: 'phaseEntered'; readonly unitId: string; readonly phase: number }
  /** A new act begins. */
  | { readonly type: 'actEntered'; readonly act: number }
  | { readonly type: 'surfaceAdded'; readonly surface: string; readonly at: Vec2; readonly side: Side }
  | { readonly type: 'surfaceRemoved'; readonly surface: string; readonly at: Vec2 }
  /** A passive, modifier, status or surface reacted to something (for UI feedback). */
  | { readonly type: 'triggered'; readonly rule: string; readonly ownerId: string | null }
  | { readonly type: 'freeActionGained'; readonly unitId: string }
  /** This action was free: the world did not answer. */
  | { readonly type: 'freeActionUsed'; readonly unitId: string }
  /** A trigger chain went deeper than allowed and was cut (logged, not an error). */
  | { readonly type: 'chainLimit'; readonly depth: number }
  | { readonly type: 'intentDeclared'; readonly unitId: string; readonly intent: Intent }
  | { readonly type: 'intentCanceled'; readonly unitId: string }
  | { readonly type: 'phaseChanged'; readonly phase: CombatState['phase']; readonly turn: number }
  | { readonly type: 'combatEnded'; readonly status: 'won' | 'lost' }
  /** Walked through a door into the next room (the renderer rebuilds the scene). */
  | { readonly type: 'roomEntered'; readonly depth: number; readonly kind: RoomKind }
  | { readonly type: 'rewardOffered'; readonly options: readonly RewardOption[] }
  | { readonly type: 'rewardTaken'; readonly option: RewardOption | null }
  | { readonly type: 'doorsOpened'; readonly doors: readonly DoorOffer[] }
  | { readonly type: 'runEnded'; readonly result: 'won' | 'lost' }
  /** Two classes became a hybrid: announce it. */
  | { readonly type: 'hybridFormed'; readonly unitId: string; readonly hybrid: string }
  /** A blinded enemy's telegraphed attack went nowhere. */
  | { readonly type: 'missed'; readonly unitId: string }
  | {
      readonly type: 'debug';
      readonly action: DebugAction | 'grant' | 'modifier' | 'item' | 'class' | 'gift' | 'jump';
    }
  | { readonly type: 'rejected'; readonly reason: RejectReason };
