import { add, dirVec, getCell, type CellType, type Dir, type Vec2 } from '../core/grid';
import {
  getEnemy,
  getModifier,
  getPassive,
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
import { checkCombatEnd, statOf } from './units';

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
  e: { actor?: Unit | null; subject?: Unit | null; cell?: Vec2 | null; from?: Vec2 | null; tags?: readonly Tag[] },
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

/** Damage after vulnerability, backstab and shields. Queues `damaged`, `hit` and, on death, `kill`/`death`. */
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
  if (dmg > 0) dmg += statOf(state, unit, 'damageTaken');
  if (dmg > 0 && cause === 'attack' && source && source !== unit) {
    const extra = statOf(state, source, 'backstab');
    if (extra > 0 && fromBehind(source, unit)) {
      dmg *= 1 + extra;
      backstab = true;
    }
  }
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
  events.push({ type: 'damaged', unitId: unit.id, amount: dmg, absorbed, hp: unit.hp, cause, backstab });
  emit(eng, 'damaged', { actor: source, subject: unit, tags });
  if (source && cause === 'attack') emit(eng, 'hit', { actor: source, subject: unit, tags });
  if (unit.hp <= 0) killUnit(eng, unit, source, tags);
}

/** Removes a unit from play (enemies and allies leave their arrays; players stay with hp 0). */
export function killUnit(eng: Engine, unit: Unit, killer: Unit | null, tags: readonly Tag[]): void {
  const { state, events } = eng;
  if (!isAlive(state, unit) && !(isPlayer(state, unit) && unit.hp <= 0 && !events.some(isDeathOf(unit.id)))) return;
  const ref = refOf(state, unit);
  const statuses = unit.statuses.map((s) => s.id);
  const cell = pos(unit);
  unit.hp = 0;
  events.push({ type: 'died', unitId: unit.id });
  if (isEnemy(state, unit)) state.enemies.splice(state.enemies.indexOf(unit), 1);
  if (isAlly(state, unit)) state.allies.splice(state.allies.indexOf(unit), 1);
  const base = { cell, from: null, tags, subjectStatuses: statuses, depth: eng.depth, subject: ref };
  if (killer && killer !== unit) eng.queue.push({ ...base, on: 'kill', actor: refOf(state, killer) });
  eng.queue.push({ ...base, on: 'death', actor: killer ? refOf(state, killer) : null });
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
  for (let i = 0; i < total; i++) {
    if (!isAlive(state, unit)) return;
    const from = pos(unit);
    const to = add(from, step);
    const cell = getCell(state.room.grid, to.x, to.y);
    if (blocksPush(cell)) {
      events.push({ type: 'collided', unitId: unit.id, at: to, withId: null });
      dealDamage(eng, unit, collisionDamage, source, 'collision', tags);
      return;
    }
    const other = unitAt(state, to.x, to.y);
    if (other) {
      events.push({ type: 'collided', unitId: unit.id, at: to, withId: other.id });
      dealDamage(eng, unit, collisionDamage, source, 'collision', tags);
      dealDamage(eng, other, PUSH_COLLISION_DAMAGE, source, 'collision', tags);
      return;
    }
    unit.x = to.x;
    unit.y = to.y;
    events.push({ type: 'pushed', unitId: unit.id, from, to });
    emit(eng, 'enterCell', { actor: source, subject: unit, tags });
    if (cell === 'pit') {
      events.push({ type: 'fell', unitId: unit.id, at: to });
      killUnit(eng, unit, source, tags);
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
  const old = unit.statuses.find((s) => s.id === id);
  const inst = {
    id,
    turns: Math.max(turns, old?.turns ?? 0),
    amount: Math.max(amount, old?.amount ?? 0),
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
      return allUnits(state).filter(
        (u) => manhattan(u, c) <= s.radius && (s.includeCenter || !same(u, c)) && keeps(state, s.filter, ctx.source, u),
      );
    }
  }
}

function selectCell(ctx: EffectContext, at: CellSelector): Vec2 | null {
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
      if (manhattan(p, c) > sel.radius || (!sel.includeCenter && dx === 0 && dy === 0)) continue;
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
        for (const u of selectUnits(eng, effect.to, ctx))
          dealDamage(eng, u, effect.amount, ctx.source, cause, ctx.tags);
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
        for (let i = 0; i < effect.range; i++) {
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
        const cell = selectCell(ctx, effect.at);
        if (cell) addSurface(eng, effect.surface, cell, effect.turns ?? null, sideOf(state, ctx.source));
        break;
      }
      case 'clearSurface': {
        const cell = selectCell(ctx, effect.at);
        if (cell) removeSurface(eng, effect.surface, cell);
        break;
      }
      case 'summon': {
        const cell = selectCell(ctx, effect.at);
        const owner = ownerPlayer(state, ctx.source);
        if (!cell || !owner || getCell(state.room.grid, cell.x, cell.y) !== 'floor' || unitAt(state, cell.x, cell.y))
          break;
        if (effect.consumes) {
          if (!surfaceAt(state, cell, effect.consumes)) break;
          removeSurface(eng, effect.consumes, cell);
        }
        const def = getSummon(effect.unit);
        const ally = {
          id: `s${state.nextId++}`,
          type: def.id,
          owner: owner.id,
          x: cell.x,
          y: cell.y,
          dir: ctx.source.dir,
          hp: def.maxHp,
          maxHp: def.maxHp,
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
      default: {
        const _exhaustive: never = effect;
      }
    }
  }
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

function matches(t: TriggerDef, ev: TriggerEvent, owner: UnitRef): boolean {
  return (
    t.on === ev.on &&
    related(t.actor, ev.actor, owner) &&
    related(t.subject, ev.subject, owner) &&
    (t.tags ?? []).every((tag) => ev.tags.includes(tag)) &&
    (!t.subjectStatus || ev.subjectStatuses.includes(t.subjectStatus))
  );
}

interface Listener {
  readonly owner: Unit;
  readonly trigger: TriggerDef;
  readonly rule: string;
  readonly surface: Surface | null;
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
    const rules = [...p.passives.map((id) => getPassive(id)), ...p.modifiers.map((id) => getModifier(id))];
    for (const r of rules)
      for (const t of r.triggers) if (matches(t, ev, me)) out.push({ owner: p, trigger: t, rule: r.id, surface: null });
  }
  for (const u of allUnits(state)) {
    const me = refOf(state, u);
    for (const s of u.statuses)
      for (const t of getStatus(s.id).triggers)
        if (matches(t, ev, me)) out.push({ owner: u, trigger: t, rule: s.id, surface: null });
  }
  if (ev.on === 'enterCell' && ev.cell) {
    const cell = ev.cell;
    for (const s of state.surfaces.filter((x) => same(x, cell))) {
      const me: UnitRef = { id: `surface:${s.id}`, side: s.side, owner: null };
      // Surfaces act through a unit of their side (heroes: the first player), or through the subject.
      const subject = ev.subject ? unitById(state, ev.subject.id) : undefined;
      const actor = s.side === 'heroes' ? state.players.find((p) => p.hp > 0) : subject;
      if (!actor) continue;
      for (const t of getSurface(s.id).triggers)
        if (matches(t, ev, me)) out.push({ owner: actor, trigger: t, rule: s.id, surface: s });
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
      runEffects(eng, l.trigger.effects, {
        source: l.owner,
        target: ev.cell ?? pos(l.owner),
        dir: l.owner.dir,
        tags: [],
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
    for (const s of u.statuses.filter((x) => x.turns <= 0)) removeStatus(eng, u, s.id);
  }
  for (const s of state.surfaces) if (s.turns !== null) s.turns--;
  for (const s of state.surfaces.filter((x) => x.turns !== null && x.turns <= 0)) {
    state.surfaces.splice(state.surfaces.indexOf(s), 1);
    events.push({ type: 'surfaceRemoved', surface: s.id, at: { x: s.x, y: s.y } });
  }
}
