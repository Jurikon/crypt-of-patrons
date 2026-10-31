import { describe, expect, it } from 'vitest';
import type { Vec2 } from '../core/grid';
import { GIFTS, PATRONS } from '../content';
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
const withGifts = (m: string, gifts: string[], opts: MapOptions = {}) => {
  const s = stateFromMap(m, opts);
  s.players[0]!.gifts.push(...gifts);
  return s;
};
/** Player facing east with a warrior right in front and another far away. */
const FRONT = `
  #########
  #>W.....#
  #.......#
  #......W#
  #########`;

/** Walks the hero through a door into a new room (with room-start rules) and returns the state. */
function enterNewRoom(gifts: string[], classId = 'knight'): GameState {
  const s = createGame(6, { classId });
  s.players[0]!.gifts.push(...gifts);
  s.run!.phase = 'doors';
  const door = s.room.doors.findIndex((d) => d.kind === 'exit');
  s.run!.doors = [{ door, reward: 'upgrade' }];
  const d = s.room.doors[door]!;
  const p = s.players[0]!;
  p.x = d.x + [0, 1, 0, -1][d.dir]!;
  p.y = d.y + [-1, 0, 1, 0][d.dir]!;
  p.dir = ((d.dir + 2) % 4) as 0 | 1 | 2 | 3;
  s.enemies = [];
  s.combat.status = 'won';
  return apply(s, step('forward')).state;
}

describe('the pantheon', () => {
  it('five patrons with five gifts each, and five duo gifts', () => {
    expect(PATRONS).toHaveLength(5);
    for (const p of PATRONS) expect(p.gifts).toHaveLength(5);
    expect(GIFTS.filter((g) => g.patrons).length).toBe(5);
  });
});

describe('Morra', () => {
  it('Plague strike: the base attack poisons', () => {
    const r = apply(withGifts(FRONT, ['gift.morra.plagueStrike']), use('knight.sword'));
    expect(hasStatus(unitById(r.state, 'e1')!, 'poison')).toBe(true);
  });

  it('Contagion: a dying enemy passes its harmful statuses to its neighbours', () => {
    const s = withGifts(
      `
      #######
      #>WW..#
      #.....#
      #....W#
      #######`,
      ['gift.morra.contagion'],
    );
    s.enemies[0]!.hp = 1;
    s.enemies[0]!.statuses.push({ id: 'bleed', turns: 2, amount: 0, sourceId: 'p1' });
    const r = apply(s, use('knight.sword'));
    expect(hasStatus(unitById(r.state, 'e2')!, 'bleed')).toBe(true);
  });

  it('Miasma: a poisoned enemy dies into a poison cloud', () => {
    const s = withGifts(FRONT, ['gift.morra.miasma']);
    s.enemies[0]!.hp = 1;
    s.enemies[0]!.statuses.push({ id: 'poison', turns: 2, amount: 1, sourceId: 'p1' });
    expect(surfaceAt(apply(s, use('knight.sword')).state, { x: 2, y: 1 }, 'poisonCloud')).toBeDefined();
  });

  it('Rotten blood: every poison you apply is one stronger', () => {
    const s = withGifts(FRONT, ['gift.morra.rottenBlood', 'gift.morra.plagueStrike']);
    s.enemies[0]!.hp = 9;
    const r = apply(s, use('knight.sword'));
    // 1 + 1 bonus, then one tick at the end of the turn takes 2.
    expect(9 - hp(r.state, 'e1')!).toBe(2 + 2);
  });

  it('Pestilence: the two nearest enemies start each room poisoned', () => {
    const s = enterNewRoom(['gift.morra.pestilence']);
    expect(s.enemies.filter((e) => hasStatus(e, 'poison')).length).toBe(Math.min(2, s.enemies.length));
  });
});

describe('Velkar', () => {
  it('Thunder push: a pushed enemy zaps enemies next to its path', () => {
    const s = withGifts(
      `
      #########
      #>W.....#
      #..W....#
      #......W#
      #########`,
      ['gift.velkar.thunderPush'],
    );
    const r = apply(s, use('knight.shieldBash'));
    expect(hp(r.state, 'e2')).toBeLessThan(4);
  });

  it('Discharge: a kill zaps the two nearest enemies', () => {
    const s = withGifts(
      `
      #########
      #>WW....#
      #..W....#
      #......W#
      #########`,
      ['gift.velkar.discharge'],
    );
    s.enemies[0]!.hp = 1;
    const r = apply(s, use('knight.sword'));
    expect([hp(r.state, 'e2'), hp(r.state, 'e3')]).toEqual([3, 3]);
  });

  it('Storm step: after a movement ability, adjacent enemies take 1', () => {
    const s = withGifts(
      `
      ########
      #>.W...#
      #...W..#
      #.....W#
      ########`,
      ['gift.velkar.stormStep'],
      { classId: 'rogue', enemyDir: 3 },
    );
    const r = apply(s, use('rogue.shadowStep', { x: 3, y: 1 }));
    expect(hp(r.state, 'e2')).toBe(3);
  });

  it('Tailwind: two free actions at the start of each room', () => {
    expect(enterNewRoom(['gift.velkar.tailwind']).players[0]!.freeActions).toBe(2);
  });

  it('Static charge: every third base attack stuns', () => {
    let s = withGifts(FRONT, ['gift.velkar.staticCharge']);
    s.enemies[0]!.hp = 99;
    s.enemies[0]!.maxHp = 99;
    const stuns: number[] = [];
    for (let i = 0; i < 3; i++) {
      const r = apply(s, use('knight.sword'));
      stuns.push(of(r.events, 'statusApplied').filter((e) => e.type === 'statusApplied' && e.status === 'stun').length);
      s = r.state;
      s.enemies[0]!.x = 2;
      s.enemies[0]!.y = 1;
    }
    expect(stuns).toEqual([0, 0, 1]);
  });
});

describe('Silas', () => {
  it('Retinue: each room starts with a skeleton beside you', () => {
    expect(enterNewRoom(['gift.silas.retinue']).allies).toHaveLength(1);
  });

  it('Bone to bone / legion: summons are tougher, and there is one more', () => {
    const s = withGifts(
      `
      ########
      #.c....#
      #.^....#
      #.....W#
      ########`,
      ['gift.silas.boneToBone', 'gift.silas.legion'],
      { classId: 'necromancer' },
    );
    const r = apply(s, use('necro.raise', { x: 2, y: 1 }));
    expect(r.state.allies).toHaveLength(2);
    expect(r.state.allies.every((a) => a.maxHp === 4)).toBe(true);
  });

  it('Feast: a dying summon heals you', () => {
    const s = withGifts(
      `
      #######
      #.S...#
      #.^..W#
      #######`,
      ['gift.silas.feast'],
      { classId: 'necromancer', abilities: ['necro.sacrifice'] },
    );
    s.players[0]!.hp = 5;
    expect(apply(s, use('necro.sacrifice', { x: 2, y: 1 })).state.players[0]!.hp).toBe(6);
  });

  it('Grave harvest: every class leaves corpses', () => {
    const s = withGifts(FRONT, ['gift.silas.graveHarvest']);
    s.enemies[0]!.hp = 1;
    expect(surfaceAt(apply(s, use('knight.sword')).state, { x: 2, y: 1 }, 'corpse')).toBeDefined();
  });
});

describe('Ingrid', () => {
  it('Ice verdict: a stunned enemy slammed into a wall takes 2 more', () => {
    const s = withGifts(
      `
      #####
      #>W.#
      #...#
      #..W#
      #####`,
      ['gift.ingrid.iceVerdict'],
    );
    s.enemies[0]!.hp = 20;
    s.enemies[0]!.statuses.push({ id: 'stun', turns: 2, amount: 0, sourceId: 'p1' });
    const r = apply(s, use('knight.shieldBash'));
    // bash 1 + collision 1+2 + verdict 2
    expect(20 - hp(r.state, 'e1')!).toBe(6);
  });

  it('Hoarfrost: a 3-point shield at the start of each room', () => {
    const p = enterNewRoom(['gift.ingrid.hoarfrost']).players[0]!;
    expect(p.statuses.find((x) => x.id === 'shield')?.amount).toBe(3);
  });

  it('Cold trail / frostbite: pushes leave ice, and hitting an enemy on ice stuns it', () => {
    const s = withGifts(
      `
      ########
      #>W....#
      #......#
      #.....W#
      ########`,
      ['gift.ingrid.coldTrail'],
    );
    expect(surfaceAt(apply(s, use('knight.shieldBash')).state, { x: 2, y: 1 }, 'ice')).toBeDefined();
    const t = withGifts(FRONT, ['gift.ingrid.frostbite']);
    t.surfaces.push({ id: 'ice', x: 2, y: 1, turns: 5, side: 'heroes' });
    t.enemies[0]!.hp = 9;
    const r = apply(t, use('knight.sword'));
    expect(of(r.events, 'statusApplied').some((e) => e.type === 'statusApplied' && e.status === 'stun')).toBe(true);
  });

  it("Widow's veil: getting hurt gives a point of shield, once per turn", () => {
    const s = withGifts(
      `
      #####
      #.W.#
      #.^.#
      #...#
      ####W`,
      ['gift.ingrid.widowVeil'],
      { intents: true },
    );
    const r = apply(s, use('knight.sword'));
    expect(hasStatus(r.state.players[0]!, 'shield')).toBe(true);
  });
});

describe('Ashtar', () => {
  it('Judgement fire: area blows set the cells they hit on fire', () => {
    const s = withGifts(FRONT, ['gift.ashtar.judgementFire'], { abilities: ['knight.crush'] });
    s.enemies[0]!.hp = 9;
    expect(surfaceAt(apply(s, use('knight.crush')).state, { x: 2, y: 1 }, 'fire')).toBeDefined();
  });

  it('Pyre: a dying enemy sets its cell alight', () => {
    const s = withGifts(FRONT, ['gift.ashtar.pyre']);
    s.enemies[0]!.hp = 1;
    expect(surfaceAt(apply(s, use('knight.sword')).state, { x: 2, y: 1 }, 'fire')).toBeDefined();
  });

  it('Torchbearer / searing blood: the base attack burns, and burning hurts 1 more', () => {
    const s = withGifts(FRONT, ['gift.ashtar.torchbearer', 'gift.ashtar.searingBlood']);
    s.enemies[0]!.hp = 9;
    const r = apply(s, use('knight.sword'));
    // sword 2, then at the end of the turn: burning 1 + searing 1.
    expect(9 - hp(r.state, 'e1')!).toBe(4);
  });

  it('Ash burst: a burning enemy explodes when it dies', () => {
    const s = withGifts(
      `
      #######
      #>WW..#
      #.....#
      #....W#
      #######`,
      ['gift.ashtar.ashBurst'],
    );
    s.enemies[0]!.hp = 1;
    s.enemies[0]!.statuses.push({ id: 'burning', turns: 2, amount: 0, sourceId: 'p1' });
    expect(hp(apply(s, use('knight.sword')).state, 'e2')).toBe(2);
  });
});

describe('duo gifts', () => {
  it('Plague dead: summons poison what they hit', () => {
    const s = withGifts(
      `
      #######
      #.SW..#
      #.^...#
      #....W#
      #######`,
      ['duo.plagueDead'],
      { classId: 'necromancer' },
    );
    s.enemies[0]!.hp = 9;
    expect(hasStatus(unitById(apply(s, step('left')).state, 'e1')!, 'poison')).toBe(true);
  });

  it('Firestorm: lightning sets enemies on fire', () => {
    const s = withGifts(
      `
      #########
      #>WW....#
      #..W....#
      #......W#
      #########`,
      ['gift.velkar.discharge', 'duo.firestorm'],
    );
    s.enemies[0]!.hp = 1;
    const r = apply(s, use('knight.sword'));
    expect(of(r.events, 'statusApplied').some((e) => e.type === 'statusApplied' && e.status === 'burning')).toBe(true);
  });

  it('Ice storm: an enemy pushed across ice is zapped and stunned', () => {
    const s = withGifts(
      `
      #########
      #>W.....#
      #.......#
      #......W#
      #########`,
      ['duo.iceStorm'],
    );
    s.surfaces.push({ id: 'ice', x: 3, y: 1, turns: 5, side: 'heroes' });
    s.enemies[0]!.hp = 9;
    const r = apply(s, use('knight.shieldBash'));
    expect(of(r.events, 'statusApplied').some((e) => e.type === 'statusApplied' && e.status === 'stun')).toBe(true);
  });

  it('Plague flame: burning enemies are poisoned too', () => {
    const s = withGifts(FRONT, ['gift.ashtar.torchbearer', 'duo.plagueFlame']);
    s.enemies[0]!.hp = 9;
    expect(hasStatus(unitById(apply(s, use('knight.sword')).state, 'e1')!, 'poison')).toBe(true);
  });

  it('Ice guardians: summons stun what they hit', () => {
    const s = withGifts(
      `
      #######
      #.SW..#
      #.^...#
      #....W#
      #######`,
      ['duo.iceGuardians'],
      { classId: 'necromancer' },
    );
    s.enemies[0]!.hp = 9;
    const r = apply(s, step('left'));
    expect(of(r.events, 'statusApplied').some((e) => e.type === 'statusApplied' && e.status === 'stun')).toBe(true);
  });
});

describe('altars', () => {
  it('the first altar door shows up when leaving room 1 or 2, with a patron', () => {
    for (let seed = 1; seed <= 20; seed++) {
      let s = createGame(seed);
      let altar = null;
      for (let depth = 1; depth <= 2 && !altar; depth++) {
        if (depth > 1) enterRoom(s, depth, 'combat', 'upgrade', []);
        s = apply(s, { type: 'debug', playerId: 'p1', action: 'killAll' }).state;
        if (s.run!.phase === 'reward') s = apply(s, { type: 'chooseReward', playerId: 'p1', index: null }).state;
        altar = s.run!.doors.find((d) => d.reward === 'altar') ?? null;
      }
      expect(altar?.patron, `seed ${seed}`).toBeDefined();
    }
  });

  it("an altar room rewards three of that patron's gifts; taking one adds it", () => {
    const s = createGame(7);
    s.run!.patron = 'morra';
    enterRoom(s, 2, 'combat', 'altar', []);
    s.run!.patron = 'morra';
    const cleared = apply(s, { type: 'debug', playerId: 'p1', action: 'killAll' }).state;
    const offer = cleared.run!.offer;
    expect(offer).toHaveLength(3);
    expect(offer.every((o) => o.kind === 'gift' && o.id.startsWith('gift.morra.'))).toBe(true);
    const taken = apply(cleared, { type: 'chooseReward', playerId: 'p1', index: 0 }).state;
    expect(taken.players[0]!.gifts).toHaveLength(1);
  });

  it('a duo gift can show up once you hold gifts of both patrons', () => {
    let duoSeen = false;
    for (let seed = 1; seed <= 20 && !duoSeen; seed++) {
      const s = createGame(seed, { classId: 'necromancer' });
      s.players[0]!.gifts.push('gift.morra.plagueStrike', 'gift.silas.graveHarvest');
      enterRoom(s, 3, 'combat', 'altar', []);
      s.run!.patron = 'silas';
      const cleared = apply(s, { type: 'debug', playerId: 'p1', action: 'killAll' }).state;
      duoSeen = cleared.run!.offer.some((o) => o.kind === 'gift' && o.id === 'duo.plagueDead');
    }
    expect(duoSeen).toBe(true);
  });

  it('a duo gift with nothing to work on is not offered (Guardians of ice without summons)', () => {
    for (let seed = 1; seed <= 30; seed++) {
      const s = createGame(seed, { classId: 'knight' });
      s.players[0]!.gifts.push('gift.silas.graveHarvest', 'gift.ingrid.hoarfrost');
      enterRoom(s, 3, 'combat', 'altar', []);
      s.run!.patron = 'ingrid';
      const offer = apply(s, { type: 'debug', playerId: 'p1', action: 'killAll' }).state.run!.offer;
      expect(
        offer.some((o) => o.kind === 'gift' && o.id === 'duo.iceGuardians'),
        `seed ${seed}`,
      ).toBe(false);
    }
  });

  it('an altar never offers a gift with nothing to work on (a Knight gets no summon gifts from Silas)', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const s = createGame(seed, { classId: 'knight' });
      enterRoom(s, 2, 'combat', 'altar', []);
      s.run!.patron = 'silas';
      const offer = apply(s, { type: 'debug', playerId: 'p1', action: 'killAll' }).state.run!.offer;
      const ids = offer.map((o) => (o.kind === 'gift' ? o.id : '')).sort();
      // Only retinue and grave harvest fit: two cards, not a third that does nothing.
      expect(ids).toEqual(['gift.silas.graveHarvest', 'gift.silas.retinue']);
    }
  });

  it('owner bug: a Necromancer without pushes is not offered Ice verdict at an altar of Ingrid', () => {
    for (let seed = 1; seed <= 50; seed++) {
      const s = createGame(seed, { classId: 'necromancer' });
      enterRoom(s, 2, 'combat', 'altar', []);
      s.run!.patron = 'ingrid';
      const offer = apply(s, { type: 'debug', playerId: 'p1', action: 'killAll' }).state.run!.offer;
      const ids = offer.map((o) => (o.kind === 'gift' ? o.id : ''));
      expect(ids, `seed ${seed}`).not.toContain('gift.ingrid.iceVerdict');
      expect(ids, `seed ${seed}`).not.toContain('gift.ingrid.coldTrail');
    }
  });
});
