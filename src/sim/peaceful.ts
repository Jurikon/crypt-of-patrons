import { dirVec, floodFill, getCell, index, type Vec2 } from '../core/grid';
import { createRng, float, fork, int, shuffle, weighted, type Rng } from '../core/rng';
import { EVENTS, getEvent, getItem, getModifier, SHOP, type EventEffect, type RewardKind } from '../content';
import { declareIntentsInPlace } from './ai';
import type { GameEvent, RejectReason } from './commands';
import { makeEnemy } from './encounter';
import { applyStatus, gainRule, type Engine } from './engine';
import {
  biomeOf,
  unitAt,
  type GameState,
  type NextFight,
  type Player,
  type RewardOption,
  type ShopWare,
} from './state';
import { grantOption, makeOffer, newAbilities, newItems, newModifiers, openDoors, upgradeOptions } from './run';

/**
 * The peaceful rooms of a run (M6c): the merchant, who sells for gold, and events, a choice whose price
 * is in plain sight. Seeded like everything in sim.
 */

const rngFor = (state: GameState, name: string) =>
  fork(createRng(state.seed), `${name}:a${state.run?.act ?? 1}:${state.run?.depth ?? 0}`);

/**
 * The cell for the merchant or the event's object: the open floor nearest the middle, away from the
 * spawn, never right inside a door and never cutting the room in two (every door stays reachable).
 */
export function npcCell(state: GameState): Vec2 | null {
  const g = state.room.grid;
  const mid = { x: (g.w - 1) / 2, y: (g.h - 1) / 2 };
  const spawn = state.room.spawn;
  const inside = state.room.doors.map((d) => ({ x: d.x + dirVec(d.dir).x, y: d.y + dirVec(d.dir).y }));
  const candidates: { cell: Vec2; score: number }[] = [];
  for (let y = 1; y < g.h - 1; y++)
    for (let x = 1; x < g.w - 1; x++) {
      if (getCell(g, x, y) !== 'floor') continue;
      if (Math.abs(x - spawn.x) + Math.abs(y - spawn.y) < 2) continue;
      if (inside.some((c) => Math.abs(c.x - x) + Math.abs(c.y - y) <= 1)) continue;
      candidates.push({ cell: { x, y }, score: Math.abs(x - mid.x) + Math.abs(y - mid.y) });
    }
  candidates.sort((a, b) => a.score - b.score || a.cell.y - b.cell.y || a.cell.x - b.cell.x);
  const reach = floodFill(g, spawn, (t) => t === 'floor');
  for (const { cell } of candidates) {
    // Flood again with this cell taken out.
    const blocked = floodFillAvoiding(g, spawn, cell);
    const ok = inside.every((c) => !reach[index(g, c.x, c.y)] || blocked[index(g, c.x, c.y)]);
    if (ok) return cell;
  }
  return null;
}

function floodFillAvoiding(g: GameState['room']['grid'], start: Vec2, avoid: Vec2): boolean[] {
  const seen = new Array<boolean>(g.w * g.h).fill(false);
  const queue: Vec2[] = [start];
  seen[index(g, start.x, start.y)] = true;
  for (let i = 0; i < queue.length; i++) {
    const c = queue[i]!;
    for (const d of [0, 1, 2, 3] as const) {
      const v = dirVec(d);
      const n = { x: c.x + v.x, y: c.y + v.y };
      if (n.x < 0 || n.y < 0 || n.x >= g.w || n.y >= g.h) continue;
      if ((n.x === avoid.x && n.y === avoid.y) || seen[index(g, n.x, n.y)] || getCell(g, n.x, n.y) !== 'floor')
        continue;
      seen[index(g, n.x, n.y)] = true;
      queue.push(n);
    }
  }
  return seen;
}

/** What a ware costs. */
function priceOf(option: RewardOption): number {
  if (option.kind === 'ability') return SHOP.price.ability;
  if (option.kind === 'modifier') return SHOP.price.modifier;
  if (option.kind === 'item') return getItem(option.id).cursed ? SHOP.price.cursedItem : SHOP.price.item;
  return SHOP.price.modifier;
}

/** The merchant's table: abilities or modifiers, and items, that fit the hero; upgrades fill any gap. */
export function makeWares(rng: Rng, p: Player): ShopWare[] {
  const rules: RewardOption[] = shuffle(rng, [
    ...newAbilities(p).map((id) => ({ kind: 'ability' as const, id })),
    ...newModifiers(p).map((id) => ({ kind: 'modifier' as const, id })),
  ]).slice(0, SHOP.rules);
  const items: RewardOption[] = shuffle(rng, newItems(p))
    .slice(0, SHOP.items)
    .map((id) => ({ kind: 'item' as const, id }));
  const wares = [...rules, ...items];
  for (const u of shuffle(rng, upgradeOptions(p))) {
    if (wares.length >= SHOP.rules + SHOP.items) break;
    wares.push(u);
  }
  return wares.map((option) => ({ option, price: priceOf(option), sold: false }));
}

/** Sets up a merchant room: the table and where the merchant stands. */
export function openShop(state: GameState): void {
  const run = state.run;
  const p = state.players[0];
  if (!run || !p) return;
  run.npc = npcCell(state);
  run.shop = { wares: makeWares(rngFor(state, 'shop'), p), rerolls: 0 };
}

const inShop = (state: GameState) => !!state.run?.shop && state.run.phase === 'doors';

/** Buys a ware: paid in gold, taken like a reward (a new ability with full slots needs `replace`). */
export function buy(eng: Engine, index: number, replace: number | undefined): RejectReason | null {
  const { state, events } = eng;
  const run = state.run;
  const p = state.players[0];
  if (!run?.shop || !p || !inShop(state)) return 'no_shop';
  const ware = run.shop.wares[index];
  if (!ware || ware.sold) return 'no_shop';
  if (run.gold < ware.price) return 'no_gold';
  const r = grantOption(eng, p, ware.option, replace);
  if (r) return r;
  run.gold -= ware.price;
  ware.sold = true;
  run.log.push({ type: 'bought', depth: run.depth, what: wareName(ware.option), price: ware.price });
  events.push({ type: 'bought', option: ware.option, price: ware.price, gold: run.gold });
  return null;
}

const wareName = (o: RewardOption) =>
  o.kind === 'upgrade' ? `upgrade:${o.abilityId}:${o.upgrade}` : `${o.kind}:${o.id}`;

/** Items the merchant can take off: cursed, and with nothing gained on pick-up that would linger. */
export function removableCurses(p: Player): string[] {
  return p.items.filter((id) => {
    const item = getItem(id);
    return item.cursed === true && !item.onGain?.length;
  });
}

/** The merchant's services: healing, taking off a cursed item, new wares. */
export function shopService(
  eng: Engine,
  service: 'heal' | 'uncurse' | 'reroll',
  itemId: string | undefined,
): RejectReason | null {
  const { state, events } = eng;
  const run = state.run;
  const p = state.players[0];
  if (!run?.shop || !p || !inShop(state)) return 'no_shop';
  const price = service === 'heal' ? SHOP.heal.price : service === 'uncurse' ? SHOP.uncurse : SHOP.reroll;
  if (run.gold < price) return 'no_gold';
  if (service === 'heal') {
    if (p.hp >= p.maxHp) return 'no_shop';
    const before = p.hp;
    p.hp = Math.min(p.maxHp, p.hp + Math.ceil(p.maxHp * SHOP.heal.share));
    events.push({ type: 'healed', unitId: p.id, amount: p.hp - before, hp: p.hp });
  } else if (service === 'uncurse') {
    if (!itemId || !removableCurses(p).includes(itemId)) return 'no_shop';
    p.items = p.items.filter((id) => id !== itemId);
  } else {
    run.shop.rerolls++;
    run.shop.wares = makeWares(fork(rngFor(state, 'shop'), `reroll${run.shop.rerolls}`), p);
  }
  run.gold -= price;
  run.log.push({ type: 'bought', depth: run.depth, what: service, price });
  events.push({ type: 'shopService', service, price, gold: run.gold });
  return null;
}

/** An event for a door: one this biome allows that the run has not met yet. */
export function pickEvent(rng: Rng, state: GameState): string | null {
  const run = state.run;
  if (!run) return null;
  if (run.forceEvent) return run.forceEvent;
  const biome = biomeOf(state).id;
  const open = EVENTS.filter((e) => (!e.biomes || e.biomes.includes(biome)) && !run.seenEvents.includes(e.id));
  return open.length ? (open[Math.floor(float(rng) * open.length)] ?? open[0]!).id : null;
}

/** Sets up an event room: the event and where its object stands; doors open once the choice is made. */
export function openEvent(state: GameState, eventId: string): void {
  const run = state.run;
  if (!run) return;
  run.npc = npcCell(state);
  run.event = eventId;
  run.seenEvents.push(eventId);
  run.phase = 'event';
}

/** Whether the hero can pay for an event option. */
export function canAfford(
  state: GameState,
  p: Player,
  cost: { readonly gold?: number; readonly hp?: number } = {},
): boolean {
  return (state.run?.gold ?? 0) >= (cost.gold ?? 0) && p.hp > (cost.hp ?? 0);
}

/** Makes an event choice: pays its price, draws its outcome, then opens the doors (or a reward, or a fight). */
export function chooseEvent(eng: Engine, index: number): RejectReason | null {
  const { state, events } = eng;
  const run = state.run;
  const p = state.players[0];
  if (!run || !p || run.phase !== 'event' || !run.event) return 'no_event';
  const def = getEvent(run.event);
  const option = def.options[index];
  if (!option) return 'no_event';
  if (!canAfford(state, p, option.cost)) return 'no_gold';
  run.gold -= option.cost?.gold ?? 0;
  if (option.cost?.hp) p.hp -= option.cost.hp;
  const rng = rngFor(state, `event:${def.id}`);
  const outcome = weighted(
    rng,
    option.outcomes.map((o, i) => ({ item: i, weight: o.weight })),
  );
  run.log.push({ type: 'event', depth: run.depth, event: def.id, option: index });
  events.push({ type: 'eventChosen', event: def.id, option: index, outcome, gold: run.gold, hp: p.hp });
  run.event = null;
  let next: 'doors' | 'reward' | 'fight' = 'doors';
  for (const effect of option.outcomes[outcome]?.effects ?? []) {
    const r = runEventEffect(eng, p, effect, rng);
    if (r !== 'doors') next = r;
  }
  if (next === 'doors') openDoors(state, events);
  return null;
}

function runEventEffect(eng: Engine, p: Player, effect: EventEffect, rng: Rng): 'doors' | 'reward' | 'fight' {
  const { state, events } = eng;
  const run = state.run!;
  switch (effect.kind) {
    case 'gold':
      run.gold = Math.max(0, run.gold + effect.add);
      return 'doors';
    case 'hp': {
      const before = p.hp;
      p.hp = Math.max(1, Math.min(p.maxHp, p.hp + effect.add));
      if (p.hp > before) events.push({ type: 'healed', unitId: p.id, amount: p.hp - before, hp: p.hp });
      return 'doors';
    }
    case 'maxHp':
      p.maxHp += effect.add;
      p.hp += effect.add;
      return 'doors';
    case 'reward':
      return offerReward(state, p, effect.reward, events, rng);
    case 'swapModifier': {
      const held = p.modifiers;
      const fresh = shuffle(rng, newModifiers(p))[0];
      if (!held.length || !fresh) return 'doors';
      const lost = held[int(rng, 0, held.length - 1)]!;
      p.modifiers = held.filter((m) => m !== lost);
      p.modifiers.push(fresh);
      gainRule(eng, p, getModifier(fresh).onGain);
      return 'doors';
    }
    case 'sacrifice': {
      const own = p.abilities.slice(1);
      if (!own.length) return 'doors';
      const lost = own[int(rng, 0, own.length - 1)]!;
      p.abilities = p.abilities.filter((a) => a !== lost);
      p.upgrades = p.upgrades.filter((u) => u.abilityId !== lost);
      for (let i = 0; i < effect.upgrades; i++) {
        const u = shuffle(rng, upgradeOptions(p))[0];
        if (u?.kind === 'upgrade') p.upgrades.push({ abilityId: u.abilityId, kind: u.upgrade });
      }
      return 'doors';
    }
    case 'nextFight': {
      const { kind: _, ...mods } = effect;
      run.nextFight = mergeNext(run.nextFight, mods);
      return 'doors';
    }
    case 'fight': {
      const at = run.npc ?? state.room.spawn;
      run.npc = null;
      const hero = state.players[0]!;
      const dir = Math.abs(hero.x - at.x) > Math.abs(hero.y - at.y) ? (hero.x > at.x ? 1 : 3) : hero.y > at.y ? 2 : 0;
      const foe = makeEnemy(`m${state.nextId++}`, effect.enemy, at, dir, effect.elite === true);
      state.enemies.push(foe);
      state.combat = { turn: 1, phase: 'player', status: 'active' };
      run.phase = 'combat';
      declareIntentsInPlace(state);
      events.push({
        type: 'summoned',
        unitId: foe.id,
        summon: effect.enemy,
        side: 'foes',
        owner: foe.id,
        at,
        dir,
        hp: foe.hp,
      });
      return 'fight';
    }
  }
}

function mergeNext(a: NextFight | null, b: NextFight): NextFight {
  return { ...(a ?? {}), ...b };
}

function offerReward(
  state: GameState,
  p: Player,
  reward: RewardKind,
  events: GameEvent[],
  rng: Rng,
): 'doors' | 'reward' {
  const run = state.run!;
  const offer = makeOffer(rng, p, reward);
  if (!offer.length) return 'doors';
  run.offerKind = reward;
  run.offer = offer;
  run.phase = 'reward';
  events.push({ type: 'rewardOffered', options: offer });
  return 'reward';
}

/** The next fight starts as an event promised: statuses on the heroes, stunned or extra enemies. */
export function applyNextFight(eng: Engine): void {
  const { state, events } = eng;
  const run = state.run;
  const mods = run?.nextFight;
  if (!run || !mods || !state.enemies.length) return;
  run.nextFight = null;
  if (mods.extraEnemies) {
    const rng = rngFor(state, 'extra');
    const biome = biomeOf(state);
    const g = state.room.grid;
    const free: Vec2[] = [];
    for (let y = 0; y < g.h; y++)
      for (let x = 0; x < g.w; x++)
        if (
          getCell(g, x, y) === 'floor' &&
          !unitAt(state, x, y) &&
          state.players.every((p) => Math.abs(p.x - x) + Math.abs(p.y - y) >= 4)
        )
          free.push({ x, y });
    for (const cell of shuffle(rng, free).slice(0, mods.extraEnemies)) {
      const type = weighted(
        rng,
        biome.enemies.map((x) => ({ item: x.id, weight: x.weight })),
      );
      state.enemies.push(makeEnemy(`m${state.nextId++}`, type, cell, 2, false));
    }
  }
  if (mods.stunEnemies) for (const e of state.enemies) applyStatus(eng, e, 'stun', mods.stunEnemies, 0, 'event');
  if (mods.status) for (const p of state.players) applyStatus(eng, p, mods.status.id, mods.status.turns, 1, 'event');
  declareIntentsInPlace(state);
  events.push({ type: 'nextFightApplied' });
}
