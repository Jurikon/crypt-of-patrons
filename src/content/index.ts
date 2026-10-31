import type { AbilityDef, ClassDef, EnemyDef, RuleDef, StatusDef, SummonDef, SurfaceDef } from './types';

export type * from './types';

/** Explosions (Sacrifice, exploding summons): the four neighbouring cells, sparing your own side's players. */
const BLAST = { kind: 'around', radius: 1, filter: 'notAlliedPlayers' } as const;

export const ABILITIES: readonly AbilityDef[] = [
  // ---- Knight: push, block, provoke ----
  {
    id: 'knight.sword',
    nameKey: 'ability.knight.sword',
    tags: ['melee'],
    cooldown: 0,
    target: { kind: 'front' },
    effects: [{ kind: 'damage', amount: 2 }],
  },
  {
    id: 'knight.shieldBash',
    nameKey: 'ability.knight.shieldBash',
    tags: ['melee', 'push'],
    cooldown: 3,
    target: { kind: 'front' },
    effects: [
      { kind: 'damage', amount: 1 },
      { kind: 'push', distance: 2 },
    ],
  },
  {
    id: 'knight.dash',
    nameKey: 'ability.knight.dash',
    tags: ['movement', 'push'],
    cooldown: 3,
    target: { kind: 'self' },
    effects: [
      {
        kind: 'dash',
        distance: 3,
        onImpact: [
          { kind: 'damage', amount: 1 },
          { kind: 'push', distance: 1 },
          { kind: 'status', status: 'stun', turns: 1 },
        ],
      },
    ],
  },
  {
    id: 'knight.challenge',
    nameKey: 'ability.knight.challenge',
    tags: ['defense'],
    cooldown: 4,
    target: { kind: 'self' },
    effects: [
      { kind: 'status', status: 'taunt', turns: 2, to: { kind: 'around', center: 'self', radius: 3, filter: 'foes' } },
      { kind: 'shield', amount: 2, turns: 3, to: { kind: 'self' } },
    ],
  },

  // ---- Necromancer: raise, sacrifice, curse ----
  {
    id: 'necro.staff',
    nameKey: 'ability.necro.staff',
    tags: ['melee'],
    cooldown: 0,
    target: { kind: 'front' },
    effects: [{ kind: 'damage', amount: 2 }],
  },
  {
    id: 'necro.raise',
    nameKey: 'ability.necro.raise',
    tags: ['summon'],
    cooldown: 2,
    target: { kind: 'cell', range: 3, surface: 'corpse' },
    effects: [{ kind: 'summon', unit: 'necro.skeleton', at: 'target', consumes: 'corpse' }],
  },
  {
    id: 'necro.boneSpear',
    nameKey: 'ability.necro.boneSpear',
    tags: ['projectile', 'curse'],
    cooldown: 2,
    target: { kind: 'line', range: 5 },
    effects: [
      {
        kind: 'projectile',
        range: 5,
        onHit: [
          { kind: 'damage', amount: 2 },
          { kind: 'status', status: 'vulnerable', turns: 2 },
        ],
      },
    ],
  },
  {
    id: 'necro.sacrifice',
    nameKey: 'ability.necro.sacrifice',
    tags: ['summon', 'area'],
    cooldown: 1,
    target: { kind: 'unit', range: 4, filter: 'ownSummons', sight: false },
    effects: [
      { kind: 'damage', amount: 3, to: { ...BLAST, center: 'target' } },
      { kind: 'kill', to: { kind: 'target' } },
    ],
  },

  // ---- Rogue: move, swap, strike from behind ----
  {
    id: 'rogue.dagger',
    nameKey: 'ability.rogue.dagger',
    tags: ['melee'],
    cooldown: 0,
    target: { kind: 'front' },
    effects: [
      { kind: 'damage', amount: 2 },
      { kind: 'status', status: 'bleed', turns: 2 },
    ],
  },
  {
    id: 'rogue.shadowStep',
    nameKey: 'ability.rogue.shadowStep',
    tags: ['movement'],
    cooldown: 3,
    target: { kind: 'unit', range: 3, filter: 'foes', sight: false, freeBehind: true },
    effects: [{ kind: 'teleportBehind' }],
  },
  {
    id: 'rogue.knife',
    nameKey: 'ability.rogue.knife',
    tags: ['projectile'],
    cooldown: 1,
    target: { kind: 'line', range: 5 },
    effects: [
      {
        kind: 'projectile',
        range: 5,
        onHit: [
          { kind: 'damage', amount: 1 },
          { kind: 'status', status: 'mark', turns: 3 },
        ],
      },
    ],
  },
  {
    id: 'rogue.swap',
    nameKey: 'ability.rogue.swap',
    tags: ['movement'],
    cooldown: 3,
    target: { kind: 'unit', range: 4, filter: 'any', sight: true },
    effects: [{ kind: 'swap' }],
  },
];

/** Class passives. */
export const PASSIVES: readonly RuleDef[] = [
  {
    id: 'knight.bulwark',
    nameKey: 'passive.knight.bulwark',
    stats: [{ stat: 'pushCollisionBonus', add: 2 }],
    triggers: [],
  },
  {
    id: 'necro.gravedigger',
    nameKey: 'passive.necro.gravedigger',
    stats: [],
    triggers: [{ on: 'death', subject: 'foe', effects: [{ kind: 'surface', surface: 'corpse', at: 'subject' }] }],
  },
  {
    id: 'rogue.backstab',
    nameKey: 'passive.rogue.backstab',
    stats: [{ stat: 'backstab', add: 1 }],
    triggers: [],
  },
];

/** Modifiers (GDD 2): rules that hook onto tags and events, never onto specific abilities. */
export const MODIFIERS: readonly RuleDef[] = [
  {
    id: 'mod.explodingSummons',
    nameKey: 'modifier.explodingSummons',
    stats: [],
    triggers: [
      {
        on: 'death',
        subject: 'ownSummon',
        effects: [{ kind: 'damage', amount: 3, to: { ...BLAST, center: 'subject' } }],
      },
    ],
  },
  {
    id: 'mod.longPush',
    nameKey: 'modifier.longPush',
    stats: [{ stat: 'pushDistance', add: 1 }],
    triggers: [],
  },
  {
    id: 'mod.piercing',
    nameKey: 'modifier.piercing',
    stats: [{ stat: 'projectilePierce', add: 1 }],
    triggers: [],
  },
  {
    id: 'mod.trailTraps',
    nameKey: 'modifier.trailTraps',
    stats: [],
    triggers: [
      { on: 'moved', actor: 'owner', tags: ['movement'], effects: [{ kind: 'surface', surface: 'trap', at: 'from' }] },
    ],
  },
  {
    id: 'mod.markedKill',
    nameKey: 'modifier.markedKill',
    stats: [],
    triggers: [{ on: 'kill', actor: 'owner', subjectStatus: 'mark', effects: [{ kind: 'freeAction' }] }],
  },
];

export const STATUSES: readonly StatusDef[] = [
  {
    id: 'bleed',
    nameKey: 'status.bleed',
    icon: '🩸',
    stats: [],
    triggers: [{ on: 'turnEnd', subject: 'owner', effects: [{ kind: 'damage', amount: 1, to: { kind: 'self' } }] }],
  },
  { id: 'stun', nameKey: 'status.stun', icon: '💫', stats: [], triggers: [], stun: true },
  { id: 'mark', nameKey: 'status.mark', icon: '🎯', stats: [], triggers: [] },
  {
    id: 'vulnerable',
    nameKey: 'status.vulnerable',
    icon: '💔',
    stats: [{ stat: 'damageTaken', add: 1 }],
    triggers: [],
  },
  { id: 'shield', nameKey: 'status.shield', icon: '🛡', stats: [], triggers: [], shield: true },
  { id: 'taunt', nameKey: 'status.taunt', icon: '❗', stats: [], triggers: [], taunt: true },
];

export const SURFACES: readonly SurfaceDef[] = [
  { id: 'corpse', nameKey: 'surface.corpse', triggers: [] },
  {
    id: 'trap',
    nameKey: 'surface.trap',
    singleUse: true,
    triggers: [{ on: 'enterCell', subject: 'foe', effects: [{ kind: 'damage', amount: 2, to: { kind: 'subject' } }] }],
  },
];

export const SUMMONS: readonly SummonDef[] = [
  { id: 'necro.skeleton', nameKey: 'summon.skeleton', maxHp: 3, damage: 2, model: 'warrior', tags: ['summon'] },
];

export const CLASSES: readonly ClassDef[] = [
  {
    id: 'knight',
    nameKey: 'class.knight',
    maxHp: 16,
    abilities: ['knight.sword', 'knight.shieldBash'],
    passives: ['knight.bulwark'],
    pool: ['knight.dash', 'knight.challenge'],
  },
  {
    id: 'necromancer',
    nameKey: 'class.necromancer',
    maxHp: 13,
    abilities: ['necro.staff', 'necro.raise'],
    passives: ['necro.gravedigger'],
    pool: ['necro.boneSpear', 'necro.sacrifice'],
  },
  {
    id: 'rogue',
    nameKey: 'class.rogue',
    maxHp: 13,
    abilities: ['rogue.dagger', 'rogue.shadowStep'],
    passives: ['rogue.backstab'],
    pool: ['rogue.knife', 'rogue.swap'],
  },
];

export const ENEMIES: readonly EnemyDef[] = [
  {
    id: 'skeletonWarrior',
    nameKey: 'enemy.skeletonWarrior',
    maxHp: 4,
    move: 1,
    attack: { kind: 'melee', damage: 2 },
    behavior: { kind: 'melee' },
    model: 'warrior',
    weight: 3,
  },
  {
    id: 'skeletonArcher',
    nameKey: 'enemy.skeletonArcher',
    maxHp: 3,
    move: 1,
    attack: { kind: 'line', damage: 1, range: 6 },
    behavior: { kind: 'ranged', minRange: 2, maxRange: 5 },
    model: 'archer',
    weight: 2,
  },
  {
    id: 'cryptWarden',
    nameKey: 'enemy.cryptWarden',
    maxHp: 14,
    move: 1,
    attack: { kind: 'sweep', damage: 3 },
    pattern: [
      { kind: 'sweep', damage: 3 },
      { kind: 'sweep', damage: 3 },
      { kind: 'summon', unit: 'skeletonWarrior', count: 2 },
    ],
    behavior: { kind: 'melee' },
    model: 'warden',
    weight: 0,
    pushFactor: 0.5,
    boss: true,
  },
];

/** Shape of one act (GDD 1): combat rooms, then the boss. */
export const ACT = {
  /** Rooms before the boss. */
  rooms: 6,
  /** Elite rooms at most per act. */
  maxElites: 2,
  /** Share of max health a rest room restores. */
  restHeal: 0.5,
  /** Reward options offered at once (pick 1 of 3). */
  offer: 3,
  /** Extra health of elite enemies, and extra enemies in an elite room. */
  eliteHp: 2,
  eliteExtra: 1,
} as const;

/** How often each kind of reward shows up on doors (only kinds still available are drawn). */
export const DOOR_WEIGHTS: readonly {
  readonly kind: 'ability' | 'modifier' | 'upgrade' | 'rest' | 'elite';
  readonly weight: number;
}[] = [
  { kind: 'ability', weight: 3 },
  { kind: 'modifier', weight: 3 },
  { kind: 'upgrade', weight: 2 },
  { kind: 'rest', weight: 2 },
  { kind: 'elite', weight: 1 },
];

/** Encounter size by depth in the act: weights for 2, 3, 4, 5 enemies. */
export function encounterWeights(depth: number): readonly { readonly item: number; readonly weight: number }[] {
  if (depth <= 2)
    return [
      { item: 2, weight: 3 },
      { item: 3, weight: 4 },
      { item: 4, weight: 1 },
    ];
  if (depth <= 4)
    return [
      { item: 3, weight: 4 },
      { item: 4, weight: 3 },
    ];
  return [
    { item: 3, weight: 2 },
    { item: 4, weight: 4 },
    { item: 5, weight: 2 },
  ];
}

/** Base damage a pushed unit takes when it hits something; passives add to it. */
export const PUSH_COLLISION_DAMAGE = 1;
/** Maximum depth of a trigger chain; deeper links are logged and dropped (CLAUDE.md rule 5). */
export const MAX_CHAIN_DEPTH = 32;
/** Ability slots besides the base attack (GDD 2). */
export const ABILITY_SLOTS = 4;
/** Corpses lying around a crypt room at the start of a fight (the Necromancer can raise them). */
export const ROOM_CORPSES = 2;

function byId<T extends { readonly id: string }>(list: readonly T[], kind: string): (id: string) => T {
  return (id) => {
    const found = list.find((x) => x.id === id);
    if (!found) throw new Error(`Unknown ${kind}: ${id}`);
    return found;
  };
}

export const getAbility = byId(ABILITIES, 'ability');
export const getPassive = byId(PASSIVES, 'passive');
export const getModifier = byId(MODIFIERS, 'modifier');
export const getStatus = byId(STATUSES, 'status');
export const getSurface = byId(SURFACES, 'surface');
export const getSummon = byId(SUMMONS, 'summon');
export const getClass = byId(CLASSES, 'class');
export const getEnemy = byId(ENEMIES, 'enemy');
