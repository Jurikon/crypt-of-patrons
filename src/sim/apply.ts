import { add, dirVec, getCell, isWalkable, rotateDir } from '../core/grid';
import { ABILITIES, getAbility } from '../content';
import { advanceEnemies, intentCells } from './ai';
import type { Command, GameEvent, MoveDir, RejectReason } from './commands';
import { runEffects } from './effects';
import { unitAt, type GameState, type Player } from './state';
import { checkCombatEnd, cooldownOf, dealDamage, kill, setCooldown, tickCooldowns } from './units';

export interface ApplyResult {
  readonly state: GameState;
  readonly events: readonly GameEvent[];
}

const MOVE_ROTATION: Record<MoveDir, number> = { forward: 0, right: 1, back: 2, left: 3 };
const MOVE_AP_COST = 1;

/**
 * The only way game state changes (CLAUDE.md rule 3).
 * Pure: the input state is never modified; a new state is returned with the events produced.
 * A rejected command returns the input state unchanged plus a `rejected` event.
 */
export function apply(prev: GameState, command: Command): ApplyResult {
  const state = structuredClone(prev);
  const events: GameEvent[] = [];
  const reject = (reason: RejectReason): ApplyResult => ({ state: prev, events: [{ type: 'rejected', reason }] });

  const player = state.players.find((p) => p.id === command.playerId);
  if (!player) return reject('unknown_player');
  const active = state.combat.status === 'active';

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
      if (active && player.ap < MOVE_AP_COST) return reject('not_enough_ap');
      const to = add(player, dirVec(rotateDir(player.dir, MOVE_ROTATION[command.dir])));
      const cell = getCell(state.room.grid, to.x, to.y);
      if (isWalkable(cell) && !unitAt(state, to.x, to.y)) {
        const from = { x: player.x, y: player.y };
        player.x = to.x;
        player.y = to.y;
        // Outside combat (won/lost) walking is free.
        if (active) player.ap -= MOVE_AP_COST;
        events.push({ type: 'moved', unitId: player.id, from, to });
      } else {
        // Bumping into something costs nothing.
        events.push({ type: 'bumped', unitId: player.id, at: to, cell });
      }
      break;
    }
    case 'useAbility': {
      if (!active) return reject('combat_over');
      if (player.hp <= 0) return reject('dead');
      if (!player.abilities.includes(command.abilityId) || !ABILITIES.some((a) => a.id === command.abilityId)) {
        return reject('unknown_ability');
      }
      const ability = getAbility(command.abilityId);
      if (cooldownOf(player, ability.id) > 0) return reject('on_cooldown');
      if (player.ap < ability.apCost) return reject('not_enough_ap');
      player.ap -= ability.apCost;
      player.attackedThisTurn = true;
      // Cooldown counts the player's own turns: 1 = unavailable on the next turn.
      setCooldown(player, ability.id, ability.cooldown + (ability.cooldown > 0 ? 1 : 0));
      const target = add(player, dirVec(player.dir));
      events.push({ type: 'abilityUsed', unitId: player.id, abilityId: ability.id, target, dir: player.dir });
      runEffects(state, ability.effects, { source: player, target, dir: player.dir }, events);
      break;
    }
    case 'endTurn': {
      if (!active) return reject('combat_over');
      runEnemyPhase(state, events);
      break;
    }
    case 'debug': {
      events.push({ type: 'debug', action: command.action });
      if (command.action === 'heal') {
        player.hp = player.maxHp;
      } else if (command.action === 'toggleGod') {
        player.god = !player.god;
      } else if (command.action === 'killAll') {
        for (const e of [...state.enemies]) if (state.combat.status === 'active') kill(state, e, events);
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

/** Enemies strike with last turn's intents, then move and telegraph; then a new player turn starts. */
function runEnemyPhase(state: GameState, events: GameEvent[]): void {
  state.combat.phase = 'enemy';
  events.push({ type: 'phaseChanged', phase: 'enemy', turn: state.combat.turn });

  for (const id of state.enemies.map((e) => e.id)) {
    const e = state.enemies.find((x) => x.id === id);
    if (!e || !e.intent || state.combat.status !== 'active') continue;
    const intent = e.intent;
    const { cells, hit } = intentCells(state, e, intent);
    events.push({ type: 'enemyAttack', unitId: e.id, intent, cells });
    e.intent = null;
    if (hit) dealDamage(state, hit, intent.damage, 'attack', events);
  }
  if (state.combat.status !== 'active') return;

  advanceEnemies(state, events);
  checkCombatEnd(state, events);
  if (state.combat.status !== 'active') return;

  state.combat.turn++;
  state.combat.phase = 'player';
  for (const p of state.players) startPlayerTurn(p);
  events.push({ type: 'phaseChanged', phase: 'player', turn: state.combat.turn });
}

function startPlayerTurn(p: Player): void {
  p.ap = p.maxAp;
  p.attackedThisTurn = false;
  tickCooldowns(p);
}

/** Replays a command list from a fresh state. Used by tests and by bug reports (seed + commands). */
export function replay(initial: GameState, commands: readonly Command[]): GameState {
  let state = initial;
  for (const c of commands) state = apply(state, c).state;
  return state;
}

/**
 * What a command would do, without committing it: the same `apply` on the same state (GDD: preview is free
 * because the simulation is deterministic). Summarised per unit for the UI.
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
  const { events } = apply(state, command);
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
