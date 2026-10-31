import { getPassive, type StatId } from '../content';
import type { GameEvent } from './commands';
import { isPlayer, type GameState, type Player, type Unit } from './state';

/** Sum of a stat over a player's passives (later: items, gifts). Non-players have no stats yet. */
export function statOf(state: GameState, unit: Unit | undefined, stat: StatId): number {
  if (!unit || !isPlayer(state, unit)) return 0;
  let total = 0;
  for (const id of unit.passives) for (const s of getPassive(id).stats) if (s.stat === stat) total += s.add;
  return total;
}

/** Applies damage, emits events, removes dead enemies and ends the combat when one side is gone. */
export function dealDamage(
  state: GameState,
  unit: Unit,
  amount: number,
  cause: 'attack' | 'collision',
  events: GameEvent[],
): void {
  if (unit.hp <= 0) return;
  const player = isPlayer(state, unit);
  const dealt = player && unit.god ? 0 : Math.max(0, amount);
  unit.hp = Math.max(0, unit.hp - dealt);
  events.push({ type: 'damaged', unitId: unit.id, amount: dealt, hp: unit.hp, cause });
  if (unit.hp <= 0) kill(state, unit, events);
}

/** Removes a unit from play (enemies leave the array; players stay with hp 0). */
export function kill(state: GameState, unit: Unit, events: GameEvent[]): void {
  unit.hp = 0;
  events.push({ type: 'died', unitId: unit.id });
  const i = state.enemies.indexOf(unit as never);
  if (i >= 0) state.enemies.splice(i, 1);
  checkCombatEnd(state, events);
}

export function checkCombatEnd(state: GameState, events: GameEvent[]): void {
  if (state.combat.status !== 'active') return;
  if (state.players.every((p) => p.hp <= 0)) {
    state.combat.status = 'lost';
    events.push({ type: 'combatEnded', status: 'lost' });
  } else if (state.enemies.length === 0) {
    state.combat.status = 'won';
    events.push({ type: 'combatEnded', status: 'won' });
  }
}

export function cooldownOf(player: Player, abilityId: string): number {
  return player.cooldowns.find((c) => c.abilityId === abilityId)?.turns ?? 0;
}

export function setCooldown(player: Player, abilityId: string, turns: number): void {
  player.cooldowns = player.cooldowns.filter((c) => c.abilityId !== abilityId);
  if (turns > 0) player.cooldowns.push({ abilityId, turns });
}

export function tickCooldowns(player: Player): void {
  for (const c of player.cooldowns) c.turns--;
  player.cooldowns = player.cooldowns.filter((c) => c.turns > 0);
}
