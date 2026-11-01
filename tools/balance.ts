// Balancing bot (M6c): plays whole runs of every class with random picks of rewards, doors, purchases
// and event choices, and writes docs/balance-report.md: wins by class and act, run length, which parts
// show up more in wins than in losses, absurd rooms, gold earned and spent.
// Run: pnpm balance [runs per class and setting] [first seed]
import { writeFileSync } from 'node:fs';
import { createRng, int, pick, type Rng } from '../src/core/rng';
import {
  ABILITY_SLOTS,
  ACT,
  CLASSES,
  getAbility,
  getEvent,
  getGift,
  getItem,
  getModifier,
  PERKS,
  SHOP,
} from '../src/content';
import { apply, canAfford, createGame, type Command, type GameState } from '../src/sim';
import { carefulAction, DIRS, face, firstStep } from './bot';

/** A room cleared in at most this many turns, against at least ABSURD_ENEMIES enemies, is suspicious. */
const ABSURD_TURNS = 2;
const ABSURD_ENEMIES = 3;
/** Damage dealt by the hero to a single enemy in one action above this is suspicious. */
const ABSURD_DAMAGE = 10;

interface Anomaly {
  readonly kind: 'fastRoom' | 'bigHit' | 'chainLimit';
  readonly seed: number;
  readonly classId: string;
  readonly act: number;
  readonly depth: number;
  readonly detail: string;
  readonly build: string;
}

interface RunStats {
  readonly seed: number;
  readonly classId: string;
  readonly perks: boolean;
  readonly result: 'won' | 'lost' | 'stuck';
  readonly act: number;
  readonly depth: number;
  readonly turns: number;
  readonly goldEarned: number;
  readonly goldSpent: number;
  readonly merchants: number;
  readonly events: string[];
  readonly parts: string[];
  readonly anomalies: Anomaly[];
}

const MAX_PERKS = PERKS.map((p) => ({ id: p.id, level: p.costs.length }));

const partName = (id: string): string => {
  try {
    if (id.startsWith('mod.')) return getModifier(id).id;
    if (id.startsWith('item.')) return getItem(id).id;
    if (id.startsWith('gift.')) return getGift(id).id;
    return getAbility(id).id;
  } catch {
    return id;
  }
};

/** What a hero holds: abilities beyond the start kit, modifiers, items, gifts. */
function partsOf(state: GameState): string[] {
  const p = state.players[0]!;
  return [...p.abilities.slice(1), ...p.modifiers, ...p.items, ...p.gifts].map(partName);
}

/** Between fights: random picks of everything, the way a curious player would try things. */
function choose(rng: Rng, state: GameState): Command | null {
  const run = state.run!;
  const p = state.players[0]!;
  if (run.phase === 'reward') {
    // A duo gift is always taken (otherwise they never get judged); else a random card, rarely none.
    const duo = run.offer.findIndex((o) => o.kind === 'gift' && !!getGift(o.id).patrons);
    const index = duo >= 0 ? duo : int(rng, 0, run.offer.length - 1);
    const option = run.offer[index];
    const full = option?.kind === 'ability' && p.abilities.length > ABILITY_SLOTS;
    return full
      ? { type: 'chooseReward', playerId: p.id, index, replace: int(rng, 1, ABILITY_SLOTS) }
      : { type: 'chooseReward', playerId: p.id, index };
  }
  if (run.phase === 'event' && run.event) {
    const options = getEvent(run.event).options;
    const affordable = options.map((o, i) => ({ o, i })).filter(({ o }) => canAfford(state, p, o.cost));
    return { type: 'eventChoice', playerId: p.id, index: pick(rng, affordable).i };
  }
  if (run.phase !== 'doors') return null;
  if (run.shop) {
    if (p.hp < p.maxHp * 0.6 && run.gold >= SHOP.heal.price)
      return { type: 'shopService', playerId: p.id, service: 'heal' };
    const can = run.shop.wares.map((w, i) => ({ w, i })).filter(({ w }) => !w.sold && w.price <= run.gold);
    if (can.length) {
      const { w, i } = pick(rng, can);
      const full = w.option.kind === 'ability' && p.abilities.length > ABILITY_SLOTS;
      return full
        ? { type: 'buy', playerId: p.id, index: i, replace: ABILITY_SLOTS }
        : { type: 'buy', playerId: p.id, index: i };
    }
  }
  // A door picked at random once (remembered on the run object for this room).
  const key = `${run.act}:${run.depth}`;
  let offer = doorChoice.get(key);
  if (offer === undefined || !run.doors[offer]) {
    offer = int(rng, 0, Math.max(0, run.doors.length - 1));
    doorChoice.set(key, offer);
  }
  const door = state.room.doors[run.doors[offer]!.door]!;
  const inside = { x: door.x + DIRS[door.dir]!.x, y: door.y + DIRS[door.dir]!.y };
  if (p.x === inside.x && p.y === inside.y)
    return face(p.id, p.dir, (door.dir + 2) % 4) ?? { type: 'move', playerId: p.id, dir: 'forward' };
  const step = firstStep(state, (x, y) => x === inside.x && y === inside.y);
  if (step < 0) return null;
  return face(p.id, p.dir, step) ?? { type: 'move', playerId: p.id, dir: 'forward' };
}

let doorChoice = new Map<string, number>();

function playRun(seed: number, classId: string, perks: boolean): RunStats {
  const rng = createRng(`balance/${seed}/${classId}/${perks}`);
  doorChoice = new Map();
  let state = createGame(seed, { classId, perks: perks ? MAX_PERKS : [] });
  const anomalies: Anomaly[] = [];
  let goldSpent = 0;
  let merchants = 0;
  const events: string[] = [];
  let roomEnemies = state.enemies.length;
  const build = () => partsOf(state).join(', ');
  for (let n = 0; n < 20000; n++) {
    const run = state.run!;
    if (run.phase === 'won' || run.phase === 'lost') break;
    const between = choose(rng, state);
    const cmd =
      between ??
      (state.combat.turn > 200 && state.combat.turn % 3 === 0 ? randomStep(rng, state) : carefulAction(rng, state));
    const before = state;
    const r = apply(state, cmd);
    state = r.state;
    const heroId = state.players[0]!.id;
    const perTarget = new Map<string, number>();
    for (const e of r.events)
      if (e.type === 'damaged' && e.unitId !== heroId)
        perTarget.set(e.unitId, (perTarget.get(e.unitId) ?? 0) + e.amount);
    const dealt = Math.max(0, ...perTarget.values());
    if (cmd.type === 'useAbility' && dealt > ABSURD_DAMAGE)
      anomalies.push({
        kind: 'bigHit',
        seed,
        classId,
        act: run.act,
        depth: run.depth,
        detail: `${dealt}`,
        build: build(),
      });
    for (const e of r.events) {
      if (e.type === 'chainLimit')
        anomalies.push({
          kind: 'chainLimit',
          seed,
          classId,
          act: run.act,
          depth: run.depth,
          detail: `${e.depth}`,
          build: build(),
        });
      if (e.type === 'bought' || e.type === 'shopService') goldSpent += e.price;
      if (e.type === 'eventChosen') events.push(`${e.event}#${e.option}`);
      if (e.type === 'roomEntered') {
        roomEnemies = state.enemies.length;
        if (e.kind === 'merchant') merchants++;
      }
    }
    // Only plain clearing counts: a hunt or a totem ends early by design.
    if (
      before.combat.status === 'active' &&
      state.combat.status === 'won' &&
      before.run!.kind !== 'event' &&
      !before.combat.goal
    ) {
      const turns = before.combat.turn;
      if (turns <= ABSURD_TURNS && roomEnemies >= ABSURD_ENEMIES)
        anomalies.push({
          kind: 'fastRoom',
          seed,
          classId,
          act: before.run!.act,
          depth: before.run!.depth,
          detail: `${roomEnemies} enemies in ${turns} turns`,
          build: build(),
        });
    }
  }
  const run = state.run!;
  return {
    seed,
    classId,
    perks,
    result: run.phase === 'won' ? 'won' : run.phase === 'lost' ? 'lost' : 'stuck',
    act: run.act,
    depth: run.depth,
    turns: run.turns + state.combat.turn,
    goldEarned: run.log.reduce((a, e) => a + (e.type === 'gold' ? e.amount : 0), 0),
    goldSpent,
    merchants,
    events,
    parts: partsOf(state),
    anomalies,
  };
}

function randomStep(rng: Rng, state: GameState): Command {
  const p = state.players[0]!;
  return pick<Command>(rng, [
    { type: 'move', playerId: p.id, dir: pick(rng, ['forward', 'left', 'right'] as const) },
    { type: 'turn', playerId: p.id, dir: pick(rng, ['left', 'right'] as const) },
    { type: 'useAbility', playerId: p.id, abilityId: p.abilities[0]! },
  ]);
}

const pct = (a: number, b: number) => (b ? `${Math.round((100 * a) / b)}%` : '—');
const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)] ?? 0;
};

/** Seconds a human takes per turn, for the run-length estimate. */
const SECONDS_PER_TURN = 3;

export function report(all: RunStats[]): string {
  const lines: string[] = [];
  const out = (s = '') => lines.push(s);
  out('# Отчёт бота-балансировщика');
  out();
  out(
    `Осторожный бот, случайные выборы наград, дверей, покупок и событий. Забегов: ${all.length}. ` +
      `Длительность в минутах — оценка по ${SECONDS_PER_TURN} с на ход.`,
  );
  out();
  out('## Победы по классам');
  out();
  out('| Класс | Усиления Часовни | Побед | Дошли до акта 2 | До акта 3 | Ходов (медиана) | ≈ минут | Застряли |');
  out('|---|---|---|---|---|---|---|---|');
  for (const perks of [false, true])
    for (const c of CLASSES) {
      const runs = all.filter((r) => r.classId === c.id && r.perks === perks);
      if (!runs.length) continue;
      const won = runs.filter((r) => r.result === 'won').length;
      const act2 = runs.filter((r) => r.act >= 2).length;
      const act3 = runs.filter((r) => r.act >= 3).length;
      const turns = median(runs.map((r) => r.turns));
      out(
        `| ${c.id} | ${perks ? 'все' : 'нет'} | ${won}/${runs.length} (${pct(won, runs.length)}) | ${pct(act2, runs.length)} | ` +
          `${pct(act3, runs.length)} | ${turns} | ${Math.round((turns * SECONDS_PER_TURN) / 60)} | ${runs.filter((r) => r.result === 'stuck').length} |`,
      );
    }
  out();
  out(`Цель: без усилений 10–20% побед, со всеми — 40–60%.`);
  out();
  out('## Где умирают');
  out();
  out('| Акт | Комната 1 | 2 | 3 | 4 | 5 | Босс |');
  out('|---|---|---|---|---|---|---|');
  const lost = all.filter((r) => r.result === 'lost');
  for (const act of [1, 2, 3]) {
    const row = Array.from(
      { length: ACT.rooms + 1 },
      (_, i) => lost.filter((r) => r.act === act && r.depth === i + 1).length,
    );
    out(`| ${act} | ${row.join(' | ')} |`);
  }
  out();
  out('## Детали в победах и поражениях');
  out();
  out(
    'Сколько забегов закончилось с этой деталью и какая доля из них — победа. Детали с долей побед заметно выше общей — кандидаты на ослабление; ниже — на усиление. ' +
      'Поправка: чем дольше забег, тем больше в нём деталей, поэтому почти все детали выше общей доли; смотреть стоит на сильные выбросы.',
  );
  out();
  const base = all.filter((r) => r.result === 'won').length / Math.max(1, all.length);
  out(`Общая доля побед: ${pct(all.filter((r) => r.result === 'won').length, all.length)}.`);
  out();
  out('| Деталь | Забегов с ней | Доля побед | Разница с общей |');
  out('|---|---|---|---|');
  const parts = new Map<string, { runs: number; won: number }>();
  for (const r of all)
    for (const part of new Set(r.parts)) {
      const s = parts.get(part) ?? { runs: 0, won: 0 };
      s.runs++;
      if (r.result === 'won') s.won++;
      parts.set(part, s);
    }
  const rows = [...parts].filter(([, s]) => s.runs >= 5).sort((a, b) => b[1].won / b[1].runs - a[1].won / a[1].runs);
  for (const [part, s] of rows) {
    const rate = s.won / s.runs;
    const diff = Math.round((rate - base) * 100);
    out(`| ${part} | ${s.runs} | ${pct(s.won, s.runs)} | ${diff > 0 ? '+' : ''}${diff} |`);
  }
  out();
  out('## Абсурдные билды');
  out();
  const anomalies = all.flatMap((r) => r.anomalies);
  const by = (k: Anomaly['kind']) => anomalies.filter((a) => a.kind === k);
  out(`- Комната с ${ABSURD_ENEMIES}+ врагами за ${ABSURD_TURNS} хода и меньше: ${by('fastRoom').length}`);
  out(`- Урон по одной цели за одно действие больше ${ABSURD_DAMAGE}: ${by('bigHit').length}`);
  out(`- Цепочка срабатываний упёрлась в лимит: ${by('chainLimit').length}`);
  out();
  if (anomalies.length) {
    out('| Что | Сид | Класс | Акт/комната | Подробно | Билд |');
    out('|---|---|---|---|---|---|');
    for (const a of anomalies.slice(0, 30))
      out(`| ${a.kind} | ${a.seed} | ${a.classId} | ${a.act}/${a.depth} | ${a.detail} | ${a.build || '—'} |`);
    out();
  }
  out('## Золото');
  out();
  const earned = all.map((r) => r.goldEarned);
  const spent = all.map((r) => r.goldSpent);
  out(`- Добыто за забег (медиана): ${median(earned)}, потрачено: ${median(spent)}`);
  out(`- Забегов, где встретился торговец: ${pct(all.filter((r) => r.merchants > 0).length, all.length)}`);
  out();
  out('## События');
  out();
  const ev = new Map<string, number>();
  for (const r of all) for (const e of r.events) ev.set(e, (ev.get(e) ?? 0) + 1);
  out('| Событие#вариант | Раз выбрано |');
  out('|---|---|');
  for (const [e, n] of [...ev].sort()) out(`| ${e} | ${n} |`);
  out();
  return lines.join('\n');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const count = Number(process.argv[2] ?? 30);
  const first = Number(process.argv[3] ?? 1);
  const all: RunStats[] = [];
  for (const perks of [false, true])
    for (const c of CLASSES) {
      for (let i = 0; i < count; i++) all.push(playRun(first + i, c.id, perks));
      const runs = all.filter((r) => r.classId === c.id && r.perks === perks);
      console.log(
        `${c.id.padEnd(12)} perks ${perks ? 'all' : 'none'}: won ${runs.filter((r) => r.result === 'won').length}/${runs.length}`,
      );
    }
  writeFileSync('docs/balance-report.md', report(all) + '\n');
  console.log('docs/balance-report.md written');
}

export { playRun as balanceRun };
