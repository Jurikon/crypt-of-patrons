import { describe, expect, it } from 'vitest';
import { apply } from './apply';
import { createGame } from './state';
import { stateFromMap } from './testing';
import { MIN_SPAWN_DISTANCE } from './encounter';
import { getCell } from '../core/grid';

/** Spends a turn by swinging at the empty cell in front (players below face a wall). */
const pass = { type: 'useAbility', playerId: 'p1', abilityId: 'knight.sword' } as const;

describe('enemy AI', () => {
  it('a warrior walks one cell per turn towards the player', () => {
    const s = stateFromMap(`
      #########
      #^......#
      #.......#
      #......W#
      #########`);
    const r = apply(s, pass);
    const w = r.state.enemies[0]!;
    expect(r.events.filter((e) => e.type === 'moved')).toHaveLength(1);
    expect(Math.abs(w.x - 1) + Math.abs(w.y - 1)).toBe(8 - 1);
  });

  it('a warrior next to the player faces it and telegraphs onto its cell', () => {
    const s = stateFromMap(`
      #######
      #^....#
      #.W...#
      #######`);
    const r = apply(s, pass);
    const w = r.state.enemies[0]!;
    expect(Math.abs(w.x - 1) + Math.abs(w.y - 1)).toBe(1);
    const target = { x: w.x + [0, 1, 0, -1][w.dir]!, y: w.y + [-1, 0, 1, 0][w.dir]! };
    expect(target).toEqual({ x: 1, y: 1 });
  });

  it('enemies never walk into pits and go around them', () => {
    const s = stateFromMap(`
      #######
      #^.~..#
      #..~..#
      #.....#
      #....W#
      #######`);
    let st = s;
    for (let i = 0; i < 8; i++) {
      const r = apply(st, pass);
      st = r.state;
      for (const e of st.enemies) expect(getCell(st.room.grid, e.x, e.y)).toBe('floor');
    }
    const w = st.enemies[0]!;
    expect(Math.abs(w.x - 1) + Math.abs(w.y - 1)).toBe(1);
  });

  it('an archer lines up with the player at range and then aims', () => {
    const s = stateFromMap(`
      #########
      #^......#
      #.......#
      #.....A.#
      #.......#
      #########`);
    let st = s;
    let aimed = false;
    for (let i = 0; i < 6 && !aimed; i++) {
      st = apply(st, pass).state;
      const a = st.enemies[0]!;
      aimed = a.intent !== null && (a.x === 1 || a.y === 1);
    }
    const a = st.enemies[0]!;
    const d = Math.abs(a.x - 1) + Math.abs(a.y - 1);
    expect(aimed).toBe(true);
    expect(d).toBeGreaterThanOrEqual(2);
    expect(d).toBeLessThanOrEqual(5);
    expect(a.intent?.kind).toBe('line');
  });

  it('an archer either moves or aims in a turn, never both', () => {
    const s = stateFromMap(`
      #########
      #^......#
      #.......#
      #.....A.#
      #.......#
      #########`);
    let st = s;
    for (let i = 0; i < 10; i++) {
      const { state, events } = apply(st, pass);
      const moved = events.some((e) => e.type === 'moved' && e.unitId === 'e1');
      const aimed = events.some((e) => e.type === 'intentDeclared' && e.unitId === 'e1');
      expect(moved && aimed).toBe(false);
      st = state;
    }
  });

  it('an archer that can already shoot holds position instead of backing off', () => {
    const s = stateFromMap(`
      #########
      #.......#
      #>....A.#
      #.......#
      #########`);
    // Player walks straight at the archer: 5, 4, 3, 2 cells away. It should stand and shoot, not retreat.
    let st = s;
    for (let i = 0; i < 3; i++) st = apply(st, { type: 'move', playerId: 'p1', dir: 'forward' }).state;
    expect(st.enemies[0]).toMatchObject({ x: 6, y: 2 });
  });

  it('a chased archer can be caught and killed', () => {
    const s = stateFromMap(`
      ###########
      #.........#
      #.........#
      #....>A...#
      #.........#
      #.........#
      ###########`);
    let st = s;
    for (let i = 0; i < 40 && st.enemies.length > 0; i++) {
      const p = st.players[0]!;
      const a = st.enemies[0]!;
      const dx = a.x - p.x;
      const dy = a.y - p.y;
      const want = Math.abs(dx) >= Math.abs(dy) ? (dx > 0 ? 1 : 3) : dy > 0 ? 2 : 0;
      const cmd =
        want === p.dir
          ? ({ type: 'move', playerId: 'p1', dir: 'forward' } as const)
          : ({ type: 'turn', playerId: 'p1', dir: (want - p.dir + 4) % 4 === 1 ? 'right' : 'left' } as const);
      st = apply(st, cmd).state;
    }
    expect(st.enemies).toHaveLength(0);
    expect(st.players[0]!.hp).toBeGreaterThan(0);
  });

  it('regression (bot seed 171): an archer cornered behind pits still finds a firing position', () => {
    const s = stateFromMap(`
      ############
      #######A...#
      #######~~..#
      ######.....#
      ####.##....#
      #.......O..#
      #.....O....#
      #.<......O.#
      #..........#
      ############`);
    let st = s;
    let shotAtPlayer = false;
    for (let i = 0; i < 20 && !shotAtPlayer; i++) {
      const r = apply(st, { type: 'turn', playerId: 'p1', dir: 'left' }); // keep facing the wall
      st = apply(r.state, pass).state;
      const a = st.enemies[0]!;
      const p = st.players[0]!;
      shotAtPlayer = a.x === p.x || a.y === p.y;
      st = apply(st, { type: 'turn', playerId: 'p1', dir: 'right' }).state;
    }
    expect(shotAtPlayer).toBe(true);
  });

  it('is deterministic', () => {
    for (const seed of [3, 30, 300]) {
      const a = apply(createGame(seed), pass);
      const b = apply(createGame(seed), pass);
      expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    }
  });
});

describe('encounters on 1000 seeds', () => {
  it('2–4 enemies on reachable floor, at least 3 steps from the player, intents declared', () => {
    const typesSeen = new Set<string>();
    for (let seed = 0; seed < 1000; seed++) {
      const s = createGame(seed);
      const p = s.players[0]!;
      expect(s.enemies.length, `seed ${seed}`).toBeGreaterThanOrEqual(2);
      expect(s.enemies.length, `seed ${seed}`).toBeLessThanOrEqual(4);
      const cells = new Set<string>();
      for (const e of s.enemies) {
        typesSeen.add(e.type);
        expect(getCell(s.room.grid, e.x, e.y), `seed ${seed}`).toBe('floor');
        expect(Math.abs(e.x - p.x) + Math.abs(e.y - p.y), `seed ${seed}`).toBeGreaterThanOrEqual(MIN_SPAWN_DISTANCE);
        expect(e.intent, `seed ${seed}`).not.toBeNull();
        cells.add(`${e.x},${e.y}`);
      }
      expect(cells.size).toBe(s.enemies.length);
      expect(s.combat.status).toBe('active');
    }
    expect([...typesSeen].sort()).toEqual(['skeletonArcher', 'skeletonWarrior']);
  });
});
