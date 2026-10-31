import { add, dirVec, getCell, type Dir, type Vec2 } from '../core/grid';
import { PUSH_COLLISION_DAMAGE, type EffectSpec } from '../content';
import type { GameEvent } from './commands';
import type { GameState, Unit } from './state';
import { unitAt } from './state';
import { dealDamage, kill, statOf } from './units';

/** Everything an effect needs to know about the action it belongs to. */
export interface EffectContext {
  readonly source: Unit;
  /** The cell the ability targets. */
  readonly target: Vec2;
  /** Direction of the action (for pushes: away from the source). */
  readonly dir: Dir;
}

/**
 * Minimal effect interpreter: runs primitive effects in order. It knows primitives, never ability ids
 * (CLAUDE.md rule 4). M2 grows this into the tag/trigger engine.
 */
export function runEffects(state: GameState, effects: readonly EffectSpec[], ctx: EffectContext, events: GameEvent[]) {
  for (const effect of effects) {
    if (state.combat.status !== 'active') return;
    switch (effect.kind) {
      case 'damage': {
        const unit = unitAt(state, ctx.target.x, ctx.target.y);
        if (unit) dealDamage(state, unit, effect.amount, 'attack', events);
        break;
      }
      case 'push': {
        const unit = unitAt(state, ctx.target.x, ctx.target.y);
        if (unit) push(state, unit, ctx.dir, effect.distance, ctx.source, events);
        break;
      }
    }
  }
}

const blocksPush = (t: string) => t === 'wall' || t === 'pillar' || t === 'door';

/**
 * Moves `unit` up to `distance` cells along `dir`, one cell at a time.
 * Stops on a wall/pillar/door or another unit (collision damage), or falls into a pit (death).
 */
export function push(
  state: GameState,
  unit: Unit,
  dir: Dir,
  distance: number,
  source: Unit,
  events: GameEvent[],
): void {
  const step = dirVec(dir);
  const collisionDamage = PUSH_COLLISION_DAMAGE + statOf(state, source, 'pushCollisionBonus');
  for (let i = 0; i < distance; i++) {
    const from: Vec2 = { x: unit.x, y: unit.y };
    const to = add(from, step);
    const cell = getCell(state.room.grid, to.x, to.y);
    if (blocksPush(cell)) {
      events.push({ type: 'collided', unitId: unit.id, at: to, withId: null });
      dealDamage(state, unit, collisionDamage, 'collision', events);
      return;
    }
    const other = unitAt(state, to.x, to.y);
    if (other) {
      events.push({ type: 'collided', unitId: unit.id, at: to, withId: other.id });
      dealDamage(state, unit, collisionDamage, 'collision', events);
      dealDamage(state, other, PUSH_COLLISION_DAMAGE, 'collision', events);
      return;
    }
    unit.x = to.x;
    unit.y = to.y;
    events.push({ type: 'pushed', unitId: unit.id, from, to });
    if (cell === 'pit') {
      events.push({ type: 'fell', unitId: unit.id, at: to });
      kill(state, unit, events);
      return;
    }
  }
}
