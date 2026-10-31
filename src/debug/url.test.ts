import { describe, expect, it } from 'vitest';
import { formatHash, parseHash } from './url';

describe('url hash', () => {
  it('parses seed and debug in any order', () => {
    expect(parseHash('#seed-42')).toEqual({ seed: 42, debug: false });
    expect(parseHash('#seed-12345&debug')).toEqual({ seed: 12345, debug: true });
    expect(parseHash('#debug&seed-7')).toEqual({ seed: 7, debug: true });
    expect(parseHash('')).toEqual({ seed: null, debug: false });
    expect(parseHash('#seed-abc')).toEqual({ seed: null, debug: false });
  });

  it('formats back to the same hash', () => {
    expect(formatHash({ seed: 42, debug: false })).toBe('#seed-42');
    expect(formatHash({ seed: 42, debug: true })).toBe('#seed-42&debug');
    expect(parseHash(formatHash({ seed: 9, debug: true }))).toEqual({ seed: 9, debug: true });
  });
});
