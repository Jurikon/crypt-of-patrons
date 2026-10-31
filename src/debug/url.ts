/**
 * URL hash parameters: `#seed-12345` sets the seed, `class-rogue` the class, `debug` opens the debug
 * overlay. Parts are joined with `&`, e.g. `#seed-42&class-necromancer&debug`.
 */
export interface HashParams {
  readonly seed: number | null;
  readonly classId?: string | null;
  readonly debug: boolean;
}

export const MAX_SEED = 999_999;

export function parseHash(hash: string): HashParams {
  const parts = hash.replace(/^#/, '').split(/[&,]/).filter(Boolean);
  let seed: number | null = null;
  let classId: string | null = null;
  let debug = false;
  for (const part of parts) {
    const m = /^seed-(\d{1,9})$/.exec(part);
    const c = /^class-([a-z]+)$/.exec(part);
    if (m) seed = Number(m[1]);
    else if (c) classId = c[1] ?? null;
    else if (part === 'debug') debug = true;
  }
  return { seed, classId, debug };
}

export function formatHash(p: HashParams): string {
  const parts: string[] = [];
  if (p.seed !== null) parts.push(`seed-${p.seed}`);
  if (p.classId) parts.push(`class-${p.classId}`);
  if (p.debug) parts.push('debug');
  return parts.length ? `#${parts.join('&')}` : '';
}

/** A fresh seed for a new room. Lives outside the simulation, so ambient randomness is fine here. */
export function randomSeed(): number {
  return 1 + Math.floor(Math.random() * MAX_SEED);
}
