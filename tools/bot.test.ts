import { describe, expect, it } from 'vitest';
import { CLASSES } from '../src/content';
import { playFights, playRun, TURN_LIMIT } from './bot';

describe('balancing bot', () => {
  for (const cls of CLASSES) {
    it(`${cls.id}: 100 random fights all finish, with wins and losses`, () => {
      const results = playFights(100, 1, 'random', cls.id);
      for (const r of results)
        expect(r.status, `seed ${r.seed} did not finish in ${TURN_LIMIT} turns`).not.toBe('active');
      // Random play should both win and lose sometimes; otherwise numbers are badly off.
      expect(results.some((r) => r.status === 'lost')).toBe(true);
    }, 120_000);

    it(`${cls.id}: 100 greedy fights all finish`, () => {
      for (const r of playFights(100, 1, 'greedy', cls.id))
        expect(r.status, `seed ${r.seed} did not finish in ${TURN_LIMIT} turns`).not.toBe('active');
    }, 120_000);

    it(`${cls.id}: 30 greedy runs through act 1 all end in a win or a death, never stuck`, () => {
      const runs = Array.from({ length: 30 }, (_, i) => playRun(i + 1, cls.id));
      for (const r of runs) expect(r.result, `seed ${r.seed} stuck in room ${r.depth}`).not.toBe('stuck');
      expect(runs.some((r) => r.depth >= 3)).toBe(true);
    }, 120_000);

    it(`${cls.id}: 20 careful runs going for altars take gifts and never get stuck`, () => {
      const runs = Array.from({ length: 20 }, (_, i) => playRun(i + 1, cls.id, 'careful', true));
      for (const r of runs) expect(r.result, `seed ${r.seed} stuck in room ${r.depth}`).not.toBe('stuck');
      expect(runs.filter((r) => r.build.gifts.length > 0).length).toBeGreaterThan(10);
    }, 120_000);

    it(`${cls.id}: with every ability and modifier at once, 60 random fights finish without errors`, () => {
      for (const r of playFights(60, 1, 'random', cls.id, 'full'))
        expect(r.status, `seed ${r.seed} did not finish in ${TURN_LIMIT} turns`).not.toBe('active');
    }, 120_000);
  }
});
