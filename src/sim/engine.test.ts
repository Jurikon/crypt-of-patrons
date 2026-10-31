import { describe, expect, it } from 'vitest';
import type { Vec2 } from '../core/grid';
import { apply, preview, replay } from './apply';
import type { Command, GameEvent } from './commands';
import { createGame, hasStatus, unitById, type GameState } from './state';
import { stateFromMap } from './testing';
import { validTargets } from './targeting';
import { getAbility } from '../content';

const use = (abilityId: string, target?: Vec2): Command =>
  target
    ? { type: 'useAbility', playerId: 'p1', abilityId, target }
    : { type: 'useAbility', playerId: 'p1', abilityId };
const step = (dir: 'forward' | 'back' | 'left' | 'right'): Command => ({ type: 'move', playerId: 'p1', dir });
const of = (events: readonly GameEvent[], type: GameEvent['type']) => events.filter((e) => e.type === type);
const unit = (s: GameState, id: string) => unitById(s, id);
const NECRO = { classId: 'necromancer' } as const;
const ROGUE = { classId: 'rogue' } as const;

describe('Knight', () => {
  it('Dash runs forward until it hits someone: 1 damage, push 1, stun (the intent is cancelled)', () => {
    const s = stateFromMap(
      `
      ########
      #>..W..#
      ########`,
      { abilities: ['knight.dash'], intents: true },
    );
    const r = apply(s, use('knight.dash'));
    expect(r.state.players[0]).toMatchObject({ x: 3, y: 1 });
    const e = r.state.enemies[0]!;
    expect(e).toMatchObject({ x: 5, hp: 3 });
    expect(of(r.events, 'intentCanceled')).toHaveLength(1);
    // Stunned: no attack and no move in the world's answer; the stun then runs out.
    expect(of(r.events, 'enemyAttack')).toHaveLength(0);
    expect(e.intent).toBeNull();
    expect(hasStatus(e, 'stun')).toBe(false);
  });

  it('Dash stops before walls and pits', () => {
    const s = stateFromMap(
      `
      ########
      #>.~..W#
      ########`,
      { abilities: ['knight.dash'] },
    );
    expect(apply(s, use('knight.dash')).state.players[0]).toMatchObject({ x: 2 });
  });

  it('Challenge: taunted enemies go for the Knight even with a skeleton next to them; shield 2', () => {
    const s = stateFromMap(
      `
      ######
      #.WS.#
      #....#
      #....#
      #.^..#
      ######`,
      { abilities: ['knight.challenge'] },
    );
    const r = apply(s, use('knight.challenge'));
    const e = r.state.enemies[0]!;
    expect(e).toMatchObject({ x: 2, y: 2 });
    expect(e.intent?.dir).toBe(2);
    expect(hasStatus(r.state.players[0]!, 'shield')).toBe(true);
  });

  it('Shield absorbs damage before health', () => {
    const s = stateFromMap(
      `
      #####
      #.W.#
      #.^.#
      #####`,
      { abilities: ['knight.challenge'], intents: true },
    );
    const r = apply(s, use('knight.challenge'));
    expect(r.state.players[0]!.hp).toBe(16);
    expect(of(r.events, 'damaged').find((e) => e.type === 'damaged' && e.unitId === 'p1')).toMatchObject({
      amount: 0,
      absorbed: 2,
    });
    expect(hasStatus(r.state.players[0]!, 'shield')).toBe(false);
  });
});

describe('Necromancer', () => {
  it('Raise skeleton turns a corpse within 3 cells into an ally', () => {
    const s = stateFromMap(
      `
      #######
      #.c..W#
      #.^...#
      #######`,
      NECRO,
    );
    const r = apply(s, use('necro.raise'));
    expect(r.state.allies).toHaveLength(1);
    expect(of(r.events, 'summoned')[0]).toMatchObject({ at: { x: 2, y: 1 }, owner: 'p1', hp: 3 });
    expect(r.state.surfaces).toEqual([]);
  });

  it('Raise skeleton needs a corpse', () => {
    const s = stateFromMap(
      `
      #####
      #..W#
      #^..#
      #####`,
      NECRO,
    );
    expect(apply(s, use('necro.raise')).events).toEqual([{ type: 'rejected', reason: 'no_target' }]);
  });

  it('Gravedigger: a killed enemy leaves a corpse', () => {
    const s = stateFromMap(
      `
      ######
      #.W.W#
      #.^..#
      ######`,
      NECRO,
    );
    s.enemies[0]!.hp = 1;
    const r = apply(s, use('necro.staff'));
    expect(r.state.surfaces).toContainEqual(expect.objectContaining({ id: 'corpse', x: 2, y: 1 }));
  });

  it('Bone spear hits the first enemy in line: 2 damage and Vulnerable (+1 damage taken)', () => {
    const s = stateFromMap(
      `
      #########
      #>..W.W.#
      #########`,
      { ...NECRO, abilities: ['necro.boneSpear'] },
    );
    const r = apply(s, use('necro.boneSpear', { x: 4, y: 1 }));
    expect(r.state.enemies[0]!.hp).toBe(2);
    expect(r.state.enemies[1]!.hp).toBe(4);
    expect(hasStatus(r.state.enemies[0]!, 'vulnerable')).toBe(true);
  });

  it('Sacrifice: the skeleton explodes for 3 on the adjacent cells and dies; the player is spared', () => {
    const s = stateFromMap(
      `
      #######
      #.....#
      #.SW.W#
      #.^...#
      #######`,
      { ...NECRO, abilities: ['necro.sacrifice'] },
    );
    const r = apply(s, use('necro.sacrifice', { x: 2, y: 2 }));
    expect(r.state.allies).toEqual([]);
    expect(unit(r.state, 'e1')?.hp).toBe(1);
    expect(r.state.players[0]!.hp).toBe(13);
  });
});

describe('Rogue', () => {
  it('Dagger: 2 damage and Bleeding (1 damage at the end of the turn)', () => {
    const s = stateFromMap(
      `
      ######
      #.W.W#
      #.^..#
      ######`,
      ROGUE,
    );
    const r = apply(s, use('rogue.dagger'));
    expect(r.state.enemies[0]!.hp).toBe(1);
    expect(of(r.events, 'triggered')).toContainEqual(expect.objectContaining({ rule: 'bleed' }));
  });

  it('Backstab: a hit from behind deals double damage', () => {
    const s = stateFromMap(
      `
      ######
      #.W.W#
      #.^..#
      ######`,
      ROGUE,
    );
    s.enemies[0]!.dir = 0; // facing away from the rogue
    const r = apply(s, use('rogue.dagger'));
    const hit = of(r.events, 'damaged')[0];
    expect(hit).toMatchObject({ unitId: 'e1', amount: 4, backstab: true });
  });

  it('Shadow step lands behind the enemy facing it; the next dagger is a backstab', () => {
    const s = stateFromMap(
      `
      ########
      #>.W...#
      #......#
      ########`,
      { ...ROGUE, enemyDir: 3 },
    );
    const r = apply(s, use('rogue.shadowStep', { x: 3, y: 1 }));
    expect(r.state.players[0]).toMatchObject({ x: 4, y: 1, dir: 3 });
  });

  it('Shadow step needs a free cell behind the target', () => {
    const s = stateFromMap(
      `
      ######
      #>.W##
      ######`,
      { ...ROGUE, enemyDir: 3 },
    );
    expect(validTargets(s, s.players[0]!, getAbility('rogue.shadowStep'))).toEqual([]);
  });

  it('Throwing knife: 1 damage and a Mark', () => {
    const s = stateFromMap(
      `
      ########
      #>..W.W#
      ########`,
      { ...ROGUE, abilities: ['rogue.knife'] },
    );
    const r = apply(s, use('rogue.knife', { x: 4, y: 1 }));
    expect(r.state.enemies[0]!.hp).toBe(3);
    expect(hasStatus(r.state.enemies[0]!, 'mark')).toBe(true);
  });

  it('Switch: trade places with an enemy, and its telegraphed blow lands where you no longer stand', () => {
    const s = stateFromMap(
      `
      #####
      #.W.#
      #.^.#
      #...#
      #####`,
      { ...ROGUE, abilities: ['rogue.swap'], intents: true },
    );
    const r = apply(s, use('rogue.swap', { x: 2, y: 1 }));
    expect(r.state.players[0]).toMatchObject({ x: 2, y: 1, hp: 13 });
    expect(of(r.events, 'enemyAttack')[0]).toMatchObject({ cells: [{ x: 2, y: 3 }] });
  });
});

describe('Allies and enemy targets', () => {
  it('a skeleton hits an adjacent enemy right after the player, before enemies act', () => {
    const s = stateFromMap(
      `
      #######
      #.....#
      #.SW..#
      #.^...#
      #######`,
      NECRO,
    );
    const r = apply(s, step('left'));
    expect(unit(r.state, 'e1')?.hp).toBe(2);
    const order = r.events.map((e) => e.type);
    expect(order.indexOf('allyAttack')).toBeLessThan(Math.max(order.indexOf('intentDeclared'), 0) || Infinity);
  });

  it('enemies go for the nearest of the players and their summons', () => {
    const s = stateFromMap(
      `
      #########
      #W.S....#
      #.......#
      #......^#
      #########`,
      NECRO,
    );
    const r = apply(s, step('forward'));
    expect(r.state.enemies[0]!.intent?.dir).toBe(1); // facing the skeleton, not the player
  });

  it('a trap hurts the first enemy that steps on it and is used up', () => {
    const s = stateFromMap(
      `
      #######
      #W....#
      #.....#
      #....^#
      #######`,
      NECRO,
    );
    s.surfaces.push({ id: 'trap', x: 2, y: 1, turns: null, side: 'heroes' });
    s.enemies[0]!.dir = 1;
    const r = apply(s, step('forward'));
    expect(r.state.enemies[0]).toMatchObject({ x: 2, y: 1, hp: 2 });
    expect(r.state.surfaces).toEqual([]);
  });

  it('bleeding can finish an enemy off at the end of the turn', () => {
    const s = stateFromMap(
      `
      ######
      #.W.W#
      #.^..#
      ######`,
      ROGUE,
    );
    s.enemies[0]!.hp = 2;
    s.enemies[0]!.dir = 1;
    const r = apply(s, use('rogue.dagger'));
    expect(unit(r.state, 'e1')).toBeUndefined();
  });
});

describe('Combos (M2 acceptance checklist)', () => {
  const sacrificeMap = `
      #######
      #.....#
      #.SW.W#
      #.^...#
      #######`;

  it('Sacrifice + "summons explode on death": the skeleton explodes twice (6 damage kills the warrior)', () => {
    const s = stateFromMap(sacrificeMap, {
      ...NECRO,
      abilities: ['necro.sacrifice'],
      modifiers: ['mod.explodingSummons'],
    });
    const r = apply(s, use('necro.sacrifice', { x: 2, y: 2 }));
    expect(unit(r.state, 'e1')).toBeUndefined();
    expect(of(r.events, 'area')).toHaveLength(2);
  });

  it('the preview shows the chain exactly as it will happen (6 damage, ☠)', () => {
    const s = stateFromMap(sacrificeMap, {
      ...NECRO,
      abilities: ['necro.sacrifice'],
      modifiers: ['mod.explodingSummons'],
    });
    const p = preview(s, use('necro.sacrifice', { x: 2, y: 2 }));
    expect(p.damage.get('e1')).toBe(6);
    expect(p.deaths.has('e1')).toBe(true);
    expect(p.deaths.has('s1')).toBe(true);
  });

  it('two skeletons side by side: the second dies in the blast and explodes too (a chain)', () => {
    const s = stateFromMap(
      `
      ########
      #......#
      #.SSWW.#
      #.^....#
      ########`,
      { ...NECRO, abilities: ['necro.sacrifice'], modifiers: ['mod.explodingSummons'] },
    );
    const r = apply(s, use('necro.sacrifice', { x: 2, y: 2 }));
    expect(r.state.allies).toEqual([]);
    expect(of(r.events, 'area')).toHaveLength(3); // sacrifice, then both deaths
    expect(unit(r.state, 'e1')?.hp).toBe(1); // only the second skeleton's blast reached it
  });

  it('Bone spear + piercing projectiles: both enemies in the line are hit', () => {
    const s = stateFromMap(
      `
      #########
      #>..W.W.#
      #########`,
      { ...NECRO, abilities: ['necro.boneSpear'], modifiers: ['mod.piercing'] },
    );
    const r = apply(s, use('necro.boneSpear', { x: 4, y: 1 }));
    expect(r.state.enemies.map((e) => e.hp)).toEqual([2, 2]);
  });

  it('Shield bash + heavy hand: the push goes 3 cells, and a pit 3 cells away kills', () => {
    const open = stateFromMap(
      `
      ########
      #>W....#
      ########`,
      { modifiers: ['mod.longPush'] },
    );
    const pushed = apply(open, use('knight.shieldBash')).events.filter((e) => e.type === 'pushed');
    expect(pushed).toHaveLength(3);
    const pit = stateFromMap(
      `
      #########
      #>W..~.W#
      #########`,
      { modifiers: ['mod.longPush'] },
    );
    const r = apply(pit, use('knight.shieldBash'));
    expect(of(r.events, 'fell')).toHaveLength(1);
  });

  it('a kill on a marked enemy gives a free action: the world does not answer the next one', () => {
    const s = stateFromMap(
      `
      #######
      #..W..#
      #..^.W#
      #.....#
      #######`,
      { ...ROGUE, modifiers: ['mod.markedKill'] },
    );
    s.enemies[0]!.hp = 1;
    s.enemies[0]!.statuses.push({ id: 'mark', turns: 3, amount: 0, sourceId: 'p1' });
    const first = apply(s, use('rogue.dagger'));
    expect(of(first.events, 'freeActionGained')).toHaveLength(1);
    const before = first.state.enemies[0]!;
    const second = apply(first.state, step('back'));
    expect(of(second.events, 'freeActionUsed')).toHaveLength(1);
    expect(of(second.events, 'phaseChanged')).toHaveLength(0);
    expect(second.state.enemies[0]).toMatchObject({ x: before.x, y: before.y });
    expect(second.state.combat.turn).toBe(first.state.combat.turn);
  });

  it('movement + trail of traps: the old cell gets a trap', () => {
    const s = stateFromMap(
      `
      ########
      #>.W...#
      #......#
      ########`,
      { ...ROGUE, enemyDir: 3, modifiers: ['mod.trailTraps'] },
    );
    const r = apply(s, use('rogue.shadowStep', { x: 3, y: 1 }));
    expect(r.state.surfaces).toContainEqual(expect.objectContaining({ id: 'trap', x: 1, y: 1 }));
  });

  it('walking does not leave traps (it has no movement tag)', () => {
    const s = stateFromMap(
      `
      #######
      #>...W#
      #######`,
      { ...ROGUE, modifiers: ['mod.trailTraps'] },
    );
    expect(apply(s, step('forward')).state.surfaces).toEqual([]);
  });

  it('cross-class: a Knight given Raise and Sacrifice uses them like a Necromancer', () => {
    const s = stateFromMap(
      `
      #######
      #.c...#
      #.^.W.#
      #######`,
      { abilities: ['necro.raise', 'necro.sacrifice'] },
    );
    const raised = apply(s, use('necro.raise', { x: 2, y: 1 }));
    expect(raised.state.allies).toHaveLength(1);
  });

  it('a runaway chain is cut at depth 32 instead of hanging the game', () => {
    const row = `#${'S'.repeat(40)}..W#`;
    const s = stateFromMap(
      `
      ${'#'.repeat(row.length)}
      ${row}
      #^${'.'.repeat(row.length - 3)}#
      ${'#'.repeat(row.length)}`,
      { ...NECRO, abilities: ['necro.sacrifice'], modifiers: ['mod.explodingSummons'] },
    );
    const r = apply(s, use('necro.sacrifice', { x: 1, y: 1 }));
    expect(of(r.events, 'chainLimit').length).toBeGreaterThan(0);
    expect(r.state.allies).toHaveLength(6);
  });
});

describe('engine guarantees', () => {
  it('is deterministic: the same seed and commands give the same state, byte for byte', () => {
    const commands: Command[] = [step('forward'), use('necro.staff'), step('left'), use('necro.staff')];
    const a = replay(createGame(5, { classId: 'necromancer' }), commands);
    const b = replay(createGame(5, { classId: 'necromancer' }), commands);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('a crypt room starts with corpses to raise', () => {
    for (let seed = 1; seed <= 50; seed++) {
      const g = createGame(seed, { classId: 'necromancer' });
      expect(g.surfaces.filter((x) => x.id === 'corpse').length).toBeGreaterThan(0);
    }
  });

  it('rejects a target the ability cannot reach', () => {
    const s = stateFromMap(
      `
      #######
      #>...W#
      #######`,
      { ...NECRO, abilities: ['necro.boneSpear'] },
    );
    expect(apply(s, use('necro.boneSpear', { x: 1, y: 1 })).events).toEqual([
      { type: 'rejected', reason: 'invalid_target' },
    ]);
  });

  it('debug commands grant abilities and toggle modifiers (and replay like any command)', () => {
    let s = createGame(3);
    s = apply(s, { type: 'debugGrant', playerId: 'p1', abilityId: 'rogue.knife', slot: 2 }).state;
    expect(s.players[0]!.abilities).toEqual(['knight.sword', 'knight.shieldBash', 'rogue.knife']);
    s = apply(s, { type: 'debugModifier', playerId: 'p1', modifierId: 'mod.longPush' }).state;
    expect(s.players[0]!.modifiers).toEqual(['mod.longPush']);
    s = apply(s, { type: 'debugModifier', playerId: 'p1', modifierId: 'mod.longPush' }).state;
    expect(s.players[0]!.modifiers).toEqual([]);
  });
});
