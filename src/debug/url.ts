/**
 * URL hash parameters: `#seed-12345` sets the seed, `class-rogue` the class, `debug` opens the debug
 * overlay, `god` makes the hero immortal in every run. Parts are joined with `&`, e.g.
 * `#seed-42&class-necromancer&debug&god`.
 */
export interface HashParams {
  readonly seed: number | null;
  readonly classId?: string | null;
  readonly debug: boolean;
  readonly god?: boolean;
}

export const MAX_SEED = 999_999;

export function parseHash(hash: string): HashParams {
  const parts = hash.replace(/^#/, '').split(/[&,]/).filter(Boolean);
  let seed: number | null = null;
  let classId: string | null = null;
  let debug = false;
  let god = false;
  for (const part of parts) {
    const m = /^seed-(\d{1,9})$/.exec(part);
    const c = /^class-([a-z]+)$/.exec(part);
    if (m) seed = Number(m[1]);
    else if (c) classId = c[1] ?? null;
    else if (part === 'debug') debug = true;
    else if (part === 'god') god = true;
  }
  return { seed, classId, debug, god };
}

export function formatHash(p: HashParams): string {
  const parts: string[] = [];
  if (p.seed !== null) parts.push(`seed-${p.seed}`);
  if (p.classId) parts.push(`class-${p.classId}`);
  if (p.debug) parts.push('debug');
  if (p.god) parts.push('god');
  return parts.length ? `#${parts.join('&')}` : '';
}

/** A fresh seed for a new room. Lives outside the simulation, so ambient randomness is fine here. */
export function randomSeed(): number {
  return 1 + Math.floor(Math.random() * MAX_SEED);
}
