import { getAffix, getEnemy, type EnemyDef } from '../content';

const cache = new Map<string, EnemyDef>();

/**
 * An enemy's definition with its elite trait folded in: faster, armoured, extra rules or a parting
 * blast. Everything that asks "what can this enemy do" goes through here.
 */
export function enemyDef(e: { readonly type: string; readonly affix?: string | undefined }): EnemyDef {
  const def = getEnemy(e.type);
  if (!e.affix) return def;
  const key = `${e.type}|${e.affix}`;
  const known = cache.get(key);
  if (known) return known;
  const a = getAffix(e.affix);
  const merged: EnemyDef = {
    ...def,
    move: def.move + (a.move ?? 0),
    frontArmor: (def.frontArmor ?? 0) + (a.frontArmor ?? 0),
    traits: [...(def.traits ?? []), ...(a.traits ?? [])],
    onDeath: [...(def.onDeath ?? []), ...(a.onDeath ?? [])],
  };
  cache.set(key, merged);
  return merged;
}

/** A thing (sarcophagus, totem) rather than a fighter. */
export const isInert = (e: { readonly type: string }) => getEnemy(e.type).inert === true;
