import {
  getStatus,
  getSummon,
  getSurface,
  type AbilityDef,
  type EffectSpec,
  type RuleDef,
  type TargetSpec,
  type TriggerDef,
  type UnitSelector,
} from '../content';
import { t, type TextKey } from '../i18n';

/**
 * Descriptions are built from the data (GDD 3), never written by hand, so a new ability, status or
 * modifier is described the moment it exists, in every language.
 */

const name = (key: string) => t(key as TextKey);

function who(sel: UnitSelector | undefined): string {
  if (!sel || sel.kind === 'target' || sel.kind === 'subject') return '';
  if (sel.kind === 'self' || sel.kind === 'actor') return t('desc.toSelf');
  if (sel.radius === 1) return t(sel.filter === 'foes' ? 'desc.adjacentFoes' : 'desc.adjacent');
  return t(sel.filter === 'foes' ? 'desc.foesInRadius' : 'desc.inRadius', { n: sel.radius });
}

function withWho(text: string, sel: UnitSelector | undefined): string {
  const w = who(sel);
  return w ? `${text} ${w}` : text;
}

export function describeEffect(e: EffectSpec): string {
  switch (e.kind) {
    case 'damage':
      return withWho(t('effect.damage', { n: e.amount }), e.to);
    case 'push':
      return withWho(t('effect.push', { n: e.distance }), e.to);
    case 'teleportBehind':
      return t('effect.teleportBehind');
    case 'swap':
      return t('effect.swap');
    case 'dash':
      return `${t('effect.dash', { n: e.distance })}: ${e.onImpact.map(describeEffect).join(', ')}`;
    case 'projectile':
      return `${t('effect.projectile', { n: e.range })}: ${e.onHit.map(describeEffect).join(', ')}`;
    case 'status':
      return withWho(t('effect.status', { status: name(getStatus(e.status).nameKey), n: e.turns }), e.to);
    case 'shield':
      return withWho(t('effect.shield', { n: e.amount, turns: e.turns }), e.to);
    case 'surface':
      return t('effect.surface', { surface: name(getSurface(e.surface).nameKey) });
    case 'clearSurface':
      return t('effect.clearSurface', { surface: name(getSurface(e.surface).nameKey) });
    case 'summon':
      return e.consumes
        ? t('effect.summonFrom', { unit: name(getSummon(e.unit).nameKey), from: name(getSurface(e.consumes).nameKey) })
        : t('effect.summon', { unit: name(getSummon(e.unit).nameKey) });
    case 'heal':
      return withWho(t('effect.heal', { n: e.amount }), e.to);
    case 'freeAction':
      return t('effect.freeAction');
    case 'kill':
      return t('effect.kill');
  }
}

function describeTarget(target: TargetSpec): string {
  switch (target.kind) {
    case 'front':
    case 'self':
      return '';
    case 'line':
      return t('target.line', { n: target.range });
    case 'unit':
      return t(`target.unit.${target.filter}` as TextKey, { n: target.range });
    case 'cell':
      return target.surface
        ? t('target.surface', { n: target.range, surface: name(getSurface(target.surface).nameKey) })
        : t('target.cell', { n: target.range });
  }
}

/** Builds an ability's description from its data. */
const capital = (text: string) => text.charAt(0).toLocaleUpperCase() + text.slice(1);

export function describeAbility(a: AbilityDef): string {
  const effects = capital(a.effects.map(describeEffect).join(', '));
  const target = describeTarget(a.target);
  return target ? `${target}. ${effects}` : effects;
}

export function abilityName(a: AbilityDef): string {
  return t(a.nameKey as TextKey);
}

function describeTrigger(tr: TriggerDef): string {
  const party = tr.actor ?? tr.subject ?? 'any';
  const key = `when.${tr.on}.${party}` as TextKey;
  let when = t(key);
  if (when === key) when = t(`when.${tr.on}` as TextKey);
  if (tr.tags?.length) when += ` (${tr.tags.map((tag) => t(`tag.${tag}` as TextKey)).join(', ')})`;
  if (tr.subjectStatus) when += ` ${t('desc.withStatus', { status: name(getStatus(tr.subjectStatus).nameKey) })}`;
  return `${when}: ${tr.effects.map(describeEffect).join(', ')}`;
}

/** Passive or modifier: its stat changes and triggers, in words. */
export function describeRule(r: RuleDef): string {
  const parts = [
    ...r.stats.map((s) => t(`stat.${s.stat}` as TextKey, { n: s.add, x: s.add + 1 })),
    ...r.triggers.map(describeTrigger),
  ];
  return parts.join('. ');
}
