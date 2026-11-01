import { describe, expect, it } from 'vitest';
import { formatHash, parseHash } from './url';

describe('url hash', () => {
  it('parses seed and debug in any order', () => {
    expect(parseHash('#seed-42')).toEqual({ seed: 42, classId: null, debug: false, god: false });
    expect(parseHash('#seed-12345&debug')).toEqual({ seed: 12345, classId: null, debug: true, god: false });
    expect(parseHash('#debug&seed-7')).toEqual({ seed: 7, classId: null, debug: true, god: false });
    expect(parseHash('')).toEqual({ seed: null, classId: null, debug: false, god: false });
    expect(parseHash('#seed-abc')).toEqual({ seed: null, classId: null, debug: false, god: false });
    expect(parseHash('#seed-3&class-rogue')).toEqual({ seed: 3, classId: 'rogue', debug: false, god: false });
  });

  it('formats back to the same hash', () => {
    expect(formatHash({ seed: 42, debug: false })).toBe('#seed-42');
    expect(formatHash({ seed: 42, debug: true })).toBe('#seed-42&debug');
    expect(parseHash(formatHash({ seed: 9, classId: 'necromancer', debug: true, god: false }))).toEqual({
      seed: 9,
      classId: 'necromancer',
      debug: true,
      god: false,
    });
  });

  it('god makes every run immortal and survives formatting', () => {
    expect(parseHash('#seed-5&god')).toEqual({ seed: 5, classId: null, debug: false, god: true });
    expect(formatHash({ seed: 5, debug: true, god: true })).toBe('#seed-5&debug&god');
  });
});
