import { describe, expect, it } from 'vitest';
import { apply, replay } from './apply';
import type { Command, GameEvent } from './commands';
import { createGame } from './state';
import { stateFromMap } from './testing';

const move = (dir: 'forward' | 'back' | 'left' | 'right'): Command => ({ type: 'move', playerId: 'p1', dir });
const turn = (dir: 'left' | 'right'): Command => ({ type: 'turn', playerId: 'p1', dir });
const types = (events: readonly GameEvent[]) => events.map((e) => e.type);

// A far-away warrior keeps the combat active.
const OPEN = `
#########
#.......#
#.......#
#..~>+..#
#...O...#
#......W#
#########`;

describe('apply: movement', () => {
  it('moves relative to facing', () => {
    // Facing east: forward = east, left = north, right = south, back = west.
    const s = stateFromMap(`
      #######
      #.....#
      #.>...#
      #.....#
      #....W#
      #######`);
    expect(apply(s, move('forward')).state.players[0]).toMatchObject({ x: 3, y: 2 });
    expect(apply(s, move('left')).state.players[0]).toMatchObject({ x: 2, y: 1 });
    expect(apply(s, move('right')).state.players[0]).toMatchObject({ x: 2, y: 3 });
    expect(apply(s, move('back')).state.players[0]).toMatchObject({ x: 1, y: 2 });
  });

  it('a step is one turn: the world answers immediately', () => {
    const s = stateFromMap(OPEN);
    const r = apply(s, move('left'));
    expect(r.events[0]).toEqual({ type: 'moved', unitId: 'p1', from: { x: 4, y: 3 }, to: { x: 4, y: 2 } });
    expect(types(r.events)).toContain('phaseChanged');
    expect(r.state.combat.turn).toBe(2);
    // The warrior took a step towards us.
    expect(r.state.enemies[0]).not.toMatchObject({ x: 7, y: 5 });
  });

  it.each([
    ['wall', 'back', { x: 3, y: 3 }],
    ['pit', 'back', { x: 3, y: 3 }],
    ['door', 'forward', { x: 5, y: 3 }],
  ] as const)('cannot step into %s; bumping takes no time', (cell, dir, at) => {
    const s = stateFromMap(OPEN);
    if (cell === 'wall') s.room.grid.cells[3 * 9 + 3] = 'wall';
    const r = apply(s, move(dir));
    expect(r.state.players[0]).toMatchObject({ x: 4, y: 3 });
    expect(r.events).toEqual([{ type: 'bumped', unitId: 'p1', at, cell }]);
    expect(r.state.combat.turn).toBe(1);
  });

  it('cannot step into a pillar', () => {
    const s = stateFromMap(OPEN);
    s.players[0]!.dir = 2;
    expect(apply(s, move('forward')).events[0]).toMatchObject({ type: 'bumped', cell: 'pillar' });
  });

  it('turning takes no time', () => {
    const s = stateFromMap(OPEN);
    const r = apply(s, turn('left'));
    expect(r.events).toEqual([{ type: 'turned', unitId: 'p1', from: 1, to: 0 }]);
    expect(r.state.combat.turn).toBe(1);
    expect(r.state.enemies).toEqual(s.enemies);
  });

  it('walking forward into an enemy attacks it with the base attack', () => {
    const s = stateFromMap(`
      #####
      #.W.#
      #.^.#
      #...#
      #####`);
    const r = apply(s, move('forward'));
    expect(r.state.players[0]).toMatchObject({ x: 2, y: 2 });
    expect(types(r.events).slice(0, 2)).toEqual(['abilityUsed', 'damaged']);
    expect(r.state.enemies[0]!.hp).toBe(2);
  });

  it('strafing into an enemy is just a bump', () => {
    const s = stateFromMap(`
      #####
      #.^W#
      #...#
      #####`);
    expect(apply(s, move('right')).events).toEqual([
      { type: 'bumped', unitId: 'p1', at: { x: 3, y: 1 }, cell: 'floor' },
    ]);
  });

  it('after the combat, walking has no world answer', () => {
    const s = stateFromMap(OPEN);
    s.combat.status = 'won';
    s.enemies = [];
    expect(types(apply(s, move('left')).events)).toEqual(['moved']);
  });
});

describe('apply: purity and serialization', () => {
  it('does not mutate the input state', () => {
    const s = createGame(4);
    const before = JSON.stringify(s);
    apply(s, move('forward'));
    apply(s, turn('left'));
    apply(s, { type: 'useAbility', playerId: 'p1', abilityId: 'knight.sword' });
    expect(JSON.stringify(s)).toBe(before);
  });

  it('state and commands round-trip through JSON', () => {
    const s = createGame(77);
    expect(JSON.parse(JSON.stringify(s))).toEqual(s);
    const c: Command = { type: 'useAbility', playerId: 'p1', abilityId: 'knight.shieldBash' };
    expect(JSON.parse(JSON.stringify(c))).toEqual(c);
  });

  it('rejects commands for unknown players without changing state', () => {
    const s = createGame(3);
    const r = apply(s, { type: 'move', playerId: 'nobody', dir: 'forward' });
    expect(r.state).toBe(s);
    expect(r.events[0]).toEqual({ type: 'rejected', reason: 'unknown_player' });
  });

  it('keeps players in an array and blocks moving into another player', () => {
    const s = createGame(5, { playerIds: ['p1', 'p2'] });
    expect(s.players.map((p) => p.id)).toEqual(['p1', 'p2']);
    const two = stateFromMap(`
      #####
      #.^.#
      #.^.#
      #...#
      #..W#
      #####`);
    expect(apply(two, { type: 'move', playerId: 'p2', dir: 'forward' }).events[0]?.type).toBe('bumped');
  });
});

describe('determinism', () => {
  it('same seed and commands give byte-identical state', () => {
    const kinds: Command[] = [
      move('forward'),
      move('left'),
      turn('right'),
      { type: 'useAbility', playerId: 'p1', abilityId: 'knight.sword' },
      move('back'),
      { type: 'useAbility', playerId: 'p1', abilityId: 'knight.shieldBash' },
      turn('left'),
      move('right'),
    ];
    const commands: Command[] = [];
    for (let i = 0; i < 400; i++) commands.push(kinds[(i * 7 + (i >> 2)) % kinds.length]!);
    for (const seed of [0, 1, 42, 12345, 999999]) {
      const a = JSON.stringify(replay(createGame(seed), commands));
      const b = JSON.stringify(replay(createGame(seed), commands));
      expect(a).toBe(b);
    }
  });

  it('different seeds give different rooms', () => {
    expect(JSON.stringify(createGame(1).room)).not.toBe(JSON.stringify(createGame(2).room));
  });
});
