import { describe, expect, it } from 'vitest';
import { dirVec, floodFill, getCell, index, type Vec2 } from '../core/grid';
import { ACT, BIOMES, getAbility, getClass, getEnemy } from '../content';
import { intentFor } from './ai';
import { apply } from './apply';
import type { Command, GameEvent } from './commands';
import { addSurface, createEngine, dealDamage } from './engine';
import { createGame, hasStatus, roomFor, surfaceAt, unitById, type GameState } from './state';
import { stateFromMap, type MapOptions } from './testing';

const ENEMY_GLYPHS = {
  G: 'ghoul',
  D: 'drowned',
  Z: 'bloated',
  L: 'leech',
  T: 'templar',
  Y: 'acolyte',
  R: 'bellringer',
  M: 'drownedMother',
  V: 'fallenVoice',
};
const map = (m: string, opts: MapOptions = {}) => stateFromMap(m, { ...opts, enemies: ENEMY_GLYPHS });
const use = (abilityId: string, target?: Vec2): Command =>
  target
    ? { type: 'useAbility', playerId: 'p1', abilityId, target }
    : { type: 'useAbility', playerId: 'p1', abilityId };
const of = (events: readonly GameEvent[], type: GameEvent['type']) => events.filter((e) => e.type === type);
const hp = (s: GameState, id: string) => unitById(s, id)?.hp;
const me = (s: GameState) => s.players[0]!;
/** Telegraphs every enemy's real next attack (cells for blasts, aid and summons included). */
const telegraph = (s: GameState) => {
  for (const e of s.enemies) e.intent = intentFor(s, e, e.dir);
  return s;
};
/** A swing at the empty cell in front: one turn passes and the world answers. */
const swing = use('knight.sword');

describe('the Rogue is no longer a one-blow assassin (owner report, M5)', () => {
  it('Shadow step cools down for 3 turns and the Rogue has 13 health again', () => {
    expect(getAbility('rogue.shadowStep').cooldown).toBe(3);
    expect(getClass('rogue').maxHp).toBe(13);
  });

  it('a Templar cannot be caught off guard: no daze, so it turns round and the dagger meets its shield', () => {
    const s = map(
      `
      #######
      #>..T.#
      #.....#
      #######`,
      { classId: 'rogue', enemyDir: 3 },
    );
    const r = apply(s, use('rogue.shadowStep', { x: 4, y: 1 }));
    expect(of(r.events, 'resisted')).toHaveLength(1);
    const t = unitById(r.state, 'e1')!;
    expect(hasStatus(t, 'daze')).toBe(false);
    // Not dazed, it faced the rogue in its own turn: the stab hits the shield (2 − 2), only the bleeding hurts.
    expect(t.dir).toBe(1);
    const r2 = apply(r.state, use('rogue.dagger'));
    expect(hp(r2.state, 'e1')).toBe(7 - 1);
  });
});

describe('act 1, the Crypt: the Ghoul', () => {
  it('eats a corpse next to it at the end of a turn and heals 2', () => {
    const s = map(`
      ######
      #....#
      #^Gc.#
      #######`);
    s.enemies[0]!.hp = 2;
    const r = apply(s, swing);
    expect(hp(r.state, 'e1')).toBe(4);
    expect(surfaceAt(r.state, { x: 3, y: 2 }, 'corpse')).toBeUndefined();
  });
});

describe('act 2, the Flooded Catacombs', () => {
  it('the Drowned throws a hook along its line and drags you 2 cells closer', () => {
    const s = telegraph(
      map(
        `
        #######
        #.....#
        #^...D#
        #######`,
        { enemyDir: 3 },
      ),
    );
    const r = apply(s, swing);
    expect(me(r.state)).toMatchObject({ x: 3, y: 2 });
    expect(me(r.state).hp).toBe(me(s).hp - 1);
  });

  it('a Bloated corpse bursts into a 3×3 cloud of poison that hurts the heroes', () => {
    const s = map(`
      #######
      #>Z...#
      #.....#
      #....W#
      #######`);
    s.enemies[0]!.hp = 1;
    const r = apply(s, use('knight.sword'));
    expect(unitById(r.state, 'e1')).toBeUndefined();
    const cloud = r.state.surfaces.filter((x) => x.id === 'poisonCloud');
    expect(cloud.length).toBeGreaterThanOrEqual(6);
    expect(cloud.every((c) => c.side === 'foes')).toBe(true);
    expect(hasStatus(me(r.state), 'poison')).toBe(true);
  });

  it('Leeches bite to make you bleed, and come in packs', () => {
    const s = telegraph(
      map(
        `
        #####
        #...#
        #L^.#
        #####`,
        { enemyDir: 1 },
      ),
    );
    const r = apply(s, use('knight.sword'));
    expect(hasStatus(me(r.state), 'bleed')).toBe(true);
    expect(getEnemy('leech').pack).toBe(3);
    let packs = 0;
    for (let seed = 1; seed <= 40; seed++) {
      const g = apply(createGame(seed), { type: 'debugJump', playerId: 'p1', act: 2, depth: 3 }).state;
      if (g.enemies.filter((e) => e.type === 'leech').length >= 2) packs++;
    }
    expect(packs).toBeGreaterThan(0);
  });

  it('the Drowned Mother floods her line with water', () => {
    const s = telegraph(
      map(
        `
        #########
        #.......#
        #^.....M#
        #########`,
        { enemyDir: 3 },
      ),
    );
    const r = apply(s, swing);
    expect(me(r.state).hp).toBe(me(s).hp - 3);
    for (let x = 1; x <= 6; x++) expect(surfaceAt(r.state, { x, y: 2 }, 'water'), `x ${x}`).toBeDefined();
  });

  it('water carries lightning to everyone in the same pool, and puts out the burning', () => {
    const s = map(`
      ########
      #^.W.W.#
      #......#
      ########`);
    for (let x = 2; x <= 5; x++) s.surfaces.push({ id: 'water', x, y: 1, turns: null, side: 'neutral' });
    const eng = createEngine(s, []);
    dealDamage(eng, s.enemies[0]!, 1, me(s), 'effect', ['lightning']);
    expect([s.enemies[0]!.hp, s.enemies[1]!.hp]).toEqual([3, 3]);
    dealDamage(eng, s.enemies[0]!, 1, me(s), 'effect', ['fire']);
    expect(s.enemies[1]!.hp).toBe(3);

    const t = map(`
      ######
      #>...#
      #...W#
      ######`);
    t.players[0]!.statuses.push({ id: 'burning', turns: 3, amount: 0, sourceId: 'x' });
    t.surfaces.push({ id: 'water', x: 2, y: 1, turns: null, side: 'neutral' });
    const r = apply(t, { type: 'move', playerId: 'p1', dir: 'forward' });
    expect(hasStatus(me(r.state), 'burning')).toBe(false);
  });

  it('surfaces react: fire on ice melts it into water, fire on water goes out', () => {
    const s = map(`
      #######
      #>W...#
      #.....#
      #######`);
    const eng = createEngine(s, []);
    s.surfaces.push({ id: 'ice', x: 3, y: 1, turns: 5, side: 'heroes' });
    s.surfaces.push({ id: 'water', x: 4, y: 1, turns: null, side: 'neutral' });
    // The path every fire takes (abilities, gifts, surfaces).
    for (const x of [3, 4]) addSurface(eng, 'fire', { x, y: 1 }, 3, 'heroes');
    expect(surfaceAt(s, { x: 3, y: 1 }, 'ice')).toBeUndefined();
    expect(surfaceAt(s, { x: 3, y: 1 }, 'water')).toBeDefined();
    expect(surfaceAt(s, { x: 4, y: 1 }, 'fire')).toBeUndefined();
    expect(surfaceAt(s, { x: 4, y: 1 }, 'water')).toBeDefined();
  });
});

describe('act 3, the Cathedral of the Fallen God', () => {
  it('a Templar shrugs off blows from the front (shield −2)', () => {
    const s = map(
      `
      ######
      #>T..#
      #....#
      ######`,
      { enemyDir: 3 },
    );
    expect(hp(apply(s, use('knight.sword')).state, 'e1')).toBe(7);
    const t = map(
      `
      ######
      #>T..#
      #....#
      ######`,
      { enemyDir: 1 },
    );
    const r = apply(t, use('knight.sword'));
    expect(hp(r.state, 'e1')).toBe(5);
    expect(unitById(r.state, 'e1')!.dir).toBe(3);
  });

  it('an Acolyte shields the most hurt enemy near it', () => {
    const s = map(
      `
      #########
      #.......#
      #^..W..Y#
      #########`,
      { enemyDir: 3 },
    );
    s.enemies[0]!.hp = 1;
    telegraph(s);
    expect(s.enemies[1]!.intent).toMatchObject({ kind: 'aid', cells: [{ x: 4, y: 2 }] });
    const r = apply(s, swing);
    expect(unitById(r.state, 'e1')!.statuses.find((x) => x.id === 'shield')?.amount).toBe(3);
  });

  it('a Bellringer rings a cross around itself and stuns whoever is in it', () => {
    const s = telegraph(
      map(`
      #####
      #.R.#
      #.^.#
      #####`),
    );
    const r = apply(s, use('knight.sword'));
    expect(me(r.state).hp).toBe(me(s).hp - 2);
    expect(of(r.events, 'statusApplied').some((e) => e.type === 'statusApplied' && e.status === 'stun')).toBe(true);
  });

  it('holy fire burns whoever steps in, and enemies walk around it', () => {
    const s = map(`
      #######
      #>....#
      #....W#
      #######`);
    s.surfaces.push({ id: 'holyFire', x: 2, y: 1, turns: null, side: 'neutral' });
    const r = apply(s, { type: 'move', playerId: 'p1', dir: 'forward' });
    // 2 for stepping in, 2 more for still standing there when the turn ends.
    expect(me(r.state).hp).toBe(me(s).hp - 4);

    const t = map(`
      #######
      #^....#
      #...W.#
      #######`);
    // A wall of holy fire between them, with a way round along the top row.
    t.surfaces.push({ id: 'holyFire', x: 3, y: 2, turns: null, side: 'neutral' });
    const r2 = apply(t, { type: 'move', playerId: 'p1', dir: 'back' });
    const w = unitById(r2.state, 'e1')!;
    expect(surfaceAt(r2.state, w, 'holyFire')).toBeUndefined();
  });

  it('the Voice blasts the square where you stand, leaving holy fire', () => {
    const s = telegraph(
      map(
        `
        #########
        #.......#
        #.^.....#
        #.......#
        #......V#
        #########`,
        { enemyDir: 3 },
      ),
    );
    expect(s.enemies[0]!.intent).toMatchObject({ kind: 'blast' });
    const r = apply(s, use('knight.sword'));
    // The blast (3), then the holy fire it left under your feet as the turn ends (2): step out in time.
    expect(me(r.state).hp).toBe(me(s).hp - 5);
    expect(r.state.surfaces.filter((x) => x.id === 'holyFire').length).toBe(9);
  });

  it('at half health the Voice cracks the floor with holy fire and comes down to fight', () => {
    const s = map(
      `
      ###########
      #.........#
      #.^.......#
      #.........#
      #.........#
      #........V#
      ###########`,
      { enemyDir: 3 },
    );
    s.enemies[0]!.hp = 15;
    const r = apply(s, swing);
    expect(of(r.events, 'phaseEntered')).toEqual([{ type: 'phaseEntered', unitId: 'e1', phase: 1 }]);
    expect(r.state.surfaces.filter((x) => x.id === 'holyFire').length).toBe(8);
    const v = r.state.enemies.find((e) => e.id === 'e1')!;
    expect(v.intent?.kind).toBe('sweep');
    // It moves two cells now.
    expect(Math.abs(v.x - 9) + Math.abs(v.y - 5)).toBe(2);
  });
});

describe('three acts, three biomes', () => {
  it('each act has its own enemies and boss', () => {
    for (const [i, biome] of BIOMES.entries()) {
      const s = apply(createGame(11), { type: 'debugJump', playerId: 'p1', act: i + 1, depth: ACT.rooms + 1 }).state;
      expect(s.enemies.map((e) => e.type)).toEqual([biome.boss]);
      const room = apply(createGame(11), { type: 'debugJump', playerId: 'p1', act: i + 1, depth: 2 }).state;
      const types = new Set(biome.enemies.map((e) => e.id));
      expect(room.enemies.every((e) => types.has(e.type))).toBe(true);
    }
  });

  for (const [i, biome] of BIOMES.entries())
    it(`${biome.id}: 1000 rooms — every floor cell reachable, doors connected, hazards on floor`, () => {
      for (let seed = 0; seed < 1000; seed++) {
        const r = roomFor(seed, 1 + (seed % (ACT.rooms + 1)), seed % 6 === 5 ? 'boss' : 'combat', i + 1);
        const seen = floodFill(r.grid, r.spawn, (t) => t === 'floor');
        r.grid.cells.forEach((t, j) => {
          if (t === 'floor') expect(seen[j], `seed ${seed}: unreachable floor`).toBe(true);
        });
        for (const d of r.doors.filter((x) => x.kind === 'exit')) {
          const v = dirVec(d.dir);
          expect(seen[index(r.grid, d.x + v.x, d.y + v.y)], `seed ${seed}: door not connected`).toBe(true);
        }
      }
      for (let seed = 0; seed < 100; seed++) {
        const s = apply(createGame(seed), { type: 'debugJump', playerId: 'p1', act: i + 1, depth: 2 }).state;
        for (const sf of s.surfaces) expect(getCell(s.room.grid, sf.x, sf.y)).toBe('floor');
        const p = me(s);
        expect(s.surfaces.some((sf) => sf.x === p.x && sf.y === p.y && sf.id !== 'corpse')).toBe(false);
      }
    });

  it('a whole run replays exactly across acts (determinism)', () => {
    const cmds: Command[] = [
      { type: 'debug', playerId: 'p1', action: 'killAll' },
      { type: 'debugJump', playerId: 'p1', act: 2, depth: 3 },
      { type: 'move', playerId: 'p1', dir: 'forward' },
      { type: 'debugJump', playerId: 'p1', act: 3, depth: ACT.rooms + 1 },
      { type: 'move', playerId: 'p1', dir: 'forward' },
    ];
    const run = () => cmds.reduce((s, c) => apply(s, c).state, createGame(77, { classId: 'rogue' }));
    expect(JSON.stringify(run())).toBe(JSON.stringify(run()));
  });
});
