import { add, dirVec, getCell, DIRS, type CellType, type Dir, type Vec2 } from '../core/grid';
import { shuffle } from '../core/rng';
import {
  ACT,
  getEnemy,
  getStatus,
  getSummon,
  getSurface,
  MAX_CHAIN_DEPTH,
  PUSH_COLLISION_DAMAGE,
  STATUSES,
  type CellSelector,
  type EffectSpec,
  type Relation,
  type Tag,
  type TriggerDef,
  type TriggerOn,
  type UnitFilter,
  type UnitSelector,
} from '../content';
import type { GameEvent } from './commands';
import {
  allUnits,
  isAlly,
  isEnemy,
  isPlayer,
  sideOf,
  surfaceAt,
  unitAt,
  unitById,
  type GameState,
  type Player,
  type Side,
  type Surface,
  type Unit,
} from './state';
import { enemyDef } from './enemies';
import { checkCombatEnd, playerRules, statOf } from './units';

/**
 * The effect engine (CLAUDE.md rule 5): a small set of primitives, plus triggers that react to engine
 * events. Primitives queue trigger events instead of calling listeners directly; `settle` then runs the
 * listeners in a fixed order. Each link of a chain is one level deeper, and links deeper than
 * MAX_CHAIN_DEPTH are logged and dropped, so a runaway combo can never hang the game.
 *
 * The engine knows primitives, flags and tags, never content ids (CLAUDE.md rule 4).
 */

/** A unit as it was when an event happened (it may be gone by the time listeners run). */
export interface UnitRef {
  readonly id: string;
  readonly side: Side;
  /** For summons: the player who owns them. */
  readonly owner: string | null;
}

export interface TriggerEvent {
  readonly on: TriggerOn;
  readonly actor: UnitRef | null;
  readonly subject: UnitRef | null;
  /** Where it happened (the subject's cell). */
  readonly cell: Vec2 | null;
  /** For `moved`: the cell left behind. */
  readonly from: Vec2 | null;
  readonly tags: readonly Tag[];
  /** The subject's statuses at that moment. */
  readonly subjectStatuses: readonly string[];
  /** The same, with their strength (for spreading them). */
  readonly subjectStatusList: readonly { readonly id: string; readonly turns: number; readonly amount: number }[];
  /** Where the actor stood (for blows that go through the subject). */
  readonly actorCell: Vec2 | null;
  /** A hit from behind. */
  readonly backstab: boolean;
  readonly depth: number;
}

export interface Engine {
  readonly state: GameState;
  readonly events: GameEvent[];
  readonly queue: TriggerEvent[];
  /** Chain depth of the effects running right now (0 = the player's own action). */
  depth: number;
}

export function createEngine(state: GameState, events: GameEvent[]): Engine {
  return { state, events, queue: [], depth: 0 };
}

/** What an effect knows about the action (or trigger) it belongs to. */
export interface EffectContext {
  /** The acting unit; for triggers, the owner of the rule. */
  readonly source: Unit;
  readonly target: Vec2;
  readonly dir: Dir;
  readonly tags: readonly Tag[];
  /** Set when the effect runs because of a trigger. */
  readonly event: TriggerEvent | null;
  /**
   * The unit that stood on the target cell when the effect list started. `target` follows it, so
   * "damage, push, stun" stuns the unit that was pushed rather than whoever ends up on the cell.
   */
  readonly targetId?: string | null | undefined;
}

const isActive = (state: GameState) => state.combat.status === 'active';
const blocksPush = (t: CellType) => t === 'wall' || t === 'pillar' || t === 'door';
export const blocksSight = (t: CellType) => t === 'wall' || t === 'pillar' || t === 'door';
const manhattan = (a: Vec2, b: Vec2) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
const chebyshev = (a: Vec2, b: Vec2) => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
const same = (a: Vec2, b: Vec2) => a.x === b.x && a.y === b.y;
const pos = (u: Unit): Vec2 => ({ x: u.x, y: u.y });

/** Grid direction from `from` towards `to`, preferring the longer axis (horizontal on ties). */
export function dirTowards(from: Vec2, to: Vec2): Dir {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  if (Math.abs(dx) >= Math.abs(dy) && dx !== 0) return dx > 0 ? 1 : 3;
  return dy > 0 ? 2 : 0;
}

function refOf(state: GameState, u: Unit): UnitRef {
  return { id: u.id, side: sideOf(state, u), owner: isAlly(state, u) ? u.owner : null };
}

function isAlive(state: GameState, u: Unit): boolean {
  if (isPlayer(state, u)) return u.hp > 0;
  return state.allies.includes(u as never) || state.enemies.includes(u as never);
}

/** The player behind a unit: itself, or a summon's owner. */
export function ownerPlayer(state: GameState, u: Unit): Player | undefined {
  if (isPlayer(state, u)) return u;
  if (isAlly(state, u)) return state.players.find((p) => p.id === u.owner);
  return undefined;
}

export function emit(
  eng: Engine,
  on: TriggerOn,
  e: {
    actor?: Unit | null;
    subject?: Unit | null;
    cell?: Vec2 | null;
    from?: Vec2 | null;
    tags?: readonly Tag[];
    backstab?: boolean;
  },
): void {
  const { state } = eng;
  eng.queue.push({
    on,
    actor: e.actor ? refOf(state, e.actor) : null,
    subject: e.subject ? refOf(state, e.subject) : null,
    cell: e.cell ?? (e.subject ? pos(e.subject) : null),
    from: e.from ?? null,
    tags: e.tags ?? [],
    subjectStatuses: e.subject ? e.subject.statuses.map((s) => s.id) : [],
    subjectStatusList: e.subject ? e.subject.statuses.map(({ id, turns, amount }) => ({ id, turns, amount })) : [],
    actorCell: e.actor ? pos(e.actor) : null,
    backstab: e.backstab ?? false,
    depth: eng.depth,
  });
}

// ---- primitives -----------------------------------------------------------------------------------

/** True when `attacker` stands behind `unit` (within the 90° cone opposite its facing). */
function fromBehind(attacker: Vec2, unit: Unit): boolean {
  const f = dirVec(unit.dir);
  const dx = attacker.x - unit.x;
  const dy = attacker.y - unit.y;
  const dot = dx * f.x + dy * f.y;
  const cross = dx * f.y - dy * f.x;
  return dot < 0 && Math.abs(cross) < Math.abs(dot);
}

/** True when `attacker` stands in front of `unit` (within the 90° cone it faces, edges included). */
function fromFront(attacker: Vec2, unit: Unit): boolean {
  const f = dirVec(unit.dir);
  const dx = attacker.x - unit.x;
  const dy = attacker.y - unit.y;
  const dot = dx * f.x + dy * f.y;
  const cross = dx * f.y - dy * f.x;
  return dot > 0 && Math.abs(cross) <= dot;
}

const hasFlag = (u: Unit, flag: 'frontGuard' | 'blind' | 'rooted' | 'stun') =>
  u.statuses.some((s) => getStatus(s.id)[flag] === true);

/**
 * Damage after the attacker's bonuses, vulnerability, backstab, guards and shields.
 * Queues `damaged`, `hit` and, on death, `kill`/`death`.
 */
export function dealDamage(
  eng: Engine,
  unit: Unit,
  amount: number,
  source: Unit | null,
  cause: 'attack' | 'collision' | 'effect',
  tags: readonly Tag[],
): void {
  const { state, events } = eng;
  if (!isAlive(state, unit)) return;
  let dmg = Math.max(0, amount);
  let backstab = false;
  const attack = cause === 'attack' && source !== null && source !== unit;
  if (attack && dmg > 0) dmg += statOf(state, source, 'damageDealt');
  if (dmg > 0) dmg += statOf(state, unit, 'damageTaken');
  if (attack && dmg > 0 && fromBehind(source, unit)) {
    backstab = true;
    dmg *= 1 + statOf(state, source, 'backstab');
  }
  if (attack && dmg > 0) dmg = Math.floor(dmg * (1 + statOf(state, source, 'damageFactor')));
  // A shield in front: blows from the front lose some damage, but always do at least 1 (no stalemates).
  if (attack && dmg > 0 && isEnemy(state, unit) && fromFront(source, unit))
    dmg = Math.max(1, dmg - (enemyDef(unit).frontArmor ?? 0));
  // A raised guard stops projectiles coming from the front.
  if (source && tags.includes('projectile') && hasFlag(unit, 'frontGuard') && fromFront(source, unit)) dmg = 0;
  if (isPlayer(state, unit) && unit.god) dmg = 0;
  let absorbed = 0;
  for (const s of unit.statuses) {
    if (dmg <= 0 || !getStatus(s.id).shield) continue;
    const take = Math.min(s.amount, dmg);
    s.amount -= take;
    dmg -= take;
    absorbed += take;
  }
  for (const s of unit.statuses.filter((x) => getStatus(x.id).shield && x.amount <= 0)) removeStatus(eng, unit, s.id);
  unit.hp = Math.max(0, unit.hp - dmg);
  // A second wind (Chapel upgrade): a hero who would die stands back up once.
  if (isPlayer(state, unit) && unit.hp <= 0 && unit.revives > 0) {
    unit.revives--;
    unit.hp = Math.max(1, Math.ceil(unit.maxHp * ACT.reviveShare));
    events.push({ type: 'revived', unitId: unit.id, hp: unit.hp });
  }
  const shownBackstab = backstab && statOf(state, source ?? undefined, 'backstab') > 0;
  events.push({ type: 'damaged', unitId: unit.id, amount: dmg, absorbed, hp: unit.hp, cause, backstab: shownBackstab });
  emit(eng, 'damaged', { actor: source, subject: unit, tags });
  if (source && cause === 'attack') emit(eng, 'hit', { actor: source, subject: unit, tags, backstab });
  const at = pos(unit);
  if (unit.hp <= 0) killUnit(eng, unit, source, tags);
  conduct(eng, at, unit, amount, source, cause, tags);
}

let conducting = false;

/**
 * Water and the like carry some damage (lightning) to everyone else standing on the same connected patch.
 * The carried blows do not carry on again.
 */
function conduct(
  eng: Engine,
  at: Vec2,
  unit: Unit,
  amount: number,
  source: Unit | null,
  cause: 'attack' | 'collision' | 'effect',
  tags: readonly Tag[],
): void {
  if (conducting) return;
  const { state, events } = eng;
  const sf = state.surfaces.find((s) => same(s, at) && getSurface(s.id).conducts);
  const tag = sf ? getSurface(sf.id).conducts : undefined;
  if (!sf || !tag || !tags.includes(tag)) return;
  const cells = patch(state, at, sf.id);
  const others = allUnits(state).filter((u) => u !== unit && cells.some((c) => same(c, u)));
  if (others.length === 0) return;
  events.push({ type: 'area', center: at, cells });
  conducting = true;
  try {
    for (const u of others) dealDamage(eng, u, amount, source, cause, tags);
  } finally {
    conducting = false;
  }
}

/** The cells of one connected patch of a surface (four-way neighbours). */
function patch(state: GameState, start: Vec2, id: string): Vec2[] {
  const out: Vec2[] = [start];
  for (let i = 0; i < out.length; i++)
    for (const d of DIRS) {
      const n = add(out[i] as Vec2, dirVec(d));
      if (!out.some((c) => same(c, n)) && surfaceAt(state, n, id)) out.push(n);
    }
  return out;
}

/** Removes a unit from play (enemies and allies leave their arrays; players stay with hp 0). */
export function killUnit(eng: Engine, unit: Unit, killer: Unit | null, tags: readonly Tag[]): void {
  const { state, events } = eng;
  if (!isAlive(state, unit) && !(isPlayer(state, unit) && unit.hp <= 0 && !events.some(isDeathOf(unit.id)))) return;
  const ref = refOf(state, unit);
  const statuses = unit.statuses.map((s) => s.id);
  const unitStatuses = unit.statuses.map(({ id, turns, amount }) => ({ id, turns, amount }));
  const cell = pos(unit);
  const side = sideOf(state, unit);
  const carried = unit.statuses.filter((s) => getStatus(s.id).jumps);
  const onDeath = isEnemy(state, unit) ? enemyDef(unit).onDeath : undefined;
  unit.hp = 0;
  events.push({ type: 'died', unitId: unit.id });
  if (isEnemy(state, unit)) state.enemies.splice(state.enemies.indexOf(unit), 1);
  if (isAlly(state, unit)) state.allies.splice(state.allies.indexOf(unit), 1);
  // Jumping statuses (curses) move on to the nearest unit of the same side.
  for (const st of carried) {
    const next = allUnits(state)
      .filter((u) => u !== unit && sideOf(state, u) === side && !isPlayer(state, u))
      .sort((a, b) => manhattan(a, cell) - manhattan(b, cell))[0];
    if (next) applyStatus(eng, next, st.id, st.turns, st.amount, st.sourceId ?? unit.id);
  }
  const base = {
    cell,
    from: null,
    tags,
    subjectStatuses: statuses,
    subjectStatusList: unitStatuses,
    depth: eng.depth,
    subject: ref,
    actorCell: killer ? pos(killer) : null,
    backstab: false,
  };
  if (killer && killer !== unit) eng.queue.push({ ...base, on: 'kill', actor: refOf(state, killer) });
  eng.queue.push({ ...base, on: 'death', actor: killer ? refOf(state, killer) : null });
  // What it leaves behind (a burst of poison), acting as itself even though it is gone.
  if (onDeath) runEffects(eng, onDeath, { source: unit, target: cell, dir: unit.dir, tags: [], event: null });
  checkCombatEnd(state, events);
}

const isDeathOf = (id: string) => (e: GameEvent) => e.type === 'died' && e.unitId === id;

/**
 * Moves `unit` up to `distance` cells along `dir`, one cell at a time (plus the source's push bonus).
 * Stops on a wall/pillar/door or another unit (collision damage to both), or falls into a pit (death).
 */
export function push(
  eng: Engine,
  unit: Unit,
  dir: Dir,
  distance: number,
  source: Unit | null,
  tags: readonly Tag[],
): void {
  const { state, events } = eng;
  const step = dirVec(dir);
  const raw = distance + statOf(state, source ?? undefined, 'pushDistance');
  // Heavy enemies (bosses) are pushed a fraction as far.
  const factor = isEnemy(state, unit) ? (getEnemy(unit.type).pushFactor ?? 1) : 1;
  const total = Math.floor(raw * factor);
  const collisionDamage = PUSH_COLLISION_DAMAGE + statOf(state, source ?? undefined, 'pushCollisionBonus');
  if (total > 0) emit(eng, 'pushed', { actor: source, subject: unit, from: pos(unit), tags });
  let steps = total;
  for (let i = 0; i < steps; i++) {
    if (!isAlive(state, unit)) return;
    const from = pos(unit);
    const to = add(from, step);
    const cell = getCell(state.room.grid, to.x, to.y);
    if (blocksPush(cell)) {
      events.push({ type: 'collided', unitId: unit.id, at: to, withId: null });
      dealDamage(eng, unit, collisionDamage, source, 'collision', tags);
      emit(eng, 'collide', { actor: source, subject: unit, tags });
      return;
    }
    const other = unitAt(state, to.x, to.y);
    if (other) {
      events.push({ type: 'collided', unitId: unit.id, at: to, withId: other.id });
      dealDamage(eng, unit, collisionDamage, source, 'collision', tags);
      dealDamage(eng, other, PUSH_COLLISION_DAMAGE, source, 'collision', tags);
      emit(eng, 'collide', { actor: source, subject: unit, tags });
      return;
    }
    unit.x = to.x;
    unit.y = to.y;
    events.push({ type: 'pushed', unitId: unit.id, from, to });
    emit(eng, 'enterCell', { actor: source, subject: unit, tags });
    // Ice: a pushed unit slides one cell further.
    if (surfaceAt(state, to, 'ice') && steps < total + 3) steps++;
    if (cell === 'pit') {
      events.push({ type: 'fell', unitId: unit.id, at: to });
      killUnit(eng, unit, source, tags);
      return;
    }
  }
}

/**
 * Drags `unit` towards `to`, a cell at a time: stops short of walls, units and the puller itself, and
 * falls into a pit it is dragged over. No collision damage: a hook, not a shove.
 */
export function pull(eng: Engine, unit: Unit, to: Unit, distance: number, tags: readonly Tag[]): void {
  const { state, events } = eng;
  if (unit === to) return;
  const dir = dirTowards(pos(unit), pos(to));
  const step = dirVec(dir);
  for (let i = 0; i < distance; i++) {
    if (!isAlive(state, unit)) return;
    const from = pos(unit);
    const next = add(from, step);
    const cell = getCell(state.room.grid, next.x, next.y);
    if (blocksPush(cell) || unitAt(state, next.x, next.y)) return;
    unit.x = next.x;
    unit.y = next.y;
    events.push({ type: 'pushed', unitId: unit.id, from, to: next });
    emit(eng, 'enterCell', { actor: to, subject: unit, tags });
    if (cell === 'pit') {
      events.push({ type: 'fell', unitId: unit.id, at: next });
      killUnit(eng, unit, to, tags);
      return;
    }
  }
}

/** A unit's own movement (a step, a dash, a teleport): queues `moved` and `enterCell`. */
export function moved(eng: Engine, unit: Unit, from: Vec2, actor: Unit, tags: readonly Tag[]): void {
  emit(eng, 'moved', { actor, subject: unit, from, tags });
  emit(eng, 'enterCell', { actor, subject: unit, tags });
}

export function applyStatus(eng: Engine, unit: Unit, id: string, turns: number, amount: number, sourceId: string) {
  const { state, events } = eng;
  if (!isAlive(state, unit)) return;
  const def = getStatus(id);
  if (isEnemy(state, unit) && enemyDef(unit).immune?.includes(id)) {
    events.push({ type: 'resisted', unitId: unit.id, status: id });
    return;
  }
  const old = unit.statuses.find((s) => s.id === id);
  const inst = {
    id,
    turns: Math.max(turns, old?.turns ?? 0),
    amount: def.stacks
      ? (old?.amount ?? 0) + amount + statOf(state, unitById(state, sourceId), 'stackBonus')
      : Math.max(amount, old?.amount ?? 0),
    sourceId,
  };
  unit.statuses = [...unit.statuses.filter((s) => s.id !== id), inst];
  events.push({ type: 'statusApplied', unitId: unit.id, status: id, turns: inst.turns });
  if (def.stun && isEnemy(state, unit) && unit.intent) {
    unit.intent = null;
    events.push({ type: 'intentCanceled', unitId: unit.id });
  }
}

export function removeStatus(eng: Engine, unit: Unit, id: string): void {
  if (!unit.statuses.some((s) => s.id === id)) return;
  unit.statuses = unit.statuses.filter((s) => s.id !== id);
  eng.events.push({ type: 'statusExpired', unitId: unit.id, status: id });
}

export function addSurface(eng: Engine, id: string, cell: Vec2, turns: number | null, side: Side): void {
  const { state, events } = eng;
  if (getCell(state.room.grid, cell.x, cell.y) !== 'floor') return;
  // Surfaces react: fire on ice leaves water, fire on water goes out.
  for (const old of state.surfaces.filter((s) => same(s, cell) && s.id !== id)) {
    const reaction = getSurface(old.id).reactions?.find((x) => x.with === id);
    if (!reaction) continue;
    removeSurface(eng, old.id, cell);
    if (reaction.result)
      addSurface(eng, reaction.result, cell, reaction.result === old.id ? old.turns : turns, old.side);
    return;
  }
  state.surfaces = state.surfaces.filter((s) => !(s.id === id && same(s, cell)));
  state.surfaces.push({ id, x: cell.x, y: cell.y, turns, side });
  events.push({ type: 'surfaceAdded', surface: id, at: { x: cell.x, y: cell.y }, side });
}

export function removeSurface(eng: Engine, id: string, cell: Vec2): void {
  const { state, events } = eng;
  if (!surfaceAt(state, cell, id)) return;
  state.surfaces = state.surfaces.filter((s) => !(s.id === id && same(s, cell)));
  events.push({ type: 'surfaceRemoved', surface: id, at: { x: cell.x, y: cell.y } });
}

function keeps(state: GameState, filter: UnitFilter, source: Unit, u: Unit): boolean {
  const mine = sideOf(state, source);
  switch (filter) {
    case 'any':
      return true;
    case 'foes':
      return sideOf(state, u) !== mine;
    case 'allies':
      return sideOf(state, u) === mine;
    case 'notAlliedPlayers':
      return !(isPlayer(state, u) && sideOf(state, u) === mine);
  }
}

function centerOf(ctx: EffectContext, c: 'target' | 'self' | 'subject'): Vec2 | null {
  if (c === 'target') return ctx.target;
  if (c === 'self') return pos(ctx.source);
  return ctx.event?.cell ?? null;
}

/** The cell in front of the actor and the two beside it. */
function frontRow(ctx: EffectContext): Vec2[] {
  const front = add(pos(ctx.source), dirVec(ctx.dir));
  return [front, add(front, dirVec(((ctx.dir + 1) % 4) as Dir)), add(front, dirVec(((ctx.dir + 3) % 4) as Dir))];
}

function selectUnits(eng: Engine, sel: UnitSelector | undefined, ctx: EffectContext): Unit[] {
  const { state } = eng;
  const s = sel ?? { kind: 'target' };
  switch (s.kind) {
    case 'target': {
      if (ctx.targetId) {
        const u = unitById(state, ctx.targetId);
        return u && isAlive(state, u) ? [u] : [];
      }
      const u = unitAt(state, ctx.target.x, ctx.target.y);
      return u ? [u] : [];
    }
    case 'self':
      return isAlive(state, ctx.source) ? [ctx.source] : [];
    case 'subject':
    case 'actor': {
      const ref = s.kind === 'subject' ? ctx.event?.subject : ctx.event?.actor;
      const u = ref ? unitById(state, ref.id) : undefined;
      return u && isAlive(state, u) ? [u] : [];
    }
    case 'around': {
      const c = centerOf(ctx, s.center);
      if (!c) return [];
      const dist = s.square ? chebyshev : manhattan;
      return allUnits(state).filter(
        (u) => dist(u, c) <= s.radius && (s.includeCenter || !same(u, c)) && keeps(state, s.filter, ctx.source, u),
      );
    }
    case 'frontRow':
      return frontRow(ctx)
        .map((c) => unitAt(state, c.x, c.y))
        .filter((u): u is Unit => !!u && u !== ctx.source);
    case 'nearest': {
      const c = centerOf(ctx, s.center);
      if (!c) return [];
      const skip = ctx.event?.subject?.id;
      return allUnits(state)
        .filter((u) => !same(u, c) && u.id !== skip && keeps(state, s.filter, ctx.source, u))
        .sort((a, b) => manhattan(a, c) - manhattan(b, c))
        .slice(0, s.count ?? 1);
    }
    case 'beyond': {
      // Past the subject as seen from the actor (triggers), or past the target along the action.
      const from = ctx.event?.actorCell ?? pos(ctx.source);
      const at = ctx.event?.cell ?? ctx.target;
      const cell = add(at, dirVec(same(from, at) ? ctx.dir : dirTowards(from, at)));
      const u = unitAt(state, cell.x, cell.y);
      return u && u !== ctx.source ? [u] : [];
    }
  }
}

function selectCell(eng: Engine, ctx: EffectContext, at: CellSelector): Vec2 | null {
  if (typeof at === 'object') {
    // The nearest free floor cell around a point (with one of the surfaces, if asked).
    const c = centerOf(ctx, at.near);
    if (!c) return null;
    const g = eng.state.room.grid;
    let best: Vec2 | null = null;
    for (let y = c.y - at.radius; y <= c.y + at.radius; y++)
      for (let x = c.x - at.radius; x <= c.x + at.radius; x++) {
        const p = { x, y };
        if (manhattan(p, c) > at.radius || getCell(g, x, y) !== 'floor' || unitAt(eng.state, x, y)) continue;
        if (at.surface && !at.surface.some((sf) => surfaceAt(eng.state, p, sf))) continue;
        if (!best || manhattan(p, c) < manhattan(best, c)) best = p;
      }
    return best;
  }
  switch (at) {
    case 'target':
      return ctx.target;
    case 'self':
      return pos(ctx.source);
    case 'subject':
      return ctx.event?.cell ?? null;
    case 'from':
      return ctx.event?.from ?? null;
  }
}

/** Cells an `around` selection covers (for the explosion flash), walls excluded. */
function areaCells(
  eng: Engine,
  sel: UnitSelector | undefined,
  ctx: EffectContext,
): { center: Vec2; cells: Vec2[] } | null {
  if (!sel || sel.kind !== 'around') return null;
  const c = centerOf(ctx, sel.center);
  if (!c) return null;
  const cells: Vec2[] = [];
  for (let dy = -sel.radius; dy <= sel.radius; dy++)
    for (let dx = -sel.radius; dx <= sel.radius; dx++) {
      const p = { x: c.x + dx, y: c.y + dy };
      if ((sel.square ? chebyshev : manhattan)(p, c) > sel.radius || (!sel.includeCenter && dx === 0 && dy === 0))
        continue;
      if (!blocksSight(getCell(eng.state.room.grid, p.x, p.y))) cells.push(p);
    }
  return { center: c, cells };
}

export function runEffects(eng: Engine, effects: readonly EffectSpec[], context: EffectContext): void {
  const { state, events } = eng;
  const ctx: EffectContext =
    context.targetId === undefined
      ? { ...context, targetId: unitAt(state, context.target.x, context.target.y)?.id ?? null }
      : context;
  const cause = ctx.event ? 'effect' : 'attack';
  for (const effect of effects) {
    if (!isActive(state)) return;
    switch (effect.kind) {
      case 'damage': {
        const area = areaCells(eng, effect.to, ctx);
        if (area) events.push({ type: 'area', center: area.center, cells: area.cells });
        for (const u of selectUnits(eng, effect.to, ctx)) {
          const stacked = effect.fromStatus ? (u.statuses.find((x) => x.id === effect.fromStatus)?.amount ?? 0) : 0;
          dealDamage(eng, u, effect.amount + stacked, ctx.source, cause, ctx.tags);
        }
        break;
      }
      case 'push': {
        const area = effect.to?.kind === 'around' ? centerOf(ctx, effect.to.center) : null;
        for (const u of selectUnits(eng, effect.to, ctx))
          push(eng, u, area ? dirTowards(area, u) : ctx.dir, effect.distance, ctx.source, ctx.tags);
        break;
      }
      case 'teleportBehind': {
        const t = unitAt(state, ctx.target.x, ctx.target.y);
        if (!t || t === ctx.source) break;
        const dest = add(pos(t), dirVec(((t.dir + 2) % 4) as Dir));
        if (getCell(state.room.grid, dest.x, dest.y) !== 'floor' || unitAt(state, dest.x, dest.y)) break;
        const from = pos(ctx.source);
        ctx.source.x = dest.x;
        ctx.source.y = dest.y;
        events.push({ type: 'teleported', unitId: ctx.source.id, from, to: dest });
        if (ctx.source.dir !== t.dir) {
          events.push({ type: 'turned', unitId: ctx.source.id, from: ctx.source.dir, to: t.dir });
          ctx.source.dir = t.dir;
        }
        moved(eng, ctx.source, from, ctx.source, ctx.tags);
        break;
      }
      case 'swap': {
        const t = unitAt(state, ctx.target.x, ctx.target.y);
        if (!t || t === ctx.source) break;
        const a = pos(ctx.source);
        const b = pos(t);
        ctx.source.x = b.x;
        ctx.source.y = b.y;
        t.x = a.x;
        t.y = a.y;
        events.push({ type: 'swapped', unitId: ctx.source.id, otherId: t.id, from: a, to: b });
        moved(eng, ctx.source, a, ctx.source, ctx.tags);
        moved(eng, t, b, ctx.source, ctx.tags);
        break;
      }
      case 'dash': {
        const step = dirVec(ctx.dir);
        const start = pos(ctx.source);
        let cur = start;
        let impact: Vec2 | null = null;
        for (let i = 0; i < effect.distance; i++) {
          const next = add(cur, step);
          const cell = getCell(state.room.grid, next.x, next.y);
          if (blocksPush(cell) || cell === 'pit') break;
          if (unitAt(state, next.x, next.y)) {
            impact = next;
            break;
          }
          cur = next;
        }
        if (!same(cur, start)) {
          ctx.source.x = cur.x;
          ctx.source.y = cur.y;
          events.push({ type: 'moved', unitId: ctx.source.id, from: start, to: cur });
          moved(eng, ctx.source, start, ctx.source, ctx.tags);
        }
        if (impact) runEffects(eng, effect.onImpact, { ...ctx, target: impact, targetId: undefined });
        break;
      }
      case 'projectile': {
        const step = dirVec(ctx.dir);
        const pierce = statOf(state, ctx.source, 'projectilePierce');
        const start = pos(ctx.source);
        let last = start;
        const hits: Vec2[] = [];
        const range = effect.range + statOf(state, ctx.source, 'projectileRange');
        for (let i = 0; i < range; i++) {
          const next = add(last, step);
          if (blocksSight(getCell(state.room.grid, next.x, next.y))) break;
          last = next;
          if (unitAt(state, next.x, next.y)) {
            hits.push(next);
            if (hits.length > pierce) break;
          }
        }
        events.push({ type: 'projectile', unitId: ctx.source.id, from: start, to: last });
        for (const h of hits) runEffects(eng, effect.onHit, { ...ctx, target: h, targetId: undefined });
        break;
      }
      case 'status':
        for (const u of selectUnits(eng, effect.to, ctx))
          applyStatus(eng, u, effect.status, effect.turns, effect.amount ?? 0, ctx.source.id);
        break;
      case 'shield': {
        const def = STATUSES.find((s) => s.shield);
        if (!def) break;
        for (const u of selectUnits(eng, effect.to, ctx))
          applyStatus(eng, u, def.id, effect.turns, effect.amount, ctx.source.id);
        break;
      }
      case 'surface': {
        const cell = selectCell(eng, ctx, effect.at);
        if (!cell) break;
        const r = effect.radius ?? 0;
        for (let dy = -r; dy <= r; dy++)
          for (let dx = -r; dx <= r; dx++)
            addSurface(
              eng,
              effect.surface,
              { x: cell.x + dx, y: cell.y + dy },
              effect.turns ?? null,
              sideOf(state, ctx.source),
            );
        break;
      }
      case 'clearSurface': {
        const cell = selectCell(eng, ctx, effect.at);
        if (cell) removeSurface(eng, effect.surface, cell);
        break;
      }
      case 'summon': {
        const owner = ownerPlayer(state, ctx.source);
        if (!owner) break;
        const cells = effect.at === 'frontRow' ? frontRow(ctx) : [selectCell(eng, ctx, effect.at)];
        const free = (c: Vec2 | null): c is Vec2 =>
          !!c && getCell(state.room.grid, c.x, c.y) === 'floor' && !unitAt(state, c.x, c.y);
        let placed: Vec2 | null = null;
        for (const cell of cells) {
          if (!free(cell)) continue;
          if (effect.consumes) {
            const sf = effect.consumes.find((id) => surfaceAt(state, cell, id));
            if (!sf) continue;
            removeSurface(eng, sf, cell);
          }
          summonAlly(eng, effect.unit, owner, cell, ctx);
          placed ??= cell;
        }
        // Extra summons rise on the nearest free cells.
        for (let i = 0; placed && i < statOf(state, owner, 'extraSummons'); i++) {
          const near = selectCell(eng, { ...ctx, target: placed }, { near: 'target', radius: 2 });
          if (near) summonAlly(eng, effect.unit, owner, near, ctx);
        }
        break;
      }
      case 'spreadStatuses': {
        const harmful = (ctx.event?.subjectStatusList ?? []).filter((x) => getStatus(x.id).debuff);
        for (const u of selectUnits(eng, effect.to, ctx))
          for (const x of harmful) applyStatus(eng, u, x.id, Math.max(1, x.turns), x.amount, ctx.source.id);
        break;
      }
      case 'removeStatus':
        for (const u of selectUnits(eng, effect.to, ctx)) removeStatus(eng, u, effect.status);
        break;
      case 'cooldowns': {
        const p = ownerPlayer(state, ctx.source);
        if (!p) break;
        for (const c of p.cooldowns) c.turns += effect.delta;
        p.cooldowns = p.cooldowns.filter((c) => c.turns > 0);
        break;
      }
      case 'maxHp': {
        const p = ownerPlayer(state, ctx.source);
        if (!p) break;
        p.maxHp = Math.max(1, effect.set ?? p.maxHp + (effect.add ?? 0));
        p.hp = Math.min(p.hp, p.maxHp);
        break;
      }
      case 'heal':
        for (const u of selectUnits(eng, effect.to, ctx)) {
          const before = u.hp;
          u.hp = Math.min(u.maxHp, u.hp + effect.amount);
          events.push({ type: 'healed', unitId: u.id, amount: u.hp - before, hp: u.hp });
        }
        break;
      case 'freeAction': {
        const p = ownerPlayer(state, ctx.source);
        if (!p) break;
        p.freeActions++;
        events.push({ type: 'freeActionGained', unitId: p.id });
        break;
      }
      case 'kill':
        for (const u of selectUnits(eng, effect.to, ctx)) killUnit(eng, u, ctx.source, ctx.tags);
        break;
      case 'pull':
        for (const u of selectUnits(eng, effect.to, ctx)) pull(eng, u, ctx.source, effect.distance, ctx.tags);
        break;
      case 'consume': {
        const me = pos(ctx.source);
        const food = state.surfaces
          .filter((s) => s.id === effect.surface && manhattan(s, me) <= effect.radius)
          .sort((a, b) => manhattan(a, me) - manhattan(b, me) || a.y - b.y || a.x - b.x)[0];
        if (!food) break;
        removeSurface(eng, food.id, food);
        runEffects(eng, effect.effects, { ...ctx, target: me, targetId: ctx.source.id });
        break;
      }
      case 'faceActor': {
        const at = ctx.event?.actorCell;
        if (!at || same(at, pos(ctx.source))) break;
        const to = dirTowards(pos(ctx.source), at);
        if (to !== ctx.source.dir) {
          events.push({ type: 'turned', unitId: ctx.source.id, from: ctx.source.dir, to });
          ctx.source.dir = to;
        }
        break;
      }
      case 'scatterSurface': {
        const g = state.room.grid;
        const free: Vec2[] = [];
        for (let y = 0; y < g.h; y++)
          for (let x = 0; x < g.w; x++) {
            const c = { x, y };
            if (getCell(g, x, y) !== 'floor' || unitAt(state, x, y)) continue;
            if (state.players.some((p) => p.hp > 0 && manhattan(p, c) <= 1)) continue;
            free.push(c);
          }
        for (const c of shuffle(state.rng, free).slice(0, effect.count))
          addSurface(eng, effect.surface, c, effect.turns ?? null, sideOf(state, ctx.source));
        break;
      }
      default: {
        const _exhaustive: never = effect;
      }
    }
  }
}

function summonAlly(eng: Engine, unit: string, owner: Player, cell: Vec2, ctx: EffectContext): void {
  const { state, events } = eng;
  const def = getSummon(unit);
  const ally = {
    id: `s${state.nextId++}`,
    type: def.id,
    owner: owner.id,
    x: cell.x,
    y: cell.y,
    dir: ctx.source.dir,
    hp: def.maxHp + statOf(state, owner, 'summonHp'),
    maxHp: def.maxHp + statOf(state, owner, 'summonHp'),
    statuses: [],
  };
  state.allies.push(ally);
  events.push({
    type: 'summoned',
    unitId: ally.id,
    summon: def.id,
    side: 'heroes',
    owner: owner.id,
    at: { x: cell.x, y: cell.y },
    dir: ally.dir,
    hp: ally.hp,
  });
  emit(eng, 'summon', { actor: ctx.source, subject: ally, tags: ctx.tags });
  emit(eng, 'enterCell', { actor: ctx.source, subject: ally, tags: ctx.tags });
}

/** Runs a rule's one-off effects when it is gained (items that change your maximum health). */
export function gainRule(eng: Engine, player: Player, effects: readonly EffectSpec[] | undefined): void {
  if (effects?.length)
    runEffects(eng, effects, { source: player, target: pos(player), dir: player.dir, tags: [], event: null });
}

// ---- triggers -------------------------------------------------------------------------------------

function related(rel: Relation | undefined, ref: UnitRef | null, owner: UnitRef): boolean {
  if (!rel) return true;
  if (!ref) return false;
  switch (rel) {
    case 'owner':
      return ref.id === owner.id;
    case 'ownerSide':
      return ref.side === owner.side;
    case 'ownSummon':
      return ref.owner !== null && ref.owner === owner.id;
    case 'foe':
      return ref.side !== owner.side && ref.side !== 'neutral';
    case 'any':
      return true;
  }
}

function matches(state: GameState, t: TriggerDef, ev: TriggerEvent, owner: UnitRef, ownerUnit: Unit | null): boolean {
  const counter = t.ownerStatusAtLeast;
  return (
    t.on === ev.on &&
    related(t.actor, ev.actor, owner) &&
    related(t.subject, ev.subject, owner) &&
    (t.tags ?? []).every((tag) => ev.tags.includes(tag)) &&
    (!t.subjectStatus || ev.subjectStatuses.includes(t.subjectStatus)) &&
    (!t.backstab || ev.backstab) &&
    (t.near === undefined || (!!ownerUnit && !!ev.cell && manhattan(ownerUnit, ev.cell) <= t.near)) &&
    (t.ownerHpAtMost === undefined || (!!ownerUnit && ownerUnit.hp <= t.ownerHpAtMost)) &&
    (!counter || (ownerUnit?.statuses.find((x) => x.id === counter.status)?.amount ?? 0) >= counter.amount) &&
    (!t.subjectSurface || (!!ev.cell && !!surfaceAt(state, ev.cell, t.subjectSurface)))
  );
}

interface Listener {
  readonly owner: Unit;
  readonly trigger: TriggerDef;
  readonly rule: string;
  readonly surface: Surface | null;
  /** A once-per-room trigger: mark the rule as used when it fires. */
  readonly once: boolean;
}

/**
 * Everyone listening to an event, in a fixed order: each player's passives then modifiers, then the
 * statuses on every unit (acting order), then the surface on the event's cell.
 */
function listeners(state: GameState, ev: TriggerEvent): Listener[] {
  const out: Listener[] = [];
  for (const p of state.players) {
    if (p.hp <= 0) continue;
    const me = refOf(state, p);
    for (const r of playerRules(p))
      for (const t of r.triggers) {
        if (!matches(state, t, ev, me, p)) continue;
        if (t.oncePerRoom && p.ruleUses.includes(r.id)) continue;
        if (t.oncePerTurn && p.turnUses.includes(r.id)) continue;
        out.push({ owner: p, trigger: t, rule: r.id, surface: null, once: t.oncePerRoom === true });
      }
  }
  // Enemies' own traits (a ghoul's hunger, a templar's watchfulness).
  for (const e of state.enemies) {
    const me = refOf(state, e);
    for (const t of enemyDef(e).traits ?? [])
      if (matches(state, t, ev, me, e)) out.push({ owner: e, trigger: t, rule: e.type, surface: null, once: false });
  }
  for (const u of allUnits(state)) {
    const me = refOf(state, u);
    for (const s of u.statuses)
      for (const t of getStatus(s.id).triggers)
        if (matches(state, t, ev, me, u)) out.push({ owner: u, trigger: t, rule: s.id, surface: null, once: false });
  }
  // Surfaces react to units stepping on them and to units ending a turn on them.
  if ((ev.on === 'enterCell' || ev.on === 'turnEnd') && ev.cell) {
    const cell = ev.cell;
    for (const s of state.surfaces.filter((x) => same(x, cell))) {
      const me: UnitRef = { id: `surface:${s.id}`, side: s.side, owner: null };
      // Surfaces act through a unit of their side (heroes: the first player), or through the subject.
      const subject = ev.subject ? unitById(state, ev.subject.id) : undefined;
      const actor = s.side === 'heroes' ? state.players.find((p) => p.hp > 0) : subject;
      if (!actor) continue;
      for (const t of getSurface(s.id).triggers)
        if (matches(state, t, ev, me, null))
          out.push({ owner: actor, trigger: t, rule: s.id, surface: s, once: false });
    }
  }
  return out;
}

/** Runs queued trigger events (and whatever they cause) until the queue is empty. */
export function settle(eng: Engine): void {
  const { state, events } = eng;
  while (eng.queue.length > 0) {
    if (!isActive(state)) {
      eng.queue.length = 0;
      return;
    }
    const ev = eng.queue.shift() as TriggerEvent;
    if (ev.depth >= MAX_CHAIN_DEPTH) {
      events.push({ type: 'chainLimit', depth: ev.depth });
      continue;
    }
    for (const l of listeners(state, ev)) {
      if (!isActive(state)) break;
      if (!isAlive(state, l.owner) && !isPlayer(state, l.owner)) continue;
      if (l.surface && !state.surfaces.includes(l.surface)) continue; // already used up
      const saved = eng.depth;
      eng.depth = ev.depth + 1;
      events.push({ type: 'triggered', rule: l.rule, ownerId: l.surface ? null : l.owner.id });
      if (l.surface && getSurface(l.surface.id).singleUse) removeSurface(eng, l.surface.id, l.surface);
      if (l.once && isPlayer(state, l.owner)) {
        if (l.owner.ruleUses.includes(l.rule)) continue;
        l.owner.ruleUses.push(l.rule);
      }
      if (l.trigger.every && isPlayer(state, l.owner)) {
        // Every n-th time: count this one, act only when the count comes round.
        let c = l.owner.counters.find((x) => x.rule === l.rule);
        if (!c) {
          c = { rule: l.rule, n: 0 };
          l.owner.counters.push(c);
        }
        c.n++;
        if (c.n % l.trigger.every !== 0) continue;
      }
      if (l.trigger.oncePerTurn && isPlayer(state, l.owner)) {
        if (l.owner.turnUses.includes(l.rule)) continue;
        l.owner.turnUses.push(l.rule);
      }
      runEffects(eng, l.trigger.effects, {
        source: l.owner,
        target: ev.cell ?? pos(l.owner),
        dir: l.owner.dir,
        tags: l.trigger.effectTags ?? [],
        event: ev,
      });
      eng.depth = saved;
    }
  }
}

/** Queues a turn event for every living unit (statuses like bleeding listen to these). */
export function emitTurn(eng: Engine, on: 'turnStart' | 'turnEnd'): void {
  for (const u of allUnits(eng.state)) emit(eng, on, { subject: u });
}

/** Ticks status and surface durations down by one turn, removing the ones that run out. */
export function tickDurations(eng: Engine): void {
  const { state, events } = eng;
  for (const u of allUnits(state)) {
    for (const s of u.statuses) s.turns--;
    for (const s of u.statuses.filter((x) => x.turns <= 0)) {
      removeStatus(eng, u, s.id);
      const after = getStatus(s.id).onExpire;
      if (after) runEffects(eng, after, { source: u, target: pos(u), dir: u.dir, tags: [], event: null });
    }
  }
  for (const s of state.surfaces) if (s.turns !== null) s.turns--;
  for (const s of state.surfaces.filter((x) => x.turns !== null && x.turns <= 0)) {
    state.surfaces.splice(state.surfaces.indexOf(s), 1);
    events.push({ type: 'surfaceRemoved', surface: s.id, at: { x: s.x, y: s.y } });
  }
}
