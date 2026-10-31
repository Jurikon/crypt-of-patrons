import { createRng, fork, shuffle, weighted, type Rng } from '../core/rng';
import {
  ABILITY_SLOTS,
  ACT,
  DOOR_WEIGHTS,
  getAbility,
  getClass,
  MODIFIERS,
  type EffectSpec,
  type RewardKind,
} from '../content';
import type { GameEvent, RejectReason } from './commands';
import {
  populateRoom,
  roomFor,
  type DoorOffer,
  type GameState,
  type Player,
  type RewardOption,
  type RoomKind,
} from './state';

/**
 * The run around the fights (GDD 1): cleared room → reward (pick 1 of 3) → doors → next room, six rooms
 * and the boss. Pure and seeded like everything in sim: the same seed and commands replay a whole run.
 */

const rngFor = (state: GameState, name: string) => fork(createRng(state.seed), `${name}:${state.run?.depth ?? 0}`);

/** Ability ids of the player's class pool not owned yet. */
function newAbilities(p: Player): string[] {
  const cls = getClass(p.classId);
  return [...cls.abilities, ...cls.pool].filter((id) => !p.abilities.includes(id));
}

const newModifiers = (p: Player) => MODIFIERS.map((m) => m.id).filter((id) => !p.modifiers.includes(id));

/** Upgrades still worth offering: a cooldown above zero to cut, or damage to raise. */
function upgradeOptions(p: Player): RewardOption[] {
  const out: RewardOption[] = [];
  for (const id of p.abilities) {
    if (effectiveCooldown(p, id) > 0) out.push({ kind: 'upgrade', abilityId: id, upgrade: 'cooldown' });
    if (dealsDamage(getAbility(id).effects)) out.push({ kind: 'upgrade', abilityId: id, upgrade: 'damage' });
  }
  return out;
}

function dealsDamage(effects: readonly EffectSpec[]): boolean {
  return effects.some(
    (e) =>
      e.kind === 'damage' ||
      (e.kind === 'projectile' && dealsDamage(e.onHit)) ||
      (e.kind === 'dash' && dealsDamage(e.onImpact)),
  );
}

/** An ability's cooldown after the player's cooldown upgrades. */
export function effectiveCooldown(p: Player, abilityId: string): number {
  const cuts = p.upgrades.filter((u) => u.abilityId === abilityId && u.kind === 'cooldown').length;
  return Math.max(0, getAbility(abilityId).cooldown - cuts);
}

/** An ability's effects with the player's damage upgrades applied (every damage effect, nested ones too). */
export function upgradedEffects(p: Player, abilityId: string): readonly EffectSpec[] {
  const bonus = p.upgrades.filter((u) => u.abilityId === abilityId && u.kind === 'damage').length;
  const boost = (effects: readonly EffectSpec[]): EffectSpec[] =>
    effects.map((e) => {
      if (e.kind === 'damage') return { ...e, amount: e.amount + bonus };
      if (e.kind === 'projectile') return { ...e, onHit: boost(e.onHit) };
      if (e.kind === 'dash') return { ...e, onImpact: boost(e.onImpact) };
      return e;
    });
  return bonus > 0 ? boost(getAbility(abilityId).effects) : getAbility(abilityId).effects;
}

/** Up to ACT.offer options for a reward; missing abilities or modifiers are filled with upgrades. */
function makeOffer(rng: Rng, p: Player, reward: RewardKind): RewardOption[] {
  const picks: RewardOption[] = [];
  if (reward === 'ability') for (const id of shuffle(rng, newAbilities(p))) picks.push({ kind: 'ability', id });
  if (reward === 'modifier' || reward === 'elite')
    for (const id of shuffle(rng, newModifiers(p))) picks.push({ kind: 'modifier', id });
  const offer = picks.slice(0, ACT.offer);
  for (const u of shuffle(rng, upgradeOptions(p))) {
    if (offer.length >= ACT.offer) break;
    offer.push(u);
  }
  return offer;
}

/** A fight in a run room just ended in victory: offer the reward, or open the doors. */
export function roomCleared(state: GameState, events: GameEvent[]): void {
  const run = state.run;
  const p = state.players[0];
  if (!run || !p || run.phase !== 'combat') return;
  run.turns += state.combat.turn;
  if (run.kind !== 'rest') run.log.push({ type: 'cleared', depth: run.depth, turns: state.combat.turn });
  if (run.kind === 'boss') {
    run.phase = 'won';
    run.log.push({ type: 'end', depth: run.depth, result: 'won' });
    events.push({ type: 'runEnded', result: 'won' });
    return;
  }
  if (run.pending) {
    run.offer = makeOffer(rngFor(state, 'reward'), p, run.pending);
    run.pending = null;
    if (run.offer.length > 0) {
      run.phase = 'reward';
      events.push({ type: 'rewardOffered', options: run.offer });
      return;
    }
  }
  openDoors(state, events);
}

/** The player died: the run is over. */
export function runLost(state: GameState, events: GameEvent[]): void {
  const run = state.run;
  if (!run || run.phase === 'lost' || run.phase === 'won') return;
  run.turns += state.combat.turn;
  run.phase = 'lost';
  run.log.push({ type: 'end', depth: run.depth, result: 'lost' });
  events.push({ type: 'runEnded', result: 'lost' });
}

/** Lights the exits: each gets a reward kind (different ones when possible); after the last room, the boss. */
function openDoors(state: GameState, events: GameEvent[]): void {
  const run = state.run;
  const p = state.players[0];
  if (!run || !p) return;
  const exits = state.room.doors.map((d, i) => ({ d, i })).filter((x) => x.d.kind === 'exit');
  const rng = rngFor(state, 'doors');
  const doors: DoorOffer[] = [];
  if (run.depth >= ACT.rooms) {
    for (const x of exits) doors.push({ door: x.i, reward: 'boss' });
  } else {
    const available = DOOR_WEIGHTS.filter((w) => {
      if (w.kind === 'ability') return newAbilities(p).length > 0;
      if (w.kind === 'modifier') return newModifiers(p).length > 0;
      if (w.kind === 'elite') return run.elites < ACT.maxElites && run.depth >= 2 && run.kind !== 'elite';
      if (w.kind === 'rest') return run.depth >= 2 && run.kind !== 'rest';
      return true;
    });
    const used = new Set<RewardKind>();
    for (const x of exits) {
      const fresh = available.filter((w) => !used.has(w.kind));
      const pool = fresh.length ? fresh : available;
      const kind = pool.length
        ? weighted(
            rng,
            pool.map((w) => ({ item: w.kind, weight: w.weight })),
          )
        : 'upgrade';
      used.add(kind);
      doors.push({ door: x.i, reward: kind });
    }
  }
  run.doors = doors;
  run.phase = 'doors';
  events.push({ type: 'doorsOpened', doors });
}

/** Takes a reward option (or none), then opens the doors. */
export function chooseReward(
  state: GameState,
  index: number | null,
  replace: number | undefined,
  events: GameEvent[],
): RejectReason | null {
  const run = state.run;
  const p = state.players[0];
  if (!run || !p || run.phase !== 'reward') return 'no_reward';
  const option = index === null ? null : run.offer[index];
  if (index !== null && !option) return 'no_reward';
  if (option?.kind === 'ability') {
    if (p.abilities.length > ABILITY_SLOTS) {
      if (replace === undefined || replace < 1 || replace > ABILITY_SLOTS) return 'slot_needed';
      p.abilities[replace] = option.id;
    } else p.abilities.push(option.id);
  } else if (option?.kind === 'modifier') p.modifiers.push(option.id);
  else if (option?.kind === 'upgrade') p.upgrades.push({ abilityId: option.abilityId, kind: option.upgrade });
  run.log.push({ type: 'reward', depth: run.depth, option: option ?? null });
  run.offer = [];
  events.push({ type: 'rewardTaken', option: option ?? null });
  openDoors(state, events);
  return null;
}

/** Index of the offered door at a cell, or -1. */
export function doorAt(state: GameState, x: number, y: number): number {
  const run = state.run;
  if (!run || run.phase !== 'doors') return -1;
  return (
    run.doors.find((o) => {
      const d = state.room.doors[o.door];
      return d && d.x === x && d.y === y;
    })?.door ?? -1
  );
}

/** Walks through an offered door into the next room. */
export function enterDoor(state: GameState, door: number, events: GameEvent[]): void {
  const run = state.run;
  const offer = run?.doors.find((o) => o.door === door);
  if (!run || !offer) return;
  const kind: RoomKind =
    offer.reward === 'boss' ? 'boss' : offer.reward === 'rest' ? 'rest' : offer.reward === 'elite' ? 'elite' : 'combat';
  const pending: RewardKind | null = kind === 'combat' || kind === 'elite' ? offer.reward : null;
  enterRoom(state, run.depth + 1, kind, pending, events);
}

/**
 * Builds the room for `depth` and moves the players in: health, abilities, modifiers and upgrades carry
 * over; cooldowns, statuses and free actions reset; summons stay behind. Rest rooms heal.
 */
export function enterRoom(
  state: GameState,
  depth: number,
  kind: RoomKind,
  pending: RewardKind | null,
  events: GameEvent[],
): void {
  const run = state.run;
  if (!run) return;
  run.depth = depth;
  run.kind = kind;
  run.pending = pending;
  run.offer = [];
  run.doors = [];
  run.phase = 'combat';
  if (kind === 'elite') run.elites++;
  run.log.push({ type: 'room', depth, kind });
  state.room = roomFor(state.seed, depth, kind);
  for (const p of state.players) {
    p.x = state.room.spawn.x;
    p.y = state.room.spawn.y;
    p.dir = state.room.spawn.dir;
    p.cooldowns = [];
    p.statuses = [];
    p.freeActions = 0;
    if (kind === 'rest' && p.hp > 0) p.hp = Math.min(p.maxHp, p.hp + Math.ceil(p.maxHp * ACT.restHeal));
  }
  populateRoom(state, depth, kind);
  events.push({ type: 'roomEntered', depth, kind });
  // A rest room has nobody to fight: its doors open at once.
  if (state.combat.status === 'won') roomCleared(state, events);
}
