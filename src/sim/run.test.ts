import { describe, expect, it } from 'vitest';
import { dirVec, type Dir } from '../core/grid';
import { createRng } from '../core/rng';
import { ACT, getItem, getModifier } from '../content';
import { apply } from './apply';
import type { Command, GameEvent } from './commands';
import { isInert } from './enemies';
import { enterRoom, makeOffer } from './run';
import { createGame, type GameState } from './state';
import { stateFromMap } from './testing';

const killAll: Command = { type: 'debug', playerId: 'p1', action: 'killAll' };
const choose = (index: number | null, replace?: number): Command =>
  replace === undefined
    ? { type: 'chooseReward', playerId: 'p1', index }
    : { type: 'chooseReward', playerId: 'p1', index, replace };
const forward: Command = { type: 'move', playerId: 'p1', dir: 'forward' };
const of = (events: readonly GameEvent[], type: GameEvent['type']) => events.filter((e) => e.type === type);

/** Puts the player on the cell inside an offered door, facing it, and steps through. */
function walkThrough(state: GameState, offer = 0): ReturnType<typeof apply> {
  const s = structuredClone(state);
  const door = s.room.doors[s.run!.doors[offer]!.door]!;
  const inner = dirVec(door.dir);
  const p = s.players[0]!;
  p.x = door.x + inner.x;
  p.y = door.y + inner.y;
  p.dir = ((door.dir + 2) % 4) as Dir;
  return apply(s, forward);
}

/** Clears the room and skips its reward, leaving the doors open. */
function clearRoom(state: GameState): GameState {
  let s = apply(state, killAll).state;
  if (s.run?.phase === 'reward') s = apply(s, choose(null)).state;
  return s;
}

describe('run: rooms, rewards, doors', () => {
  it('a run starts in room 1 of act 1, fighting, with an ability waiting as the reward', () => {
    const s = createGame(11, { classId: 'rogue' });
    expect(s.run).toMatchObject({ depth: 1, kind: 'combat', phase: 'combat', pending: 'ability' });
  });

  it('clearing a room offers up to 3 rewards; taking one opens the doors with a reward on each', () => {
    const cleared = apply(createGame(11), killAll);
    const run = cleared.state.run!;
    expect(run.phase).toBe('reward');
    expect(run.offer.length).toBeGreaterThan(0);
    expect(run.offer.length).toBeLessThanOrEqual(ACT.offer);
    // Three of the Knight's four pool abilities.
    const pool = ['knight.dash', 'knight.challenge', 'knight.shieldWall', 'knight.crush'];
    expect(run.offer.every((o) => o.kind === 'ability' && pool.includes(o.id))).toBe(true);
    const taken = apply(cleared.state, choose(0));
    expect(taken.state.players[0]!.abilities).toHaveLength(3);
    expect(taken.state.run!.phase).toBe('doors');
    const exits = taken.state.room.doors.filter((d) => d.kind === 'exit').length;
    expect(taken.state.run!.doors).toHaveLength(exits);
  });

  it('a reward can be refused', () => {
    const cleared = apply(createGame(11), killAll).state;
    const r = apply(cleared, choose(null));
    expect(r.state.players[0]!.abilities).toHaveLength(2);
    expect(r.state.run!.log.at(-1)).toEqual({ type: 'reward', depth: 1, option: null });
  });

  it('you cannot walk away from the reward screen', () => {
    const cleared = apply(createGame(11), killAll).state;
    expect(apply(cleared, forward).events).toEqual([{ type: 'rejected', reason: 'choose_reward' }]);
  });

  it('stepping through a door enters the next room: health and abilities carry over, cooldowns reset', () => {
    let s = createGame(21);
    s.players[0]!.hp = 7;
    s.players[0]!.cooldowns = [{ abilityId: 'knight.shieldBash', turns: 2 }];
    s = clearRoom(s);
    const r = walkThrough(s);
    expect(of(r.events, 'roomEntered')).toHaveLength(1);
    const p = r.state.players[0]!;
    expect(r.state.run!.depth).toBe(2);
    expect(p).toMatchObject({ hp: 7, x: r.state.room.spawn.x, y: r.state.room.spawn.y, cooldowns: [] });
    expect(JSON.stringify(r.state.room)).not.toBe(JSON.stringify(s.room));
  });

  it('the same seed and choices give the same rewards, doors and rooms', () => {
    const play = () => {
      let s = clearRoom(createGame(33, { classId: 'necromancer' }));
      s = walkThrough(s).state;
      return JSON.stringify({ run: s.run, room: s.room, enemies: s.enemies });
    };
    expect(play()).toBe(play());
  });

  it('a new ability with every slot full replaces the chosen slot (and needs one)', () => {
    let s = createGame(5);
    const p = s.players[0]!;
    p.abilities = ['knight.sword', 'knight.shieldBash', 'rogue.dagger', 'rogue.knife', 'necro.staff'];
    s = apply(s, killAll).state;
    const i = s.run!.offer.findIndex((o) => o.kind === 'ability');
    expect(i).toBeGreaterThanOrEqual(0);
    expect(apply(s, choose(i)).events).toEqual([{ type: 'rejected', reason: 'slot_needed' }]);
    const r = apply(s, choose(i, 2));
    const id = s.run!.offer[i]!.kind === 'ability' ? (s.run!.offer[i] as { id: string }).id : '';
    expect(r.state.players[0]!.abilities[2]).toBe(id);
    expect(r.state.players[0]!.abilities).toHaveLength(5);
  });

  it('upgrades: −1 cooldown and +1 damage on every hit of that ability', () => {
    const s = stateFromMap(`
      #######
      #>W...#
      #######`);
    s.players[0]!.upgrades = [
      { abilityId: 'knight.shieldBash', kind: 'cooldown' },
      { abilityId: 'knight.shieldBash', kind: 'damage' },
    ];
    const r = apply(s, { type: 'useAbility', playerId: 'p1', abilityId: 'knight.shieldBash' });
    expect(r.events.find((e) => e.type === 'damaged')).toMatchObject({ amount: 2 });
    // Cooldown 3 − 1 = 2, plus the turn that just passed.
    expect(r.state.players[0]!.cooldowns).toEqual([{ abilityId: 'knight.shieldBash', turns: 2 }]);
  });

  it('an elite room has tougher enemies (and one more) and rewards an item', () => {
    const s = createGame(8);
    const events: GameEvent[] = [];
    enterRoom(s, 3, 'elite', 'elite', events);
    const fighters = s.enemies.filter((e) => !isInert(e));
    expect(fighters.every((e) => e.elite && e.hp === e.maxHp && e.maxHp >= 5 && e.affix)).toBe(true);
    const cleared = apply(s, killAll).state;
    expect(cleared.run!.offer.every((o) => o.kind === 'item')).toBe(true);
  });

  it('a rest room heals half your health and opens its doors at once', () => {
    const s = createGame(8);
    s.players[0]!.hp = 2;
    const events: GameEvent[] = [];
    enterRoom(s, 3, 'rest', null, events);
    expect(s.players[0]!.hp).toBe(2 + 8);
    expect(s.enemies).toEqual([]);
    expect(s.run!.phase).toBe('doors');
  });

  it('deeper rooms hold more enemies', () => {
    const counts = (depth: number) => {
      let total = 0;
      for (let seed = 1; seed <= 30; seed++) {
        const s = createGame(seed);
        enterRoom(s, depth, 'combat', 'upgrade', []);
        total += s.enemies.length;
      }
      return total / 30;
    };
    expect(counts(6)).toBeGreaterThan(counts(1) + 0.8);
  });

  it('after the sixth room exactly one door opens, and it leads to the boss', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const s = createGame(seed);
      enterRoom(s, ACT.rooms, 'combat', null, []);
      const cleared = apply(s, killAll).state;
      expect(cleared.run!.doors.map((d) => d.reward)).toEqual(['boss']);
    }
  });

  it('dying ends the run', () => {
    const s = createGame(8);
    s.players[0]!.hp = 1;
    // Stand in front of an enemy's telegraphed blow and let a turn pass.
    const e = s.enemies[0]!;
    e.intent = { kind: 'melee', dir: 0, damage: 5 };
    s.players[0]!.x = e.x;
    s.players[0]!.y = e.y - 1;
    s.players[0]!.dir = 1;
    const r = apply(s, { type: 'turn', playerId: 'p1', dir: 'left' });
    const r2 = apply(r.state, { type: 'useAbility', playerId: 'p1', abilityId: 'knight.sword' });
    expect(r2.state.run!.phase).toBe('lost');
    expect(of(r2.events, 'runEnded')).toEqual([{ type: 'runEnded', result: 'lost' }]);
  });
});

describe('boss: the crypt warden', () => {
  it('the boss room is 11×11 with the warden alone, far from the door', () => {
    const r = apply(createGame(4), { type: 'debug', playerId: 'p1', action: 'toBoss' });
    expect(r.state.run).toMatchObject({ depth: ACT.rooms + 1, kind: 'boss' });
    expect(r.state.room.interior).toMatchObject({ w: 11, h: 11 });
    expect(r.state.enemies.map((e) => e.type)).toEqual(['cryptWarden']);
  });

  it('Sweep hits the three cells in front of it; every third strike it calls a warrior on the cell it showed', () => {
    const s = stateFromMap(
      `
      #########
      #.......#
      #...B...#
      #..S^...#
      #.......#
      #########`,
      { classId: 'necromancer' },
    );
    const boss = s.enemies[0]!;
    boss.intent = { kind: 'sweep', dir: 2, damage: 3 };
    boss.strikes = 1; // its pattern is sweep, sweep, summon: this is the second sweep
    const r2 = apply(s, { type: 'move', playerId: 'p1', dir: 'back' });
    // The step back left the sweep: three cells in front of the warden, nobody in them now.
    expect(r2.state.players[0]!.hp).toBe(13);
    const sweep = r2.events.find((e) => e.type === 'enemyAttack');
    expect(sweep).toMatchObject({
      cells: [
        { x: 4, y: 3 },
        { x: 3, y: 3 },
        { x: 5, y: 3 },
      ],
    });
    // Its next intent is the summon, with the cells shown in advance.
    const next = r2.state.enemies.find((e) => e.type === 'cryptWarden')!.intent!;
    expect(next.kind).toBe('summon');
    const cells = next.kind === 'summon' ? next.cells : [];
    expect(cells).toHaveLength(1);
    const r4 = apply(r2.state, { type: 'move', playerId: 'p1', dir: 'left' });
    const spawned = r4.events.filter((e) => e.type === 'summoned');
    expect(spawned.map((e) => (e.type === 'summoned' ? e.at : null))).toEqual(cells);
    expect(r4.state.enemies.filter((e) => e.type === 'skeletonWarrior').length).toBe(1);
  });

  it('pushes move the warden half as far', () => {
    const s = stateFromMap(`
      #########
      #>B.....#
      #########`);
    const r = apply(s, { type: 'useAbility', playerId: 'p1', abilityId: 'knight.shieldBash' });
    expect(r.events.filter((e) => e.type === 'pushed')).toHaveLength(1);
  });

  it('killing the warden offers an item for the road, then act 2 begins in the catacombs', () => {
    const boss = apply(createGame(4), { type: 'debug', playerId: 'p1', action: 'toBoss' }).state;
    const r = apply(boss, killAll);
    expect(r.state.run!.phase).toBe('reward');
    expect(r.state.run!.offer.every((o) => o.kind === 'item')).toBe(true);
    const r2 = apply(r.state, choose(0));
    expect(r2.state.run).toMatchObject({ act: 2, depth: 1, phase: 'combat' });
    expect(r2.state.players[0]!.items).toHaveLength(1);
    expect(of(r2.events, 'actEntered')).toEqual([{ type: 'actEntered', act: 2 }]);
    const catacombs = new Set(['drowned', 'bloated', 'leech', 'skeletonWarrior']);
    expect(r2.state.enemies.every((e) => catacombs.has(e.type))).toBe(true);
  });

  it('the boss of act 3 ends the run in victory', () => {
    const boss = apply(createGame(4), { type: 'debugJump', playerId: 'p1', act: 3, depth: ACT.rooms + 1 }).state;
    expect(boss.enemies.map((e) => e.type)).toEqual(['fallenVoice']);
    const r = apply(apply(boss, killAll).state, choose(0));
    expect(r.state.run!.phase).toBe('won');
    expect(of(r.events, 'runEnded')).toEqual([{ type: 'runEnded', result: 'won' }]);
  });
});

describe('offers fit the build', () => {
  it('a rogue whose only "summon" is the inert decoy of the mirror dagger is not offered summon rules', () => {
    const s = createGame(1, { classId: 'rogue' });
    const p = structuredClone(s.players[0]!);
    p.items = [...p.items, 'item.mirrorDagger'];
    for (let seed = 0; seed < 200; seed++) {
      for (const kind of ['modifier', 'treasure'] as const) {
        for (const o of makeOffer(createRng(seed), p, kind)) {
          const rule = o.kind === 'modifier' ? getModifier(o.id) : o.kind === 'item' ? getItem(o.id) : null;
          expect(rule?.requires ?? [], rule?.id).not.toContain('summon');
        }
      }
    }
  });
});
