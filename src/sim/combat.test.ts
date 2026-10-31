import { describe, expect, it } from 'vitest';
import { apply, preview, replay } from './apply';
import type { Command, GameEvent } from './commands';
import { stateFromMap } from './testing';

const sword: Command = { type: 'useAbility', playerId: 'p1', abilityId: 'knight.sword' };
const bash: Command = { type: 'useAbility', playerId: 'p1', abilityId: 'knight.shieldBash' };
/** Spends a turn: the maps below always leave the cell in front of the player empty when this is used. */
const pass: Command = sword;
const types = (events: readonly GameEvent[]) => events.map((e) => e.type);
/** Only the player's own action, without the world's answer. */
const own = (events: readonly GameEvent[]) => {
  const i = events.findIndex((e) => e.type === 'phaseChanged');
  return types(i >= 0 ? events.slice(0, i) : events);
};

describe('Knight: sword strike', () => {
  it('deals 2 damage to the unit in front and takes a turn', () => {
    const s = stateFromMap(`
      #####
      #.W.#
      #.^.#
      #...#
      #####`);
    const r = apply(s, sword);
    expect(r.state.enemies[0]!.hp).toBe(2);
    expect(own(r.events)).toEqual(['abilityUsed', 'damaged']);
    expect(r.state.combat.turn).toBe(2);
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

  it('can hit empty air (the turn is still spent)', () => {
    const s = stateFromMap(`
      #######
      #.....#
      #.^...#
      #....W#
      #######`);
    const r = apply(s, sword);
    expect(own(r.events)).toEqual(['abilityUsed']);
    expect(r.state.combat.turn).toBe(2);
  });
});

describe('Knight: shield bash and push', () => {
  it('pushes 2 cells in open space for 1 damage', () => {
    const s = stateFromMap(`
      ########
      #......#
      #>W....#
      #......#
      ########`);
    const r = apply(s, bash);
    expect(own(r.events)).toEqual(['abilityUsed', 'damaged', 'pushed', 'pushed']);
    expect(r.events.filter((e) => e.type === 'pushed').at(-1)).toMatchObject({ to: { x: 4, y: 2 } });
    expect(r.state.enemies[0]!.hp).toBe(3);
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
    expect(r.state.enemies.find((e) => e.id === 'e2')!.hp).toBe(3);
  });

  it('push into a pit kills regardless of health', () => {
    const s = stateFromMap(`
      ######
      #>W~.#
      #....#
      #...W#
      ######`);
    s.enemies[0]!.hp = 99;
    const r = apply(s, bash);
    expect(own(r.events)).toEqual(['abilityUsed', 'damaged', 'pushed', 'fell', 'died']);
    expect(r.state.enemies.map((e) => e.id)).toEqual(['e2']);
  });

  it('has a 3-turn cooldown', () => {
    const s = stateFromMap(`
      ##########
      #>W......#
      #........#
      ##########`);
    s.enemies[0]!.hp = 99;
    let st = apply(s, bash).state;
    for (let turn = 1; turn <= 3; turn++) {
      expect(apply(st, bash).events, `turn ${turn} after use`).toEqual([{ type: 'rejected', reason: 'on_cooldown' }]);
      st = apply(st, { type: 'turn', playerId: 'p1', dir: 'left' }).state; // face the wall…
      st = apply(st, pass).state; // …and spend a turn
      st = apply(st, { type: 'turn', playerId: 'p1', dir: 'right' }).state;
    }
    expect(apply(st, bash).events[0]?.type).toBe('abilityUsed');
  });

  it('rejects unknown abilities', () => {
    const s = stateFromMap(`
      #####
      #>W.#
      #####`);
    expect(apply(s, { ...bash, abilityId: 'nope' }).events).toEqual([{ type: 'rejected', reason: 'unknown_ability' }]);
  });
});

describe('enemy intents', () => {
  it('a warrior hits the cell it telegraphed after the player acts', () => {
    const s = stateFromMap(
      `
      #####
      #.W.#
      #.v.#
      #...#
      #####`,
      { intents: true },
    );
    const r = apply(s, pass);
    expect(r.state.players[0]!.hp).toBe(12 - 2);
    expect(types(r.events).slice(0, 4)).toEqual(['abilityUsed', 'phaseChanged', 'enemyAttack', 'damaged']);
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
    const r = apply(s, { type: 'move', playerId: 'p1', dir: 'right' });
    expect(r.state.players[0]!.hp).toBe(12);
    expect(r.events.find((e) => e.type === 'enemyAttack')).toBeDefined();
  });

  it('pushing a warrior redirects its attack into another enemy', () => {
    // e1 faces south and will strike (2,3). Bash it east one cell (a pillar stops it): its strike lands on (3,3).
    const s = stateFromMap(
      `
      #######
      #.....#
      #>W.O.#
      #..A..#
      #.....#
      #######`,
      { intents: true },
    );
    s.enemies[0]!.hp = 9;
    s.enemies[1]!.intent = null;
    const r = apply(s, bash);
    // Archer (3 HP) takes the redirected 2 → 1 HP left, and the player is untouched.
    expect(r.state.enemies.find((e) => e.id === 'e2')!.hp).toBe(1);
    expect(r.state.players[0]!.hp).toBe(12);
  });

  it('an archer shoots the first unit in line, even an ally', () => {
    const s = stateFromMap(
      `
      #######
      #..A..#
      #..W..#
      #..v..#
      #.....#
      #######`,
      { intents: true },
    );
    s.enemies[1]!.intent = null; // the warrior does nothing this turn
    const r = apply(s, pass);
    expect(r.state.enemies.find((e) => e.id === 'e2')!.hp).toBe(3);
    expect(r.state.players[0]!.hp).toBe(12);
  });

  it('pillars block arrows', () => {
    const s = stateFromMap(
      `
      #######
      #..A..#
      #..O..#
      #..v..#
      #.....#
      #######`,
      { intents: true },
    );
    const r = apply(s, pass);
    expect(r.events.find((e) => e.type === 'enemyAttack')).toMatchObject({ cells: [] });
    expect(r.state.players[0]!.hp).toBe(12);
  });
});

describe('turn structure', () => {
  it('each action: enemies strike, move, telegraph; the turn counter advances; cooldowns tick', () => {
    const s = stateFromMap(`
      #########
      #v......#
      #.......#
      #......W#
      #########`);
    const r = apply(s, { type: 'move', playerId: 'p1', dir: 'forward' });
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
      #.v.#
      #...#
      #####`,
      { intents: true },
    );
    s.players[0]!.hp = 2;
    const r = apply(s, pass);
    expect(r.state.combat.status).toBe('lost');
    expect(types(r.events)).toEqual(['abilityUsed', 'phaseChanged', 'enemyAttack', 'damaged', 'died', 'combatEnded']);
    expect(apply(r.state, sword).events).toEqual([{ type: 'rejected', reason: 'combat_over' }]);
    expect(apply(r.state, { type: 'move', playerId: 'p1', dir: 'back' }).events[0]).toEqual({
      type: 'rejected',
      reason: 'dead',
    });
  });

  it('debug commands: god mode blocks damage, heal restores, killAll wins — and take no time', () => {
    const s = stateFromMap(
      `
      #####
      #.W.#
      #.v.#
      #...#
      #####`,
      { intents: true },
    );
    s.players[0]!.hp = 1;
    let r = apply(s, { type: 'debug', playerId: 'p1', action: 'toggleGod' });
    expect(r.state.combat.turn).toBe(1);
    r = apply(r.state, pass);
    expect(r.state.players[0]!.hp).toBe(1);
    r = apply(r.state, { type: 'debug', playerId: 'p1', action: 'heal' });
    expect(r.state.players[0]!.hp).toBe(12);
    r = apply(r.state, { type: 'debug', playerId: 'p1', action: 'killAll' });
    expect(r.state.combat.status).toBe('won');
  });

  it('replays a whole fight identically', () => {
    const s = stateFromMap(`
      #########
      #v......#
      #...O...#
      #..~..A.#
      #......W#
      #########`);
    const cmds: Command[] = [];
    for (let i = 0; i < 30; i++) cmds.push(i % 3 === 0 ? sword : { type: 'move', playerId: 'p1', dir: 'forward' });
    expect(JSON.stringify(replay(s, cmds))).toBe(JSON.stringify(replay(s, cmds)));
  });
});

describe('preview', () => {
  it("matches the real outcome of the player's action exactly, including chains", () => {
    const s = stateFromMap(`
      #######
      #>WW..#
      #.....#
      #######`);
    const p = preview(s, bash);
    const real = apply(s, bash);
    expect(p.events).toEqual(real.events.slice(0, p.events.length));
    expect(p.damage.get('e1')).toBe(4);
    expect(p.damage.get('e2')).toBe(1);
    expect([...p.deaths]).toEqual(['e1']);
    expect(p.rejected).toBeNull();
  });

  it("does not include the world's answer", () => {
    const s = stateFromMap(
      `
      #####
      #.W.#
      #.v.#
      #...#
      #####`,
      { intents: true },
    );
    const p = preview(s, sword);
    expect(types(p.events)).toEqual(['abilityUsed']);
    expect(p.damage.size).toBe(0);
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
      #...#
      #####`);
    s.enemies[0]!.hp = 99;
    const after = apply(s, bash).state;
    expect(preview(after, bash).rejected).toBe('on_cooldown');
  });
});
