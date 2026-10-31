import { add, dirVec, getCell, rotateDir, type Dir, type Vec2 } from '../core/grid';
import type { AbilityDef } from '../content';
import { blocksSight, dirTowards } from './engine';
import { allUnits, isAlly, sideOf, surfaceAt, unitAt, type GameState, type Player, type Unit } from './state';
import { statOf } from './units';

/**
 * Where an ability can be aimed. Shared by the simulation (validation, default targets), the UI
 * (highlighted cells, the crosshair) and the bots, so all three always agree.
 */

const manhattan = (a: Vec2, b: Vec2) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);

/** True if nothing that blocks sight lies strictly between the centres of two cells. */
export function hasLineOfSight(state: GameState, a: Vec2, b: Vec2): boolean {
  const steps = Math.max(Math.abs(b.x - a.x), Math.abs(b.y - a.y)) * 4;
  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    const x = Math.round(a.x + (b.x - a.x) * t);
    const y = Math.round(a.y + (b.y - a.y) * t);
    if ((x === a.x && y === a.y) || (x === b.x && y === b.y)) continue;
    if (blocksSight(getCell(state.room.grid, x, y))) return false;
  }
  return true;
}

/** Facing first, then clockwise: the order default targets are searched in. */
const searchDirs = (facing: Dir): Dir[] => [0, 1, 2, 3].map((r) => rotateDir(facing, r));

function unitOk(state: GameState, player: Player, u: Unit, filter: 'foes' | 'ownSummons' | 'any'): boolean {
  if (u === player) return false;
  if (filter === 'foes') return sideOf(state, u) !== sideOf(state, player);
  if (filter === 'ownSummons') return isAlly(state, u) && u.owner === player.id;
  return true;
}

/** Every valid target cell, best first: in front of the player, then nearest. */
export function validTargets(state: GameState, player: Player, ability: AbilityDef): Vec2[] {
  const t = ability.target;
  const me: Vec2 = { x: player.x, y: player.y };
  const front = add(me, dirVec(player.dir));
  const byCloseness = (a: Vec2, b: Vec2) =>
    manhattan(a, me) - manhattan(b, me) ||
    (a.x === front.x && a.y === front.y ? -1 : b.x === front.x && b.y === front.y ? 1 : 0) ||
    a.y - b.y ||
    a.x - b.x;
  switch (t.kind) {
    case 'front':
      return [front];
    case 'self':
      return [me];
    case 'line': {
      const out: Vec2[] = [];
      const range = t.range + statOf(state, player, 'projectileRange');
      for (const d of searchDirs(player.dir)) {
        let c = me;
        for (let i = 0; i < range; i++) {
          c = add(c, dirVec(d));
          if (blocksSight(getCell(state.room.grid, c.x, c.y))) break;
          out.push(c);
          if (unitAt(state, c.x, c.y)) break;
        }
      }
      return out;
    }
    case 'unit': {
      const out: Vec2[] = [];
      for (const u of allUnits(state)) {
        if (!unitOk(state, player, u, t.filter) || manhattan(u, me) > t.range) continue;
        if (t.sight && !hasLineOfSight(state, me, u)) continue;
        if (t.freeBehind) {
          const b = add({ x: u.x, y: u.y }, dirVec(((u.dir + 2) % 4) as Dir));
          if (getCell(state.room.grid, b.x, b.y) !== 'floor' || unitAt(state, b.x, b.y)) continue;
        }
        out.push({ x: u.x, y: u.y });
      }
      return out.sort(byCloseness);
    }
    case 'cell': {
      const out: Vec2[] = [];
      const g = state.room.grid;
      for (let y = player.y - t.range; y <= player.y + t.range; y++)
        for (let x = player.x - t.range; x <= player.x + t.range; x++) {
          const c = { x, y };
          if (manhattan(c, me) > t.range || getCell(g, x, y) !== 'floor' || unitAt(state, x, y)) continue;
          if (t.surface && !t.surface.some((sf) => surfaceAt(state, c, sf))) continue;
          out.push(c);
        }
      return out.sort(byCloseness);
    }
  }
}

/** The direction an ability acts in for a target: towards it along a line, else where the player faces. */
export function actionDir(player: Player, ability: AbilityDef, target: Vec2): Dir {
  return ability.target.kind === 'line' ? dirTowards(player, target) : player.dir;
}
