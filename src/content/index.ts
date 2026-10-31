import type { AbilityDef, ClassDef, EnemyDef, HybridDef, RuleDef, StatusDef, SummonDef, SurfaceDef } from './types';

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
  {
    id: 'mod.fireTrail',
    nameKey: 'modifier.fireTrail',
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
  { id: 'mod.longReach', nameKey: 'modifier.longReach', stats: [{ stat: 'projectileRange', add: 2 }], triggers: [] },
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
  { id: 'mod.doubleSummon', nameKey: 'modifier.doubleSummon', stats: [{ stat: 'extraSummons', add: 1 }], triggers: [] },
];

export const STATUSES: readonly StatusDef[] = [
  {
    id: 'bleed',
    nameKey: 'status.bleed',
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
    icon: '🔥',
    stats: [],
    triggers: [{ on: 'turnEnd', subject: 'owner', effects: [{ kind: 'damage', amount: 1, to: { kind: 'self' } }] }],
  },
  {
    id: 'curse',
    nameKey: 'status.curse',
    icon: '💀',
    stats: [{ stat: 'damageTaken', add: 1 }],
    triggers: [],
    jumps: true,
  },
  { id: 'daze', nameKey: 'status.daze', icon: '🌀', stats: [], triggers: [], rooted: true },
  { id: 'blind', nameKey: 'status.blind', icon: '🌫', stats: [], triggers: [], blind: true },
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
  { id: 'ice', nameKey: 'surface.ice', triggers: [] },
  { id: 'fire', nameKey: 'surface.fire', triggers: LINGER('burning', 2) },
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
    icon: '🚩',
    stats: [{ stat: 'auraDamage', add: 1 }],
    triggers: [],
  },
  {
    id: 'item.judgeEye',
    nameKey: 'item.judgeEye',
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
  /** Treasure doors at most per act. */
  maxTreasures: 1,
  /** Rooms (1-based) in which the Initiation door shows up, once per act. */
  initiationFrom: 1,
  initiationBy: 3,
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
  readonly kind: 'ability' | 'modifier' | 'upgrade' | 'rest' | 'elite' | 'treasure';
  readonly weight: number;
}[] = [
  { kind: 'ability', weight: 3 },
  { kind: 'modifier', weight: 3 },
  { kind: 'upgrade', weight: 2 },
  { kind: 'rest', weight: 2 },
  { kind: 'elite', weight: 1 },
  { kind: 'treasure', weight: 1 },
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
export const getItem = byId(ITEMS, 'item');
export const getHybrid = byId(HYBRIDS, 'hybrid');
export const getClass = byId(CLASSES, 'class');
export const getEnemy = byId(ENEMIES, 'enemy');
