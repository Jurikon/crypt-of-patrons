import { describe, expect, it } from 'vitest';
import { createRng, float, fork, int, nextU32, pick, shuffle, weighted } from './rng';

const draw = (seed: number | string, n: number) => {
  const r = createRng(seed);
  return Array.from({ length: n }, () => nextU32(r));
};

describe('rng', () => {
  it('same seed gives the same sequence', () => {
    expect(draw(42, 100)).toEqual(draw(42, 100));
    expect(draw('abc', 50)).toEqual(draw('abc', 50));
  });

  it('different seeds give different sequences', () => {
    expect(draw(1, 20)).not.toEqual(draw(2, 20));
    expect(draw(42, 20)).not.toEqual(draw(43, 20));
  });

  it('float stays in [0, 1)', () => {
    const r = createRng(7);
    for (let i = 0; i < 10000; i++) {
      const f = float(r);
      expect(f).toBeGreaterThanOrEqual(0);
      expect(f).toBeLessThan(1);
    }
  });

  it('int is inclusive and covers the whole range', () => {
    const r = createRng(9);
    const seen = new Set<number>();
    for (let i = 0; i < 2000; i++) {
      const v = int(r, 3, 8);
      expect(v).toBeGreaterThanOrEqual(3);
      expect(v).toBeLessThanOrEqual(8);
      seen.add(v);
    }
    expect([...seen].sort()).toEqual([3, 4, 5, 6, 7, 8]);
    expect(() => int(r, 5, 4)).toThrow();
  });

  it('pick, shuffle and weighted are deterministic and well-formed', () => {
    const items = ['a', 'b', 'c', 'd', 'e'];
    const a = createRng(5);
    const b = createRng(5);
    expect(pick(a, items)).toBe(pick(b, items));
    const s1 = shuffle(a, items);
    const s2 = shuffle(b, items);
    expect(s1).toEqual(s2);
    expect([...s1].sort()).toEqual(items);
    expect(items).toEqual(['a', 'b', 'c', 'd', 'e']);

    const counts = { x: 0, y: 0, z: 0 };
    const r = createRng(11);
    for (let i = 0; i < 10000; i++) {
      const k = weighted(r, [
        { item: 'x' as const, weight: 1 },
        { item: 'y' as const, weight: 3 },
        { item: 'z' as const, weight: 0 },
      ]);
      counts[k]++;
    }
    expect(counts.z).toBe(0);
    expect(counts.y / counts.x).toBeGreaterThan(2.5);
    expect(counts.y / counts.x).toBeLessThan(3.5);
  });

  it('fork streams are independent of draws in the parent and in siblings', () => {
    const p1 = createRng(100);
    const genA = fork(p1, 'gen');
    const expected = Array.from({ length: 10 }, () => nextU32(genA));

    const p2 = createRng(100);
    for (let i = 0; i < 37; i++) nextU32(p2); // parent used a lot
    const combat = fork(p2, 'combat');
    for (let i = 0; i < 99; i++) nextU32(combat); // sibling used a lot
    const genB = fork(p2, 'gen');
    expect(Array.from({ length: 10 }, () => nextU32(genB))).toEqual(expected);
  });

  it('different fork labels give different streams', () => {
    const root = createRng(1);
    const a = fork(root, 'a');
    const b = fork(root, 'b');
    expect(nextU32(a)).not.toBe(nextU32(b));
  });

  it('state survives a JSON round trip and continues the same sequence', () => {
    const r = createRng(2024);
    for (let i = 0; i < 13; i++) nextU32(r);
    const copy = JSON.parse(JSON.stringify(r)) as typeof r;
    expect(Array.from({ length: 20 }, () => nextU32(copy))).toEqual(Array.from({ length: 20 }, () => nextU32(r)));
  });
});
