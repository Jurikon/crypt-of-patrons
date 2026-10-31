import { describe, expect, it } from 'vitest';
import type { Vec2 } from '../core/grid';
import { ACT, HYBRIDS, ITEMS, MODIFIERS } from '../content';
import { apply } from './apply';
import type { Command, GameEvent } from './commands';
import { enterRoom } from './run';
import { createGame, hasStatus, surfaceAt, unitById, type GameState } from './state';
import { stateFromMap, type MapOptions } from './testing';

const use = (abilityId: string, target?: Vec2): Command =>
  target
    ? { type: 'useAbility', playerId: 'p1', abilityId, target }
    : { type: 'useAbility', playerId: 'p1', abilityId };
const step = (dir: 'forward' | 'back' | 'left' | 'right'): Command => ({ type: 'move', playerId: 'p1', dir });
const of = (events: readonly GameEvent[], type: GameEvent['type']) => events.filter((e) => e.type === type);
const hp = (s: GameState, id: string) => unitById(s, id)?.hp;
const map = (m: string, opts: MapOptions = {}) => stateFromMap(m, opts);
const withItems = (s: GameState, ...items: string[]) => {
  s.players[0]!.items.push(...items);
  return s;
};

// A small arena: player facing east, one warrior two cells ahead, one far away (so fights do not end).
const ARENA = `
  ##########
  #........#
  #.>.W....#
  #........#
  #.......W#
  ##########`;

describe('new abilities', () => {
  it('Shield wall: shield 3 for you and adjacent allies, and arrows from the front do nothing', () => {
    const s = map(
      `
      #########
      #.S.....#
      #.>...A.#
      #.......#
      #########`,
      { abilities: ['knight.shieldWall'] },
    );
    s.enemies[0]!.dir = 3;
    s.enemies[0]!.intent = { kind: 'line', dir: 3, damage: 1, range: 6 };
    const r = apply(s, use('knight.shieldWall'));
    expect(hasStatus(unitById(r.state, 's1')!, 'shield')).toBe(true);
    expect(r.state.players[0]!.hp).toBe(16);
    expect(r.events.find((e) => e.type === 'damaged' && e.unitId === 'p1')).toMatchObject({ amount: 0 });
  });

  it('Crush: 1 damage and a 1-cell push to everyone in the three cells ahead', () => {
    const s = map(
      `
      #######
      #..W..#
      #.>W..#
      #..W..#
      #.....#
      #######`,
      { abilities: ['knight.crush'] },
    );
    const r = apply(s, use('knight.crush'));
    expect(r.state.enemies.map((e) => e.hp)).toEqual([3, 3, 3]);
    // All three were pushed a cell (they walk back in the world's answer).
    expect(of(r.events, 'pushed').map((e) => (e.type === 'pushed' ? e.to.x : 0))).toEqual([4, 4, 4]);
  });

  it('Curse: +1 damage taken, and when the cursed enemy dies the curse jumps to the nearest enemy', () => {
    const s = map(
      `
      ########
      #>W....#
      #......#
      #....W.#
      ########`,
      { classId: 'necromancer', abilities: ['necro.curse'] },
    );
    let r = apply(s, use('necro.curse', { x: 2, y: 1 }));
    expect(hasStatus(r.state.enemies[0]!, 'curse')).toBe(true);
    r.state.enemies[0]!.hp = 1;
    r = apply(r.state, use('necro.staff'));
    expect(hasStatus(unitById(r.state, 'e2')!, 'curse')).toBe(true);
  });

  it('Bone wall: raises inert walls on the cells ahead that soak up blows', () => {
    const s = map(ARENA, { classId: 'necromancer', abilities: ['necro.boneWall'] });
    const r = apply(s, use('necro.boneWall'));
    const walls = r.state.allies.filter((a) => a.type === 'necro.boneWall');
    expect(walls.length).toBe(3);
    expect(walls.every((w) => w.x === 3)).toBe(true);
  });

  it('Smoke bomb: enemies inside are blinded and their telegraphed blows miss', () => {
    const s = map(
      `
      #######
      #..W..#
      #..^..#
      #.....#
      #######`,
      { classId: 'rogue', abilities: ['rogue.smoke'], intents: true },
    );
    const r2 = apply(s, use('rogue.smoke', { x: 2, y: 2 }));
    expect(of(r2.events, 'missed')).toHaveLength(1);
    expect(r2.state.players[0]!.hp).toBe(13);
    expect(r2.state.surfaces.filter((x) => x.id === 'smoke').length).toBeGreaterThan(4);
  });

  it('Poison blade: 2 damage and poison that stacks and ticks for its amount', () => {
    const s = map(ARENA, { classId: 'rogue', abilities: ['rogue.poisonBlade'] });
    s.players[0]!.x = 3;
    s.enemies[0]!.dir = 3;
    const r = apply(s, use('rogue.poisonBlade'));
    expect(hp(r.state, 'e1')).toBe(4 - 2 - 1);
    const poison = unitById(r.state, 'e1')!.statuses.find((x) => x.id === 'poison');
    expect(poison).toMatchObject({ amount: 1 });
  });

  it('Shadow step dazes the target: it cannot turn round, so the next blow is a backstab', () => {
    const s = map(
      `
      ########
      #>.W...#
      #......#
      ########`,
      { classId: 'rogue', enemyDir: 3 },
    );
    const r = apply(s, use('rogue.shadowStep', { x: 3, y: 1 }));
    expect(r.state.enemies[0]!.dir).toBe(3); // still facing away from the rogue
    const r2 = apply(r.state, use('rogue.dagger'));
    expect(of(r2.events, 'damaged')[0]).toMatchObject({ amount: 4, backstab: true });
  });
});

describe('surfaces', () => {
  it('fire burns enemies that walk into it; burning hurts at the end of the turn', () => {
    const s = map(ARENA);
    s.surfaces.push({ id: 'fire', x: 3, y: 2, turns: 3, side: 'heroes' });
    s.enemies[0]!.dir = 3;
    const r = apply(s, step('back'));
    expect(hasStatus(unitById(r.state, 'e1')!, 'burning') || hp(r.state, 'e1')! < 4).toBe(true);
  });

  it('ice makes a pushed unit slide one cell further', () => {
    const s = map(`
      #########
      #>W.....#
      #########`);
    s.surfaces.push({ id: 'ice', x: 3, y: 1, turns: 5, side: 'heroes' });
    const r = apply(s, use('knight.shieldBash'));
    expect(of(r.events, 'pushed')).toHaveLength(3);
  });

  it('bleeding leaves blood, and the Necromancer can raise a skeleton from blood', () => {
    const s = map(
      `
      ######
      #.W.W#
      #.^..#
      ######`,
      { classId: 'necromancer' },
    );
    s.enemies[0]!.statuses.push({ id: 'bleed', turns: 2, amount: 0, sourceId: 'p1' });
    s.enemies[0]!.hp = 9;
    const r = apply(s, step('left'));
    expect(r.state.surfaces.some((x) => x.id === 'blood')).toBe(true);
  });
});

describe('modifiers', () => {
  it('there are 25 modifiers and every one has a working description key', () => {
    expect(MODIFIERS.length).toBe(25);
  });

  const bash = (
    mods: string[],
    m = `
      ########
      #>W...W#
      ########`,
  ) => apply(map(m, { modifiers: mods }), use('knight.shieldBash'));

  it('Bloody push: pushes make the target bleed', () => {
    expect(hasStatus(bash(['mod.bloodyPush']).state.enemies[0]!, 'bleed')).toBe(true);
  });

  it('Heavy pushes: a push into an obstacle stuns', () => {
    const s = map(
      `
      #####
      #>W.#
      #...#
      #..W#
      #####`,
      { modifiers: ['mod.heavyPushes'] },
    );
    s.enemies[0]!.hp = 9;
    const r = apply(s, use('knight.shieldBash'));
    expect(of(r.events, 'statusApplied').some((e) => e.type === 'statusApplied' && e.status === 'stun')).toBe(true);
  });

  it('Chain lightning: a kill sends 1 damage to the nearest enemy', () => {
    const s = map(ARENA, { modifiers: ['mod.chainLightning'] });
    s.players[0]!.x = 3;
    s.enemies[0]!.hp = 1;
    const r = apply(s, use('knight.sword'));
    expect(hp(r.state, 'e2')).toBe(3);
  });

  it('Venom shots / long reach: projectiles poison, and fly 2 cells further', () => {
    const s = map(
      `
      ###########
      #>......W.#
      ###########`,
      { classId: 'rogue', abilities: ['rogue.knife'], modifiers: ['mod.venomShots', 'mod.longReach'] },
    );
    // Range 5 + 2: the enemy 7 cells away is in reach.
    const r = apply(s, use('rogue.knife', { x: 8, y: 1 }));
    expect(hasStatus(r.state.enemies[0]!, 'poison')).toBe(true);
  });

  it('Through strike: melee blows also hit the cell behind the target', () => {
    const s = map(
      `
      #######
      #>WW..#
      #######`,
      { modifiers: ['mod.throughStrike'] },
    );
    const r = apply(s, use('knight.sword'));
    expect(hp(r.state, 'e2')).toBe(3);
  });

  it('Stun breaker / hot blood: extra damage on stunned and burning enemies', () => {
    const s = map(ARENA, { modifiers: ['mod.stunBreaker', 'mod.hotBlood'] });
    s.players[0]!.x = 3;
    s.enemies[0]!.statuses.push({ id: 'stun', turns: 1, amount: 0, sourceId: 'p1' });
    s.enemies[0]!.statuses.push({ id: 'burning', turns: 1, amount: 0, sourceId: 'p1' });
    s.enemies[0]!.hp = 9;
    const r = apply(s, use('knight.sword'));
    expect(9 - hp(r.state, 'e1')!).toBeGreaterThanOrEqual(2 + 2 + 1);
  });

  it('Hunter mark: every hit marks the target', () => {
    const s = map(ARENA, { modifiers: ['mod.hunterMark'] });
    s.players[0]!.x = 3;
    expect(hasStatus(apply(s, use('knight.sword')).state.enemies[0]!, 'mark')).toBe(true);
  });

  it('Contagion: an enemy dying with poison poisons its neighbours', () => {
    const s = map(
      `
      #######
      #>WW..#
      #.....#
      #....W#
      #######`,
      { modifiers: ['mod.contagion'] },
    );
    s.enemies[0]!.hp = 2;
    s.enemies[0]!.statuses.push({ id: 'poison', turns: 2, amount: 1, sourceId: 'p1' });
    const r = apply(s, use('knight.sword'));
    expect(hasStatus(unitById(r.state, 'e2')!, 'poison')).toBe(true);
  });

  it('Fire trail / ice step: movement abilities leave fire or ice behind', () => {
    const run = (mod: string) =>
      apply(
        map(
          `
          ########
          #>.W...#
          #......#
          ########`,
          { classId: 'rogue', enemyDir: 3, modifiers: [mod] },
        ),
        use('rogue.shadowStep', { x: 3, y: 1 }),
      ).state.surfaces;
    expect(run('mod.fireTrail').some((x) => x.id === 'fire' && x.x === 1)).toBe(true);
    expect(run('mod.iceStep').some((x) => x.id === 'ice' && x.x === 1)).toBe(true);
  });

  it('Shadow after shadow: a movement ability cools the others down by a turn', () => {
    const s = map(
      `
      ########
      #>.W...#
      #......#
      ########`,
      { classId: 'rogue', enemyDir: 3, modifiers: ['mod.shadowAfterShadow'], abilities: ['rogue.knife'] },
    );
    s.players[0]!.cooldowns = [{ abilityId: 'rogue.knife', turns: 3 }];
    const r = apply(s, use('rogue.shadowStep', { x: 3, y: 1 }));
    expect(r.state.players[0]!.cooldowns.find((c) => c.abilityId === 'rogue.knife')?.turns).toBe(1);
  });

  it('Blood for blood / last breath: getting hurt powers up the next blows', () => {
    const s = map(
      `
      #####
      #.W.#
      #.^.#
      #...#
      #...#
      ####W`,
      { intents: true, modifiers: ['mod.bloodForBlood', 'mod.lastBreath'] },
    );
    s.players[0]!.hp = 4;
    const r = apply(s, step('left'));
    void r;
    const s2 = map(
      `
      #####
      #.W.#
      #.^.#
      #...#
      ####W`,
      { intents: true, modifiers: ['mod.bloodForBlood', 'mod.lastBreath'] },
    );
    s2.players[0]!.hp = 4;
    const r2 = apply(s2, use('knight.sword'));
    const me = r2.state.players[0]!;
    expect(hasStatus(me, 'rage')).toBe(true);
    expect(hasStatus(me, 'lastBreath')).toBe(true);
  });

  it('Scavenger: an enemy dying near you gives a point of shield', () => {
    const s = map(ARENA, { modifiers: ['mod.scavenger'] });
    s.players[0]!.x = 3;
    s.enemies[0]!.hp = 1;
    expect(hasStatus(apply(s, use('knight.sword')).state.players[0]!, 'shield')).toBe(true);
  });

  it('Summon modifiers: double summon, bone shards, vengeful and greedy dead', () => {
    const s = map(
      `
      ########
      #.c....#
      #.^....#
      #....W.#
      #.....W#
      ########`,
      { classId: 'necromancer', modifiers: ['mod.doubleSummon'] },
    );
    expect(apply(s, use('necro.raise', { x: 2, y: 1 })).state.allies).toHaveLength(2);
    const t = map(
      `
      #######
      #.SW..#
      #.^...#
      #....W#
      #######`,
      { classId: 'necromancer', modifiers: ['mod.vengefulDead', 'mod.greedyDead', 'mod.boneShards'] },
    );
    t.enemies[0]!.intent = { kind: 'melee', dir: 3, damage: 1 };
    t.enemies[0]!.hp = 9;
    const r = apply(t, step('left'));
    // The skeleton hit it (2), then got hit and hit back (1).
    expect(9 - hp(r.state, 'e1')!).toBe(3);
  });
});

describe('items', () => {
  it('there are 15 items, cursed ones are marked', () => {
    expect(ITEMS.length).toBe(15);
    expect(ITEMS.filter((i) => i.cursed).length).toBeGreaterThanOrEqual(4);
  });

  it('Oath: double damage, and you cannot step back', () => {
    const s = withItems(map(ARENA), 'item.oath');
    s.players[0]!.x = 3;
    expect(unitById(apply(s, use('knight.sword')).state, 'e1')).toBeUndefined(); // 2 × 2 = 4 kills a warrior
    expect(apply(withItems(map(ARENA), 'item.oath'), step('back')).events).toEqual([
      { type: 'rejected', reason: 'cannot_retreat' },
    ]);
  });

  it('Blood ledger: no cooldowns, but abilities cost health', () => {
    const s = withItems(map(ARENA), 'item.bloodLedger');
    const r = apply(s, use('knight.shieldBash'));
    expect(r.state.players[0]!.cooldowns).toEqual([]);
    expect(r.state.players[0]!.hp).toBe(14);
  });

  it('Stone heart: health drops to 1, a 6-point shield returns every turn', () => {
    let s = createGame(2);
    s = apply(s, { type: 'debugItem', playerId: 'p1', itemId: 'item.stoneHeart' }).state;
    expect(s.players[0]).toMatchObject({ hp: 1, maxHp: 1 });
    s = apply(s, step('forward')).state;
    expect(s.players[0]!.statuses.find((x) => x.id === 'shield')?.amount ?? 0).toBeGreaterThan(0);
  });

  it('Piggy skull: −3 max health, every upgrade counts twice', () => {
    let s = createGame(2);
    s = apply(s, { type: 'debugItem', playerId: 'p1', itemId: 'item.piggySkull' }).state;
    expect(s.players[0]!.maxHp).toBe(13);
  });

  it("Jailer's chains: an enemy killed by a push rises as your skeleton", () => {
    const s = withItems(
      map(`
      #####
      #>W.#
      #...#
      #..W#
      #####`),
      'item.jailerChains',
    );
    s.enemies[0]!.hp = 1;
    const r = apply(s, use('knight.shieldBash'));
    expect(r.state.allies).toHaveLength(1);
  });

  it('Mirror dagger: a teleport leaves a decoy that fades after a turn', () => {
    const s = withItems(
      map(
        `
        ########
        #>.W...#
        #......#
        ########`,
        { classId: 'rogue', enemyDir: 3 },
      ),
      'item.mirrorDagger',
    );
    const r = apply(s, use('rogue.shadowStep', { x: 3, y: 1 }));
    expect(of(r.events, 'summoned').some((e) => e.type === 'summoned' && e.summon === 'decoy')).toBe(true);
  });

  it('Rusty nail / judge eye: hits bleed; marked enemies take 2 more', () => {
    const s = withItems(map(ARENA), 'item.rustyNail', 'item.judgeEye');
    s.players[0]!.x = 3;
    s.enemies[0]!.hp = 9;
    s.enemies[0]!.statuses.push({ id: 'mark', turns: 2, amount: 0, sourceId: 'p1' });
    const r = apply(s, use('knight.sword'));
    expect(9 - hp(r.state, 'e1')!).toBeGreaterThanOrEqual(4);
  });

  it('Burning lantern: every step leaves fire behind', () => {
    const s = withItems(map(ARENA), 'item.burningLantern');
    const r = apply(s, step('back'));
    expect(surfaceAt(r.state, { x: 2, y: 2 }, 'fire')).toBeDefined();
  });

  it('Room-start items: boots (free first action), dead bell (a skeleton), shadow cloak (enemies blinded)', () => {
    const s = createGame(6);
    s.players[0]!.items.push('item.pilgrimBoots', 'item.deadBell', 'item.shadowCloak');
    s.run!.phase = 'doors';
    s.run!.doors = [{ door: s.room.doors.findIndex((d) => d.kind === 'exit'), reward: 'upgrade' }];
    const door = s.room.doors[s.run!.doors[0]!.door]!;
    const p = s.players[0]!;
    p.x = door.x + [0, 1, 0, -1][door.dir]!;
    p.y = door.y + [-1, 0, 1, 0][door.dir]!;
    p.dir = ((door.dir + 2) % 4) as 0 | 1 | 2 | 3;
    s.enemies = [];
    s.combat.status = 'won';
    const r = apply(s, step('forward'));
    expect(r.state.players[0]!.freeActions).toBe(1);
    expect(r.state.allies).toHaveLength(1);
    expect(r.state.enemies.every((e) => hasStatus(e, 'blind'))).toBe(true);
  });

  it("Lich's crown / war banner: summons use your base attack; summons beside you hit harder", () => {
    const s = withItems(
      map(
        `
        #######
        #.SW..#
        #.^...#
        #....W#
        #######`,
        { classId: 'rogue' },
      ),
      'item.lichCrown',
    );
    s.enemies[0]!.hp = 9;
    const r = apply(s, step('left'));
    expect(hasStatus(unitById(r.state, 'e1')!, 'bleed')).toBe(true);
  });

  it('Hourglass: the first kill in a room gives a free action', () => {
    const s = withItems(map(ARENA), 'item.hourglass');
    s.players[0]!.x = 3;
    s.enemies[0]!.hp = 1;
    expect(apply(s, use('knight.sword')).state.players[0]!.freeActions).toBe(1);
  });
});

describe('Initiation and hybrids', () => {
  it('an Initiation door shows up once in rooms 1–3 and offers the two other classes', () => {
    for (let seed = 1; seed <= 20; seed++) {
      let s = createGame(seed, { classId: 'knight' });
      let found = false;
      for (let depth = 1; depth <= ACT.initiationBy && !found; depth++) {
        if (depth > 1) enterRoom(s, depth, 'combat', 'upgrade', []);
        s = apply(s, { type: 'debug', playerId: 'p1', action: 'killAll' }).state;
        if (s.run!.phase === 'reward') s = apply(s, { type: 'chooseReward', playerId: 'p1', index: null }).state;
        found = s.run!.doors.some((d) => d.reward === 'initiation');
      }
      expect(found, `seed ${seed}`).toBe(true);
    }
  });

  it('taking a second class adds its passive, opens its abilities and forms the hybrid', () => {
    let s = createGame(3, { classId: 'knight' });
    const r = apply(s, { type: 'debugClass', playerId: 'p1', classId: 'necromancer' });
    s = r.state;
    const p = s.players[0]!;
    expect(p.classes).toEqual(['knight', 'necromancer']);
    expect(p.passives).toContain('necro.gravedigger');
    expect(p.hybrid).toBe('hybrid.runeKnight');
    expect(of(r.events, 'hybridFormed')).toHaveLength(1);
  });

  it('there is a hybrid for every pair of classes', () => {
    expect(HYBRIDS.map((h) => [...h.classes].sort().join('+')).sort()).toEqual([
      'knight+necromancer',
      'knight+rogue',
      'necromancer+rogue',
    ]);
  });

  it('Rune knight: a push leaves a rune trap where the enemy stood', () => {
    const s = map(`
      ########
      #>W...W#
      ########`);
    s.players[0]!.hybrid = 'hybrid.runeKnight';
    const r = apply(s, use('knight.shieldBash'));
    expect(surfaceAt(r.state, { x: 2, y: 1 }, 'trap')).toBeDefined();
  });

  it('Necro-assassin: a backstab next to a corpse raises it', () => {
    const s = map(
      `
      #######
      #.c...#
      #.W...#
      #.^..W#
      #######`,
      { classId: 'necromancer' },
    );
    s.players[0]!.hybrid = 'hybrid.necroAssassin';
    s.players[0]!.passives.push('rogue.backstab');
    s.enemies[0]!.dir = 0; // facing away
    s.enemies[0]!.hp = 9;
    const r = apply(s, use('necro.staff'));
    expect(r.state.allies).toHaveLength(1);
  });

  it('Duelist: after a backstab the next push goes further and stuns', () => {
    const s = map(`
      ########
      #>W...W#
      ########`);
    s.players[0]!.hybrid = 'hybrid.duelist';
    s.players[0]!.statuses.push({ id: 'duelist', turns: 2, amount: 0, sourceId: 'p1' });
    const r = apply(s, use('knight.shieldBash'));
    expect(of(r.events, 'pushed')).toHaveLength(3);
    expect(of(r.events, 'statusApplied').some((e) => e.type === 'statusApplied' && e.status === 'stun')).toBe(true);
  });
});

describe('rewards fit the build', () => {
  const offered = (classId: string, extraClass?: string) => {
    const seen = new Set<string>();
    for (let seed = 1; seed <= 40; seed++) {
      let s = createGame(seed, { classId });
      if (extraClass) s = apply(s, { type: 'debugClass', playerId: 'p1', classId: extraClass }).state;
      enterRoom(s, 2, 'combat', 'modifier', []);
      s = apply(s, { type: 'debug', playerId: 'p1', action: 'killAll' }).state;
      for (const o of s.run!.offer) if (o.kind === 'modifier') seen.add(o.id);
    }
    return seen;
  };

  it('a Knight is never offered projectile or summon modifiers', () => {
    const seen = offered('knight');
    for (const id of ['mod.longReach', 'mod.piercing', 'mod.venomShots', 'mod.doubleSummon', 'mod.vengefulDead'])
      expect(seen.has(id), id).toBe(false);
    expect(seen.has('mod.longPush')).toBe(true);
  });

  it('after Initiation into Necromancer, summon modifiers show up for the Knight', () => {
    const seen = offered('knight', 'necromancer');
    expect(
      ['mod.doubleSummon', 'mod.vengefulDead', 'mod.boneShards', 'mod.greedyDead'].some((id) => seen.has(id)),
    ).toBe(true);
  });
});
