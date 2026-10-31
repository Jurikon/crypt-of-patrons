import { createRng, float, fork, shuffle, weighted, type Rng } from '../core/rng';
import {
  ABILITY_SLOTS,
  ACT,
  CLASSES,
  DOOR_WEIGHTS,
  getAbility,
  getClass,
  getItem,
  getModifier,
  HYBRIDS,
  ITEMS,
  MODIFIERS,
  type EffectSpec,
  type RewardKind,
  type RuleDef,
} from '../content';
import type { GameEvent, RejectReason } from './commands';
import { gainRule, type Engine } from './engine';
import { playerRules, statOf } from './units';
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

/** Abilities of every class the hero has (start kits and pools) not owned yet. */
function newAbilities(p: Player): string[] {
  const ids = p.classes.flatMap((c) => [...getClass(c).abilities.slice(1), ...getClass(c).pool]);
  return [...new Set(ids)].filter((id) => !p.abilities.includes(id));
}

/** Abilities the hero has or can still be offered (pools of their classes). */
function reachableAbilities(p: Player): string[] {
  return [...new Set([...p.abilities, ...p.classes.flatMap((c) => [...getClass(c).abilities, ...getClass(c).pool])])];
}

/** Every effect the hero's abilities and rules can produce, nested ones included. */
function heroEffects(p: Player): EffectSpec[] {
  const out: EffectSpec[] = [];
  const walk = (effects: readonly EffectSpec[]) => {
    for (const e of effects) {
      out.push(e);
      if (e.kind === 'projectile') walk(e.onHit);
      if (e.kind === 'dash') walk(e.onImpact);
    }
  };
  for (const id of reachableAbilities(p)) walk(getAbility(id).effects);
  for (const r of playerRules(p)) {
    walk(r.onGain ?? []);
    for (const t of r.triggers) walk(t.effects);
  }
  return out;
}

/**
 * A modifier or item is worth offering only if it can do something for this hero: an ability with a
 * tag it needs (or a rule that summons, for summon rules), or a way to apply the status it feeds on.
 */
function fits(p: Player, rule: RuleDef): boolean {
  const effects = heroEffects(p);
  if (rule.requires) {
    const tags = new Set(reachableAbilities(p).flatMap((id) => getAbility(id).tags));
    if (effects.some((e) => e.kind === 'summon')) tags.add('summon');
    if (!rule.requires.some((t) => tags.has(t))) return false;
  }
  if (rule.requiresStatus && !effects.some((e) => e.kind === 'status' && e.status === rule.requiresStatus))
    return false;
  return true;
}

const newModifiers = (p: Player) => MODIFIERS.filter((m) => !p.modifiers.includes(m.id) && fits(p, m)).map((m) => m.id);
const newItems = (p: Player) => ITEMS.filter((i) => !p.items.includes(i.id) && fits(p, i)).map((i) => i.id);
const otherClasses = (p: Player) => CLASSES.map((c) => c.id).filter((id) => !p.classes.includes(id));

/**
 * Adds a class (Initiation): its passive, its abilities in future rewards, and a hybrid when two
 * classes make one.
 */
export function addClass(eng: Engine, p: Player, classId: string): void {
  if (p.classes.includes(classId)) return;
  p.classes.push(classId);
  for (const id of getClass(classId).passives) if (!p.passives.includes(id)) p.passives.push(id);
  const hybrid = HYBRIDS.find((h) => h.classes.every((c) => p.classes.includes(c)));
  if (hybrid && !p.hybrid) {
    p.hybrid = hybrid.id;
    eng.events.push({ type: 'hybridFormed', unitId: p.id, hybrid: hybrid.id });
    gainRule(eng, p, hybrid.rule.onGain);
  }
}

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
  if (reward === 'modifier') for (const id of shuffle(rng, newModifiers(p))) picks.push({ kind: 'modifier', id });
  if (reward === 'elite' || reward === 'treasure' || reward === 'boss')
    for (const id of shuffle(rng, newItems(p))) picks.push({ kind: 'item', id });
  if (reward === 'initiation') for (const id of shuffle(rng, otherClasses(p))) picks.push({ kind: 'class', id });
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
    // The warden falls: an item for the road ahead, then the act is won.
    run.offer = makeOffer(rngFor(state, 'reward'), p, 'boss').filter((o) => o.kind === 'item');
    if (run.offer.length > 0) {
      run.phase = 'reward';
      events.push({ type: 'rewardOffered', options: run.offer });
      return;
    }
    winRun(state, events);
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

function winRun(state: GameState, events: GameEvent[]): void {
  const run = state.run;
  if (!run) return;
  run.phase = 'won';
  run.log.push({ type: 'end', depth: run.depth, result: 'won' });
  events.push({ type: 'runEnded', result: 'won' });
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

/** Lights the exits: each gets a reward kind (different ones when possible); after the last room, one door to the boss. */
function openDoors(state: GameState, events: GameEvent[]): void {
  const run = state.run;
  const p = state.players[0];
  if (!run || !p) return;
  const exits = state.room.doors.map((d, i) => ({ d, i })).filter((x) => x.d.kind === 'exit');
  const rng = rngFor(state, 'doors');
  const doors: DoorOffer[] = [];
  if (run.depth >= ACT.rooms) {
    // One way on: a single door to the boss, the other exits stay shut.
    const first = exits[0];
    if (first) doors.push({ door: first.i, reward: 'boss' });
  } else {
    const available = DOOR_WEIGHTS.filter((w) => {
      if (w.kind === 'ability') return newAbilities(p).length > 0;
      if (w.kind === 'modifier') return newModifiers(p).length > 0;
      if (w.kind === 'elite')
        return run.elites < ACT.maxElites && run.depth >= 2 && run.kind !== 'elite' && newItems(p).length > 0;
      if (w.kind === 'treasure') return run.treasures < ACT.maxTreasures && run.depth >= 2 && newItems(p).length > 0;
      if (w.kind === 'rest') return run.depth >= 2 && run.kind !== 'rest';
      return true;
    });
    const used = new Set<RewardKind>();
    // Initiation shows up once per act, on one door, somewhere in rooms initiationFrom..initiationBy.
    const initiate =
      !run.initiation &&
      otherClasses(p).length > 0 &&
      run.depth >= ACT.initiationFrom &&
      (run.depth >= ACT.initiationBy || float(rng) < 0.5);
    for (const [n, x] of exits.entries()) {
      if (initiate && n === 0) {
        run.initiation = true;
        used.add('initiation');
        doors.push({ door: x.i, reward: 'initiation' });
        continue;
      }
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
export function chooseReward(eng: Engine, index: number | null, replace: number | undefined): RejectReason | null {
  const { state, events } = eng;
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
  } else if (option?.kind === 'modifier') {
    p.modifiers.push(option.id);
    gainRule(eng, p, getModifier(option.id).onGain);
  } else if (option?.kind === 'item') {
    p.items.push(option.id);
    gainRule(eng, p, getItem(option.id).onGain);
  } else if (option?.kind === 'class') addClass(eng, p, option.id);
  else if (option?.kind === 'upgrade')
    for (let i = 0; i <= statOf(state, p, 'upgradeBonus'); i++)
      p.upgrades.push({ abilityId: option.abilityId, kind: option.upgrade });
  run.log.push({ type: 'reward', depth: run.depth, option: option ?? null });
  run.offer = [];
  events.push({ type: 'rewardTaken', option: option ?? null });
  if (run.kind === 'boss') winRun(state, events);
  else openDoors(state, events);
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
  if (offer.reward === 'treasure') run.treasures++;
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
    p.ruleUses = [];
    if (kind === 'rest' && p.hp > 0) p.hp = Math.min(p.maxHp, p.hp + Math.ceil(p.maxHp * ACT.restHeal));
  }
  populateRoom(state, depth, kind);
  events.push({ type: 'roomEntered', depth, kind });
  // A rest room has nobody to fight: its doors open at once.
  if (state.combat.status === 'won') roomCleared(state, events);
}
