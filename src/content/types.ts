/**
 * Content is data (CLAUDE.md rule 4). These types describe what the simulation can execute;
 * the simulation never branches on a specific content id. New content that does not fit gets a new
 * general primitive here, not a special case in the engine.
 */

/** Action tags (GDD 2). Abilities carry them; events inherit the tags of the action that caused them. */
export type Tag =
  | 'melee'
  | 'projectile'
  | 'area'
  | 'movement'
  | 'push'
  | 'summon'
  | 'curse'
  | 'defense'
  /** The hero's base attack (slot 1), whatever ability it is. */
  | 'basic'
  /** Damage from lightning (patron gifts). */
  | 'lightning'
  /** Damage from fire (patron gifts). */
  | 'fire';

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
      /** Count distance as a square (3×3 for radius 1) instead of steps. */
      readonly square?: boolean;
    }
  /** Everyone on the cell in front of the actor and the two cells beside it (a sweeping blow). */
  | { readonly kind: 'frontRow' }
  /** The nearest units to a centre (not on it) that pass the filter: one, or `count`. */
  | {
      readonly kind: 'nearest';
      readonly center: 'target' | 'self' | 'subject';
      readonly filter: UnitFilter;
      readonly count?: number;
    }
  /** The unit right behind the subject (triggers) or the target, seen from the actor: a blow that goes through. */
  | { readonly kind: 'beyond' };

/**
 * A cell an effect works on. `from` is where a moving unit left (triggers on `moved`, `pushed`).
 * The object form finds the nearest free floor cell around a point, optionally one with a surface.
 */
export type CellSelector =
  | 'target'
  | 'self'
  | 'subject'
  | 'from'
  | { readonly near: 'target' | 'self' | 'subject'; readonly radius: number; readonly surface?: readonly string[] };

/** Effect primitives. Every ability, status, surface and modifier is built from these. */
export type EffectSpec =
  | {
      readonly kind: 'damage';
      readonly amount: number;
      readonly to?: UnitSelector;
      /** Adds the amount of this status on the damaged unit (stacking poison). */
      readonly fromStatus?: string;
    }
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
  | {
      readonly kind: 'surface';
      readonly surface: string;
      readonly at: CellSelector;
      readonly turns?: number;
      /** Covers the square of this radius around the cell (1 = 3×3). */
      readonly radius?: number;
    }
  /** Removes a surface from a cell (e.g. a used trap or a corpse turned into a skeleton). */
  | { readonly kind: 'clearSurface'; readonly surface: string; readonly at: CellSelector }
  | {
      readonly kind: 'summon';
      readonly unit: string;
      /** One cell, or the row of three cells in front of the summoner. */
      readonly at: CellSelector | 'frontRow';
      /** The cell must hold one of these surfaces, which is used up. */
      readonly consumes?: readonly string[];
    }
  | { readonly kind: 'removeStatus'; readonly status: string; readonly to?: UnitSelector }
  /** Copies the harmful statuses the subject had (triggers) onto the selected units. */
  | { readonly kind: 'spreadStatuses'; readonly to: UnitSelector }
  /** Shifts every cooldown of the owner by `delta` turns (negative = sooner). */
  | { readonly kind: 'cooldowns'; readonly delta: number }
  /** Changes the owner's maximum health (and keeps health within it). */
  | { readonly kind: 'maxHp'; readonly add?: number; readonly set?: number }
  | { readonly kind: 'heal'; readonly amount: number; readonly to?: UnitSelector }
  /** Shield points on a unit: a `shield`-flagged status with an amount. */
  | { readonly kind: 'shield'; readonly amount: number; readonly turns: number; readonly to?: UnitSelector }
  /** The owner's next action does not let the world answer. */
  | { readonly kind: 'freeAction' }
  | { readonly kind: 'kill'; readonly to?: UnitSelector }
  /** Drags units towards the acting unit, up to `distance` cells; stops short of anything in the way. */
  | { readonly kind: 'pull'; readonly distance: number; readonly to?: UnitSelector }
  /** Uses up the nearest `surface` within `radius` of the owner, then runs `effects` (a ghoul eats a corpse). */
  | {
      readonly kind: 'consume';
      readonly surface: string;
      readonly radius: number;
      readonly effects: readonly EffectSpec[];
    }
  /** The owner turns to face whoever caused the event. */
  | { readonly kind: 'faceActor' }
  /** Spreads a surface over `count` free floor cells away from the heroes, picked by the seed. */
  | { readonly kind: 'scatterSurface'; readonly surface: string; readonly count: number; readonly turns?: number };

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
  | { readonly kind: 'cell'; readonly range: number; readonly surface?: readonly string[] };

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
  | 'damageTaken'
  /** Extra cells of range for projectiles. */
  | 'projectileRange'
  /** Extra damage on every attack this unit makes. */
  | 'damageDealt'
  /** Damage multiplier on attacks (added to 1). */
  | 'damageFactor'
  /** Cannot step backwards. */
  | 'noRetreat'
  /** Abilities have no cooldown but each use costs this much health. */
  | 'bloodPrice'
  /** Extra units on every summon. */
  | 'extraSummons'
  /** Summons strike with their owner's base attack instead of their own blow. */
  | 'summonsUseBaseAttack'
  /** Extra damage dealt by summons standing next to their owner. */
  | 'auraDamage'
  /** Extra copies of every upgrade reward. */
  | 'upgradeBonus'
  /** Extra strength on every stacking status this unit applies (poison). */
  | 'stackBonus'
  /** Extra health for every summon. */
  | 'summonHp';

export interface StatMod {
  readonly stat: StatId;
  readonly add: number;
}

/** Engine events rules can react to (GDD 2). */
export type TriggerOn =
  | 'hit'
  | 'kill'
  | 'damaged'
  | 'moved'
  | 'enterCell'
  | 'turnStart'
  | 'turnEnd'
  | 'death'
  | 'summon'
  /** A unit was pushed (once per push; `from` is where it started). */
  | 'pushed'
  /** A pushed unit hit a wall, pillar, door or another unit. */
  | 'collide'
  /** The fight in a room begins. */
  | 'roomStart';

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
  /** The subject was at most this many steps from the owner. */
  readonly near?: number;
  /** The owner's health was at most this. */
  readonly ownerHpAtMost?: number;
  /** Only the first time in each room. */
  readonly oncePerRoom?: boolean;
  /** Only hits from behind. */
  readonly backstab?: boolean;
  /** Only once per turn. */
  readonly oncePerTurn?: boolean;
  /** Fires only on every n-th matching event (every third blow); counted per rule over the run. */
  readonly every?: number;
  /** The owner holds at least this much of a status (counters built from stacking statuses). */
  readonly ownerStatusAtLeast?: { readonly status: string; readonly amount: number };
  /** The subject stood on this surface. */
  readonly subjectSurface?: string;
  /** Tags the effects carry (lightning, fire), so other rules can react to them. */
  readonly effectTags?: readonly Tag[];
  readonly effects: readonly EffectSpec[];
}

/** Passives, modifiers, items, hybrid features (and later gifts): stat changes plus triggers. */
export interface RuleDef {
  readonly id: string;
  readonly nameKey: string;
  readonly stats: readonly StatMod[];
  readonly triggers: readonly TriggerDef[];
  /** Effects run once when the rule is gained (an item that lowers your maximum health). */
  readonly onGain?: readonly EffectSpec[];
  /** Items: drawn in the build panel. */
  readonly icon?: string;
  /** Items: a strong upside with a real downside. */
  readonly cursed?: boolean;
  /** Only offered when the hero has (or can still get) an ability with one of these tags. */
  readonly requires?: readonly Tag[];
  /** Only offered when the hero has some way to put this status on enemies. */
  readonly requiresStatus?: string;
  /** Only offered when the hero has some way to make this surface. */
  readonly requiresSurface?: string;
  /** Patron gifts: whose gift it is. */
  readonly patron?: string;
  /** Duo gifts: the two patrons whose gifts unlock it. */
  readonly patrons?: readonly [string, string];
}

/** A patron of the dark pantheon (GDD 2): colour, sign, a line of voice, and their gifts. */
export interface PatronDef {
  readonly id: string;
  readonly nameKey: string;
  /** Altar and card colour. */
  readonly color: number;
  readonly icon: string;
  /** Said when one of their gifts is taken. */
  readonly voiceKey: string;
  readonly gifts: readonly string[];
}

/** Two classes together become a hybrid with its own name and feature (an idea of the owner, M4). */
export interface HybridDef {
  readonly id: string;
  readonly nameKey: string;
  readonly classes: readonly [string, string];
  readonly rule: RuleDef;
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
  /** Applying it again adds to its amount instead of keeping the larger. */
  readonly stacks?: boolean;
  /** The holder neither moves nor turns (its telegraphed blow still lands). */
  readonly rooted?: boolean;
  /** The holder's attacks miss. */
  readonly blind?: boolean;
  /** Projectiles coming at the holder from the front do nothing. */
  readonly frontGuard?: boolean;
  /** When the holder dies, the status moves to the nearest unit on the holder's side. */
  readonly jumps?: boolean;
  /** Effects run on the holder when the status runs out. */
  readonly onExpire?: readonly EffectSpec[];
  /** Harmful: it spreads with spreading effects. */
  readonly debuff?: boolean;
}

export interface SurfaceDef {
  readonly id: string;
  readonly nameKey: string;
  /** Triggers owned by the side that made the surface; `subject` is the unit on the cell. */
  readonly triggers: readonly TriggerDef[];
  /** Removed after its first trigger fires. */
  readonly singleUse?: boolean;
  /** Damage with this tag to a unit standing here also hits every other unit on the same connected patch. */
  readonly conducts?: Tag;
  /** What happens when another surface lands on this one: both go, `result` (if any) takes the cell. */
  readonly reactions?: readonly { readonly with: string; readonly result: string | null }[];
  /** Enemies walk around it when they can. */
  readonly hazard?: boolean;
  /** A current: at the end of every turn, whoever stands here is pushed one cell this way (0 = north). */
  readonly flow?: 0 | 1 | 2 | 3;
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
  /** Does not act (walls, decoys): it only takes up space and draws attacks. */
  readonly inert?: boolean;
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

/** Extras any damaging enemy attack can have. */
interface AttackExtras {
  /** Run on every unit the attack hits (bleeding, stun, a hook that pulls). */
  readonly onHit?: readonly EffectSpec[];
  /** Left on every cell the attack covers (a flood of water, holy fire). */
  readonly surface?: { readonly id: string; readonly turns?: number };
}

/** What an enemy telegraphs. Directions are relative to the enemy when it acts, so pushing it redirects the attack. */
export type AttackSpec =
  | ({ readonly kind: 'melee'; readonly damage: number } & AttackExtras)
  | ({ readonly kind: 'line'; readonly damage: number; readonly range: number } & AttackExtras)
  /** The cell in front and the two beside it, everyone in them. */
  | ({ readonly kind: 'sweep'; readonly damage: number } & AttackExtras)
  /** Every cell within `radius` steps of the enemy (a cross for radius 1). */
  | ({ readonly kind: 'burst'; readonly damage: number; readonly radius: number } & AttackExtras)
  /** A square of side 2·radius+1 around where the nearest hero stands when it is telegraphed: step out of it. */
  | ({ readonly kind: 'blast'; readonly damage: number; readonly radius: number } & AttackExtras)
  /** Calls up `count` units of an enemy type; the cells are chosen (and shown) when it is telegraphed. */
  | { readonly kind: 'summon'; readonly unit: string; readonly count: number }
  /** Helps the weakest other enemy within `range` (or itself): `effects` run on it. */
  | { readonly kind: 'aid'; readonly range: number; readonly effects: readonly EffectSpec[] };

/** A boss phase: from this much health down, a new pattern (and pace), with an entrance. */
export interface PhaseDef {
  readonly hpAtMost: number;
  readonly pattern: readonly AttackSpec[];
  readonly move?: number;
  readonly behavior?: EnemyBehavior;
  /** Run once when the phase begins (the floor cracks with holy fire). */
  readonly onEnter?: readonly EffectSpec[];
}

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
  /** Attacks used in turn, one per strike (bosses). Without it the enemy always uses `attack`. */
  readonly pattern?: readonly AttackSpec[];
  /** Multiplier on how far pushes move it (0.5 = half as far, rounded down). */
  readonly pushFactor?: number;
  /** A boss: one per boss room, never in ordinary encounters. */
  readonly boss?: boolean;
  readonly behavior: EnemyBehavior;
  /** Which voxel model the renderer draws. */
  readonly model: string;
  /** Relative spawn frequency in encounters (within its biomes). */
  readonly weight: number;
  /** Rules the enemy carries, on the same events and filters as the heroes' (a ghoul eats corpses). */
  readonly traits?: readonly TriggerDef[];
  /** Run where it dies (a bloated corpse bursts). */
  readonly onDeath?: readonly EffectSpec[];
  /** Statuses that do not take hold of it. */
  readonly immune?: readonly string[];
  /** Blows from in front of it lose this much damage (a shield). */
  readonly frontArmor?: number;
  /** Comes in a group of this many. */
  readonly pack?: number;
  /** Boss phases, by falling health. */
  readonly phases?: readonly PhaseDef[];
  /** A thing rather than a fighter (a sarcophagus, a totem): never acts, and the room is clear without killing it. */
  readonly inert?: boolean;
  /** Calls up one enemy of the biome every this many turns (a totem). */
  readonly spawnEvery?: number;
  /** ...but only while fewer than this many fighters are in the room. */
  readonly spawnWhileBelow?: number;
}

/** An elite's trait (M6b): shown over its head, changes how it must be fought. */
export interface AffixDef {
  readonly id: string;
  readonly nameKey: string;
  readonly icon: string;
  /** Extra cells it moves per turn. */
  readonly move?: number;
  readonly frontArmor?: number;
  readonly traits?: readonly TriggerDef[];
  readonly onDeath?: readonly EffectSpec[];
}

/** What a room asks of you (M6b): on the door before you go in, on the HUD inside. */
export type RoomGoal = 'clear' | 'survive' | 'totem' | 'ambush' | 'hunt';

/** A Chapel upgrade bought with Ash between runs (M6b): applied at the start of every run. */
export interface PerkDef {
  readonly id: string;
  readonly nameKey: string;
  readonly icon: string;
  /** Ash for each level, in order; the length is the level cap. */
  readonly costs: readonly number[];
  readonly effect:
    | { readonly kind: 'maxHp'; readonly add: number }
    | { readonly kind: 'rerolls'; readonly add: number }
    | { readonly kind: 'startModifier' }
    | { readonly kind: 'restHeal'; readonly add: number }
    | { readonly kind: 'revive'; readonly add: number };
}

/** An act's place (GDD 1): who lives there, its boss, the hazards lying around. */
export interface BiomeDef {
  readonly id: string;
  readonly nameKey: string;
  /** Ordinary enemies and how often each shows up. */
  readonly enemies: readonly { readonly id: string; readonly weight: number }[];
  readonly boss: string;
  /** Patches of surfaces in every fight: `patches` clusters of up to `size` cells each. */
  readonly features: readonly {
    /** One surface, or several to pick from per patch (currents in four directions). */
    readonly surface: string | readonly string[];
    readonly patches: number;
    readonly size: number;
    /** Grow in a straight line along the surface's flow instead of a blob. */
    readonly straight?: boolean;
  }[];
  /** Things standing in its fights (sarcophagi): `count` of an inert enemy type. */
  readonly objects?: readonly { readonly enemy: string; readonly count: number }[];
  /** A surface that grows: every `every` turns, `count` new cells next to the existing ones (the tide). */
  readonly spread?: { readonly surface: string; readonly every: number; readonly count: number };
  /**
   * Telegraphed strikes of the place itself (light through the windows): every `every` turns a whole row
   * or column is marked, and a turn later everyone on it takes `damage`.
   */
  readonly omens?: { readonly every: number; readonly damage: number };
  /** Room shapes and obstacles (the crypt keeps the generator's defaults). */
  readonly layout?: {
    readonly shapes?: readonly ('rect' | 'cross' | 'l' | 'chamfer')[];
    readonly pillars?: Readonly<Record<'none' | 'scatter' | 'symmetric' | 'rows', number>>;
    readonly pits?: readonly [number, number, number, number];
  };
}

/** What a door offers (GDD 1): shown on the door, granted after clearing the room behind it. */
export type RewardKind =
  | 'ability'
  | 'modifier'
  | 'upgrade'
  | 'rest'
  | 'elite'
  | 'boss'
  /** A second class (GDD 2). */
  | 'initiation'
  /** Pick an item. */
  | 'treasure'
  /** A patron's altar: pick one of their gifts. */
  | 'altar';

/** Ability upgrades (a general reward, M3): faster cooldown or one more damage on every hit. */
export type UpgradeKind = 'cooldown' | 'damage';
