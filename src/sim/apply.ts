import { add, dirVec, getCell, isWalkable, rotateDir } from '../core/grid';
import { ABILITIES, getAbility } from '../content';
import { advanceEnemies, intentCells } from './ai';
import type { Command, GameEvent, MoveDir, RejectReason } from './commands';
import { runEffects } from './effects';
import { isPlayer, unitAt, type GameState, type Player } from './state';
import { checkCombatEnd, cooldownOf, dealDamage, kill, setCooldown, tickCooldowns } from './units';

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
 * Turn structure: a step or an ability takes one turn, and the world answers immediately (`worldTurn`).
 * Turning in place and bumping into a wall take no time.
 */
export function apply(prev: GameState, command: Command): ApplyResult {
  const state = structuredClone(prev);
  const events: GameEvent[] = [];
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
      const to = add(player, dirVec(rotateDir(player.dir, MOVE_ROTATION[command.dir])));
      const cell = getCell(state.room.grid, to.x, to.y);
      const occupant = unitAt(state, to.x, to.y);
      const baseAttack = player.abilities[0];
      if (command.dir === 'forward' && occupant && !isPlayer(state, occupant) && baseAttack && isActive(state)) {
        // Walking into an enemy attacks it with the base attack (classic roguelike bump-attack).
        const r = useAbility(state, player, baseAttack, events);
        if (r) return reject(r);
        worldTurn(state, events);
      } else if (isWalkable(cell) && !occupant) {
        const from = { x: player.x, y: player.y };
        player.x = to.x;
        player.y = to.y;
        events.push({ type: 'moved', unitId: player.id, from, to });
        if (isActive(state)) worldTurn(state, events);
      } else {
        // Bumping into a wall costs nothing.
        events.push({ type: 'bumped', unitId: player.id, at: to, cell });
      }
      break;
    }
    case 'useAbility': {
      if (!isActive(state)) return reject('combat_over');
      if (player.hp <= 0) return reject('dead');
      const r = useAbility(state, player, command.abilityId, events);
      if (r) return reject(r);
      worldTurn(state, events);
      break;
    }
    case 'debug': {
      events.push({ type: 'debug', action: command.action });
      if (command.action === 'heal') {
        player.hp = player.maxHp;
      } else if (command.action === 'toggleGod') {
        player.god = !player.god;
      } else if (command.action === 'killAll') {
        for (const e of [...state.enemies]) if (isActive(state)) kill(state, e, events);
      }
      break;
    }
    default: {
      const _exhaustive: never = command;
      return reject('unknown_command');
    }
  }
  return { state, events };
}

const isActive = (state: GameState) => state.combat.status === 'active';

/** Runs an ability's effects. Returns a reject reason instead if it cannot be used. */
function useAbility(state: GameState, player: Player, abilityId: string, events: GameEvent[]): RejectReason | null {
  if (!player.abilities.includes(abilityId) || !ABILITIES.some((a) => a.id === abilityId)) return 'unknown_ability';
  const ability = getAbility(abilityId);
  if (cooldownOf(player, ability.id) > 0) return 'on_cooldown';
  // +1 because the turn this ability is used on ticks once as the world answers.
  setCooldown(player, ability.id, ability.cooldown > 0 ? ability.cooldown + 1 : 0);
  const target = add(player, dirVec(player.dir));
  events.push({ type: 'abilityUsed', unitId: player.id, abilityId: ability.id, target, dir: player.dir });
  runEffects(state, ability.effects, { source: player, target, dir: player.dir }, events);
  return null;
}

/**
 * The world's answer to one player turn: enemies strike with the attacks they telegraphed, then move
 * and telegraph the next ones. Then the next player turn starts.
 */
function worldTurn(state: GameState, events: GameEvent[]): void {
  if (!isActive(state)) return;
  state.combat.phase = 'enemy';
  events.push({ type: 'phaseChanged', phase: 'enemy', turn: state.combat.turn });

  for (const id of state.enemies.map((e) => e.id)) {
    const e = state.enemies.find((x) => x.id === id);
    if (!e || !e.intent || !isActive(state)) continue;
    const intent = e.intent;
    const { cells, hit } = intentCells(state, e, intent);
    events.push({ type: 'enemyAttack', unitId: e.id, intent, cells });
    e.intent = null;
    if (hit) dealDamage(state, hit, intent.damage, 'attack', events);
  }
  if (!isActive(state)) return;

  advanceEnemies(state, events);
  checkCombatEnd(state, events);
  if (!isActive(state)) return;

  state.combat.turn++;
  state.combat.phase = 'player';
  for (const p of state.players) tickCooldowns(p);
  events.push({ type: 'phaseChanged', phase: 'player', turn: state.combat.turn });
}

/** Replays a command list from a fresh state. Used by tests and by bug reports (seed + commands). */
export function replay(initial: GameState, commands: readonly Command[]): GameState {
  let state = initial;
  for (const c of commands) state = apply(state, c).state;
  return state;
}

/**
 * What a command would do, without committing it: the same `apply` on the same state (GDD: preview is free
 * because the simulation is deterministic). Summarised per unit for the UI; covers the player's action only.
 */
export interface Preview {
  readonly events: readonly GameEvent[];
  /** Total damage per unit id, in event order. */
  readonly damage: ReadonlyMap<string, number>;
  readonly deaths: ReadonlySet<string>;
  /** Cells each pushed unit passes through, per unit id. */
  readonly pushPaths: ReadonlyMap<string, readonly { x: number; y: number }[]>;
  readonly rejected: RejectReason | null;
}

export function preview(state: GameState, command: Command): Preview {
  const all = apply(state, command).events;
  // Only the action itself: the world's answer is shown by the telegraphed intents instead.
  const cut = all.findIndex((e) => e.type === 'phaseChanged');
  const events = cut >= 0 ? all.slice(0, cut) : all;
  const damage = new Map<string, number>();
  const deaths = new Set<string>();
  const pushPaths = new Map<string, { x: number; y: number }[]>();
  let rejected: RejectReason | null = null;
  for (const e of events) {
    if (e.type === 'damaged') damage.set(e.unitId, (damage.get(e.unitId) ?? 0) + e.amount);
    else if (e.type === 'died') deaths.add(e.unitId);
    else if (e.type === 'pushed') pushPaths.set(e.unitId, [...(pushPaths.get(e.unitId) ?? []), e.to]);
    else if (e.type === 'rejected') rejected = e.reason;
  }
  return { events, damage, deaths, pushPaths, rejected };
}
