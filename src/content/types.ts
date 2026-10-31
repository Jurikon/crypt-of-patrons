/**
 * Content is data (CLAUDE.md rule 4). These types describe what the simulation can execute;
 * the simulation never branches on a specific content id. New content that does not fit gets a new
 * general primitive here, not a special case in the engine.
 */

/** Action tags (GDD 2). Abilities carry them; events inherit the tags of the action that caused them. */
export type Tag = 'melee' | 'projectile' | 'area' | 'movement' | 'push' | 'summon' | 'curse' | 'defense';

/** Which units a group selection keeps, relative to the acting unit's side. */
export type UnitFilter =
  | 'any'
  | 'foes'
  | 'allies'
  /** Everyone except the players on the acting side: explosions hurt enemies and summons, never you. */
  | 'notAlliedPlayers';

/** Who an effect lands on. In a trigger, `self` is the rule's owner. */
export type UnitSelector =
  /** The unit on the target cell. */
  | { readonly kind: 'target' }
  | { readonly kind: 'self' }
  /** Triggers: the unit the event happened to (the one hit, killed, moved…). */
  | { readonly kind: 'subject' }
  /** Triggers: the unit that caused the event. */
  | { readonly kind: 'actor' }
  /** Every unit within `radius` steps (Manhattan) of a centre; the centre's own unit only with `includeCenter`. */
  | {
      readonly kind: 'around';
      readonly center: 'target' | 'self' | 'subject';
      readonly radius: number;
      readonly filter: UnitFilter;
      readonly includeCenter?: boolean;
    };

/** A cell an effect works on. `from` is where a moving unit left (triggers on `moved`). */
export type CellSelector = 'target' | 'self' | 'subject' | 'from';

/** Effect primitives. Every ability, status, surface and modifier is built from these. */
export type EffectSpec =
  | { readonly kind: 'damage'; readonly amount: number; readonly to?: UnitSelector }
  /** Pushes away from the action (or away from the centre of an `around` selection). */
  | { readonly kind: 'push'; readonly distance: number; readonly to?: UnitSelector }
  /** Moves the acting unit to the free cell behind the target unit, facing it. */
  | { readonly kind: 'teleportBehind' }
  /** The acting unit and the target unit trade places. */
  | { readonly kind: 'swap' }
  /** The acting unit runs forward until blocked; `onImpact` hits the unit that stopped it. */
  | { readonly kind: 'dash'; readonly distance: number; readonly onImpact: readonly EffectSpec[] }
  /** Flies from the acting unit along the action's direction and hits the first unit (or more, with pierce). */
  | { readonly kind: 'projectile'; readonly range: number; readonly onHit: readonly EffectSpec[] }
  | {
      readonly kind: 'status';
      readonly status: string;
      readonly turns: number;
      /** For statuses with a size (shield points). */
      readonly amount?: number;
      readonly to?: UnitSelector;
    }
  | { readonly kind: 'surface'; readonly surface: string; readonly at: CellSelector; readonly turns?: number }
  /** Removes a surface from a cell (e.g. a used trap or a corpse turned into a skeleton). */
  | { readonly kind: 'clearSurface'; readonly surface: string; readonly at: CellSelector }
  | { readonly kind: 'summon'; readonly unit: string; readonly at: CellSelector; readonly consumes?: string }
  | { readonly kind: 'heal'; readonly amount: number; readonly to?: UnitSelector }
  /** Shield points on a unit: a `shield`-flagged status with an amount. */
  | { readonly kind: 'shield'; readonly amount: number; readonly turns: number; readonly to?: UnitSelector }
  /** The owner's next action does not let the world answer. */
  | { readonly kind: 'freeAction' }
  | { readonly kind: 'kill'; readonly to?: UnitSelector };

/** Where an ability can be aimed. */
export type TargetSpec =
  /** The cell in front. */
  | { readonly kind: 'front' }
  /** No target: the ability works around the user. */
  | { readonly kind: 'self' }
  /** A cell on one of the four straight lines from the user, up to `range`, not past walls. Sets the direction. */
  | { readonly kind: 'line'; readonly range: number }
  /** A unit within `range` steps. */
  | {
      readonly kind: 'unit';
      readonly range: number;
      readonly filter: 'foes' | 'ownSummons' | 'any';
      /** Needs a clear line of sight (walls, pillars and doors block it). */
      readonly sight: boolean;
      /** Needs a free floor cell behind the unit (for teleports behind it). */
      readonly freeBehind?: boolean;
    }
  /** An empty floor cell within `range` steps, optionally one with a given surface. */
  | { readonly kind: 'cell'; readonly range: number; readonly surface?: string };

export interface AbilityDef {
  readonly id: string;
  /** i18n key of the display name; descriptions are generated from the data. */
  readonly nameKey: string;
  readonly tags: readonly Tag[];
  /** Turns it stays unavailable after use; 0 = every turn. Every ability use takes one turn. */
  readonly cooldown: number;
  readonly target: TargetSpec;
  readonly effects: readonly EffectSpec[];
}

/** Numbers that rules and statuses add to. */
export type StatId =
  /** Extra damage when a pushed unit hits something. */
  | 'pushCollisionBonus'
  /** Extra cells on every push. */
  | 'pushDistance'
  /** Extra units a projectile flies through. */
  | 'projectilePierce'
  /** Damage multiplier for hits from behind (added to 1). */
  | 'backstab'
  /** Extra damage this unit takes from every hit. */
  | 'damageTaken';

export interface StatMod {
  readonly stat: StatId;
  readonly add: number;
}

/** Engine events rules can react to (GDD 2). */
export type TriggerOn =
  'hit' | 'kill' | 'damaged' | 'moved' | 'enterCell' | 'turnStart' | 'turnEnd' | 'death' | 'summon';

/** How a unit in an event relates to the owner of the rule that listens. */
export type Relation = 'owner' | 'ownerSide' | 'ownSummon' | 'foe' | 'any';

/** "When [event] with [tags], do [effects]" (GDD 2). Never names a specific ability. */
export interface TriggerDef {
  readonly on: TriggerOn;
  readonly actor?: Relation;
  readonly subject?: Relation;
  /** All of these tags must be on the action behind the event. */
  readonly tags?: readonly Tag[];
  /** The subject had this status when the event happened. */
  readonly subjectStatus?: string;
  readonly effects: readonly EffectSpec[];
}

/** Passives, modifiers (and later items and gifts): stat changes plus triggers. */
export interface RuleDef {
  readonly id: string;
  readonly nameKey: string;
  readonly stats: readonly StatMod[];
  readonly triggers: readonly TriggerDef[];
}

export interface StatusDef {
  readonly id: string;
  readonly nameKey: string;
  /** Short symbol drawn over the unit. */
  readonly icon: string;
  /** Stats the holder gets while it lasts. */
  readonly stats: readonly StatMod[];
  /** Triggers owned by the holder (e.g. damage at the end of each turn). */
  readonly triggers: readonly TriggerDef[];
  /** Absorbs damage up to its amount. */
  readonly shield?: boolean;
  /** The holder skips its actions and loses its telegraphed attack. */
  readonly stun?: boolean;
  /** The holder targets whoever applied it. */
  readonly taunt?: boolean;
}

export interface SurfaceDef {
  readonly id: string;
  readonly nameKey: string;
  /** Triggers owned by the side that made the surface; `subject` is the unit on the cell. */
  readonly triggers: readonly TriggerDef[];
  /** Removed after its first trigger fires. */
  readonly singleUse?: boolean;
}

/** A unit a player can call up (skeletons). Allies act right after the players. */
export interface SummonDef {
  readonly id: string;
  readonly nameKey: string;
  readonly maxHp: number;
  readonly damage: number;
  /** Which voxel model the renderer draws. */
  readonly model: string;
  readonly tags: readonly Tag[];
}

export interface ClassDef {
  readonly id: string;
  readonly nameKey: string;
  readonly maxHp: number;
  /** Base attack first, then the starting ability. */
  readonly abilities: readonly string[];
  readonly passives: readonly string[];
  /** More abilities of this class (rewards in M4; the debug menu in M2). */
  readonly pool: readonly string[];
}

/** What an enemy telegraphs. Directions are relative to the enemy when it acts, so pushing it redirects the attack. */
export type AttackSpec =
  | { readonly kind: 'melee'; readonly damage: number }
  | { readonly kind: 'line'; readonly damage: number; readonly range: number };

export type EnemyBehavior =
  /** Walk next to the nearest target and strike. */
  | { readonly kind: 'melee' }
  /** Line up with a target at a distance inside [min, max] and shoot. */
  | { readonly kind: 'ranged'; readonly minRange: number; readonly maxRange: number };

export interface EnemyDef {
  readonly id: string;
  readonly nameKey: string;
  readonly maxHp: number;
  readonly move: number;
  readonly attack: AttackSpec;
  readonly behavior: EnemyBehavior;
  /** Which voxel model the renderer draws. */
  readonly model: string;
  /** Relative spawn frequency in encounters. */
  readonly weight: number;
}
