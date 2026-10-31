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
import { hasText, t, type TextKey } from '../i18n';

/**
 * Descriptions are built from the data (GDD 3), never written by hand, so a new ability, status or
 * modifier is described the moment it exists, in every language.
 */

const name = (key: string) => t(key as TextKey);

function who(sel: UnitSelector | undefined): string {
  if (!sel || sel.kind === 'target' || sel.kind === 'subject') return '';
  if (sel.kind === 'self') return t('desc.toSelf');
  if (sel.kind === 'actor') return t('desc.toActor');
  if (sel.kind === 'frontRow') return t('desc.frontRow');
  if (sel.kind === 'beyond') return t('desc.beyond');
  if (sel.kind === 'nearest') return t('desc.nearestFoe');
  if (sel.radius >= 50) return t('desc.allFoes');
  if (sel.filter === 'allies') return t('desc.alliesAround');
  if (sel.radius === 1 && !sel.square) return t(sel.filter === 'foes' ? 'desc.adjacentFoes' : 'desc.adjacent');
  if (sel.square) return t('desc.square', { n: sel.radius * 2 + 1 });
  return t(sel.filter === 'foes' ? 'desc.foesInRadius' : 'desc.inRadius', { n: sel.radius });
}

const surfaceNames = (ids: readonly string[]) => ids.map((id) => name(getSurface(id).nameKey)).join(t('desc.or'));

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
      return e.radius
        ? t('effect.surfaceArea', {
            surface: name(getSurface(e.surface).nameKey),
            n: e.radius * 2 + 1,
            turns: e.turns ?? 0,
          })
        : t('effect.surface', { surface: name(getSurface(e.surface).nameKey) });
    case 'clearSurface':
      return t('effect.clearSurface', { surface: name(getSurface(e.surface).nameKey) });
    case 'summon':
      if (e.at === 'frontRow') return t('effect.summonRow', { unit: name(getSummon(e.unit).nameKey) });
      return e.consumes
        ? t('effect.summonFrom', { unit: name(getSummon(e.unit).nameKey), from: surfaceNames(e.consumes) })
        : t('effect.summon', { unit: name(getSummon(e.unit).nameKey) });
    case 'removeStatus':
      return t('effect.removeStatus', { status: name(getStatus(e.status).nameKey) });
    case 'cooldowns':
      return t('effect.cooldowns', { n: -e.delta });
    case 'maxHp':
      return e.set !== undefined ? t('effect.maxHpSet', { n: e.set }) : t('effect.maxHpAdd', { n: e.add ?? 0 });
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
        ? t('target.surface', { n: target.range, surface: surfaceNames(target.surface) })
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
  // The most specific phrase there is: by subject (who it happens to), then by actor, then generic.
  const keys = [`when.${tr.on}.${tr.subject}`, `when.${tr.on}.${tr.actor}`, `when.${tr.on}`];
  const key = keys.find(hasText) ?? 'when.generic';
  let when = t(key as TextKey);
  if (tr.tags?.length) when += ` (${tr.tags.map((tag) => t(`tag.${tag}` as TextKey)).join(', ')})`;
  if (tr.subjectStatus) when += ` ${t('desc.withStatus', { status: name(getStatus(tr.subjectStatus).nameKey) })}`;
  if (tr.backstab) when += ` ${t('desc.fromBehind')}`;
  if (tr.near !== undefined) when += ` ${t('desc.near', { n: tr.near })}`;
  if (tr.ownerHpAtMost !== undefined) when += ` ${t('desc.lowHp', { n: tr.ownerHpAtMost })}`;
  if (tr.oncePerRoom) when += ` ${t('desc.oncePerRoom')}`;
  return `${when}: ${tr.effects.map(describeEffect).join(', ')}`;
}

/** Passive, modifier, item or hybrid feature: what it does when gained, its stats and triggers, in words. */
export function describeRule(r: RuleDef): string {
  const parts = [
    ...(r.onGain ?? []).map((e) => capital(describeEffect(e))),
    ...r.stats.map((s) => t(`stat.${s.stat}` as TextKey, { n: s.add, x: s.add + 1 })),
    ...r.triggers.map(describeTrigger),
  ];
  return parts.join('. ');
}
