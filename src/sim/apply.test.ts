import { describe, expect, it } from 'vitest';
import { setCell, type CellType, type Dir } from '../core/grid';
import { apply, replay } from './apply';
import type { Command } from './commands';
import { createGame, type GameState } from './state';

/** A game whose player stands at (x, y) facing `dir`, with `around` cells placed by offset. */
function setup(dir: Dir, around: Partial<Record<'n' | 'e' | 's' | 'w', CellType>> = {}): GameState {
  const state = createGame(1);
  const g = state.room.grid;
  for (let i = 0; i < g.cells.length; i++) g.cells[i] = 'wall';
  for (let y = 1; y < g.h - 1; y++) for (let x = 1; x < g.w - 1; x++) setCell(g, x, y, 'floor');
  const x = 3;
  const y = 3;
  const offsets = { n: [0, -1], e: [1, 0], s: [0, 1], w: [-1, 0] } as const;
  for (const [k, t] of Object.entries(around) as [keyof typeof offsets, CellType][]) {
    setCell(g, x + offsets[k][0], y + offsets[k][1], t);
  }
  const p = state.players[0]!;
  p.x = x;
  p.y = y;
  p.dir = dir;
  return state;
}

const move = (dir: 'forward' | 'back' | 'left' | 'right'): Command => ({ type: 'move', playerId: 'p1', dir });
const turn = (dir: 'left' | 'right'): Command => ({ type: 'turn', playerId: 'p1', dir });

describe('apply: movement', () => {
  it('moves relative to facing', () => {
    // Facing east: forward = east, left = north, right = south, back = west.
    const s = setup(1);
    expect(apply(s, move('forward')).state.players[0]).toMatchObject({ x: 4, y: 3 });
    expect(apply(s, move('left')).state.players[0]).toMatchObject({ x: 3, y: 2 });
    expect(apply(s, move('right')).state.players[0]).toMatchObject({ x: 3, y: 4 });
    expect(apply(s, move('back')).state.players[0]).toMatchObject({ x: 2, y: 3 });
  });

  it('emits moved with from/to', () => {
    const { events } = apply(setup(0), move('forward'));
    expect(events).toEqual([{ type: 'moved', playerId: 'p1', from: { x: 3, y: 3 }, to: { x: 3, y: 2 } }]);
  });

  it.each(['wall', 'pillar', 'pit', 'door'] as const)('cannot step into %s and emits bumped', (cell) => {
    const s = setup(0, { n: cell });
    const { state, events } = apply(s, move('forward'));
    expect(state.players[0]).toMatchObject({ x: 3, y: 3 });
    expect(events).toEqual([{ type: 'bumped', playerId: 'p1', at: { x: 3, y: 2 }, cell }]);
  });

  it('cannot leave the grid', () => {
    const s = createGame(1);
    const p = s.players[0]!;
    p.x = 0;
    p.y = 0;
    p.dir = 0;
    expect(apply(s, move('forward')).events[0]?.type).toBe('bumped');
  });
});

describe('apply: turning', () => {
  it('turns 90° and emits turned', () => {
    const s = setup(0);
    const r = apply(s, turn('right'));
    expect(r.state.players[0]!.dir).toBe(1);
    expect(r.events).toEqual([{ type: 'turned', playerId: 'p1', from: 0, to: 1 }]);
    expect(apply(s, turn('left')).state.players[0]!.dir).toBe(3);
  });
});

describe('apply: purity and serialization', () => {
  it('does not mutate the input state', () => {
    const s = setup(0);
    const before = JSON.stringify(s);
    apply(s, move('forward'));
    apply(s, turn('left'));
    expect(JSON.stringify(s)).toBe(before);
  });

  it('state and commands round-trip through JSON', () => {
    const s = createGame(77);
    expect(JSON.parse(JSON.stringify(s))).toEqual(s);
    const c = move('left');
    expect(JSON.parse(JSON.stringify(c))).toEqual(c);
  });

  it('rejects commands for unknown players without changing state', () => {
    const s = createGame(3);
    const r = apply(s, { type: 'move', playerId: 'nobody', dir: 'forward' });
    expect(r.state).toBe(s);
    expect(r.events[0]).toEqual({ type: 'rejected', reason: 'unknown_player' });
  });

  it('supports several players and blocks moving into another player', () => {
    const s = createGame(5, ['p1', 'p2']);
    expect(s.players.map((p) => p.id)).toEqual(['p1', 'p2']);
    const [p1, p2] = s.players;
    p2!.x = p1!.x;
    p2!.y = p1!.y;
    p1!.y += 1; // p2 now stands north of p1
    p1!.dir = 0;
    const r = apply(s, move('forward'));
    expect(r.events[0]?.type).toBe('bumped');
  });
});

describe('determinism', () => {
  it('same seed and commands give byte-identical state', () => {
    const commands: Command[] = [];
    const kinds: Command[] = [move('forward'), move('left'), turn('right'), move('back'), turn('left'), move('right')];
    for (let i = 0; i < 300; i++) commands.push(kinds[(i * 7 + (i >> 2)) % kinds.length]!);
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
