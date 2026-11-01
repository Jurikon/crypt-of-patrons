import type {
  AffixDef,
  EventDef,
  EventOption,
  BiomeDef,
  PerkDef,
  RoomGoal,
  AbilityDef,
  ClassDef,
  EnemyDef,
  HybridDef,
  PatronDef,
  RuleDef,
  StatusDef,
  SummonDef,
  SurfaceDef,
} from './types';

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
    target: { kind: 'cell', range: 3, surface: ['corpse', 'blood'] },
    effects: [{ kind: 'summon', unit: 'necro.skeleton', at: 'target', consumes: ['corpse', 'blood'] }],
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
    // The target is dazed for a turn: it cannot turn round, so the next blow lands in its back.
    effects: [{ kind: 'teleportBehind' }, { kind: 'status', status: 'daze', turns: 1 }],
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
  {
    id: 'knight.shieldWall',
    nameKey: 'ability.knight.shieldWall',
    tags: ['defense'],
    cooldown: 4,
    target: { kind: 'self' },
    effects: [
      {
        kind: 'shield',
        amount: 3,
        turns: 2,
        to: { kind: 'around', center: 'self', radius: 1, filter: 'allies', includeCenter: true },
      },
      { kind: 'status', status: 'guard', turns: 2, to: { kind: 'self' } },
    ],
  },
  {
    id: 'knight.crush',
    nameKey: 'ability.knight.crush',
    tags: ['melee', 'push', 'area'],
    cooldown: 2,
    target: { kind: 'front' },
    effects: [
      { kind: 'damage', amount: 1, to: { kind: 'frontRow' } },
      { kind: 'push', distance: 1, to: { kind: 'frontRow' } },
    ],
  },
  {
    id: 'necro.curse',
    nameKey: 'ability.necro.curse',
    tags: ['curse'],
    cooldown: 2,
    target: { kind: 'unit', range: 5, filter: 'foes', sight: true },
    effects: [{ kind: 'status', status: 'curse', turns: 99 }],
  },
  {
    id: 'necro.boneWall',
    nameKey: 'ability.necro.boneWall',
    tags: ['summon', 'defense'],
    cooldown: 3,
    target: { kind: 'self' },
    effects: [{ kind: 'summon', unit: 'necro.boneWall', at: 'frontRow' }],
  },
  {
    id: 'rogue.smoke',
    nameKey: 'ability.rogue.smoke',
    tags: ['area'],
    cooldown: 3,
    target: { kind: 'cell', range: 4 },
    effects: [
      { kind: 'surface', surface: 'smoke', at: 'target', radius: 1, turns: 2 },
      {
        kind: 'status',
        status: 'blind',
        turns: 2,
        to: { kind: 'around', center: 'target', radius: 1, filter: 'foes', includeCenter: true, square: true },
      },
    ],
  },
  {
    id: 'rogue.poisonBlade',
    nameKey: 'ability.rogue.poisonBlade',
    tags: ['melee'],
    cooldown: 2,
    target: { kind: 'front' },
    effects: [
      { kind: 'damage', amount: 2 },
      { kind: 'status', status: 'poison', turns: 3, amount: 1 },
    ],
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
    requires: ['summon'],
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
    requires: ['push'],
    stats: [{ stat: 'pushDistance', add: 1 }],
    triggers: [],
  },
  {
    id: 'mod.piercing',
    nameKey: 'modifier.piercing',
    requires: ['projectile'],
    stats: [{ stat: 'projectilePierce', add: 1 }],
    triggers: [],
  },
  {
    id: 'mod.trailTraps',
    nameKey: 'modifier.trailTraps',
    requires: ['movement'],
    stats: [],
    triggers: [
      { on: 'moved', actor: 'owner', tags: ['movement'], effects: [{ kind: 'surface', surface: 'trap', at: 'from' }] },
    ],
  },
  {
    id: 'mod.markedKill',
    nameKey: 'modifier.markedKill',
    requiresStatus: 'mark',
    stats: [],
    triggers: [{ on: 'kill', actor: 'owner', subjectStatus: 'mark', effects: [{ kind: 'freeAction' }] }],
  },
  {
    id: 'mod.fireTrail',
    nameKey: 'modifier.fireTrail',
    requires: ['movement'],
    stats: [],
    triggers: [
      {
        on: 'moved',
        actor: 'owner',
        tags: ['movement'],
        effects: [{ kind: 'surface', surface: 'fire', at: 'from', turns: 3 }],
      },
    ],
  },
  {
    id: 'mod.bloodyPush',
    nameKey: 'modifier.bloodyPush',
    requires: ['push'],
    stats: [],
    triggers: [
      {
        on: 'hit',
        actor: 'owner',
        tags: ['push'],
        effects: [{ kind: 'status', status: 'bleed', turns: 2, to: { kind: 'subject' } }],
      },
    ],
  },
  {
    id: 'mod.chainLightning',
    nameKey: 'modifier.chainLightning',
    stats: [],
    triggers: [
      {
        on: 'kill',
        actor: 'owner',
        effects: [{ kind: 'damage', amount: 1, to: { kind: 'nearest', center: 'subject', filter: 'foes' } }],
      },
    ],
  },
  {
    id: 'mod.venomShots',
    nameKey: 'modifier.venomShots',
    requires: ['projectile'],
    stats: [],
    triggers: [
      {
        on: 'hit',
        actor: 'owner',
        tags: ['projectile'],
        effects: [{ kind: 'status', status: 'poison', turns: 3, amount: 1, to: { kind: 'subject' } }],
      },
    ],
  },
  {
    id: 'mod.iceStep',
    nameKey: 'modifier.iceStep',
    requires: ['movement'],
    stats: [],
    triggers: [
      {
        on: 'moved',
        actor: 'owner',
        tags: ['movement'],
        effects: [{ kind: 'surface', surface: 'ice', at: 'from', turns: 5 }],
      },
    ],
  },
  {
    id: 'mod.stunBreaker',
    nameKey: 'modifier.stunBreaker',
    requiresStatus: 'stun',
    stats: [],
    triggers: [
      {
        on: 'hit',
        actor: 'owner',
        subjectStatus: 'stun',
        effects: [{ kind: 'damage', amount: 2, to: { kind: 'subject' } }],
      },
    ],
  },
  {
    id: 'mod.vengefulDead',
    nameKey: 'modifier.vengefulDead',
    requires: ['summon'],
    stats: [],
    triggers: [
      {
        on: 'damaged',
        subject: 'ownSummon',
        actor: 'foe',
        effects: [{ kind: 'damage', amount: 1, to: { kind: 'actor' } }],
      },
    ],
  },
  {
    id: 'mod.greedyDead',
    nameKey: 'modifier.greedyDead',
    requires: ['summon'],
    stats: [],
    triggers: [{ on: 'kill', actor: 'ownSummon', effects: [{ kind: 'heal', amount: 1, to: { kind: 'actor' } }] }],
  },
  {
    id: 'mod.scavenger',
    nameKey: 'modifier.scavenger',
    stats: [],
    triggers: [
      {
        on: 'death',
        subject: 'foe',
        near: 2,
        effects: [{ kind: 'shield', amount: 1, turns: 3, to: { kind: 'self' } }],
      },
    ],
  },
  {
    id: 'mod.longReach',
    nameKey: 'modifier.longReach',
    stats: [{ stat: 'projectileRange', add: 2 }],
    triggers: [],
    requires: ['projectile'],
  },
  {
    id: 'mod.throughStrike',
    nameKey: 'modifier.throughStrike',
    stats: [],
    triggers: [
      { on: 'hit', actor: 'owner', tags: ['melee'], effects: [{ kind: 'damage', amount: 1, to: { kind: 'beyond' } }] },
    ],
  },
  {
    id: 'mod.heavyPushes',
    nameKey: 'modifier.heavyPushes',
    requires: ['push'],
    stats: [],
    triggers: [
      {
        on: 'collide',
        actor: 'owner',
        effects: [{ kind: 'status', status: 'stun', turns: 1, to: { kind: 'subject' } }],
      },
    ],
  },
  {
    id: 'mod.shadowAfterShadow',
    nameKey: 'modifier.shadowAfterShadow',
    requires: ['movement'],
    stats: [],
    triggers: [{ on: 'moved', actor: 'owner', tags: ['movement'], effects: [{ kind: 'cooldowns', delta: -1 }] }],
  },
  {
    id: 'mod.bloodForBlood',
    nameKey: 'modifier.bloodForBlood',
    stats: [],
    triggers: [
      {
        on: 'damaged',
        subject: 'owner',
        effects: [{ kind: 'status', status: 'rage', turns: 3, to: { kind: 'self' } }],
      },
    ],
  },
  {
    id: 'mod.hunterMark',
    nameKey: 'modifier.hunterMark',
    stats: [],
    triggers: [
      { on: 'hit', actor: 'owner', effects: [{ kind: 'status', status: 'mark', turns: 3, to: { kind: 'subject' } }] },
    ],
  },
  {
    id: 'mod.contagion',
    nameKey: 'modifier.contagion',
    requiresStatus: 'poison',
    stats: [],
    triggers: [
      {
        on: 'death',
        subject: 'foe',
        subjectStatus: 'poison',
        effects: [
          {
            kind: 'status',
            status: 'poison',
            turns: 3,
            amount: 2,
            to: { kind: 'around', center: 'subject', radius: 1, filter: 'foes' },
          },
        ],
      },
    ],
  },
  {
    id: 'mod.hotBlood',
    nameKey: 'modifier.hotBlood',
    requiresStatus: 'burning',
    stats: [],
    triggers: [
      {
        on: 'hit',
        actor: 'owner',
        subjectStatus: 'burning',
        effects: [{ kind: 'damage', amount: 1, to: { kind: 'subject' } }],
      },
    ],
  },
  {
    id: 'mod.boneShards',
    nameKey: 'modifier.boneShards',
    requires: ['summon'],
    stats: [],
    triggers: [
      {
        on: 'death',
        subject: 'ownSummon',
        effects: [
          {
            kind: 'damage',
            amount: 1,
            to: { kind: 'around', center: 'subject', radius: 2, filter: 'notAlliedPlayers' },
          },
        ],
      },
    ],
  },
  {
    id: 'mod.lastBreath',
    nameKey: 'modifier.lastBreath',
    stats: [],
    triggers: [
      {
        on: 'damaged',
        subject: 'owner',
        ownerHpAtMost: 3,
        effects: [{ kind: 'status', status: 'lastBreath', turns: 99, to: { kind: 'self' } }],
      },
    ],
  },
  {
    id: 'mod.doubleSummon',
    nameKey: 'modifier.doubleSummon',
    stats: [{ stat: 'extraSummons', add: 1 }],
    triggers: [],
    requires: ['summon'],
  },
];

export const STATUSES: readonly StatusDef[] = [
  {
    id: 'bleed',
    nameKey: 'status.bleed',
    debuff: true,
    icon: '🩸',
    stats: [],
    triggers: [
      {
        on: 'turnEnd',
        subject: 'owner',
        effects: [
          { kind: 'damage', amount: 1, to: { kind: 'self' } },
          { kind: 'surface', surface: 'blood', at: 'self', turns: 6 },
        ],
      },
    ],
  },
  {
    id: 'poison',
    nameKey: 'status.poison',
    debuff: true,
    icon: '🧪',
    stats: [],
    stacks: true,
    triggers: [
      {
        on: 'turnEnd',
        subject: 'owner',
        effects: [{ kind: 'damage', amount: 0, fromStatus: 'poison', to: { kind: 'self' } }],
      },
    ],
  },
  {
    id: 'burning',
    nameKey: 'status.burning',
    debuff: true,
    icon: '🔥',
    stats: [],
    triggers: [{ on: 'turnEnd', subject: 'owner', effects: [{ kind: 'damage', amount: 1, to: { kind: 'self' } }] }],
  },
  {
    id: 'curse',
    nameKey: 'status.curse',
    debuff: true,
    icon: '💀',
    stats: [{ stat: 'damageTaken', add: 1 }],
    triggers: [],
    jumps: true,
  },
  { id: 'daze', nameKey: 'status.daze', icon: '🌀', debuff: true, stats: [], triggers: [], rooted: true },
  { id: 'blind', nameKey: 'status.blind', icon: '🌫', debuff: true, stats: [], triggers: [], blind: true },
  { id: 'guard', nameKey: 'status.guard', icon: '⛨', stats: [], triggers: [], frontGuard: true },
  {
    id: 'rage',
    nameKey: 'status.rage',
    icon: '💢',
    stats: [{ stat: 'damageDealt', add: 1 }],
    triggers: [
      { on: 'hit', actor: 'owner', effects: [{ kind: 'removeStatus', status: 'rage', to: { kind: 'self' } }] },
    ],
  },
  {
    id: 'lastBreath',
    nameKey: 'status.lastBreath',
    icon: '⚡',
    stats: [{ stat: 'damageDealt', add: 1 }],
    triggers: [],
  },
  {
    id: 'duelist',
    nameKey: 'status.duelist',
    icon: '⚔',
    stats: [{ stat: 'pushDistance', add: 1 }],
    triggers: [
      {
        on: 'hit',
        actor: 'owner',
        tags: ['push'],
        effects: [
          { kind: 'status', status: 'stun', turns: 1, to: { kind: 'subject' } },
          { kind: 'removeStatus', status: 'duelist', to: { kind: 'self' } },
        ],
      },
    ],
  },
  {
    id: 'fading',
    nameKey: 'status.fading',
    icon: '⌛',
    stats: [],
    triggers: [],
    onExpire: [{ kind: 'kill', to: { kind: 'self' } }],
  },
  { id: 'stun', nameKey: 'status.stun', icon: '💫', debuff: true, stats: [], triggers: [], stun: true },
  { id: 'mark', nameKey: 'status.mark', icon: '🎯', debuff: true, stats: [], triggers: [] },
  {
    id: 'vulnerable',
    nameKey: 'status.vulnerable',
    debuff: true,
    icon: '💔',
    stats: [{ stat: 'damageTaken', add: 1 }],
    triggers: [],
  },
  { id: 'shield', nameKey: 'status.shield', icon: '🛡', stats: [], triggers: [], shield: true },
  { id: 'taunt', nameKey: 'status.taunt', icon: '❗', debuff: true, stats: [], triggers: [], taunt: true },
];

/** Surfaces that keep hurting whoever stands in them (stepping in, or ending a turn there). */
const LINGER = (status: string, turns: number, amount?: number) =>
  (['enterCell', 'turnEnd'] as const).map((on) => ({
    on,
    subject: 'foe' as const,
    effects: [
      { kind: 'status' as const, status, turns, ...(amount ? { amount } : {}), to: { kind: 'subject' as const } },
    ],
  }));

export const SURFACES: readonly SurfaceDef[] = [
  { id: 'corpse', nameKey: 'surface.corpse', triggers: [] },
  { id: 'blood', nameKey: 'surface.blood', triggers: [] },
  // Fire melts ice into water.
  { id: 'ice', nameKey: 'surface.ice', triggers: [], reactions: [{ with: 'fire', result: 'water' }] },
  {
    id: 'fire',
    nameKey: 'surface.fire',
    triggers: LINGER('burning', 2),
    reactions: [
      { with: 'ice', result: 'water' },
      { with: 'water', result: 'water' },
    ],
  },
  /** Catacomb water: puts out the burning, carries lightning to everyone in the same pool, smothers fire. */
  {
    id: 'water',
    nameKey: 'surface.water',
    conducts: 'lightning',
    reactions: [{ with: 'fire', result: 'water' }],
    triggers: [
      {
        on: 'enterCell',
        subject: 'any',
        subjectStatus: 'burning',
        effects: [{ kind: 'removeStatus', status: 'burning', to: { kind: 'subject' } }],
      },
    ],
  },
  /** Crypt spike plates: hurt whoever steps on them, every time. */
  {
    id: 'spikes',
    nameKey: 'surface.spikes',
    hazard: true,
    triggers: [{ on: 'enterCell', subject: 'foe', effects: [{ kind: 'damage', amount: 2, to: { kind: 'subject' } }] }],
  },
  // Catacomb currents: whoever stands in one is carried a cell downstream at the end of each turn.
  ...([0, 1, 2, 3] as const).map((flow) => ({
    id: `current${'NESW'[flow]}`,
    nameKey: 'surface.current',
    flow,
    conducts: 'lightning' as const,
    // Enemies wade around a current when they can: walking against one gets nowhere.
    hazard: true,
    triggers: [],
  })),
  /** The cathedral's holy fire: burns anyone not of its side who steps in or stays. */
  {
    id: 'holyFire',
    nameKey: 'surface.holyFire',
    hazard: true,
    triggers: (['enterCell', 'turnEnd'] as const).map((on) => ({
      on,
      subject: 'foe' as const,
      effectTags: ['fire'] as const,
      effects: [{ kind: 'damage' as const, amount: 2, to: { kind: 'subject' as const } }],
    })),
  },
  { id: 'smoke', nameKey: 'surface.smoke', triggers: LINGER('blind', 2) },
  { id: 'poisonCloud', nameKey: 'surface.poisonCloud', triggers: LINGER('poison', 3, 1) },
  {
    id: 'trap',
    nameKey: 'surface.trap',
    singleUse: true,
    triggers: [{ on: 'enterCell', subject: 'foe', effects: [{ kind: 'damage', amount: 2, to: { kind: 'subject' } }] }],
  },
];

export const SUMMONS: readonly SummonDef[] = [
  { id: 'necro.skeleton', nameKey: 'summon.skeleton', maxHp: 3, damage: 2, model: 'warrior', tags: ['summon'] },
  {
    id: 'necro.boneWall',
    nameKey: 'summon.boneWall',
    maxHp: 2,
    damage: 0,
    model: 'boneWall',
    tags: ['summon', 'defense'],
    inert: true,
  },
  { id: 'decoy', nameKey: 'summon.decoy', maxHp: 2, damage: 0, model: 'decoy', tags: ['summon'], inert: true },
];

/** Items (GDD 2): rules that change how you play; cursed ones trade a big upside for a real downside. */
export const ITEMS: readonly RuleDef[] = [
  {
    id: 'item.lichCrown',
    nameKey: 'item.lichCrown',
    requires: ['summon'],
    icon: '♛',
    stats: [{ stat: 'summonsUseBaseAttack', add: 1 }],
    triggers: [],
  },
  {
    id: 'item.stoneHeart',
    nameKey: 'item.stoneHeart',
    icon: '🪨',
    cursed: true,
    stats: [],
    onGain: [{ kind: 'maxHp', set: 1 }],
    triggers: (['turnStart', 'roomStart'] as const).map((on) => ({
      on,
      ...(on === 'turnStart' ? { subject: 'owner' as const } : {}),
      effects: [{ kind: 'shield' as const, amount: 6, turns: 1, to: { kind: 'self' as const } }],
    })),
  },
  {
    id: 'item.jailerChains',
    nameKey: 'item.jailerChains',
    requires: ['push'],
    icon: '⛓',
    stats: [],
    triggers: [
      {
        on: 'kill',
        actor: 'owner',
        tags: ['push'],
        effects: [{ kind: 'summon', unit: 'necro.skeleton', at: 'subject' }],
      },
    ],
  },
  {
    id: 'item.mirrorDagger',
    nameKey: 'item.mirrorDagger',
    requires: ['movement'],
    icon: '🗡',
    stats: [],
    triggers: [
      {
        on: 'moved',
        actor: 'owner',
        tags: ['movement'],
        effects: [{ kind: 'summon', unit: 'decoy', at: 'from' }],
      },
    ],
  },
  {
    id: 'item.oath',
    nameKey: 'item.oath',
    icon: '⚔',
    cursed: true,
    stats: [
      { stat: 'damageFactor', add: 1 },
      { stat: 'noRetreat', add: 1 },
    ],
    triggers: [],
  },
  {
    id: 'item.bloodLedger',
    nameKey: 'item.bloodLedger',
    icon: '📕',
    cursed: true,
    stats: [{ stat: 'bloodPrice', add: 2 }],
    triggers: [],
  },
  {
    id: 'item.pilgrimBoots',
    nameKey: 'item.pilgrimBoots',
    icon: '👢',
    stats: [],
    triggers: [{ on: 'roomStart', effects: [{ kind: 'freeAction' }] }],
  },
  {
    id: 'item.hourglass',
    nameKey: 'item.hourglass',
    icon: '⌛',
    stats: [],
    triggers: [{ on: 'kill', actor: 'owner', oncePerRoom: true, effects: [{ kind: 'freeAction' }] }],
  },
  {
    id: 'item.deadBell',
    nameKey: 'item.deadBell',
    icon: '🔔',
    stats: [],
    triggers: [
      { on: 'roomStart', effects: [{ kind: 'summon', unit: 'necro.skeleton', at: { near: 'self', radius: 2 } }] },
    ],
  },
  {
    id: 'item.shadowCloak',
    nameKey: 'item.shadowCloak',
    icon: '🧥',
    stats: [],
    triggers: [
      {
        on: 'roomStart',
        effects: [
          {
            kind: 'status',
            status: 'blind',
            turns: 2,
            to: { kind: 'around', center: 'self', radius: 99, filter: 'foes' },
          },
        ],
      },
    ],
  },
  {
    id: 'item.rustyNail',
    nameKey: 'item.rustyNail',
    icon: '📌',
    stats: [],
    triggers: [
      { on: 'hit', actor: 'owner', effects: [{ kind: 'status', status: 'bleed', turns: 1, to: { kind: 'subject' } }] },
    ],
  },
  {
    id: 'item.burningLantern',
    nameKey: 'item.burningLantern',
    icon: '🏮',
    stats: [],
    triggers: [{ on: 'moved', actor: 'owner', effects: [{ kind: 'surface', surface: 'fire', at: 'from', turns: 2 }] }],
  },
  {
    id: 'item.piggySkull',
    nameKey: 'item.piggySkull',
    icon: '💀',
    cursed: true,
    stats: [{ stat: 'upgradeBonus', add: 1 }],
    onGain: [{ kind: 'maxHp', add: -3 }],
    triggers: [],
  },
  {
    id: 'item.bannerScrap',
    nameKey: 'item.bannerScrap',
    requires: ['summon'],
    icon: '🚩',
    stats: [{ stat: 'auraDamage', add: 1 }],
    triggers: [],
  },
  {
    id: 'item.judgeEye',
    nameKey: 'item.judgeEye',
    requiresStatus: 'mark',
    icon: '👁',
    cursed: true,
    stats: [{ stat: 'damageTaken', add: 1 }],
    triggers: [
      {
        on: 'hit',
        actor: 'owner',
        subjectStatus: 'mark',
        effects: [{ kind: 'damage', amount: 2, to: { kind: 'subject' } }],
      },
    ],
  },
];

/** Lightning damage: tagged so rules can react to it (the Firestorm duo gift sets things alight). */
const ZAP = ['lightning'] as const;
const FIRE = ['fire'] as const;

/** Patron gifts (GDD 2): rules like modifiers, each belonging to a patron; duo gifts need two patrons. */
export const GIFTS: readonly RuleDef[] = [
  // ---- Morra, Queen of Plague: poison and spreading ----
  {
    id: 'gift.morra.plagueStrike',
    nameKey: 'gift.morra.plagueStrike',
    patron: 'morra',
    stats: [],
    triggers: [
      {
        on: 'hit',
        actor: 'owner',
        tags: ['basic'],
        effects: [{ kind: 'status', status: 'poison', turns: 3, amount: 1, to: { kind: 'subject' } }],
      },
    ],
  },
  {
    id: 'gift.morra.contagion',
    nameKey: 'gift.morra.contagion',
    patron: 'morra',
    stats: [],
    triggers: [
      {
        on: 'death',
        subject: 'foe',
        effects: [{ kind: 'spreadStatuses', to: { kind: 'around', center: 'subject', radius: 1, filter: 'foes' } }],
      },
    ],
  },
  {
    id: 'gift.morra.miasma',
    nameKey: 'gift.morra.miasma',
    patron: 'morra',
    requiresStatus: 'poison',
    stats: [],
    triggers: [
      {
        on: 'death',
        subject: 'foe',
        subjectStatus: 'poison',
        effects: [{ kind: 'surface', surface: 'poisonCloud', at: 'subject', turns: 3 }],
      },
    ],
  },
  {
    id: 'gift.morra.rottenBlood',
    nameKey: 'gift.morra.rottenBlood',
    patron: 'morra',
    requiresStatus: 'poison',
    stats: [{ stat: 'stackBonus', add: 1 }],
    triggers: [],
  },
  {
    id: 'gift.morra.pestilence',
    nameKey: 'gift.morra.pestilence',
    patron: 'morra',
    stats: [],
    triggers: [
      {
        on: 'roomStart',
        effects: [
          {
            kind: 'status',
            status: 'poison',
            turns: 4,
            amount: 2,
            to: { kind: 'nearest', center: 'self', filter: 'foes', count: 2 },
          },
        ],
      },
    ],
  },

  // ---- Velkar, Lord of the Storm: chains and movement ----
  {
    id: 'gift.velkar.thunderPush',
    nameKey: 'gift.velkar.thunderPush',
    patron: 'velkar',
    requires: ['push'],
    stats: [],
    triggers: [
      {
        on: 'enterCell',
        actor: 'owner',
        subject: 'foe',
        tags: ['push'],
        effectTags: ZAP,
        effects: [{ kind: 'damage', amount: 1, to: { kind: 'around', center: 'subject', radius: 1, filter: 'foes' } }],
      },
    ],
  },
  {
    id: 'gift.velkar.discharge',
    nameKey: 'gift.velkar.discharge',
    patron: 'velkar',
    stats: [],
    triggers: [
      {
        on: 'kill',
        actor: 'owner',
        effectTags: ZAP,
        effects: [{ kind: 'damage', amount: 1, to: { kind: 'nearest', center: 'subject', filter: 'foes', count: 2 } }],
      },
    ],
  },
  {
    id: 'gift.velkar.stormStep',
    nameKey: 'gift.velkar.stormStep',
    patron: 'velkar',
    requires: ['movement'],
    stats: [],
    triggers: [
      {
        on: 'moved',
        actor: 'owner',
        tags: ['movement'],
        effectTags: ZAP,
        effects: [{ kind: 'damage', amount: 1, to: { kind: 'around', center: 'self', radius: 1, filter: 'foes' } }],
      },
    ],
  },
  {
    id: 'gift.velkar.tailwind',
    nameKey: 'gift.velkar.tailwind',
    patron: 'velkar',
    stats: [],
    triggers: [{ on: 'roomStart', effects: [{ kind: 'freeAction' }, { kind: 'freeAction' }] }],
  },
  {
    id: 'gift.velkar.staticCharge',
    nameKey: 'gift.velkar.staticCharge',
    patron: 'velkar',
    stats: [],
    triggers: [
      {
        on: 'hit',
        actor: 'owner',
        tags: ['basic'],
        every: 3,
        effects: [{ kind: 'status', status: 'stun', turns: 1, to: { kind: 'subject' } }],
      },
    ],
  },

  // ---- Silas the Faceless: corpses, summons, sacrifice ----
  {
    id: 'gift.silas.retinue',
    nameKey: 'gift.silas.retinue',
    patron: 'silas',
    stats: [],
    triggers: [
      { on: 'roomStart', effects: [{ kind: 'summon', unit: 'necro.skeleton', at: { near: 'self', radius: 2 } }] },
    ],
  },
  {
    id: 'gift.silas.boneToBone',
    nameKey: 'gift.silas.boneToBone',
    patron: 'silas',
    requires: ['summon'],
    stats: [{ stat: 'summonHp', add: 1 }],
    triggers: [],
  },
  {
    id: 'gift.silas.feast',
    nameKey: 'gift.silas.feast',
    patron: 'silas',
    requires: ['summon'],
    stats: [],
    triggers: [{ on: 'death', subject: 'ownSummon', effects: [{ kind: 'heal', amount: 1, to: { kind: 'self' } }] }],
  },
  {
    id: 'gift.silas.graveHarvest',
    nameKey: 'gift.silas.graveHarvest',
    patron: 'silas',
    stats: [],
    triggers: [{ on: 'death', subject: 'foe', effects: [{ kind: 'surface', surface: 'corpse', at: 'subject' }] }],
  },
  {
    id: 'gift.silas.legion',
    nameKey: 'gift.silas.legion',
    patron: 'silas',
    requires: ['summon'],
    stats: [{ stat: 'extraSummons', add: 1 }],
    triggers: [],
  },

  // ---- Ingrid, the Ice Widow: control and shields ----
  {
    id: 'gift.ingrid.iceVerdict',
    nameKey: 'gift.ingrid.iceVerdict',
    patron: 'ingrid',
    requires: ['push'],
    stats: [],
    triggers: [
      {
        on: 'collide',
        actor: 'owner',
        subjectStatus: 'stun',
        effects: [{ kind: 'damage', amount: 2, to: { kind: 'subject' } }],
      },
    ],
  },
  {
    id: 'gift.ingrid.hoarfrost',
    nameKey: 'gift.ingrid.hoarfrost',
    patron: 'ingrid',
    stats: [],
    triggers: [{ on: 'roomStart', effects: [{ kind: 'shield', amount: 3, turns: 99, to: { kind: 'self' } }] }],
  },
  {
    id: 'gift.ingrid.coldTrail',
    nameKey: 'gift.ingrid.coldTrail',
    patron: 'ingrid',
    requires: ['push'],
    stats: [],
    triggers: [
      {
        on: 'pushed',
        actor: 'owner',
        subject: 'foe',
        effects: [{ kind: 'surface', surface: 'ice', at: 'from', turns: 5 }],
      },
    ],
  },
  {
    id: 'gift.ingrid.frostbite',
    nameKey: 'gift.ingrid.frostbite',
    patron: 'ingrid',
    requiresSurface: 'ice',
    stats: [],
    triggers: [
      {
        on: 'hit',
        actor: 'owner',
        subjectSurface: 'ice',
        effects: [{ kind: 'status', status: 'stun', turns: 1, to: { kind: 'subject' } }],
      },
    ],
  },
  {
    id: 'gift.ingrid.widowVeil',
    nameKey: 'gift.ingrid.widowVeil',
    patron: 'ingrid',
    stats: [],
    triggers: [
      {
        on: 'damaged',
        subject: 'owner',
        oncePerTurn: true,
        effects: [{ kind: 'shield', amount: 1, turns: 3, to: { kind: 'self' } }],
      },
    ],
  },

  // ---- Ashtar, the Ash Judge: fire on cells, explosions ----
  {
    id: 'gift.ashtar.judgementFire',
    nameKey: 'gift.ashtar.judgementFire',
    patron: 'ashtar',
    requires: ['area'],
    stats: [],
    triggers: [
      {
        on: 'hit',
        actor: 'owner',
        tags: ['area'],
        effects: [{ kind: 'surface', surface: 'fire', at: 'subject', turns: 3 }],
      },
    ],
  },
  {
    id: 'gift.ashtar.pyre',
    nameKey: 'gift.ashtar.pyre',
    patron: 'ashtar',
    stats: [],
    triggers: [
      { on: 'death', subject: 'foe', effects: [{ kind: 'surface', surface: 'fire', at: 'subject', turns: 3 }] },
    ],
  },
  {
    id: 'gift.ashtar.searingBlood',
    nameKey: 'gift.ashtar.searingBlood',
    patron: 'ashtar',
    requiresStatus: 'burning',
    stats: [],
    triggers: [
      {
        on: 'turnEnd',
        subject: 'foe',
        subjectStatus: 'burning',
        effectTags: FIRE,
        effects: [{ kind: 'damage', amount: 1, to: { kind: 'subject' } }],
      },
    ],
  },
  {
    id: 'gift.ashtar.ashBurst',
    nameKey: 'gift.ashtar.ashBurst',
    patron: 'ashtar',
    requiresStatus: 'burning',
    stats: [],
    triggers: [
      {
        on: 'death',
        subject: 'foe',
        subjectStatus: 'burning',
        effectTags: FIRE,
        effects: [
          {
            kind: 'damage',
            amount: 2,
            to: { kind: 'around', center: 'subject', radius: 1, filter: 'notAlliedPlayers' },
          },
        ],
      },
    ],
  },
  {
    id: 'gift.ashtar.torchbearer',
    nameKey: 'gift.ashtar.torchbearer',
    patron: 'ashtar',
    stats: [],
    triggers: [
      {
        on: 'hit',
        actor: 'owner',
        tags: ['basic'],
        effects: [{ kind: 'status', status: 'burning', turns: 2, to: { kind: 'subject' } }],
      },
    ],
  },

  // ---- Duo gifts ----
  {
    id: 'duo.plagueDead',
    nameKey: 'duo.plagueDead',
    requires: ['summon'],
    patrons: ['morra', 'silas'],
    stats: [],
    triggers: [
      {
        on: 'hit',
        actor: 'ownSummon',
        effects: [{ kind: 'status', status: 'poison', turns: 3, amount: 1, to: { kind: 'subject' } }],
      },
      {
        on: 'death',
        subject: 'ownSummon',
        effects: [{ kind: 'surface', surface: 'poisonCloud', at: 'subject', radius: 1, turns: 3 }],
      },
    ],
  },
  {
    id: 'duo.firestorm',
    nameKey: 'duo.firestorm',
    patrons: ['velkar', 'ashtar'],
    stats: [],
    triggers: [
      {
        on: 'damaged',
        actor: 'owner',
        subject: 'foe',
        tags: ['lightning'],
        effects: [{ kind: 'status', status: 'burning', turns: 2, to: { kind: 'subject' } }],
      },
    ],
  },
  {
    id: 'duo.iceStorm',
    nameKey: 'duo.iceStorm',
    requires: ['push'],
    patrons: ['ingrid', 'velkar'],
    stats: [],
    triggers: [
      {
        on: 'enterCell',
        actor: 'owner',
        subject: 'foe',
        tags: ['push'],
        subjectSurface: 'ice',
        effectTags: ZAP,
        effects: [
          { kind: 'damage', amount: 1, to: { kind: 'subject' } },
          { kind: 'status', status: 'stun', turns: 1, to: { kind: 'subject' } },
        ],
      },
    ],
  },
  {
    id: 'duo.plagueFlame',
    nameKey: 'duo.plagueFlame',
    requiresStatus: 'burning',
    patrons: ['ashtar', 'morra'],
    stats: [],
    triggers: [
      {
        on: 'turnEnd',
        subject: 'foe',
        subjectStatus: 'burning',
        effects: [{ kind: 'status', status: 'poison', turns: 3, amount: 1, to: { kind: 'subject' } }],
      },
    ],
  },
  {
    id: 'duo.iceGuardians',
    nameKey: 'duo.iceGuardians',
    requires: ['summon'],
    patrons: ['silas', 'ingrid'],
    stats: [],
    triggers: [
      {
        on: 'hit',
        actor: 'ownSummon',
        effects: [{ kind: 'status', status: 'stun', turns: 1, to: { kind: 'subject' } }],
      },
    ],
  },
];

const giftsOf = (patron: string) => GIFTS.filter((g) => g.patron === patron).map((g) => g.id);

/** The dark pantheon (GDD 2). */
export const PATRONS: readonly PatronDef[] = [
  {
    id: 'morra',
    nameKey: 'patron.morra',
    color: 0x8ac040,
    icon: '☣',
    voiceKey: 'voice.morra',
    gifts: giftsOf('morra'),
  },
  {
    id: 'velkar',
    nameKey: 'patron.velkar',
    color: 0x60c8ff,
    icon: '⚡',
    voiceKey: 'voice.velkar',
    gifts: giftsOf('velkar'),
  },
  {
    id: 'silas',
    nameKey: 'patron.silas',
    color: 0xe8dcc0,
    icon: '☠',
    voiceKey: 'voice.silas',
    gifts: giftsOf('silas'),
  },
  {
    id: 'ingrid',
    nameKey: 'patron.ingrid',
    color: 0xb8e8ff,
    icon: '❄',
    voiceKey: 'voice.ingrid',
    gifts: giftsOf('ingrid'),
  },
  {
    id: 'ashtar',
    nameKey: 'patron.ashtar',
    color: 0xff8a30,
    icon: '♨',
    voiceKey: 'voice.ashtar',
    gifts: giftsOf('ashtar'),
  },
];

/** Hybrids: two classes together give a new name and a feature (the owner's idea). */
export const HYBRIDS: readonly HybridDef[] = [
  {
    id: 'hybrid.runeKnight',
    nameKey: 'hybrid.runeKnight',
    classes: ['knight', 'necromancer'],
    rule: {
      id: 'hybrid.runeKnight',
      nameKey: 'hybrid.runeKnight',
      stats: [],
      triggers: [
        { on: 'pushed', actor: 'owner', subject: 'foe', effects: [{ kind: 'surface', surface: 'trap', at: 'from' }] },
      ],
    },
  },
  {
    id: 'hybrid.necroAssassin',
    nameKey: 'hybrid.necroAssassin',
    classes: ['necromancer', 'rogue'],
    rule: {
      id: 'hybrid.necroAssassin',
      nameKey: 'hybrid.necroAssassin',
      stats: [],
      triggers: [
        {
          on: 'hit',
          actor: 'owner',
          backstab: true,
          effects: [
            {
              kind: 'summon',
              unit: 'necro.skeleton',
              at: { near: 'subject', radius: 1, surface: ['corpse', 'blood'] },
              consumes: ['corpse', 'blood'],
            },
          ],
        },
      ],
    },
  },
  {
    id: 'hybrid.duelist',
    nameKey: 'hybrid.duelist',
    classes: ['knight', 'rogue'],
    rule: {
      id: 'hybrid.duelist',
      nameKey: 'hybrid.duelist',
      stats: [],
      triggers: [
        {
          on: 'hit',
          actor: 'owner',
          backstab: true,
          effects: [{ kind: 'status', status: 'duelist', turns: 3, to: { kind: 'self' } }],
        },
      ],
    },
  },
];

export const CLASSES: readonly ClassDef[] = [
  {
    id: 'knight',
    nameKey: 'class.knight',
    maxHp: 16,
    abilities: ['knight.sword', 'knight.shieldBash'],
    passives: ['knight.bulwark'],
    pool: ['knight.dash', 'knight.challenge', 'knight.shieldWall', 'knight.crush'],
  },
  {
    id: 'necromancer',
    nameKey: 'class.necromancer',
    maxHp: 13,
    abilities: ['necro.staff', 'necro.raise'],
    passives: ['necro.gravedigger'],
    pool: ['necro.boneSpear', 'necro.sacrifice', 'necro.curse', 'necro.boneWall'],
  },
  {
    id: 'rogue',
    nameKey: 'class.rogue',
    maxHp: 13,
    abilities: ['rogue.dagger', 'rogue.shadowStep'],
    passives: ['rogue.backstab'],
    pool: ['rogue.knife', 'rogue.swap', 'rogue.smoke', 'rogue.poisonBlade'],
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
    maxHp: 12,
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

  // ---- Act 1, the Crypt ----
  {
    id: 'ghoul',
    nameKey: 'enemy.ghoul',
    maxHp: 4,
    move: 2,
    attack: { kind: 'melee', damage: 2 },
    behavior: { kind: 'melee' },
    model: 'ghoul',
    weight: 2,
    // It eats a corpse next to it at the end of every turn: fights the Necromancer for the dead.
    traits: [
      {
        on: 'turnEnd',
        subject: 'owner',
        effects: [
          {
            kind: 'consume',
            surface: 'corpse',
            radius: 1,
            effects: [{ kind: 'heal', amount: 2, to: { kind: 'self' } }],
          },
        ],
      },
    ],
  },

  // ---- Act 2, the Flooded Catacombs ----
  {
    id: 'drowned',
    nameKey: 'enemy.drowned',
    maxHp: 5,
    move: 1,
    attack: { kind: 'line', damage: 1, range: 4, onHit: [{ kind: 'pull', distance: 2 }] },
    behavior: { kind: 'ranged', minRange: 2, maxRange: 4 },
    model: 'drowned',
    weight: 3,
  },
  {
    id: 'bloated',
    nameKey: 'enemy.bloated',
    maxHp: 3,
    move: 1,
    attack: { kind: 'melee', damage: 1 },
    behavior: { kind: 'melee' },
    model: 'bloated',
    weight: 2,
    onDeath: [{ kind: 'surface', surface: 'poisonCloud', at: 'self', radius: 1, turns: 3 }],
  },
  {
    id: 'leech',
    nameKey: 'enemy.leech',
    maxHp: 2,
    move: 2,
    attack: { kind: 'melee', damage: 1, onHit: [{ kind: 'status', status: 'bleed', turns: 2 }] },
    behavior: { kind: 'melee' },
    model: 'leech',
    weight: 1,
    pack: 3,
  },
  {
    id: 'drownedMother',
    nameKey: 'enemy.drownedMother',
    maxHp: 18,
    move: 1,
    attack: { kind: 'sweep', damage: 3 },
    pattern: [
      { kind: 'line', damage: 3, range: 6, surface: { id: 'water' } },
      { kind: 'summon', unit: 'leech', count: 2 },
      { kind: 'sweep', damage: 3 },
    ],
    behavior: { kind: 'melee' },
    model: 'mother',
    weight: 0,
    pushFactor: 0.5,
    boss: true,
  },

  // ---- Act 3, the Cathedral of the Fallen God ----
  {
    id: 'templar',
    nameKey: 'enemy.templar',
    maxHp: 6,
    move: 1,
    attack: { kind: 'melee', damage: 3 },
    behavior: { kind: 'melee' },
    model: 'templar',
    weight: 3,
    // A shield in front, never caught off guard, and it turns on whoever hits it.
    frontArmor: 2,
    immune: ['daze'],
    traits: [{ on: 'hit', subject: 'owner', effects: [{ kind: 'faceActor' }] }],
  },
  {
    id: 'acolyte',
    nameKey: 'enemy.acolyte',
    maxHp: 4,
    move: 1,
    attack: { kind: 'line', damage: 1, range: 5 },
    pattern: [
      { kind: 'aid', range: 5, effects: [{ kind: 'shield', amount: 3, turns: 3 }] },
      { kind: 'line', damage: 1, range: 5 },
    ],
    behavior: { kind: 'ranged', minRange: 3, maxRange: 5 },
    model: 'acolyte',
    weight: 2,
  },
  {
    id: 'bellringer',
    nameKey: 'enemy.bellringer',
    maxHp: 5,
    move: 1,
    attack: { kind: 'burst', damage: 2, radius: 1, onHit: [{ kind: 'status', status: 'stun', turns: 1 }] },
    behavior: { kind: 'melee' },
    model: 'bellringer',
    weight: 2,
  },
  {
    id: 'fallenVoice',
    nameKey: 'enemy.fallenVoice',
    maxHp: 26,
    move: 1,
    attack: { kind: 'blast', damage: 3, radius: 1 },
    pattern: [
      { kind: 'blast', damage: 3, radius: 1, surface: { id: 'holyFire', turns: 3 } },
      { kind: 'summon', unit: 'acolyte', count: 1 },
      { kind: 'blast', damage: 3, radius: 1, surface: { id: 'holyFire', turns: 3 } },
    ],
    behavior: { kind: 'ranged', minRange: 3, maxRange: 6 },
    model: 'voice',
    weight: 0,
    pushFactor: 0.5,
    boss: true,
    // At half health the floor cracks with holy fire and it comes down to fight.
    phases: [
      {
        hpAtMost: 13,
        move: 2,
        behavior: { kind: 'melee' },
        pattern: [
          { kind: 'sweep', damage: 4 },
          { kind: 'burst', damage: 3, radius: 1 },
        ],
        onEnter: [{ kind: 'scatterSurface', surface: 'holyFire', count: 8 }],
      },
    ],
  },
];

/** Things in a room rather than fighters (M6b). */
export const OBJECTS: readonly EnemyDef[] = [
  {
    // Break it (it costs a turn) for holy water: heals the heroes next to it, leaves a corpse.
    id: 'sarcophagus',
    nameKey: 'enemy.sarcophagus',
    maxHp: 3,
    move: 0,
    attack: { kind: 'melee', damage: 0 },
    behavior: { kind: 'melee' },
    model: 'sarcophagus',
    weight: 0,
    inert: true,
    pushFactor: 0,
    onDeath: [
      { kind: 'heal', amount: 3, to: { kind: 'around', center: 'self', radius: 1, filter: 'foes' } },
      { kind: 'surface', surface: 'corpse', at: 'self' },
    ],
  },
  {
    // A "Totem" room's goal: it calls up an enemy every few turns until it is broken (owner: every 3
    // turns with no limit was unbeatable).
    id: 'totem',
    nameKey: 'enemy.totem',
    maxHp: 5,
    move: 0,
    attack: { kind: 'melee', damage: 0 },
    behavior: { kind: 'melee' },
    model: 'totem',
    weight: 0,
    inert: true,
    pushFactor: 0,
    spawnEvery: 5,
    spawnWhileBelow: 3,
  },
];

/** Elite traits (M6b). */
export const AFFIXES: readonly AffixDef[] = [
  { id: 'swift', nameKey: 'affix.swift', icon: '»', move: 1 },
  {
    id: 'explosive',
    nameKey: 'affix.explosive',
    icon: '✹',
    onDeath: [{ kind: 'damage', amount: 2, to: { kind: 'around', center: 'self', radius: 1, filter: 'any' } }],
  },
  {
    id: 'vampire',
    nameKey: 'affix.vampire',
    icon: '♆',
    traits: [{ on: 'hit', actor: 'owner', effects: [{ kind: 'heal', amount: 1, to: { kind: 'self' } }] }],
  },
  { id: 'shielded', nameKey: 'affix.shielded', icon: '⛉', frontArmor: 2 },
  {
    id: 'thorny',
    nameKey: 'affix.thorny',
    icon: '✣',
    traits: [
      {
        on: 'damaged',
        subject: 'owner',
        tags: ['melee'],
        effects: [{ kind: 'damage', amount: 1, to: { kind: 'actor' } }],
      },
    ],
  },
];

/** Chapel upgrades (M6b, GDD 3): bought with Ash between runs, each with a cap. */
export const PERKS: readonly PerkDef[] = [
  { id: 'vitality', nameKey: 'perk.vitality', icon: '♥', costs: [4, 8, 12], effect: { kind: 'maxHp', add: 3 } },
  { id: 'reroll', nameKey: 'perk.reroll', icon: '↻', costs: [5, 10], effect: { kind: 'rerolls', add: 1 } },
  { id: 'gift', nameKey: 'perk.startModifier', icon: '✦', costs: [8], effect: { kind: 'startModifier' } },
  { id: 'rest', nameKey: 'perk.restHeal', icon: '☕', costs: [6], effect: { kind: 'restHeal', add: 0.25 } },
  { id: 'secondWind', nameKey: 'perk.revive', icon: '✚', costs: [12, 20], effect: { kind: 'revive', add: 1 } },
];

/** How often each room goal shows up on combat doors (act 1, room 1 is always a plain fight). */
export const GOAL_WEIGHTS: readonly { readonly item: RoomGoal; readonly weight: number }[] = [
  { item: 'clear', weight: 5 },
  { item: 'survive', weight: 1 },
  { item: 'totem', weight: 1 },
  { item: 'ambush', weight: 1 },
  { item: 'hunt', weight: 1 },
];

/** The three acts' places (GDD 1). */
export const BIOMES: readonly BiomeDef[] = [
  {
    id: 'crypt',
    nameKey: 'biome.crypt',
    enemies: [
      { id: 'skeletonWarrior', weight: 3 },
      { id: 'skeletonArcher', weight: 2 },
      { id: 'ghoul', weight: 1 },
    ],
    boss: 'cryptWarden',
    features: [{ surface: 'spikes', patches: 2, size: 1 }],
    objects: [{ enemy: 'sarcophagus', count: 1 }],
  },
  {
    id: 'catacombs',
    nameKey: 'biome.catacombs',
    enemies: [
      { id: 'drowned', weight: 3 },
      { id: 'bloated', weight: 2 },
      { id: 'leech', weight: 1 },
      { id: 'skeletonWarrior', weight: 1 },
    ],
    boss: 'drownedMother',
    features: [
      { surface: 'water', patches: 3, size: 5 },
      { surface: ['currentN', 'currentE', 'currentS', 'currentW'], patches: 2, size: 4, straight: true },
    ],
    spread: { surface: 'water', every: 4, count: 2 },
    // Long flooded halls: fewer pits (the water is the hazard here).
    layout: { shapes: ['rect', 'l', 'cross'], pits: [4, 4, 1, 0] },
  },
  {
    id: 'cathedral',
    nameKey: 'biome.cathedral',
    enemies: [
      { id: 'templar', weight: 3 },
      { id: 'acolyte', weight: 2 },
      { id: 'bellringer', weight: 2 },
      { id: 'ghoul', weight: 1 },
    ],
    boss: 'fallenVoice',
    features: [{ surface: 'holyFire', patches: 2, size: 2 }],
    omens: { every: 3, damage: 3 },
    // Naves and colonnades.
    layout: {
      shapes: ['rect', 'cross', 'chamfer'],
      pillars: { none: 0, scatter: 1, symmetric: 3, rows: 5 },
      pits: [4, 3, 1, 0],
    },
  },
];

/** Shape of one act (GDD 1): combat rooms, then the boss. */
export const ACT = {
  /** Rooms before the boss, in each act. */
  rooms: 5,
  /** Acts in a run, one biome each. */
  acts: 3,
  /** Elite rooms at most per act. */
  maxElites: 2,
  /** Treasure doors at most per act. */
  maxTreasures: 1,
  /** Altars at most per act; the run's first is guaranteed in rooms 2–3 of act 1. */
  maxAltars: 2,
  /** Chance a duo gift takes the third card on an altar when it is unlocked. */
  duoChance: 0.5,
  /** Rooms (1-based) in which the Initiation door shows up, once per act. */
  initiationFrom: 1,
  initiationBy: 3,
  /** Share of max health a rest room restores. */
  restHeal: 0.5,
  /** Share of max health restored on the way into a new act (after its boss). */
  actHeal: 1,
  /** Reward options offered at once (pick 1 of 3). */
  offer: 3,
  /** Ash for the Chapel (M6b): per cleared room, per elite room, per boss, for winning the run. */
  ash: { room: 1, elite: 2, boss: 5, win: 10 },
  /** Share of max health a second wind gets you back. */
  reviveShare: 0.5,
  /** "Survive": turns to hold out, and a wave of two enemies every this many turns. */
  surviveTurns: 8,
  waveEvery: 3,
  /** "Ambush": enemies start this close, one fewer of them. */
  ambushDistance: 2,
  /** "Hunt": the leader's extra health. */
  leaderHp: 3,
  /** Acts from which one enemy in each fight carries an elite trait. */
  affixFromAct: 2,
  /** Extra health of elite enemies, and extra enemies in an elite room. */
  eliteHp: 2,
  eliteExtra: 1,
  /** Gold (M6c): per cleared room (a range), extra for elite and boss rooms, and a gold door's pouch. */
  gold: { room: [3, 5], elite: 5, boss: 10, door: [12, 18] },
  /** The merchant shows up once per act, behind a door into one of rooms merchantFrom..merchantBy. */
  merchantFrom: 2,
  merchantBy: 4,
  /** Event rooms at most per act. */
  maxEvents: 2,
} as const;

/** The merchant's prices and wares (M6c). */
export const SHOP = {
  /** Abilities or modifiers on sale, and items. */
  rules: 2,
  items: 2,
  price: { ability: 20, modifier: 15, item: 25, cursedItem: 15 },
  /** Healing: share of max health, and its price. */
  heal: { share: 0.5, price: 10 },
  /** Taking off a cursed item. */
  uncurse: 15,
  /** New wares. */
  reroll: 5,
} as const;

/** Event rooms (M6c): a choice with its price in plain sight. The last option is always walking away. */
const leave: EventOption = { textKey: 'event.leave', outcomes: [{ weight: 1, effects: [] }] };
export const EVENTS: readonly EventDef[] = [
  {
    id: 'bloodWell',
    nameKey: 'event.bloodWell',
    textKey: 'event.bloodWell.text',
    prop: 'well',
    options: [
      {
        textKey: 'event.bloodWell.drink',
        cost: { hp: 4 },
        outcomes: [{ weight: 1, effects: [{ kind: 'reward', reward: 'treasure' }] }],
      },
      leave,
    ],
  },
  {
    id: 'sleepingSarcophagus',
    nameKey: 'event.sleepingSarcophagus',
    textKey: 'event.sleepingSarcophagus.text',
    biomes: ['crypt'],
    prop: 'sarcophagusProp',
    options: [
      {
        textKey: 'event.sleepingSarcophagus.open',
        outcomes: [
          { weight: 1, effects: [{ kind: 'reward', reward: 'treasure' }] },
          { weight: 1, effects: [{ kind: 'fight', enemy: 'skeletonWarrior', elite: true }] },
        ],
      },
      leave,
    ],
  },
  {
    id: 'deadMensDice',
    nameKey: 'event.deadMensDice',
    textKey: 'event.deadMensDice.text',
    prop: 'dice',
    options: [
      {
        textKey: 'event.deadMensDice.bet',
        cost: { gold: 10 },
        outcomes: [
          { weight: 1, effects: [{ kind: 'gold', add: 25 }] },
          { weight: 1, effects: [] },
        ],
      },
      leave,
    ],
  },
  {
    id: 'woundedPilgrim',
    nameKey: 'event.woundedPilgrim',
    textKey: 'event.woundedPilgrim.text',
    prop: 'pilgrim',
    options: [
      {
        textKey: 'event.woundedPilgrim.give',
        cost: { gold: 10 },
        outcomes: [{ weight: 1, effects: [{ kind: 'maxHp', add: 3 }] }],
      },
      {
        textKey: 'event.woundedPilgrim.rob',
        outcomes: [
          {
            weight: 1,
            effects: [
              { kind: 'gold', add: 15 },
              { kind: 'nextFight', elite: true },
            ],
          },
        ],
      },
      leave,
    ],
  },
  {
    id: 'mycelium',
    nameKey: 'event.mycelium',
    textKey: 'event.mycelium.text',
    biomes: ['catacombs'],
    prop: 'mushrooms',
    options: [
      {
        textKey: 'event.mycelium.eat',
        outcomes: [
          {
            weight: 1,
            effects: [
              { kind: 'hp', add: 6 },
              { kind: 'nextFight', status: { id: 'poison', turns: 3 } },
            ],
          },
        ],
      },
      leave,
    ],
  },
  {
    id: 'mirror',
    nameKey: 'event.mirror',
    textKey: 'event.mirror.text',
    prop: 'mirror',
    options: [{ textKey: 'event.mirror.swap', outcomes: [{ weight: 1, effects: [{ kind: 'swapModifier' }] }] }, leave],
  },
  {
    id: 'bell',
    nameKey: 'event.bell',
    textKey: 'event.bell.text',
    biomes: ['cathedral'],
    prop: 'bell',
    options: [
      {
        textKey: 'event.bell.ring',
        outcomes: [{ weight: 1, effects: [{ kind: 'nextFight', stunEnemies: 1, extraEnemies: 1 }] }],
      },
      leave,
    ],
  },
  {
    id: 'bargainAltar',
    nameKey: 'event.bargainAltar',
    textKey: 'event.bargainAltar.text',
    prop: 'bargainAltar',
    options: [
      { textKey: 'event.bargainAltar.give', outcomes: [{ weight: 1, effects: [{ kind: 'sacrifice', upgrades: 2 }] }] },
      leave,
    ],
  },
];

/** How often each kind of reward shows up on doors (only kinds still available are drawn). */
export const DOOR_WEIGHTS: readonly {
  readonly kind: 'ability' | 'modifier' | 'upgrade' | 'rest' | 'elite' | 'treasure' | 'altar' | 'gold' | 'event';
  readonly weight: number;
}[] = [
  { kind: 'ability', weight: 3 },
  { kind: 'modifier', weight: 3 },
  { kind: 'upgrade', weight: 2 },
  { kind: 'rest', weight: 2 },
  { kind: 'elite', weight: 1 },
  { kind: 'treasure', weight: 1 },
  { kind: 'altar', weight: 2 },
  { kind: 'gold', weight: 1 },
  { kind: 'event', weight: 2 },
];

/** Encounter size by depth in the act: weights for 2, 3, 4, 5 enemies. */
export function encounterWeights(depth: number): readonly { readonly item: number; readonly weight: number }[] {
  if (depth <= 2)
    return [
      { item: 2, weight: 4 },
      { item: 3, weight: 3 },
    ];
  if (depth <= 4)
    return [
      { item: 2, weight: 1 },
      { item: 3, weight: 4 },
      { item: 4, weight: 2 },
    ];
  return [
    { item: 3, weight: 3 },
    { item: 4, weight: 3 },
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
export const getItem = byId(ITEMS, 'item');
export const getHybrid = byId(HYBRIDS, 'hybrid');
export const getGift = byId(GIFTS, 'gift');
export const getPatron = byId(PATRONS, 'patron');
export const getClass = byId(CLASSES, 'class');
export const getEnemy = byId([...ENEMIES, ...OBJECTS], 'enemy');
export const getBiome = byId(BIOMES, 'biome');
export const getAffix = byId(AFFIXES, 'affix');
export const getPerk = byId(PERKS, 'perk');
export const getEvent = byId(EVENTS, 'event');
