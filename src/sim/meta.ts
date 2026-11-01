import { PERKS, getPerk } from '../content';

/**
 * What carries over between runs (M6b, GDD 3): Ash and the Chapel upgrades bought with it. Kept apart
 * from the run save, so a new run never wipes it. Plain JSON with a version (CLAUDE.md rule 8).
 */
export const META_VERSION = 1;

export interface MetaSave {
  readonly version: number;
  readonly ash: number;
  readonly perks: readonly { readonly id: string; readonly level: number }[];
}

export const emptyMeta = (): MetaSave => ({ version: META_VERSION, ash: 0, perks: [] });

/** Reads a stored meta save; anything broken or unknown gives a fresh one (never throws). */
export function readMeta(text: string | null): MetaSave {
  if (!text) return emptyMeta();
  try {
    const raw = JSON.parse(text) as Partial<MetaSave>;
    if (raw.version !== META_VERSION || typeof raw.ash !== 'number' || !Array.isArray(raw.perks)) return emptyMeta();
    const known = new Set(PERKS.map((p) => p.id));
    const perks = raw.perks
      .filter((p) => known.has(p.id) && Number.isInteger(p.level) && p.level > 0)
      .map((p) => ({ id: p.id, level: Math.min(p.level, getPerk(p.id).costs.length) }));
    return { version: META_VERSION, ash: Math.max(0, Math.floor(raw.ash)), perks };
  } catch {
    return emptyMeta();
  }
}

export const perkLevel = (meta: MetaSave, id: string) => meta.perks.find((p) => p.id === id)?.level ?? 0;

/** The next level's price, or null at the cap. */
export function nextCost(meta: MetaSave, id: string): number | null {
  return getPerk(id).costs[perkLevel(meta, id)] ?? null;
}

/** Buys the next level of an upgrade, or returns null if it is capped or there is not enough Ash. */
export function buyPerk(meta: MetaSave, id: string): MetaSave | null {
  const cost = nextCost(meta, id);
  if (cost === null || meta.ash < cost) return null;
  const level = perkLevel(meta, id) + 1;
  return {
    ...meta,
    ash: meta.ash - cost,
    perks: [...meta.perks.filter((p) => p.id !== id), { id, level }].sort(
      (a, b) => PERKS.findIndex((p) => p.id === a.id) - PERKS.findIndex((p) => p.id === b.id),
    ),
  };
}

export const addAsh = (meta: MetaSave, ash: number): MetaSave => ({ ...meta, ash: meta.ash + ash });
