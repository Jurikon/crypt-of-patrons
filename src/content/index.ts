import type { AbilityDef, ClassDef, EnemyDef, PassiveDef } from './types';

export type * from './types';

export const ABILITIES: readonly AbilityDef[] = [
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
];

export const PASSIVES: readonly PassiveDef[] = [
  {
    id: 'knight.bulwark',
    nameKey: 'passive.knight.bulwark',
    stats: [{ stat: 'pushCollisionBonus', add: 2 }],
  },
];

export const CLASSES: readonly ClassDef[] = [
  {
    id: 'knight',
    nameKey: 'class.knight',
    maxHp: 12,
    abilities: ['knight.sword', 'knight.shieldBash'],
    passives: ['knight.bulwark'],
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
    sprite: 'warrior',
    weight: 3,
  },
  {
    id: 'skeletonArcher',
    nameKey: 'enemy.skeletonArcher',
    maxHp: 3,
    move: 1,
    attack: { kind: 'line', damage: 1, range: 6 },
    behavior: { kind: 'ranged', minRange: 2, maxRange: 5 },
    sprite: 'archer',
    weight: 2,
  },
];

/** Base damage a pushed unit takes when it hits something; passives add to it. */
export const PUSH_COLLISION_DAMAGE = 1;

function byId<T extends { readonly id: string }>(list: readonly T[], kind: string): (id: string) => T {
  return (id) => {
    const found = list.find((x) => x.id === id);
    if (!found) throw new Error(`Unknown ${kind}: ${id}`);
    return found;
  };
}

export const getAbility = byId(ABILITIES, 'ability');
export const getPassive = byId(PASSIVES, 'passive');
export const getClass = byId(CLASSES, 'class');
export const getEnemy = byId(ENEMIES, 'enemy');
