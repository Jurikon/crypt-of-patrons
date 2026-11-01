import { describe, expect, it } from 'vitest';
import { addAsh, buyPerk, emptyMeta, nextCost, perkLevel, readMeta } from './meta';

describe('meta save (Ash and the Chapel)', () => {
  it('buys levels up to the cap, only with enough Ash, and survives a save round trip', () => {
    let m = addAsh(emptyMeta(), 30);
    expect(buyPerk(emptyMeta(), 'vitality')).toBeNull();
    m = buyPerk(m, 'vitality')!;
    m = buyPerk(m, 'vitality')!;
    expect(perkLevel(m, 'vitality')).toBe(2);
    expect(m.ash).toBe(30 - 4 - 8);
    m = buyPerk(addAsh(m, 20), 'vitality')!;
    expect(nextCost(m, 'vitality')).toBeNull();
    expect(buyPerk(m, 'vitality')).toBeNull();
    expect(readMeta(JSON.stringify(m))).toEqual(m);
  });

  it('broken or foreign data gives a fresh Chapel instead of throwing', () => {
    expect(readMeta(null)).toEqual(emptyMeta());
    expect(readMeta('{nope')).toEqual(emptyMeta());
    expect(readMeta('{"version":99,"ash":5,"perks":[]}')).toEqual(emptyMeta());
    expect(readMeta('{"version":1,"ash":5,"perks":[{"id":"nope","level":3},{"id":"vitality","level":9}]}')).toEqual({
      version: 1,
      ash: 5,
      perks: [{ id: 'vitality', level: 3 }],
    });
  });
});
