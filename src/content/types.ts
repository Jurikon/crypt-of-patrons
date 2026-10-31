/**
 * Content is data (CLAUDE.md rule 4). These types describe what the simulation can execute;
 * the simulation never branches on a specific content id.
 */

/** Effect primitives. M1 needs two; M2 grows this into the full event-driven engine. */
export type EffectSpec =
  { readonly kind: 'damage'; readonly amount: number } | { readonly kind: 'push'; readonly distance: number };

/** Where an ability lands. M1 abilities are all melee: the cell the user is facing. */
export type TargetSpec = { readonly kind: 'front' };

export interface AbilityDef {
  readonly id: string;
  /** i18n key of the display name; descriptions are generated from `effects`. */
  readonly nameKey: string;
  readonly tags: readonly string[];
  /** Turns it stays unavailable after use; 0 = every turn. Every ability use takes one turn. */
  readonly cooldown: number;
  readonly target: TargetSpec;
  readonly effects: readonly EffectSpec[];
}

/** Numeric stats that passives and (later) items add to. */
export type StatId = 'pushCollisionBonus';

export interface PassiveDef {
  readonly id: string;
  readonly nameKey: string;
  readonly stats: readonly { readonly stat: StatId; readonly add: number }[];
}

export interface ClassDef {
  readonly id: string;
  readonly nameKey: string;
  readonly maxHp: number;
  /** Base attack first, then the starting ability. */
  readonly abilities: readonly string[];
  readonly passives: readonly string[];
}

/** What an enemy telegraphs. Directions are relative to the enemy when it acts, so pushing it redirects the attack. */
export type AttackSpec =
  | { readonly kind: 'melee'; readonly damage: number }
  | { readonly kind: 'line'; readonly damage: number; readonly range: number };

export type EnemyBehavior =
  /** Walk next to the nearest player and strike. */
  | { readonly kind: 'melee' }
  /** Line up with a player at a distance inside [min, max] and shoot. */
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
