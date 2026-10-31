/**
 * Grid primitives. Coordinates: x grows east, y grows south. Cells are stored
 * row-major in a plain array so a grid serializes to JSON as-is.
 */

export type CellType = 'floor' | 'wall' | 'pillar' | 'pit' | 'door';

export interface Grid {
  readonly w: number;
  readonly h: number;
  cells: CellType[];
}

export interface Vec2 {
  readonly x: number;
  readonly y: number;
}

/** 0 = north, 1 = east, 2 = south, 3 = west. */
export type Dir = 0 | 1 | 2 | 3;

export const DIRS: readonly Dir[] = [0, 1, 2, 3];

const DIR_VECS: readonly Vec2[] = [
  { x: 0, y: -1 },
  { x: 1, y: 0 },
  { x: 0, y: 1 },
  { x: -1, y: 0 },
];

export function dirVec(d: Dir): Vec2 {
  return DIR_VECS[d] as Vec2;
}

export function rotateDir(d: Dir, quarterTurnsClockwise: number): Dir {
  return ((((d + quarterTurnsClockwise) % 4) + 4) % 4) as Dir;
}

export function createGrid(w: number, h: number, fill: CellType): Grid {
  return { w, h, cells: new Array<CellType>(w * h).fill(fill) };
}

export function inBounds(g: Grid, x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < g.w && y < g.h;
}

export function index(g: Grid, x: number, y: number): number {
  return y * g.w + x;
}

/** Cell at (x, y); out-of-bounds reads as wall. */
export function getCell(g: Grid, x: number, y: number): CellType {
  if (!inBounds(g, x, y)) return 'wall';
  return g.cells[index(g, x, y)] as CellType;
}

export function setCell(g: Grid, x: number, y: number, t: CellType): void {
  if (!inBounds(g, x, y)) throw new Error(`setCell out of bounds: ${x},${y}`);
  g.cells[index(g, x, y)] = t;
}

export function add(a: Vec2, b: Vec2): Vec2 {
  return { x: a.x + b.x, y: a.y + b.y };
}

/** The four orthogonal neighbours that lie inside the grid. */
export function neighbors4(g: Grid, p: Vec2): Vec2[] {
  const out: Vec2[] = [];
  for (const d of DIRS) {
    const n = add(p, dirVec(d));
    if (inBounds(g, n.x, n.y)) out.push(n);
  }
  return out;
}

/** Cells a walker can stand on. */
export function isWalkable(t: CellType): boolean {
  return t === 'floor';
}

/**
 * Flood fill over 4-connected cells accepted by `passable`.
 * Returns a boolean mask indexed like `grid.cells`.
 */
export function floodFill(g: Grid, start: Vec2, passable: (t: CellType) => boolean): boolean[] {
  const seen = new Array<boolean>(g.w * g.h).fill(false);
  if (!inBounds(g, start.x, start.y) || !passable(getCell(g, start.x, start.y))) return seen;
  const stack: Vec2[] = [start];
  seen[index(g, start.x, start.y)] = true;
  while (stack.length > 0) {
    const p = stack.pop() as Vec2;
    for (const n of neighbors4(g, p)) {
      const i = index(g, n.x, n.y);
      if (!seen[i] && passable(g.cells[i] as CellType)) {
        seen[i] = true;
        stack.push(n);
      }
    }
  }
  return seen;
}

/** True when every cell accepted by `passable` is reachable from `start`. */
export function isConnected(g: Grid, start: Vec2, passable: (t: CellType) => boolean): boolean {
  const seen = floodFill(g, start, passable);
  for (let i = 0; i < g.cells.length; i++) {
    if (passable(g.cells[i] as CellType) && !seen[i]) return false;
  }
  return true;
}
