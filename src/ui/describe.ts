import type { AbilityDef } from '../content';
import { t, type TextKey } from '../i18n';

/** Builds an ability's description from its data (GDD 3: descriptions are generated, not hand-written). */
export function describeAbility(a: AbilityDef): string {
  return a.effects
    .map((e) => (e.kind === 'damage' ? t('effect.damage', { n: e.amount }) : t('effect.push', { n: e.distance })))
    .join(', ');
}

export function abilityName(a: AbilityDef): string {
  return t(a.nameKey as TextKey);
}
