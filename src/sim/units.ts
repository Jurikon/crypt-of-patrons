import { getModifier, getPassive, getStatus, type StatId } from '../content';
import type { GameEvent } from './commands';
import { isPlayer, type GameState, type Player, type Unit } from './state';

/** Sum of a stat over a unit's rules (players: passives and modifiers) and its current statuses. */
export function statOf(state: GameState, unit: Unit | undefined, stat: StatId): number {
  if (!unit) return 0;
  let total = 0;
  const add = (mods: readonly { stat: StatId; add: number }[]) => {
    for (const m of mods) if (m.stat === stat) total += m.add;
  };
  if (isPlayer(state, unit)) {
    for (const id of unit.passives) add(getPassive(id).stats);
    for (const id of unit.modifiers) add(getModifier(id).stats);
  }
  for (const s of unit.statuses) add(getStatus(s.id).stats);
  return total;
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
