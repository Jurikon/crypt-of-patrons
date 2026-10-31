import { describe, expect, it } from 'vitest';
import { apply, preview, replay } from './apply';
import type { Command, GameEvent } from './commands';
import { stateFromMap } from './testing';

const sword: Command = { type: 'useAbility', playerId: 'p1', abilityId: 'knight.sword' };
const bash: Command = { type: 'useAbility', playerId: 'p1', abilityId: 'knight.shieldBash' };
const endTurn: Command = { type: 'endTurn', playerId: 'p1' };
const types = (events: readonly GameEvent[]) => events.map((e) => e.type);

describe('Knight: sword strike', () => {
  it('deals 2 damage to the unit in front for 1 AP', () => {
    const s = stateFromMap(`
      #####
      #.W.#
      #.^.#
      #...#
      #####`);
    const r = apply(s, sword);
    expect(r.state.enemies[0]!.hp).toBe(2);
    expect(r.state.players[0]!.ap).toBe(2);
    expect(r.state.players[0]!.attackedThisTurn).toBe(true);
    expect(types(r.events)).toEqual(['abilityUsed', 'damaged']);
  });

  it('kills and wins the combat when the last enemy dies', () => {
    const s = stateFromMap(`
      #####
      #.A.#
      #.^.#
      #####`);
    s.enemies[0]!.hp = 2;
    const r = apply(s, sword);
    expect(r.state.enemies).toEqual([]);
    expect(r.state.combat.status).toBe('won');
    expect(types(r.events)).toEqual(['abilityUsed', 'damaged', 'died', 'combatEnded']);
  });

  it('can hit empty air (AP is still spent)', () => {
    const s = stateFromMap(`
      #####
      #...#
      #.^.#
      #..W#
      #####`);
    const r = apply(s, sword);
    expect(r.state.players[0]!.ap).toBe(2);
    expect(types(r.events)).toEqual(['abilityUsed']);
  });
});

describe('Knight: shield bash and push', () => {
  it('pushes 2 cells in open space for 1 damage', () => {
    const s = stateFromMap(`
      #######
      #.....#
      #>W...#
      #.....#
      #######`);
    const r = apply(s, bash);
    expect(r.state.enemies[0]).toMatchObject({ x: 4, y: 2, hp: 3 });
    expect(r.state.players[0]!.ap).toBe(1);
    expect(types(r.events)).toEqual(['abilityUsed', 'damaged', 'pushed', 'pushed']);
  });

  it('push into a wall: 1 base + 2 Knight passive collision damage', () => {
    const s = stateFromMap(`
      #####
      #>W.#
      #...#
      #####`);
    const r = apply(s, bash);
    // 1 (bash) + after one step, collision 1 + 2 = 3 → total 4 = dead warrior.
    expect(r.state.enemies).toEqual([]);
    expect(types(r.events)).toEqual(['abilityUsed', 'damaged', 'pushed', 'collided', 'damaged', 'died', 'combatEnded']);
    const collision = r.events.find((e) => e.type === 'damaged' && e.cause === 'collision');
    expect(collision).toMatchObject({ amount: 3 });
  });

  it('push into a pillar counts as an obstacle', () => {
    const s = stateFromMap(`
      ######
      #>WO.#
      #....#
      #...W#
      ######`);
    const r = apply(s, bash);
    expect(r.state.enemies.find((e) => e.id === 'e1')).toBeUndefined();
    expect(r.events.find((e) => e.type === 'collided')).toMatchObject({ withId: null, at: { x: 3, y: 1 } });
  });

  it('push into another unit: pushed takes 1+2, the other takes 1', () => {
    const s = stateFromMap(`
      #######
      #>WW..#
      #.....#
      #######`);
    const r = apply(s, bash);
    expect(r.events.find((e) => e.type === 'collided')).toMatchObject({ unitId: 'e1', withId: 'e2' });
    expect(r.state.enemies.find((e) => e.id === 'e1')).toBeUndefined(); // 1 + 3 = 4
    expect(r.state.enemies.find((e) => e.id === 'e2')).toMatchObject({ hp: 3, x: 3 });
  });

  it('push into a pit kills regardless of health', () => {
    const s = stateFromMap(`
      ######
      #>W~.#
      #....#
      #...W#
      ######`);
    const r = apply(s, bash);
    expect(types(r.events)).toEqual(['abilityUsed', 'damaged', 'pushed', 'fell', 'died']);
    expect(r.state.enemies.map((e) => e.id)).toEqual(['e2']);
  });

  it('has a 1-turn cooldown and costs 2 AP', () => {
    const s = stateFromMap(`
      #########
      #>W.....#
      #.......#
      #.......#
      #########`);
    s.enemies[0]!.hp = 99;
    let r = apply(s, bash);
    expect(apply(r.state, bash).events).toEqual([{ type: 'rejected', reason: 'on_cooldown' }]);
    // Next turn: still cooling down.
    r = apply(r.state, endTurn);
    expect(r.state.players[0]!.ap).toBe(3);
    // The warrior walked back to us; turn to face it and try.
    expect(apply(r.state, bash).events[0]).toEqual({ type: 'rejected', reason: 'on_cooldown' });
    r = apply(r.state, endTurn);
    expect(apply(r.state, bash).events[0]?.type).toBe('abilityUsed');
  });

  it('rejects abilities without enough AP', () => {
    const s = stateFromMap(`
      #####
      #>W.#
      #...#
      #####`);
    s.players[0]!.ap = 1;
    expect(apply(s, bash).events).toEqual([{ type: 'rejected', reason: 'not_enough_ap' }]);
    expect(apply(s, { ...bash, abilityId: 'nope' }).events).toEqual([{ type: 'rejected', reason: 'unknown_ability' }]);
  });
});

describe('enemy intents', () => {
  it('a warrior hits the cell it telegraphed', () => {
    const s = stateFromMap(
      `
      #####
      #.W.#
      #.^.#
      #...#
      #####`,
      { intents: true },
    );
    const r = apply(s, endTurn);
    expect(r.state.players[0]!.hp).toBe(12 - 3);
    expect(types(r.events).slice(0, 3)).toEqual(['phaseChanged', 'enemyAttack', 'damaged']);
  });

  it('stepping out of the telegraphed cell dodges the attack', () => {
    const s = stateFromMap(
      `
      ######
      #.W..#
      #.^..#
      #....#
      ######`,
      { intents: true },
    );
    const r = replay(s, [{ type: 'move', playerId: 'p1', dir: 'right' }, endTurn]);
    expect(r.players[0]!.hp).toBe(12);
  });

  it('pushing a warrior redirects its attack into another enemy', () => {
    // e1 faces south and will strike (2,3). We bash e1 east… its strike now lands on (3,3) where e2 waits.
    const s = stateFromMap(
      `
      #######
      #.....#
      #>W...#
      #..A..#
      #.....#
      #######`,
      { intents: true },
    );
    s.enemies[0]!.hp = 9;
    s.enemies[1]!.intent = null;
    // Push only 1 cell: put a pillar to stop it at (3,2).
    s.room.grid.cells[2 * 7 + 4] = 'pillar';
    const r = replay(s, [bash, endTurn]);
    const archer = r.enemies.find((e) => e.id === 'e2');
    // Archer had 3 HP, takes 3 from the redirected strike → dead.
    expect(archer).toBeUndefined();
  });

  it('an archer shoots the first unit in line, even an ally', () => {
    const s = stateFromMap(
      `
      #######
      #..A..#
      #..W..#
      #..^..#
      #######`,
      { intents: true },
    );
    s.enemies[1]!.intent = null; // the warrior does nothing
    const r = apply(s, endTurn);
    expect(r.state.enemies.find((e) => e.id === 'e2')!.hp).toBe(2);
    expect(r.state.players[0]!.hp).toBe(12);
  });

  it('pillars block arrows', () => {
    const s = stateFromMap(
      `
      #######
      #..A..#
      #..O..#
      #..^..#
      #######`,
      { intents: true },
    );
    const r = apply(s, endTurn);
    expect(r.events.find((e) => e.type === 'enemyAttack')).toMatchObject({ cells: [] });
    expect(r.state.players[0]!.hp).toBe(12);
  });
});

describe('turn structure', () => {
  it('end turn: enemies act, AP refills, turn counter advances, new intents are declared', () => {
    const s = stateFromMap(`
      #########
      #>......#
      #.......#
      #......W#
      #########`);
    s.players[0]!.ap = 0;
    const r = apply(s, endTurn);
    expect(r.state.players[0]!.ap).toBe(3);
    expect(r.state.combat).toEqual({ turn: 2, phase: 'player', status: 'active' });
    expect(r.state.enemies[0]!.intent).not.toBeNull();
    expect(types(r.events)).toContain('intentDeclared');
    expect(types(r.events).at(-1)).toBe('phaseChanged');
  });

  it('losing: the player dies at 0 HP and further actions are rejected', () => {
    const s = stateFromMap(
      `
      #####
      #.W.#
      #.^.#
      #####`,
      { intents: true },
    );
    s.players[0]!.hp = 3;
    const r = apply(s, endTurn);
    expect(r.state.combat.status).toBe('lost');
    expect(types(r.events)).toEqual(['phaseChanged', 'enemyAttack', 'damaged', 'died', 'combatEnded']);
    expect(apply(r.state, sword).events).toEqual([{ type: 'rejected', reason: 'combat_over' }]);
    expect(apply(r.state, { type: 'move', playerId: 'p1', dir: 'back' }).events[0]).toEqual({
      type: 'rejected',
      reason: 'dead',
    });
  });

  it('debug commands: god mode blocks damage, heal restores, killAll wins', () => {
    const s = stateFromMap(
      `
      #####
      #.W.#
      #.^.#
      #####`,
      { intents: true },
    );
    s.players[0]!.hp = 1;
    let r = apply(s, { type: 'debug', playerId: 'p1', action: 'toggleGod' });
    r = apply(r.state, endTurn);
    expect(r.state.players[0]!.hp).toBe(1);
    r = apply(r.state, { type: 'debug', playerId: 'p1', action: 'heal' });
    expect(r.state.players[0]!.hp).toBe(12);
    r = apply(r.state, { type: 'debug', playerId: 'p1', action: 'killAll' });
    expect(r.state.combat.status).toBe('won');
  });
});

describe('preview', () => {
  it('matches the real outcome exactly, including chains', () => {
    const s = stateFromMap(`
      #######
      #>WW..#
      #.....#
      #######`);
    const p = preview(s, bash);
    const real = apply(s, bash);
    expect(p.events).toEqual(real.events);
    expect(p.damage.get('e1')).toBe(4);
    expect(p.damage.get('e2')).toBe(1);
    expect([...p.deaths]).toEqual(['e1']);
    expect(p.rejected).toBeNull();
  });

  it('shows the push path and pit deaths', () => {
    const s = stateFromMap(`
      ######
      #>W.~#
      #....#
      #...W#
      ######`);
    const p = preview(s, bash);
    expect(p.pushPaths.get('e1')).toEqual([
      { x: 3, y: 1 },
      { x: 4, y: 1 },
    ]);
    expect(p.deaths.has('e1')).toBe(true);
  });

  it('reports a rejection instead of an outcome', () => {
    const s = stateFromMap(`
      #####
      #>W.#
      #####`);
    s.players[0]!.ap = 0;
    expect(preview(s, sword).rejected).toBe('not_enough_ap');
  });
});
