import {
  getEnemy,
  getGift,
  getHybrid,
  getItem,
  getModifier,
  getPassive,
  getStatus,
  type RuleDef,
  type StatId,
} from '../content';
import type { GameEvent } from './commands';
import { isPlayer, type GameState, type Player, type Unit } from './state';

/** Every rule a player carries, in a fixed order: passives, modifiers, items, the hybrid's feature, gifts. */
export function playerRules(p: Player): RuleDef[] {
  return [
    ...p.passives.map((id) => getPassive(id)),
    ...p.modifiers.map((id) => getModifier(id)),
    ...p.items.map((id) => getItem(id)),
    ...(p.hybrid ? [getHybrid(p.hybrid).rule] : []),
    ...p.gifts.map((id) => getGift(id)),
  ];
}

/** Sum of a stat over a unit's rules (players: passives, modifiers, items, hybrid) and its current statuses. */
export function statOf(state: GameState, unit: Unit | undefined, stat: StatId): number {
  if (!unit) return 0;
  let total = 0;
  const add = (mods: readonly { stat: StatId; add: number }[]) => {
    for (const m of mods) if (m.stat === stat) total += m.add;
  };
  if (isPlayer(state, unit)) for (const r of playerRules(unit)) add(r.stats);
  for (const s of unit.statuses) add(getStatus(s.id).stats);
  return total;
}

/**
 * Lost when every hero is down. Won by the room's goal (M6b): every fighter dead (things like sarcophagi
 * do not count), the totem or the leader broken; a survival room is won by the clock (`winCombat`).
 */
export function checkCombatEnd(state: GameState, events: GameEvent[]): void {
  if (state.combat.status !== 'active') return;
  if (state.players.every((p) => p.hp <= 0)) {
    state.combat.status = 'lost';
    events.push({ type: 'combatEnded', status: 'lost' });
    return;
  }
  const goal = state.combat.goal ?? 'clear';
  const target = state.combat.goalTarget;
  if (goal === 'totem' || goal === 'hunt') {
    if (target && !state.enemies.some((e) => e.id === target)) winCombat(state, events);
  } else if (goal !== 'survive' && !state.enemies.some((e) => !getEnemy(e.type).inert)) winCombat(state, events);
}

/** The fight is won: whoever is left runs off (the room is the heroes'). */
export function winCombat(state: GameState, events: GameEvent[]): void {
  if (state.combat.status !== 'active') return;
  for (const e of state.enemies) events.push({ type: 'fled', unitId: e.id });
  state.enemies = [];
  state.combat.status = 'won';
  events.push({ type: 'combatEnded', status: 'won' });
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
