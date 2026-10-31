import { describe, expect, it } from 'vitest';
import { apply, replay } from './apply';
import type { Command } from './commands';
import { migrateState, readSave, writeSave } from './save';
import { createGame } from './state';

describe('saves', () => {
  it('a saved run loads back to exactly the same state', () => {
    const commands: Command[] = [
      { type: 'move', playerId: 'p1', dir: 'forward' },
      { type: 'debug', playerId: 'p1', action: 'killAll' },
      { type: 'chooseReward', playerId: 'p1', index: 0 },
    ];
    const state = replay(createGame(9, { classId: 'rogue' }), commands);
    const text = writeSave({ state, commands, classId: 'rogue', elapsedMs: 4200 });
    const loaded = readSave(text)!;
    expect(JSON.stringify(loaded.state)).toBe(JSON.stringify(state));
    expect(loaded).toMatchObject({ classId: 'rogue', elapsedMs: 4200, commands });
    // And play continues from it like from the original.
    const next: Command = { type: 'move', playerId: 'p1', dir: 'back' };
    expect(JSON.stringify(apply(loaded.state, next).state)).toBe(JSON.stringify(apply(state, next).state));
  });

  it('migrates a version-5 state (before runs existed)', () => {
    const v6 = createGame(3);
    const { run: _run, ...rest } = v6;
    const v5 = {
      ...rest,
      version: 5,
      players: v6.players.map(({ upgrades: _u, ...p }) => p),
      enemies: v6.enemies.map(({ elite: _e, strikes: _s, ...e }) => e),
    };
    const migrated = migrateState(JSON.parse(JSON.stringify(v5)))!;
    expect(migrated.version).toBe(v6.version);
    expect(migrated.run).toMatchObject({ depth: 1, phase: 'combat' });
    expect(migrated.players[0]!.upgrades).toEqual([]);
    expect(migrated.enemies.every((e) => e.elite === false && e.strikes === 0)).toBe(true);
  });

  it('migrates a version-6 save (before second classes and items)', () => {
    const v7 = createGame(4, { classId: 'rogue' });
    const { initiation: _i, treasures: _t, patron: _p, altars: _a, forceAltar: _f, ...run } = v7.run!;
    const v6 = {
      ...v7,
      version: 6,
      run,
      players: v7.players.map(
        ({ classes: _c, hybrid: _h, items: _it, ruleUses: _r, gifts: _g, turnUses: _tu, ...p }) => p,
      ),
    };
    const migrated = migrateState(JSON.parse(JSON.stringify(v6)))!;
    expect(migrated.version).toBe(8);
    expect(migrated.players[0]).toMatchObject({ classes: ['rogue'], hybrid: null, items: [], ruleUses: [] });
    expect(migrated.run).toMatchObject({ initiation: false, treasures: 0 });
  });

  it('migrates a version-7 save (before patrons)', () => {
    const v8 = createGame(5, { classId: 'knight' });
    const { patron: _p, altars: _a, forceAltar: _f, ...run } = v8.run!;
    const v7 = { ...v8, version: 7, run, players: v8.players.map(({ gifts: _g, turnUses: _tu, ...p }) => p) };
    const migrated = migrateState(JSON.parse(JSON.stringify(v7)))!;
    expect(migrated.version).toBe(8);
    expect(migrated.players[0]).toMatchObject({ gifts: [], turnUses: [] });
    expect(migrated.run).toMatchObject({ patron: null, altars: 0, forceAltar: false });
  });

  it('broken, foreign or too-old saves are rejected without throwing', () => {
    expect(readSave(null)).toBeNull();
    expect(readSave('')).toBeNull();
    expect(readSave('{not json')).toBeNull();
    expect(readSave('{"version":1}')).toBeNull();
    expect(readSave('{"version":99,"state":{}}')).toBeNull();
    expect(readSave(JSON.stringify({ version: 1, state: { version: 2 }, commands: [], classId: 'knight' }))).toBeNull();
    expect(
      readSave(JSON.stringify({ version: 1, state: { version: 6, players: [] }, commands: [], classId: 'knight' })),
    ).toBeNull();
  });
});
