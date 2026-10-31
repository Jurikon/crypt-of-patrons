import { int, pick, shuffle, weighted, chance, type Rng } from '../../core/rng';
import {
  add,
  createGrid,
  dirVec,
  getCell,
  isConnected,
  setCell,
  DIRS,
  rotateDir,
  type Dir,
  type Grid,
  type Vec2,
} from '../../core/grid';

export type RoomShape = 'rect' | 'cross' | 'l' | 'chamfer';

export const ROOM_SHAPES: readonly RoomShape[] = ['rect', 'cross', 'l', 'chamfer'];

export interface Door {
  readonly x: number;
  readonly y: number;
  /** Direction pointing from the door into the room. */
  readonly dir: Dir;
  readonly kind: 'entrance' | 'exit';
}

export interface Room {
  readonly grid: Grid;
  readonly shape: RoomShape;
  /** Interior bounds in grid coordinates (the grid has a one-cell wall border around it). */
  readonly interior: { readonly x: number; readonly y: number; readonly w: number; readonly h: number };
  /** Where a player entering through the entrance stands, facing into the room. */
  readonly spawn: { readonly x: number; readonly y: number; readonly dir: Dir };
  /** Entrance first, then 2–3 exits (for later milestones). */
  readonly doors: readonly Door[];
}

export interface RoomParams {
  readonly minSize?: number;
  readonly maxSize?: number;
}

const OBSTACLE_ATTEMPTS = 24;

/**
 * Generates one room. Uses only `rng`, so the same RNG state always yields the same room.
 * Guarantees: interior in [minSize, maxSize] per side, every floor cell reachable from the
 * spawn, spawn and every door's inner cell are floor.
 */
export function generateRoom(rng: Rng, params: RoomParams = {}): Room {
  const minSize = params.minSize ?? 7;
  const maxSize = params.maxSize ?? 11;
  const w = int(rng, minSize, maxSize);
  const h = int(rng, minSize, maxSize);
  const shape = pick(rng, ROOM_SHAPES);
  const mask = shapeMask(rng, shape, w, h);

  const base = createGrid(w + 2, h + 2, 'wall');
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (mask[y * w + x]) setCell(base, x + 1, y + 1, 'floor');
    }
  }

  const doors = placeDoors(rng, base);
  const entrance = doors[0] as Door;
  const forward = dirVec(entrance.dir);
  const spawn = { x: entrance.x + forward.x, y: entrance.y + forward.y, dir: entrance.dir };

  const reserved = new Set<number>();
  const reserve = (p: Vec2) => reserved.add(p.y * base.w + p.x);
  reserve(spawn);
  reserve(add(spawn, forward));
  for (const d of doors) reserve(add(d, dirVec(d.dir)));

  let grid = base;
  for (let attempt = 0; attempt < OBSTACLE_ATTEMPTS; attempt++) {
    const candidate = cloneGrid(base);
    placePillars(rng, candidate, reserved);
    placePits(rng, candidate, reserved);
    if (isConnected(candidate, spawn, (t) => t === 'floor')) {
      grid = candidate;
      break;
    }
  }
  // If every attempt failed, `grid` stays the obstacle-free base, which is connected by construction.

  return { grid, shape, interior: { x: 1, y: 1, w, h }, spawn, doors };
}

function cloneGrid(g: Grid): Grid {
  return { w: g.w, h: g.h, cells: g.cells.slice() };
}

/** Floor mask for the interior, row-major w×h. Every shape is a single connected region. */
function shapeMask(rng: Rng, shape: RoomShape, w: number, h: number): boolean[] {
  const mask = new Array<boolean>(w * h).fill(true);
  const cut = (x0: number, y0: number, cw: number, ch: number) => {
    for (let y = y0; y < y0 + ch; y++) for (let x = x0; x < x0 + cw; x++) mask[y * w + x] = false;
  };
  switch (shape) {
    case 'rect':
      break;
    case 'cross': {
      const cw = Math.max(2, Math.floor(w / 3));
      const ch = Math.max(2, Math.floor(h / 3));
      cut(0, 0, cw, ch);
      cut(w - cw, 0, cw, ch);
      cut(0, h - ch, cw, ch);
      cut(w - cw, h - ch, cw, ch);
      break;
    }
    case 'l': {
      // Leave arms at least 3 cells wide.
      const cw = int(rng, Math.ceil(w * 0.4), w - 3);
      const ch = int(rng, Math.ceil(h * 0.4), h - 3);
      const corner = int(rng, 0, 3);
      const x0 = corner === 1 || corner === 2 ? w - cw : 0;
      const y0 = corner >= 2 ? h - ch : 0;
      cut(x0, y0, cw, ch);
      break;
    }
    case 'chamfer': {
      const k = int(rng, 2, Math.min(w, h) >= 10 ? 4 : 3);
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const dx = Math.min(x, w - 1 - x);
          const dy = Math.min(y, h - 1 - y);
          if (dx + dy < k - 1) mask[y * w + x] = false;
        }
      }
      break;
    }
  }
  return mask;
}

/**
 * Picks the entrance and 2–3 exits on straight stretches of wall.
 * A door cell is a wall with floor directly inside and wall on both sides along the wall line.
 */
function placeDoors(rng: Rng, g: Grid): Door[] {
  const candidates: { x: number; y: number; dir: Dir }[] = [];
  for (let y = 0; y < g.h; y++) {
    for (let x = 0; x < g.w; x++) {
      if (getCell(g, x, y) !== 'wall') continue;
      for (const dir of DIRS) {
        const inward = dirVec(dir);
        const inner = { x: x + inward.x, y: y + inward.y };
        if (getCell(g, inner.x, inner.y) !== 'floor') continue;
        const side1 = dirVec(rotateDir(dir, 1));
        const side2 = dirVec(rotateDir(dir, -1));
        const straight =
          getCell(g, x + side1.x, y + side1.y) === 'wall' &&
          getCell(g, x + side2.x, y + side2.y) === 'wall' &&
          getCell(g, inner.x + side1.x, inner.y + side1.y) === 'floor' &&
          getCell(g, inner.x + side2.x, inner.y + side2.y) === 'floor';
        const behind = getCell(g, x - inward.x, y - inward.y);
        if (straight && behind === 'wall') candidates.push({ x, y, dir });
      }
    }
  }

  const doors: Door[] = [];
  const farEnough = (c: Vec2) => doors.every((d) => Math.abs(d.x - c.x) + Math.abs(d.y - c.y) >= 3);

  // Entrance: any candidate.
  const entrance = pick(rng, candidates);
  doors.push({ ...entrance, kind: 'entrance' });

  const exitCount = int(rng, 2, 3);
  // Prefer walls facing a different way from the entrance, then any wall.
  const others = shuffle(rng, candidates);
  const usedDirs = new Set<Dir>([entrance.dir]);
  for (const pass of [0, 1]) {
    for (const c of others) {
      if (doors.length >= 1 + exitCount) break;
      if (!farEnough(c)) continue;
      if (pass === 0 && usedDirs.has(c.dir)) continue;
      doors.push({ ...c, kind: 'exit' });
      usedDirs.add(c.dir);
    }
  }

  for (const d of doors) setCell(g, d.x, d.y, 'door');
  return doors;
}

type PillarStyle = 'none' | 'scatter' | 'symmetric' | 'rows';

function placePillars(rng: Rng, g: Grid, reserved: Set<number>): void {
  const style = weighted<PillarStyle>(rng, [
    { item: 'none', weight: 1 },
    { item: 'scatter', weight: 3 },
    { item: 'symmetric', weight: 2 },
    { item: 'rows', weight: 2 },
  ]);
  const canPlace = (x: number, y: number) => getCell(g, x, y) === 'floor' && !reserved.has(y * g.w + x);
  const noPillarAround = (x: number, y: number) => {
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) if (getCell(g, x + dx, y + dy) === 'pillar') return false;
    return true;
  };
  const x0 = 1;
  const y0 = 1;
  const w = g.w - 2;
  const h = g.h - 2;

  switch (style) {
    case 'none':
      return;
    case 'scatter': {
      const count = int(rng, 1, Math.max(2, Math.floor((w * h) / 18)));
      let placed = 0;
      for (let tries = 0; tries < count * 6 && placed < count; tries++) {
        const x = int(rng, x0 + 1, x0 + w - 2);
        const y = int(rng, y0 + 1, y0 + h - 2);
        if (canPlace(x, y) && noPillarAround(x, y)) {
          setCell(g, x, y, 'pillar');
          placed++;
        }
      }
      return;
    }
    case 'symmetric': {
      // Mirrored pairs across both axes.
      const inset = int(rng, 1, 2);
      const pts = [
        { x: x0 + inset, y: y0 + inset },
        { x: x0 + w - 1 - inset, y: y0 + inset },
        { x: x0 + inset, y: y0 + h - 1 - inset },
        { x: x0 + w - 1 - inset, y: y0 + h - 1 - inset },
      ];
      if (chance(rng, 0.5)) pts.push({ x: x0 + Math.floor(w / 2), y: y0 + Math.floor(h / 2) });
      for (const p of pts) if (canPlace(p.x, p.y)) setCell(g, p.x, p.y, 'pillar');
      return;
    }
    case 'rows': {
      // A colonnade along the longer axis.
      const alongX = w >= h;
      const step = int(rng, 2, 3);
      const offset = int(rng, 1, 2);
      const len = alongX ? w : h;
      const across = alongX ? h : w;
      const lanes = [offset, across - 1 - offset];
      for (const lane of lanes) {
        for (let t = 1; t < len - 1; t += step) {
          const x = alongX ? x0 + t : x0 + lane;
          const y = alongX ? y0 + lane : y0 + t;
          if (canPlace(x, y)) setCell(g, x, y, 'pillar');
        }
      }
      return;
    }
  }
}

function placePits(rng: Rng, g: Grid, reserved: Set<number>): void {
  const groups = weighted(rng, [
    { item: 0, weight: 2 },
    { item: 1, weight: 4 },
    { item: 2, weight: 3 },
    { item: 3, weight: 1 },
  ]);
  const canPlace = (p: Vec2) => getCell(g, p.x, p.y) === 'floor' && !reserved.has(p.y * g.w + p.x);
  for (let gi = 0; gi < groups; gi++) {
    const size = int(rng, 1, 6);
    let seed: Vec2 | null = null;
    for (let tries = 0; tries < 20 && !seed; tries++) {
      const p = { x: int(rng, 2, g.w - 3), y: int(rng, 2, g.h - 3) };
      if (canPlace(p)) seed = p;
    }
    if (!seed) continue;
    const group: Vec2[] = [seed];
    setCell(g, seed.x, seed.y, 'pit');
    for (let tries = 0; tries < size * 6 && group.length < size; tries++) {
      const from = pick(rng, group);
      const n = add(from, dirVec(pick(rng, DIRS)));
      if (canPlace(n)) {
        setCell(g, n.x, n.y, 'pit');
        group.push(n);
      }
    }
  }
}
