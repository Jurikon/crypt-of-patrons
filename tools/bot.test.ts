import { describe, expect, it } from 'vitest';
import { playFights, TURN_LIMIT } from './bot';

describe('random-play bot', () => {
  it('200 fights all finish without crashing', () => {
    const results = playFights(200);
    for (const r of results) {
      expect(r.status, `seed ${r.seed} did not finish in ${TURN_LIMIT} turns`).not.toBe('active');
    }
    // Random play should both win and lose sometimes; otherwise numbers are badly off.
    expect(results.some((r) => r.status === 'won')).toBe(true);
    expect(results.some((r) => r.status === 'lost')).toBe(true);
  }, 60_000);

  it('a simple greedy fighter also always finishes', () => {
    for (const r of playFights(200, 1, 'greedy')) {
      expect(r.status, `seed ${r.seed} did not finish in ${TURN_LIMIT} turns`).not.toBe('active');
    }
  }, 60_000);
});
