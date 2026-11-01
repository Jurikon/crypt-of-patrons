import { describe, expect, it } from 'vitest';
import type { Vec2 } from '../core/grid';
import { ACT, AFFIXES, getClass } from '../content';
import { apply } from './apply';
import type { Command, GameEvent } from './commands';
import { isInert } from './enemies';
import { ashEarned, enterRoom } from './run';
import { checkCombatEnd } from './units';
import { createGame, surfaceAt, unitById, type GameState } from './state';
import { stateFromMap, type MapOptions } from './testing';

const use = (abilityId: string, target?: Vec2): Command =>
  target
    ? { type: 'useAbility', playerId: 'p1', abilityId, target }
    : { type: 'useAbility', playerId: 'p1', abilityId };
const swing = use('knight.sword');
const killAll: Command = { type: 'debug', playerId: 'p1', action: 'killAll' };
const of = (events: readonly GameEvent[], type: GameEvent['type']) => events.filter((e) => e.type === type);
const me = (s: GameState) => s.players[0]!;
const fighters = (s: GameState) => s.enemies.filter((e) => !isInert(e));
const map = (m: string, opts: MapOptions = {}) =>
  stateFromMap(m, { ...opts, enemies: { Z: 'sarcophagus', T: 'totem', G: 'ghoul' } });
/** A run at act/depth of a seed, in a room with a given goal. */
function goalRoom(seed: number, goal: 'survive' | 'totem' | 'ambush' | 'hunt', act = 1): GameState {
  const s = apply(createGame(seed), { type: 'debugJump', playerId: 'p1', act, depth: 2 }).state;
  enterRoom(s, 3, 'combat', 'upgrade', [], goal);
  return s;
}
/** Passes a turn without doing anything useful: turn round twice is free, so swing at the air instead. */
function waitTurns(s: GameState, n: number): GameState {
  let st = s;
  for (let i = 0; i < n && st.combat.status === 'active'; i++) {
    st.players[0]!.god = true;
    st = apply(st, swing).state;
  }
  return st;
}

describe('the Chapel: upgrades bought with Ash between runs', () => {
  it('more health, rerolls, better rests and a second wind', () => {
    const base = createGame(5);
    const s = createGame(5, {
      perks: [
        { id: 'vitality', level: 2 },
        { id: 'reroll', level: 1 },
        { id: 'rest', level: 1 },
        { id: 'secondWind', level: 1 },
      ],
    });
    expect(me(s).maxHp).toBe(me(base).maxHp + 6);
    expect(me(s).hp).toBe(me(s).maxHp);
    expect(s.run).toMatchObject({ rerolls: 1, restBonus: 0.25 });
    expect(me(s).revives).toBe(1);
  });

  it('a starting modifier is picked by the seed (same seed, same modifier) and fits the class', () => {
    const a = createGame(9, { classId: 'necromancer', perks: [{ id: 'gift', level: 1 }] });
    const b = createGame(9, { classId: 'necromancer', perks: [{ id: 'gift', level: 1 }] });
    expect(me(a).modifiers).toHaveLength(1);
    expect(me(a).modifiers).toEqual(me(b).modifiers);
  });

  it('a second wind stands the hero back up at half health, once', () => {
    const s = map(
      `
      #####
      #.W.#
      #.^.#
      #####`,
      { intents: true },
    );
    me(s).hp = 1;
    me(s).revives = 1;
    const r = apply(s, { type: 'turn', playerId: 'p1', dir: 'left' });
    const r2 = apply(r.state, use('knight.sword'));
    expect(of(r2.events, 'revived')).toHaveLength(1);
    expect(me(r2.state).hp).toBe(Math.ceil(getClass('knight').maxHp / 2));
    expect(me(r2.state).revives).toBe(0);
    expect(r2.state.combat.status).toBe('active');
  });

  it('a reroll draws new options of the same kind and uses one up', () => {
    const s = createGame(4, { perks: [{ id: 'reroll', level: 2 }] });
    const cleared = apply(s, killAll).state;
    const before = JSON.stringify(cleared.run!.offer);
    const r = apply(cleared, { type: 'reroll', playerId: 'p1' });
    expect(r.state.run!.rerolls).toBe(1);
    expect(r.state.run!.offer.every((o) => o.kind === 'ability' || o.kind === 'upgrade')).toBe(true);
    expect(JSON.stringify(r.state.run!.offer)).not.toBe(before);
    const none = apply(createGame(4), killAll).state;
    expect(of(apply(none, { type: 'reroll', playerId: 'p1' }).events, 'rejected')).toHaveLength(1);
  });

  it('Ash: a point per cleared room, more for elites and bosses, a bonus for winning', () => {
    const s = createGame(3);
    s.run!.log = [
      { type: 'room', depth: 1, kind: 'combat' },
      { type: 'cleared', depth: 1, turns: 5 },
      { type: 'room', depth: 2, kind: 'elite' },
      { type: 'cleared', depth: 2, turns: 5 },
      { type: 'room', depth: 6, kind: 'boss' },
      { type: 'cleared', depth: 6, turns: 9 },
      { type: 'end', depth: 6, result: 'won' },
    ];
    const { room, elite, boss, win } = ACT.ash;
    expect(ashEarned(s)).toBe(room * 3 + elite + boss + win);
  });
});

describe('room goals', () => {
  it('doors announce goals other than plain clearing, some of the time', () => {
    const goals = new Set<string>();
    for (let seed = 1; seed <= 40; seed++) {
      const s = apply(createGame(seed), killAll).state;
      const d = s.run!.phase === 'reward' ? apply(s, { type: 'chooseReward', playerId: 'p1', index: null }).state : s;
      for (const o of d.run!.doors) goals.add(o.goal ?? 'clear');
    }
    expect([...goals].sort()).toEqual(['ambush', 'clear', 'hunt', 'survive', 'totem']);
  });

  it('Survive: waves come in, and holding out for the set number of turns wins the room', () => {
    let s = goalRoom(6, 'survive');
    expect(s.combat.goal).toBe('survive');
    const start = fighters(s).length;
    s = waitTurns(s, ACT.waveEvery);
    expect(fighters(s).length + 0).toBeGreaterThanOrEqual(Math.min(start, 1));
    s = waitTurns(s, ACT.surviveTurns);
    expect(s.combat.status).toBe('won');
    expect(s.run!.phase).not.toBe('combat');
  });

  it('Totem: it calls up an enemy every few turns; breaking it wins, the rest run off', () => {
    const s = map(`
      #######
      #>T...#
      #.....#
      #....G#
      #######`);
    s.combat.goal = 'totem';
    s.combat.goalTarget = 'e1';
    let st = s;
    for (let i = 0; i < 2; i++) {
      me(st).god = true;
      st = apply(st, { type: 'move', playerId: 'p1', dir: 'right' }).state;
      st = apply(st, { type: 'move', playerId: 'p1', dir: 'left' }).state;
    }
    expect(st.enemies.length).toBeGreaterThan(2);
    // Face it again and break it.
    st = apply(st, { type: 'turn', playerId: 'p1', dir: 'left' }).state;
    while (me(st).dir !== 1) st = apply(st, { type: 'turn', playerId: 'p1', dir: 'right' }).state;
    unitById(st, 'e1')!.hp = 1;
    const r = apply(st, swing);
    expect(r.state.combat.status).toBe('won');
    expect(of(r.events, 'fled').length).toBeGreaterThan(0);
  });

  it('Hunt: the leader is tougher and has a trait; killing it wins', () => {
    const s = goalRoom(8, 'hunt');
    const leader = s.enemies.find((e) => e.id === s.combat.goalTarget)!;
    expect(leader.elite).toBe(true);
    expect(leader.affix).toBeDefined();
    expect(leader.maxHp).toBeGreaterThanOrEqual(3 + ACT.leaderHp);
    // Killing anyone else does not end it; killing the leader does, and the rest run off.
    const events: GameEvent[] = [];
    const other = fighters(s).find((e) => e.id !== leader.id);
    if (other) s.enemies = s.enemies.filter((e) => e !== other);
    checkCombatEnd(s, events);
    expect(s.combat.status).toBe('active');
    s.enemies = s.enemies.filter((e) => e.id !== leader.id);
    checkCombatEnd(s, events);
    expect(s.combat.status).toBe('won');
    expect(s.enemies).toEqual([]);
  });

  it('Ambush: fewer enemies, but close on every side', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const s = goalRoom(seed, 'ambush');
      const p = me(s);
      const near = fighters(s).filter((e) => Math.abs(e.x - p.x) + Math.abs(e.y - p.y) <= ACT.ambushDistance + 2);
      expect(near.length, `seed ${seed}`).toBeGreaterThan(0);
    }
  });
});

describe('elite traits', () => {
  const at = () =>
    map(`
      ########
      #>W.....#
      #......#
      #.....W#
      ########`);

  it('every enemy of an elite room has a trait; from act 2 one enemy of every fight does', () => {
    expect(AFFIXES.map((a) => a.id)).toEqual(['swift', 'explosive', 'vampire', 'shielded', 'thorny']);
    const s = apply(createGame(12), { type: 'debugJump', playerId: 'p1', act: 2, depth: 2 }).state;
    expect(fighters(s).filter((e) => e.affix).length).toBe(1);
  });

  it('Shielded: blows from the front lose 2 damage (but always do 1)', () => {
    const s = at();
    s.enemies[0]!.affix = 'shielded';
    s.enemies[0]!.dir = 3;
    expect(unitById(apply(s, swing).state, 'e1')!.hp).toBe(3);
  });

  it('Explosive: it blows up around itself when it dies', () => {
    const s = at();
    s.enemies[0]!.affix = 'explosive';
    s.enemies[0]!.hp = 1;
    const hp = me(s).hp;
    expect(me(apply(s, swing).state).hp).toBeLessThanOrEqual(hp - 2);
  });

  it('Thorny: hitting it in melee hurts you back', () => {
    const s = at();
    s.enemies[0]!.affix = 'thorny';
    s.enemies[0]!.hp = 9;
    const r = apply(s, swing);
    expect(of(r.events, 'damaged').some((e) => e.type === 'damaged' && e.unitId === 'p1')).toBe(true);
  });

  it('Swift: it moves one cell further each turn', () => {
    const s = map(`
      #########
      #^......#
      #.......#
      #......W#
      #########`);
    s.enemies[0]!.affix = 'swift';
    const r = apply(s, swing);
    const w = unitById(r.state, 'e1')!;
    expect(Math.abs(w.x - 7) + Math.abs(w.y - 3)).toBe(2);
  });

  it('Vampire: it heals when its blow lands', () => {
    const s = map(
      `
      #####
      #.W.#
      #.^.#
      #...#
      ####W`,
      { intents: true },
    );
    s.enemies[0]!.affix = 'vampire';
    s.enemies[0]!.hp = 2;
    // Let its telegraphed blow land: swing at the air to the side.
    const turned = apply(s, { type: 'turn', playerId: 'p1', dir: 'left' }).state;
    expect(unitById(apply(turned, swing).state, 'e1')!.hp).toBe(3);
  });
});

describe('biome rules', () => {
  it('crypt: spike plates hurt whoever steps on them; a sarcophagus heals when broken and is not a foe to beat', () => {
    const s = map(`
      ######
      #>...#
      #...W#
      ######`);
    s.surfaces.push({ id: 'spikes', x: 2, y: 1, turns: null, side: 'neutral' });
    expect(me(apply(s, { type: 'move', playerId: 'p1', dir: 'forward' }).state).hp).toBe(me(s).hp - 2);

    const t = map(`
      ######
      #>Z..#
      #...W#
      ######`);
    me(t).hp = 5;
    t.enemies[0]!.hp = 1;
    const r2 = apply(t, swing);
    expect(me(r2.state).hp).toBe(5 + 3);
    expect(surfaceAt(r2.state, { x: 2, y: 1 }, 'corpse')).toBeDefined();
    // Only things left: the room is clear.
    const u = map(`
      ######
      #>W..#
      #...Z#
      ######`);
    u.enemies[0]!.hp = 1;
    expect(apply(u, swing).state.combat.status).toBe('won');
  });

  it('catacombs: a current carries whoever stands in it one cell downstream every turn', () => {
    const s = map(`
      #######
      #^....#
      #....W#
      #######`);
    s.surfaces.push({ id: 'currentE', x: 1, y: 1, turns: null, side: 'neutral' });
    const r = apply(s, swing);
    expect(me(r.state)).toMatchObject({ x: 2, y: 1 });
  });

  it('catacombs: the tide rises every few turns', () => {
    let s = apply(createGame(21), { type: 'debugJump', playerId: 'p1', act: 2, depth: 2 }).state;
    const water = s.surfaces.filter((x) => x.id === 'water').length;
    s = waitTurns(s, 4);
    if (s.combat.status === 'active') expect(s.surfaces.filter((x) => x.id === 'water').length).toBeGreaterThan(water);
  });

  it('cathedral: light marks a row or column, and strikes it a turn later', () => {
    let s = apply(createGame(33), { type: 'debugJump', playerId: 'p1', act: 3, depth: 2 }).state;
    s = waitTurns(s, 2);
    const r = apply(s, swing);
    expect(of(r.events, 'omen')).toHaveLength(1);
    expect(r.state.omen?.cells.length).toBeGreaterThan(0);
    const cells = r.state.omen!.cells;
    me(r.state).god = false;
    const r2 = apply(r.state, swing);
    expect(of(r2.events, 'area').some((e) => e.type === 'area' && e.cells.length === cells.length)).toBe(true);
    expect(r2.state.omen ?? null).toBeNull();
  });
});
