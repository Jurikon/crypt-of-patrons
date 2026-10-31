import type { CellType, Dir } from '../core/grid';
import { createRng } from '../core/rng';
import { getEnemy, getSummon } from '../content';
import { makeIntent } from './ai';
import { createPlayer, STATE_VERSION, type Ally, type Enemy, type GameState, type Surface } from './state';

export interface MapOptions {
  readonly enemyDir?: Dir;
  readonly intents?: boolean;
  readonly classId?: string;
  readonly modifiers?: readonly string[];
  /** Ability ids to give the player after the class's own (slots 2, 3…). */
  readonly abilities?: readonly string[];
}

/**
 * Builds an exact combat situation from an ASCII map, for tests and the balancing bot.
 *
 *   # wall   . floor   O pillar   ~ pit   + door
 *   ^ > v <  the player (p1) facing north/east/south/west
 *   W        skeleton warrior     A  skeleton archer
 *   S        a skeleton raised by p1 (an ally), facing north
 *   c        a corpse on the floor
 *
 * Enemies are numbered e1, e2… and allies s1, s2… in reading order; enemies face `enemyDir` (default: south).
 */
export function stateFromMap(map: string, opts: MapOptions = {}): GameState {
  const rows = map
    .trim()
    .split('\n')
    .map((r) => r.trim());
  const h = rows.length;
  const w = Math.max(...rows.map((r) => r.length));
  const cells: CellType[] = [];
  const glyph: Record<string, CellType> = { '#': 'wall', '.': 'floor', O: 'pillar', '~': 'pit', '+': 'door' };
  const players: GameState['players'] = [];
  const enemies: Enemy[] = [];
  const allies: Ally[] = [];
  const surfaces: Surface[] = [];
  const enemyDir = opts.enemyDir ?? 2;
  const classId = opts.classId ?? 'knight';
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const ch = rows[y]?.[x] ?? '#';
      const facing = '^>v<'.indexOf(ch);
      if (facing >= 0) {
        const p = createPlayer(`p${players.length + 1}`, classId, x, y, facing as Dir);
        p.abilities.push(...(opts.abilities ?? []));
        p.modifiers.push(...(opts.modifiers ?? []));
        players.push(p);
        cells.push('floor');
      } else if (ch === 'W' || ch === 'A' || ch === 'B') {
        const type = ch === 'W' ? 'skeletonWarrior' : ch === 'A' ? 'skeletonArcher' : 'cryptWarden';
        const def = getEnemy(type);
        enemies.push({
          id: `e${enemies.length + 1}`,
          type,
          x,
          y,
          dir: enemyDir,
          hp: def.maxHp,
          maxHp: def.maxHp,
          statuses: [],
          intent: opts.intents ? makeIntent(def.attack, enemyDir) : null,
          moved: false,
          elite: false,
          strikes: 0,
        });
        cells.push('floor');
      } else if (ch === 'S') {
        const def = getSummon('necro.skeleton');
        allies.push({
          id: `s${allies.length + 1}`,
          type: def.id,
          owner: 'p1',
          x,
          y,
          dir: 0,
          hp: def.maxHp,
          maxHp: def.maxHp,
          statuses: [],
        });
        cells.push('floor');
      } else if (ch === 'c') {
        surfaces.push({ id: 'corpse', x, y, turns: null, side: 'neutral' });
        cells.push('floor');
      } else {
        const t = glyph[ch];
        if (!t) throw new Error(`Unknown map glyph "${ch}"`);
        cells.push(t);
      }
    }
  }
  const p = players[0];
  return {
    version: STATE_VERSION,
    seed: 0,
    rng: createRng(0),
    room: {
      grid: { w, h, cells },
      shape: 'rect',
      interior: { x: 1, y: 1, w: w - 2, h: h - 2 },
      spawn: { x: p?.x ?? 1, y: p?.y ?? 1, dir: p?.dir ?? 0 },
      doors: [],
    },
    players,
    allies,
    enemies,
    surfaces,
    combat: { turn: 1, phase: 'player', status: enemies.length ? 'active' : 'won' },
    nextId: allies.length + 1,
    run: null,
  };
}
