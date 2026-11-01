import { add, dirVec, getCell, isWalkable, rotateDir, type Vec2 } from '../core/grid';
import {
  ABILITIES,
  ABILITY_SLOTS,
  ACT,
  CLASSES,
  getAbility,
  getGift,
  getItem,
  getModifier,
  getStatus,
  GIFTS,
  ITEMS,
  MODIFIERS,
} from '../content';
import { actAllies, advanceEnemies, intentCells, nextAttack } from './ai';
import { makeEnemy } from './encounter';
import {
  addClass,
  chooseReward,
  doorAt,
  effectiveCooldown,
  enterAct,
  enterDoor,
  enterRoom,
  roomCleared,
  runLost,
  upgradedEffects,
} from './run';
import type { Command, GameEvent, MoveDir, RejectReason } from './commands';
import {
  createEngine,
  dealDamage,
  dirTowards,
  emit,
  emitTurn,
  gainRule,
  addSurface,
  killUnit,
  moved,
  runEffects,
  settle,
  tickDurations,
  type Engine,
} from './engine';
import { isPlayer, surfaceAt, unitAt, type Enemy, type GameState, type Player } from './state';
import { actionDir, validTargets } from './targeting';
import { checkCombatEnd, cooldownOf, setCooldown, statOf, tickCooldowns } from './units';

export interface ApplyResult {
  readonly state: GameState;
  readonly events: readonly GameEvent[];
}

const MOVE_ROTATION: Record<MoveDir, number> = { forward: 0, right: 1, back: 2, left: 3 };

/**
 * The only way game state changes (CLAUDE.md rule 3).
 * Pure: the input state is never modified; a new state is returned with the events produced.
 * A rejected command returns the input state unchanged plus a `rejected` event.
 *
 * Turn structure: a step or an ability takes one turn, and the world answers immediately (`worldTurn`),
 * unless the action was free. Turning in place and bumping into a wall take no time.
 */
export function apply(prev: GameState, command: Command): ApplyResult {
  const state = structuredClone(prev);
  const events: GameEvent[] = [];
  const eng = createEngine(state, events);
  const reject = (reason: RejectReason): ApplyResult => ({ state: prev, events: [{ type: 'rejected', reason }] });

  const player = state.players.find((p) => p.id === command.playerId);
  if (!player) return reject('unknown_player');

  switch (command.type) {
    case 'turn': {
      if (player.hp <= 0) return reject('dead');
      const from = player.dir;
      player.dir = rotateDir(from, command.dir === 'right' ? 1 : -1);
      events.push({ type: 'turned', unitId: player.id, from, to: player.dir });
      break;
    }
    case 'move': {
      if (player.hp <= 0) return reject('dead');
      if (state.run?.phase === 'reward') return reject('choose_reward');
      if (command.dir === 'back' && statOf(state, player, 'noRetreat') > 0) return reject('cannot_retreat');
      const to = add(player, dirVec(rotateDir(player.dir, MOVE_ROTATION[command.dir])));
      const cell = getCell(state.room.grid, to.x, to.y);
      const door = command.dir === 'forward' ? doorAt(state, to.x, to.y) : -1;
      if (door >= 0) {
        // Through an open door into the next room.
        enterDoor(state, door, events);
        break;
      }
      const occupant = unitAt(state, to.x, to.y);
      const baseAttack = player.abilities[0];
      const foe = occupant && !isPlayer(state, occupant) && !state.allies.includes(occupant as never);
      if (command.dir === 'forward' && foe && baseAttack && isActive(state)) {
        // Walking into an enemy attacks it with the base attack (classic roguelike bump-attack).
        const free = player.freeActions > 0;
        const r = useAbility(eng, player, baseAttack, to);
        if (r) return reject(r);
        endAction(eng, player, free);
      } else if (isWalkable(cell) && !occupant) {
        const free = player.freeActions > 0;
        const from = { x: player.x, y: player.y };
        player.x = to.x;
        player.y = to.y;
        events.push({ type: 'moved', unitId: player.id, from, to });
        moved(eng, player, from, player, []);
        settle(eng);
        if (isActive(state)) endAction(eng, player, free);
      } else if (occupant && state.allies.includes(occupant as never)) {
        // Walking into your own summon trades places with it, so a skeleton never walls you in.
        const free = player.freeActions > 0;
        const from = { x: player.x, y: player.y };
        occupant.x = from.x;
        occupant.y = from.y;
        player.x = to.x;
        player.y = to.y;
        events.push({ type: 'swapped', unitId: player.id, otherId: occupant.id, from, to });
        moved(eng, player, from, player, []);
        settle(eng);
        if (isActive(state)) endAction(eng, player, free);
      } else {
        // Bumping into a wall costs nothing.
        events.push({ type: 'bumped', unitId: player.id, at: to, cell });
      }
      break;
    }
    case 'chooseReward': {
      const r = chooseReward(eng, command.index, command.replace);
      if (r) return reject(r);
      break;
    }
    case 'useAbility': {
      if (!isActive(state)) return reject('combat_over');
      if (player.hp <= 0) return reject('dead');
      const free = player.freeActions > 0;
      const r = useAbility(eng, player, command.abilityId, command.target ?? null);
      if (r) return reject(r);
      endAction(eng, player, free);
      break;
    }
    case 'debug': {
      events.push({ type: 'debug', action: command.action });
      if (command.action === 'heal') {
        player.hp = player.maxHp;
      } else if (command.action === 'toggleGod') {
        player.god = !player.god;
      } else if (command.action === 'killAll') {
        for (const e of [...state.enemies]) if (isActive(state)) killUnit(eng, e, null, []);
        settle(eng);
      } else if (command.action === 'altarNext' && state.run) {
        state.run.forceAltar = true;
      } else if (command.action === 'toBoss' && state.run) {
        enterRoom(state, ACT.rooms + 1, 'boss', null, events);
      }
      break;
    }
    case 'debugJump': {
      const run = state.run;
      if (!run || command.act < 1 || command.act > ACT.acts || command.depth < 1 || command.depth > ACT.rooms + 1)
        return reject('unknown_command');
      if (command.act !== run.act) enterAct(state, command.act, events);
      if (command.depth !== 1 || command.act === run.act)
        enterRoom(state, command.depth, command.depth > ACT.rooms ? 'boss' : 'combat', null, events);
      events.push({ type: 'debug', action: 'jump' });
      break;
    }
    case 'debugGrant': {
      if (!ABILITIES.some((a) => a.id === command.abilityId)) return reject('unknown_ability');
      if (command.slot < 1 || command.slot > ABILITY_SLOTS) return reject('unknown_ability');
      const list = player.abilities.filter((id) => id !== command.abilityId);
      while (list.length <= command.slot) list.push('');
      list[command.slot] = command.abilityId;
      player.abilities = list.filter((id, i) => id !== '' || i === 0);
      events.push({ type: 'debug', action: 'grant' });
      break;
    }
    case 'debugModifier': {
      if (!MODIFIERS.some((m) => m.id === command.modifierId)) return reject('unknown_command');
      const had = player.modifiers.includes(command.modifierId);
      player.modifiers = had
        ? player.modifiers.filter((m) => m !== command.modifierId)
        : [...player.modifiers, command.modifierId];
      if (!had) gainRule(eng, player, getModifier(command.modifierId).onGain);
      events.push({ type: 'debug', action: 'modifier' });
      break;
    }
    case 'debugItem': {
      if (!ITEMS.some((i) => i.id === command.itemId)) return reject('unknown_command');
      const had = player.items.includes(command.itemId);
      player.items = had ? player.items.filter((i) => i !== command.itemId) : [...player.items, command.itemId];
      if (!had) gainRule(eng, player, getItem(command.itemId).onGain);
      events.push({ type: 'debug', action: 'item' });
      break;
    }
    case 'debugGift': {
      if (!GIFTS.some((g) => g.id === command.giftId)) return reject('unknown_command');
      const had = player.gifts.includes(command.giftId);
      player.gifts = had ? player.gifts.filter((g) => g !== command.giftId) : [...player.gifts, command.giftId];
      if (!had) gainRule(eng, player, getGift(command.giftId).onGain);
      events.push({ type: 'debug', action: 'gift' });
      break;
    }
    case 'debugClass': {
      if (!CLASSES.some((c) => c.id === command.classId)) return reject('unknown_command');
      addClass(eng, player, command.classId);
      events.push({ type: 'debug', action: 'class' });
      break;
    }
    default: {
      const _exhaustive: never = command;
      return reject('unknown_command');
    }
  }
  // A new room: rules that act at its start (items), then its first turn.
  if (events.some((e) => e.type === 'roomEntered') && state.combat.status === 'active') {
    emit(eng, 'roomStart', { subject: player });
    emitTurn(eng, 'turnStart');
    settle(eng);
  }
  // The run moves on when a room's fight ends.
  if (state.run?.phase === 'combat') {
    if (state.combat.status === 'won') roomCleared(state, events);
    else if (state.combat.status === 'lost') runLost(state, events);
  }
  return { state, events };
}

const isActive = (state: GameState) => state.combat.status === 'active';
const same = (a: Vec2, b: Vec2) => a.x === b.x && a.y === b.y;

/** Runs an ability on a target cell (or its default target). Returns a reject reason instead if it cannot be used. */
function useAbility(eng: Engine, player: Player, abilityId: string, target: Vec2 | null): RejectReason | null {
  const { state, events } = eng;
  if (!player.abilities.includes(abilityId) || !ABILITIES.some((a) => a.id === abilityId)) return 'unknown_ability';
  const ability = getAbility(abilityId);
  if (cooldownOf(player, ability.id) > 0) return 'on_cooldown';
  const valid = validTargets(state, player, ability);
  const chosen = target ?? valid[0] ?? null;
  if (!chosen) return 'no_target';
  if (!valid.some((c) => same(c, chosen))) return 'invalid_target';

  // +1 because the turn this ability is used on ticks once as the world answers.
  // With a blood price (an item), abilities that would cool down cost health instead.
  const price = statOf(state, player, 'bloodPrice');
  const cooldown = price > 0 ? 0 : effectiveCooldown(player, ability.id);
  setCooldown(player, ability.id, cooldown > 0 ? cooldown + 1 : 0);
  if (price > 0 && ability.cooldown > 0) dealDamage(eng, player, price, player, 'effect', []);
  if (player.hp <= 0) return null;
  const dir = actionDir(player, ability, chosen);
  if (dir !== player.dir) {
    events.push({ type: 'turned', unitId: player.id, from: player.dir, to: dir });
    player.dir = dir;
  }
  events.push({ type: 'abilityUsed', unitId: player.id, abilityId: ability.id, target: chosen, dir });
  // The base attack (slot 1) carries the `basic` tag, whatever ability it is.
  const tags = abilityId === player.abilities[0] ? [...ability.tags, 'basic' as const] : ability.tags;
  runEffects(eng, upgradedEffects(player, ability.id), { source: player, target: chosen, dir, tags, event: null });
  settle(eng);
  return null;
}

/** After an action: a free one ends here; otherwise the world answers. */
function endAction(eng: Engine, player: Player, free: boolean): void {
  if (free && isActive(eng.state)) {
    player.freeActions--;
    eng.events.push({ type: 'freeActionUsed', unitId: player.id });
    return;
  }
  worldTurn(eng);
}

/**
 * The world's answer to one player turn: allies act, enemies strike with the attacks they telegraphed,
 * then move and telegraph the next ones; statuses tick. Then the next player turn starts.
 */
function worldTurn(eng: Engine): void {
  const { state, events } = eng;
  if (!isActive(state)) return;
  state.combat.phase = 'enemy';
  events.push({ type: 'phaseChanged', phase: 'enemy', turn: state.combat.turn });

  actAllies(eng);
  for (const id of state.enemies.map((e) => e.id)) {
    const e = state.enemies.find((x) => x.id === id);
    if (!e || !e.intent || !isActive(state)) continue;
    const intent = e.intent;
    const attack = nextAttack(e);
    const { cells, hits } = intentCells(state, e, intent);
    events.push({ type: 'enemyAttack', unitId: e.id, intent, cells });
    e.intent = null;
    e.strikes++;
    // Blinded enemies strike at nothing.
    if (e.statuses.some((st) => getStatus(st.id).blind) && intent.kind !== 'summon' && intent.kind !== 'aid') {
      events.push({ type: 'missed', unitId: e.id });
      continue;
    }
    if (intent.kind === 'summon') summonEnemies(eng, e, intent.unit, cells);
    else if (intent.kind === 'aid') {
      // Help lands on whichever enemy now stands on the chosen cell.
      const cell = cells[0];
      const friend = cell ? state.enemies.find((x) => same(x, cell)) : undefined;
      if (friend && attack.kind === 'aid')
        runEffects(eng, attack.effects, { source: e, target: cell!, dir: e.dir, tags: [], event: null });
    } else {
      const tags = intent.kind === 'line' ? (['projectile'] as const) : (['melee'] as const);
      for (const hit of hits) {
        const at = { x: hit.x, y: hit.y };
        dealDamage(eng, hit, intent.damage, e, 'attack', tags);
        if (attack.kind !== 'summon' && attack.kind !== 'aid' && attack.onHit && state.enemies.includes(e))
          runEffects(eng, attack.onHit, { source: e, target: at, dir: e.dir, tags, event: null });
      }
      if (attack.kind !== 'summon' && attack.kind !== 'aid' && attack.surface && state.enemies.includes(e))
        for (const c of cells) addSurface(eng, attack.surface.id, c, attack.surface.turns ?? null, 'foes');
    }
    settle(eng);
  }
  if (!isActive(state)) return;

  advanceEnemies(eng);
  if (!isActive(state)) return;

  emitTurn(eng, 'turnEnd');
  settle(eng);
  tickDurations(eng);
  checkCombatEnd(state, events);
  if (!isActive(state)) return;

  state.combat.turn++;
  state.combat.phase = 'player';
  for (const p of state.players) {
    tickCooldowns(p);
    p.turnUses = [];
  }
  events.push({ type: 'phaseChanged', phase: 'player', turn: state.combat.turn });
  emitTurn(eng, 'turnStart');
  settle(eng);
}

/** An enemy calls up more enemies on the cells it telegraphed (still free ones only; corpses are used up). */
function summonEnemies(eng: Engine, summoner: Enemy, unit: string, cells: readonly Vec2[]): void {
  const { state, events } = eng;
  for (const c of cells) {
    if (getCell(state.room.grid, c.x, c.y) !== 'floor' || unitAt(state, c.x, c.y)) continue;
    if (surfaceAt(state, c, 'corpse')) {
      state.surfaces = state.surfaces.filter((sf) => !(sf.id === 'corpse' && sf.x === c.x && sf.y === c.y));
      events.push({ type: 'surfaceRemoved', surface: 'corpse', at: c });
    }
    const target = state.players.find((p) => p.hp > 0) ?? summoner;
    const e = makeEnemy(`m${state.nextId++}`, unit, c, dirTowards(c, target), false);
    state.enemies.push(e);
    events.push({
      type: 'summoned',
      unitId: e.id,
      summon: unit,
      side: 'foes',
      owner: summoner.id,
      at: c,
      dir: e.dir,
      hp: e.hp,
    });
    emit(eng, 'summon', { actor: summoner, subject: e });
  }
}

/** Replays a command list from a fresh state. Used by tests and by bug reports (seed + commands). */
export function replay(initial: GameState, commands: readonly Command[]): GameState {
  let state = initial;
  for (const c of commands) state = apply(state, c).state;
  return state;
}

/**
 * What a command would do, without committing it: the same `apply` on the same state (GDD: preview is free
 * because the simulation is deterministic), trigger chains included. Covers the player's action only.
 */
export interface Preview {
  readonly events: readonly GameEvent[];
  /** Total damage per unit id, in event order (shield-absorbed points not included). */
  readonly damage: ReadonlyMap<string, number>;
  readonly deaths: ReadonlySet<string>;
  /** Cells each pushed unit passes through, per unit id. */
  readonly pushPaths: ReadonlyMap<string, readonly Vec2[]>;
  /** Statuses each unit would get. */
  readonly statuses: ReadonlyMap<string, readonly string[]>;
  /** Explosion cells. */
  readonly areas: readonly Vec2[];
  /** Where the player would end up, if the action moves them. */
  readonly playerTo: Vec2 | null;
  readonly freeAction: boolean;
  readonly rejected: RejectReason | null;
}

export function preview(state: GameState, command: Command): Preview {
  const all = apply(state, command).events;
  // Only the action itself: the world's answer is shown by the telegraphed intents instead.
  const cut = all.findIndex((e) => e.type === 'phaseChanged');
  const events = cut >= 0 ? all.slice(0, cut) : all;
  const damage = new Map<string, number>();
  const deaths = new Set<string>();
  const pushPaths = new Map<string, Vec2[]>();
  const statuses = new Map<string, string[]>();
  const areas: Vec2[] = [];
  let playerTo: Vec2 | null = null;
  let freeAction = false;
  let rejected: RejectReason | null = null;
  for (const e of events) {
    if (e.type === 'damaged') damage.set(e.unitId, (damage.get(e.unitId) ?? 0) + e.amount);
    else if (e.type === 'died') deaths.add(e.unitId);
    else if (e.type === 'pushed') pushPaths.set(e.unitId, [...(pushPaths.get(e.unitId) ?? []), e.to]);
    else if (e.type === 'statusApplied') statuses.set(e.unitId, [...(statuses.get(e.unitId) ?? []), e.status]);
    else if (e.type === 'area') areas.push(...e.cells);
    else if ((e.type === 'teleported' || e.type === 'moved' || e.type === 'swapped') && e.unitId === command.playerId)
      playerTo = e.to;
    else if (e.type === 'freeActionGained') freeAction = true;
    else if (e.type === 'rejected') rejected = e.reason;
  }
  return { events, damage, deaths, pushPaths, statuses, areas, playerTo, freeAction, rejected };
}
