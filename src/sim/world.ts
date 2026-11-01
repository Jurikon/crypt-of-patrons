import { add, dirVec, getCell, DIRS, type Vec2 } from '../core/grid';
import { int, shuffle } from '../core/rng';
import { ACT, getEnemy, getSurface } from '../content';
import { pickBiomeEnemy, spawnEnemy } from './ai';
import { addSurface, dealDamage, emit, killUnit, settle, type Engine } from './engine';
import { allUnits, biomeOf, unitAt, type GameState } from './state';
import { winCombat } from './units';

/**
 * The place itself acts at the end of every world turn (M6b): currents carry whoever stands in them,
 * the tide rises, light through the windows strikes the cells it marked a turn ago and marks new
 * ones, a besieged room gets its next wave or is won by the clock. Every choice comes from the run's
 * RNG, so a seed and its commands still replay exactly.
 */
export function worldEffects(eng: Engine): void {
  const { state } = eng;
  const biome = biomeOf(state);
  const turn = state.combat.turn;
  currents(eng);
  if (!active(state)) return;
  strikeOmen(eng);
  if (!active(state)) return;
  if (biome.spread && turn % biome.spread.every === 0) tide(eng, biome.spread.surface, biome.spread.count);
  if (biome.omens && turn % biome.omens.every === 0) markOmen(eng, biome.omens.damage);
  if (state.combat.goal === 'survive') siege(eng, turn);
}

const active = (state: GameState) => state.combat.status === 'active';
const same = (a: Vec2, b: Vec2) => a.x === b.x && a.y === b.y;

/** Whoever stands in a current is carried one cell downstream, if that cell is open (a pit swallows them). */
function currents(eng: Engine): void {
  const { state, events } = eng;
  for (const u of allUnits(state)) {
    const sf = state.surfaces.find((s) => same(s, u) && getSurface(s.id).flow !== undefined);
    const flow = sf ? getSurface(sf.id).flow : undefined;
    if (flow === undefined || !active(state)) continue;
    // Heavy ones (bosses, things) stand fast, as they shrug off pushes: a boss in a current would
    // otherwise be carried back every turn and never reach anyone.
    if ('intent' in u && Math.floor(getEnemy(u.type).pushFactor ?? 1) < 1) continue;
    const from = { x: u.x, y: u.y };
    const to = add(from, dirVec(flow));
    const cell = getCell(state.room.grid, to.x, to.y);
    if ((cell !== 'floor' && cell !== 'pit') || unitAt(state, to.x, to.y)) continue;
    u.x = to.x;
    u.y = to.y;
    events.push({ type: 'pushed', unitId: u.id, from, to });
    emit(eng, 'enterCell', { subject: u });
    if (cell === 'pit') {
      events.push({ type: 'fell', unitId: u.id, at: to });
      killUnit(eng, u, null, []);
    }
    settle(eng);
  }
}

/** The marked cells are struck: everyone on them takes the omen's damage. */
function strikeOmen(eng: Engine): void {
  const { state, events } = eng;
  const omen = state.omen;
  if (!omen) return;
  state.omen = null;
  const center = omen.cells[Math.floor(omen.cells.length / 2)] ?? { x: 0, y: 0 };
  events.push({ type: 'area', center, cells: [...omen.cells] });
  for (const u of allUnits(state).filter((x) => omen.cells.some((c) => same(c, x))))
    dealDamage(eng, u, omen.damage, null, 'effect', ['fire']);
  settle(eng);
}

/** A whole row or column of the room lights up: it will be struck at the end of the next turn. */
function markOmen(eng: Engine, damage: number): void {
  const { state, events } = eng;
  const { interior, grid } = state.room;
  const row = int(state.rng, 0, 1) === 0;
  const at = row
    ? int(state.rng, interior.y, interior.y + interior.h - 1)
    : int(state.rng, interior.x, interior.x + interior.w - 1);
  const cells: Vec2[] = [];
  const len = row ? interior.w : interior.h;
  for (let i = 0; i < len; i++) {
    const c = row ? { x: interior.x + i, y: at } : { x: at, y: interior.y + i };
    if (getCell(grid, c.x, c.y) === 'floor') cells.push(c);
  }
  if (cells.length === 0) return;
  state.omen = { cells, damage };
  events.push({ type: 'omen', cells });
}

/** The tide: `count` new cells of the surface, each next to one that is already there. */
function tide(eng: Engine, surface: string, count: number): void {
  const { state } = eng;
  const wet = state.surfaces.filter((s) => s.id === surface);
  const edge: Vec2[] = [];
  for (const w of wet)
    for (const d of DIRS) {
      const c = add(w, dirVec(d));
      if (getCell(state.room.grid, c.x, c.y) !== 'floor') continue;
      if (wet.some((x) => same(x, c)) || edge.some((x) => same(x, c))) continue;
      edge.push(c);
    }
  for (const c of shuffle(state.rng, edge).slice(0, count)) addSurface(eng, surface, c, null, 'neutral');
}

/** A siege: a wave of two every few turns; holding out to the last turn wins the room. */
function siege(eng: Engine, turn: number): void {
  const { state } = eng;
  if (turn >= ACT.surviveTurns) {
    winCombat(state, eng.events);
    return;
  }
  if (turn % ACT.waveEvery !== 0) return;
  const g = state.room.grid;
  const free: Vec2[] = [];
  for (let y = 0; y < g.h; y++)
    for (let x = 0; x < g.w; x++) {
      const c = { x, y };
      if (getCell(g, x, y) !== 'floor' || unitAt(state, x, y)) continue;
      if (state.players.some((p) => Math.abs(p.x - x) + Math.abs(p.y - y) < 3)) continue;
      free.push(c);
    }
  for (const c of shuffle(state.rng, free).slice(0, 2)) spawnEnemy(eng, pickBiomeEnemy(state), c);
}
