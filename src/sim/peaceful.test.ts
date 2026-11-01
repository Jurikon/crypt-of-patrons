import { describe, expect, it } from 'vitest';
import { dirVec, type Dir } from '../core/grid';
import { ACT, EVENTS, getEvent, SHOP } from '../content';
import { apply } from './apply';
import type { Command, GameEvent } from './commands';
import { enterRoom } from './run';
import { migrateState } from './save';
import { createGame, type GameState } from './state';

const P = 'p1';
const killAll: Command = { type: 'debug', playerId: P, action: 'killAll' };
const skip: Command = { type: 'chooseReward', playerId: P, index: null };
const forward: Command = { type: 'move', playerId: P, dir: 'forward' };
const of = (events: readonly GameEvent[], type: GameEvent['type']) => events.filter((e) => e.type === type);

function clearRoom(state: GameState): GameState {
  let s = apply(state, killAll).state;
  if (s.run?.phase === 'reward') s = apply(s, skip).state;
  return s;
}

function walkThrough(state: GameState, offer = 0): ReturnType<typeof apply> {
  const s = structuredClone(state);
  const door = s.room.doors[s.run!.doors[offer]!.door]!;
  const inner = dirVec(door.dir);
  const p = s.players[0]!;
  p.x = door.x + inner.x;
  p.y = door.y + inner.y;
  p.dir = ((door.dir + 2) % 4) as Dir;
  return apply(s, forward);
}

/** A run standing in a fresh merchant room (room 2 of act 1). */
function merchantRoom(seed = 5, gold = 100): GameState {
  const s = structuredClone(createGame(seed, { classId: 'knight' }));
  s.run!.gold = gold;
  enterRoom(s, 2, 'merchant', null, []);
  return s;
}

/** A run standing in an event room. */
function eventRoom(eventId: string, seed = 5, gold = 100, act = 1): GameState {
  const s = structuredClone(createGame(seed, { classId: 'knight' }));
  s.run!.gold = gold;
  s.run!.act = act;
  enterRoom(s, 2, 'event', null, [], 'clear', eventId);
  return s;
}

describe('gold (M6c)', () => {
  it('every won fight drops gold in the room range, shown as an event', () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const r = apply(createGame(seed), killAll);
      const gain = of(r.events, 'goldGained')[0] as Extract<GameEvent, { type: 'goldGained' }>;
      expect(gain.amount).toBeGreaterThanOrEqual(ACT.gold.room[0]);
      expect(gain.amount).toBeLessThanOrEqual(ACT.gold.room[1]);
      expect(r.state.run!.gold).toBe(gain.amount);
    }
  });

  it('elite rooms drop more, bosses most', () => {
    const elite = structuredClone(createGame(3));
    enterRoom(elite, 2, 'elite', 'elite', []);
    const e = apply(elite, killAll).state.run!.gold;
    expect(e).toBeGreaterThanOrEqual(ACT.gold.room[0] + ACT.gold.elite);
    const boss = structuredClone(createGame(3));
    enterRoom(boss, ACT.rooms + 1, 'boss', null, []);
    expect(apply(boss, killAll).state.run!.gold).toBeGreaterThanOrEqual(ACT.gold.room[0] + ACT.gold.boss);
  });

  it('a gold door pays a pouch instead of a reward screen', () => {
    const s = structuredClone(createGame(4));
    enterRoom(s, 2, 'combat', 'gold', []);
    const r = apply(s, killAll);
    expect(r.state.run!.phase).toBe('doors');
    const gains = of(r.events, 'goldGained') as Extract<GameEvent, { type: 'goldGained' }>[];
    expect(gains).toHaveLength(2);
    expect(gains[1]!.amount).toBeGreaterThanOrEqual(ACT.gold.door[0]);
    expect(gains[1]!.amount).toBeLessThanOrEqual(ACT.gold.door[1]);
  });

  it('rest rooms drop nothing', () => {
    const s = structuredClone(createGame(4));
    enterRoom(s, 2, 'rest', null, []);
    expect(s.run!.gold).toBe(0);
  });
});

describe('merchant (M6c)', () => {
  it('opens with doors already open, wares priced, and a merchant standing in the room', () => {
    const s = merchantRoom();
    expect(s.run!.phase).toBe('doors');
    expect(s.run!.shop!.wares).toHaveLength(SHOP.rules + SHOP.items);
    expect(s.run!.npc).not.toBeNull();
    for (const w of s.run!.shop!.wares) expect(w.price).toBeGreaterThan(0);
  });

  it('the same seed lays out the same wares', () => {
    expect(merchantRoom(9).run!.shop).toEqual(merchantRoom(9).run!.shop);
  });

  it('buying takes the gold and gives the ware; it cannot be bought twice', () => {
    const s = merchantRoom();
    const index = s.run!.shop!.wares.findIndex((w) => w.option.kind === 'item');
    const ware = s.run!.shop!.wares[index]!;
    const r = apply(s, { type: 'buy', playerId: P, index });
    expect(r.state.run!.gold).toBe(100 - ware.price);
    expect(r.state.players[0]!.items).toContain((ware.option as { id: string }).id);
    expect(r.state.run!.shop!.wares[index]!.sold).toBe(true);
    expect(of(apply(r.state, { type: 'buy', playerId: P, index }).events, 'rejected')).toHaveLength(1);
  });

  it('without enough gold nothing is sold', () => {
    const s = merchantRoom(5, 3);
    const r = apply(s, { type: 'buy', playerId: P, index: 0 });
    expect(r.events).toEqual([{ type: 'rejected', reason: 'no_gold' }]);
  });

  it('heals half the health for its price, only when hurt', () => {
    const s = merchantRoom();
    expect(of(apply(s, { type: 'shopService', playerId: P, service: 'heal' }).events, 'rejected')).toHaveLength(1);
    s.players[0]!.hp = 2;
    const r = apply(s, { type: 'shopService', playerId: P, service: 'heal' });
    expect(r.state.players[0]!.hp).toBe(2 + Math.ceil(s.players[0]!.maxHp * SHOP.heal.share));
    expect(r.state.run!.gold).toBe(100 - SHOP.heal.price);
  });

  it('takes off a cursed item for its price', () => {
    const s = merchantRoom();
    s.players[0]!.items.push('item.oath');
    const r = apply(s, { type: 'shopService', playerId: P, service: 'uncurse', itemId: 'item.oath' });
    if (r.events[0]?.type === 'rejected') {
      // Not every item is cursed or removable; then a clean item is refused as well.
      expect(apply(s, { type: 'shopService', playerId: P, service: 'uncurse', itemId: 'nope' }).events[0]!.type).toBe(
        'rejected',
      );
      return;
    }
    expect(r.state.players[0]!.items).not.toContain('item.oath');
    expect(r.state.run!.gold).toBe(100 - SHOP.uncurse);
  });

  it('rerolls the wares for its price', () => {
    const s = merchantRoom();
    const r = apply(s, { type: 'shopService', playerId: P, service: 'reroll' });
    expect(r.state.run!.gold).toBe(100 - SHOP.reroll);
    expect(r.state.run!.shop!.rerolls).toBe(1);
  });

  it('nobody walks through the merchant: bumping into him is an event for the UI', () => {
    const s = merchantRoom();
    const npc = s.run!.npc!;
    const p = s.players[0]!;
    // Stand next to him, facing him.
    for (const d of [0, 1, 2, 3] as const) {
      const v = dirVec(d);
      const x = npc.x - v.x;
      const y = npc.y - v.y;
      if (s.room.grid.cells[y * s.room.grid.w + x] !== 'floor') continue;
      p.x = x;
      p.y = y;
      p.dir = d as Dir;
      break;
    }
    const r = apply(s, forward);
    expect(of(r.events, 'npcBumped')).toHaveLength(1);
    expect(r.state.players[0]!.x).toBe(p.x);
  });

  it('shows up on a door once per act, into rooms 2–4', () => {
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
      let s = createGame(seed);
      let seen = 0;
      for (let depth = 1; depth < ACT.rooms; depth++) {
        s = clearRoom(s);
        if (!s.run!.doors.length) break;
        const m = s.run!.doors.findIndex((d) => d.reward === 'merchant');
        if (m >= 0) {
          seen++;
          expect(depth + 1).toBeGreaterThanOrEqual(ACT.merchantFrom);
          expect(depth + 1).toBeLessThanOrEqual(ACT.merchantBy);
        }
        // Go on through a fighting door to keep counting.
        const fight = s.run!.doors.findIndex(
          (d) => d.reward !== 'merchant' && d.reward !== 'event' && d.reward !== 'rest',
        );
        s = walkThrough(s, Math.max(0, fight)).state;
        if (s.run!.phase === 'event')
          s = apply(s, { type: 'eventChoice', playerId: P, index: getEvent(s.run!.event!).options.length - 1 }).state;
      }
      expect(seen).toBeLessThanOrEqual(1);
    }
  });

  it('debug: the next doors include a merchant', () => {
    let s = createGame(2);
    s = apply(s, { type: 'debug', playerId: P, action: 'merchantNext' }).state;
    s = clearRoom(s);
    expect(s.run!.doors.some((d) => d.reward === 'merchant')).toBe(true);
    const i = s.run!.doors.findIndex((d) => d.reward === 'merchant');
    expect(walkThrough(s, i).state.run!.kind).toBe('merchant');
  });
});

describe('events (M6c)', () => {
  it('every event has a walk-away option last and its prop', () => {
    for (const e of EVENTS) {
      expect(e.options[e.options.length - 1]!.textKey).toBe('event.leave');
      expect(e.prop.length).toBeGreaterThan(0);
    }
  });

  it('an event room waits for the choice; walking away opens the doors', () => {
    const s = eventRoom('mirror');
    expect(s.run!.phase).toBe('event');
    expect(s.run!.doors).toHaveLength(0);
    const r = apply(s, { type: 'eventChoice', playerId: P, index: 1 });
    expect(r.state.run!.phase).toBe('doors');
  });

  it('Well of Blood: −4 health, then a pick of items', () => {
    const s = eventRoom('bloodWell');
    const r = apply(s, { type: 'eventChoice', playerId: P, index: 0 });
    expect(r.state.players[0]!.hp).toBe(s.players[0]!.hp - 4);
    expect(r.state.run!.phase).toBe('reward');
    expect(r.state.run!.offer.every((o) => o.kind === 'item' || o.kind === 'upgrade')).toBe(true);
    // Too hurt to pay: the option is refused.
    s.players[0]!.hp = 4;
    expect(apply(s, { type: 'eventChoice', playerId: P, index: 0 }).events[0]).toEqual({
      type: 'rejected',
      reason: 'no_gold',
    });
  });

  it('Sleeping Sarcophagus: either a pick of items or an elite skeleton rising where it stood', () => {
    const outcomes = new Set<string>();
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]) {
      const s = eventRoom('sleepingSarcophagus', seed);
      const npc = s.run!.npc!;
      const r = apply(s, { type: 'eventChoice', playerId: P, index: 0 });
      if (r.state.run!.phase === 'combat') {
        outcomes.add('fight');
        const e = r.state.enemies[0]!;
        expect([e.x, e.y]).toEqual([npc.x, npc.y]);
        expect(e.elite).toBe(true);
        // Winning the fight opens the doors.
        expect(apply(r.state, killAll).state.run!.phase).toBe('doors');
      } else {
        outcomes.add(r.state.run!.phase);
      }
    }
    expect(outcomes).toEqual(new Set(['fight', 'reward']));
  });

  it("Dead Men's Dice: costs 10 gold and pays 25 or nothing", () => {
    const results = new Set<number>();
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
      const r = apply(eventRoom('deadMensDice', seed, 20), { type: 'eventChoice', playerId: P, index: 0 });
      results.add(r.state.run!.gold);
    }
    expect(results).toEqual(new Set([10, 35]));
    expect(apply(eventRoom('deadMensDice', 1, 5), { type: 'eventChoice', playerId: P, index: 0 }).events[0]!.type).toBe(
      'rejected',
    );
  });

  it('Wounded Pilgrim: give 10 gold for +3 max health, or rob him and face an elite fight next', () => {
    const s = eventRoom('woundedPilgrim');
    const give = apply(s, { type: 'eventChoice', playerId: P, index: 0 }).state;
    expect(give.run!.gold).toBe(90);
    expect(give.players[0]!.maxHp).toBe(s.players[0]!.maxHp + 3);
    const rob = apply(s, { type: 'eventChoice', playerId: P, index: 1 }).state;
    expect(rob.run!.gold).toBe(115);
    expect(rob.run!.nextFight).toEqual({ elite: true });
    const fight = rob.run!.doors.findIndex((d) => !['merchant', 'event', 'rest', 'boss'].includes(d.reward));
    if (fight >= 0) expect(walkThrough(rob, fight).state.run!.kind).toBe('elite');
  });

  it('Mycelium: heals 6, and the next fight starts Poisoned', () => {
    const s = eventRoom('mycelium', 5, 0, 2);
    s.players[0]!.hp = 5;
    const r = apply(s, { type: 'eventChoice', playerId: P, index: 0 }).state;
    expect(r.players[0]!.hp).toBe(11);
    const fight = r.run!.doors.findIndex((d) => !['merchant', 'event', 'rest', 'boss'].includes(d.reward));
    const next = walkThrough(r, Math.max(0, fight)).state;
    if (next.run!.kind === 'combat' || next.run!.kind === 'elite') {
      expect(next.players[0]!.statuses.some((x) => x.id === 'poison')).toBe(true);
      expect(next.run!.nextFight).toBeNull();
    }
  });

  it('Black Mirror: one modifier swapped for a new one', () => {
    const s = eventRoom('mirror');
    s.players[0]!.modifiers = ['mod.longPush'];
    const r = apply(s, { type: 'eventChoice', playerId: P, index: 0 }).state;
    expect(r.players[0]!.modifiers).toHaveLength(1);
    expect(r.players[0]!.modifiers[0]).not.toBe('mod.longPush');
  });

  it('Cracked Bell: the next fight has one more enemy and every enemy is stunned', () => {
    const base = structuredClone(createGame(5));
    base.run!.act = 3;
    enterRoom(base, 3, 'combat', 'ability', []);
    const plain = base.enemies.length;
    const s = eventRoom('bell', 5, 0, 3);
    const r = apply(s, { type: 'eventChoice', playerId: P, index: 0 }).state;
    expect(r.run!.nextFight).toEqual({ stunEnemies: 1, extraEnemies: 1 });
    r.run!.nextFight = { stunEnemies: 1, extraEnemies: 1 };
    enterRoom(r, 3, 'combat', 'ability', []);
    expect(r.enemies.length).toBe(plain + 1);
    for (const e of r.enemies) expect(e.statuses.some((x) => x.id === 'stun')).toBe(true);
  });

  it('Altar of Bargains: one ability given up, two upgrades for the rest', () => {
    const s = eventRoom('bargainAltar');
    const before = s.players[0]!.abilities.length;
    const r = apply(s, { type: 'eventChoice', playerId: P, index: 0 }).state;
    expect(r.players[0]!.abilities.length).toBe(before - 1);
    expect(r.players[0]!.abilities[0]).toBe(s.players[0]!.abilities[0]);
    expect(r.players[0]!.upgrades.length).toBe(2);
  });

  it('biome events only show up in their biome, and none repeats in a run', () => {
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      let s = createGame(seed);
      const met: string[] = [];
      for (let depth = 1; depth < ACT.rooms; depth++) {
        s = clearRoom(s);
        // A "survive" room is not won by killing everyone: stop this walk there.
        if (!s.run!.doors.length) break;
        for (const d of s.run!.doors.filter((x) => x.reward === 'event')) {
          const def = getEvent(d.event!);
          if (def.biomes) expect(def.biomes).toContain('crypt');
          expect(met).not.toContain(d.event);
        }
        const e = s.run!.doors.findIndex((d) => d.reward === 'event');
        s = walkThrough(s, Math.max(0, e)).state;
        if (s.run!.phase === 'event') {
          met.push(s.run!.event!);
          s = apply(s, { type: 'eventChoice', playerId: P, index: getEvent(s.run!.event!).options.length - 1 }).state;
        }
        if (s.run!.phase === 'reward') s = apply(s, skip).state;
      }
    }
  });

  it('debug: the next doors include the chosen event', () => {
    let s = createGame(3);
    s = apply(s, { type: 'debugEvent', playerId: P, eventId: 'deadMensDice' }).state;
    s = clearRoom(s);
    expect(s.run!.doors.find((d) => d.reward === 'event')?.event).toBe('deadMensDice');
  });

  it('an event room replays the same from the same seed and commands', () => {
    const a = apply(eventRoom('sleepingSarcophagus', 4), { type: 'eventChoice', playerId: P, index: 0 });
    const b = apply(eventRoom('sleepingSarcophagus', 4), { type: 'eventChoice', playerId: P, index: 0 });
    expect(JSON.stringify(a.state)).toBe(JSON.stringify(b.state));
  });
});

describe('save v12 (M6c)', () => {
  it('a v11 save gets an empty purse and no merchant or event', () => {
    const s = createGame(1) as unknown as Record<string, unknown>;
    const run = { ...(s.run as Record<string, unknown>) };
    for (const k of [
      'gold',
      'merchant',
      'events',
      'seenEvents',
      'shop',
      'event',
      'npc',
      'nextFight',
      'forceMerchant',
      'forceEvent',
    ])
      delete run[k];
    const migrated = migrateState({ ...s, version: 11, run })!;
    expect(migrated.version).toBe(12);
    expect(migrated.run!.gold).toBe(0);
    expect(migrated.run!.seenEvents).toEqual([]);
    expect(migrated.run!.shop).toBeNull();
  });
});
