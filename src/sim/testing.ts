import type { CellType, Dir } from '../core/grid';
import { createRng } from '../core/rng';
import { getEnemy } from '../content';
import { makeIntent } from './ai';
import { createPlayer, STATE_VERSION, type Enemy, type GameState } from './state';

/**
 * Builds an exact combat situation from an ASCII map, for tests and the balancing bot.
 *
 *   # wall   . floor   O pillar   ~ pit   + door
 *   ^ > v <  the player (p1) facing north/east/south/west
 *   W        skeleton warrior     A  skeleton archer
 *
 * Enemies are numbered e1, e2… in reading order and face `enemyDir` (default: south).
 */
export function stateFromMap(map: string, opts: { enemyDir?: Dir; intents?: boolean } = {}): GameState {
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
  const enemyDir = opts.enemyDir ?? 2;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const ch = rows[y]?.[x] ?? '#';
      const facing = '^>v<'.indexOf(ch);
      if (facing >= 0) {
        players.push(createPlayer(`p${players.length + 1}`, 'knight', x, y, facing as Dir));
        cells.push('floor');
      } else if (ch === 'W' || ch === 'A') {
        const type = ch === 'W' ? 'skeletonWarrior' : 'skeletonArcher';
        const def = getEnemy(type);
        enemies.push({
          id: `e${enemies.length + 1}`,
          type,
          x,
          y,
          dir: enemyDir,
          hp: def.maxHp,
          maxHp: def.maxHp,
          intent: opts.intents ? makeIntent(def.attack, enemyDir) : null,
          moved: false,
        });
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
    enemies,
    combat: { turn: 1, phase: 'player', status: enemies.length ? 'active' : 'won' },
  };
}
