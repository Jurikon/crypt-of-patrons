import {
  GIFTS,
  HYBRIDS,
  ITEMS,
  MODIFIERS,
  PASSIVES,
  getStatus,
  getSummon,
  getSurface,
  type AbilityDef,
  type EffectSpec,
  type RuleDef,
  type StatusDef,
  type SurfaceDef,
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
  if (sel.kind === 'nearest')
    return (sel.count ?? 1) > 1 ? t('desc.nearestFoes', { n: sel.count ?? 1 }) : t('desc.nearestFoe');
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

/** Durations this long last the whole room, so they are not worth counting. */
const LASTING = 99;

/** Effects in a row, the same ones merged: "free action ×2". */
function describeEffects(effects: readonly EffectSpec[]): string {
  const texts = effects.map(describeEffect);
  const out: string[] = [];
  for (let i = 0; i < texts.length; i++) {
    let n = 1;
    while (texts[i + n] === texts[i]) n++;
    out.push(n > 1 ? `${texts[i]} ×${n}` : texts[i]!);
    i += n - 1;
  }
  return out.join(', ');
}

export function describeEffect(e: EffectSpec): string {
  switch (e.kind) {
    case 'damage':
      if (e.fromStatus)
        return withWho(t('effect.damageFromStatus', { status: name(getStatus(e.fromStatus).nameKey) }), e.to);
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
    case 'status': {
      // A stronger status says how strong; one that lasts the whole room does not count turns.
      const status =
        (e.amount ?? 1) > 1 ? `${name(getStatus(e.status).nameKey)} ${e.amount}` : name(getStatus(e.status).nameKey);
      return withWho(e.turns >= LASTING ? status : t('effect.status', { status, n: e.turns }), e.to);
    }
    case 'shield':
      return withWho(
        e.turns >= LASTING
          ? t('effect.shieldLasting', { n: e.amount })
          : t('effect.shield', { n: e.amount, turns: e.turns }),
        e.to,
      );
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
    case 'spreadStatuses':
      return withWho(t('effect.spreadStatuses'), e.to);
    case 'pull':
      return withWho(t('effect.pull', { n: e.distance }), e.to);
    case 'consume':
      return `${t('effect.consume', { surface: name(getSurface(e.surface).nameKey) })}: ${describeEffects(e.effects)}`;
    case 'faceActor':
      return t('effect.faceActor');
    case 'scatterSurface':
      return t('effect.scatterSurface', { surface: name(getSurface(e.surface).nameKey), n: e.count });
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
  // The most specific phrase there is: by actor and subject, by subject, by actor, then generic.
  const keys = [
    `when.${tr.on}.${tr.actor}.${tr.subject}`,
    `when.${tr.on}.${tr.subject}`,
    `when.${tr.on}.${tr.actor}`,
    `when.${tr.on}`,
  ];
  const key = keys.find(hasText) ?? 'when.generic';
  let when = t(key as TextKey);
  if (tr.tags?.length) when += ` (${tr.tags.map((tag) => t(`tag.${tag}` as TextKey)).join(', ')})`;
  // A clause of its own (", if it has Stun"), so it cannot be read as part of the phrase before it.
  if (tr.subjectStatus) when += t('desc.withStatus', { status: name(getStatus(tr.subjectStatus).nameKey) });
  if (tr.backstab) when += ` ${t('desc.fromBehind')}`;
  if (tr.near !== undefined) when += ` ${t('desc.near', { n: tr.near })}`;
  if (tr.ownerHpAtMost !== undefined) when += ` ${t('desc.lowHp', { n: tr.ownerHpAtMost })}`;
  if (tr.subjectSurface) when += ` ${t('desc.onSurface', { surface: name(getSurface(tr.subjectSurface).nameKey) })}`;
  if (tr.ownerStatusAtLeast)
    when += ` ${t('desc.ownerStatusAtLeast', { status: name(getStatus(tr.ownerStatusAtLeast.status).nameKey), n: tr.ownerStatusAtLeast.amount })}`;
  if (tr.oncePerRoom) when += ` ${t('desc.oncePerRoom')}`;
  if (tr.oncePerTurn) when += ` ${t('desc.oncePerTurn')}`;
  if (tr.every) when += t('desc.every', { n: tr.every });
  const effects = describeEffects(tr.effects);
  // Lightning or fire damage says so: other rules react to those tags.
  const kind = tr.effectTags?.length ? ` (${tr.effectTags.map((tag) => t(`tag.${tag}` as TextKey)).join(', ')})` : '';
  return `${when}: ${effects}${kind}`;
}

/** Passive, modifier, item or hybrid feature: what it does when gained, its stats and triggers, in words. */
export function describeRule(r: RuleDef): string {
  const parts = [
    ...(r.onGain ?? []).map((e) => capital(describeEffect(e))),
    ...r.stats.map((s) => t(`stat.${s.stat}` as TextKey, { n: s.add, x: s.add + 1 })),
    ...r.triggers.map(describeTrigger),
  ];
  // Phrases may already end in a full stop ("for 3 turns."); do not double it.
  return parts.map((p, i) => (i < parts.length - 1 ? p.replace(/\.$/, '') : p)).join('. ');
}

/** Every rule that can be gained, with what kind of reward it is (for "who reacts to this?"). */
const REACTORS: readonly { rule: RuleDef; kind: TextKey }[] = [
  ...MODIFIERS.map((rule) => ({ rule, kind: 'reward.kind.modifier' as TextKey })),
  ...ITEMS.map((rule) => ({ rule, kind: 'reward.kind.item' as TextKey })),
  ...GIFTS.map((rule) => ({ rule, kind: 'reward.kind.gift' as TextKey })),
  ...PASSIVES.map((rule) => ({ rule, kind: 'reward.kind.passive' as TextKey })),
  ...HYBRIDS.map((h) => ({ rule: h.rule, kind: 'reward.kind.hybrid' as TextKey })),
];

/**
 * A status with no effect of its own (a mark) is only worth something through the rules that react to
 * it: name them, so the player knows what to look for.
 */
function markerText(status: string): string {
  const names = REACTORS.filter(({ rule }) => rule.triggers.some((tr) => tr.subjectStatus === status)).map(
    ({ rule, kind }) => `«${name(rule.nameKey)}» (${t(kind).toLocaleLowerCase()}): ${describeRule(rule)}`,
  );
  return names.length ? `${t('flag.markerFor')} ${names.join('; ')}` : t('flag.marker');
}

/** What a status does, from its data: its stats, its triggers and its special flags. */
export function describeStatus(st: StatusDef): string {
  const flags = (['stun', 'rooted', 'blind', 'taunt', 'shield', 'frontGuard', 'stacks', 'jumps'] as const)
    .filter((f) => st[f])
    .map((f) => t(`flag.${f}` as TextKey));
  const parts = [
    ...flags,
    ...st.stats.map((x) => t(`stat.${x.stat}` as TextKey, { n: x.add, x: x.add + 1 })),
    ...st.triggers.map(describeTrigger),
    ...(st.onExpire ? [`${t('desc.onExpire')}: ${describeEffects(st.onExpire)}`] : []),
  ];
  return capital(parts.length ? sentences(parts) : markerText(st.id));
}

/** Phrases joined into sentences, without doubling a full stop that ends one ("3 turns."). */
const sentences = (parts: readonly string[]) =>
  parts.map((p, i) => (i < parts.length - 1 ? p.replace(/\.$/, '') : p)).join('. ');

/**
 * A surface's triggers: most hurt on stepping in and again at the end of a turn there with the same
 * effect, which reads as one sentence ("whoever steps in or stays: …").
 */
function surfaceTriggers(sf: SurfaceDef): string[] {
  const enter = sf.triggers.find((x) => x.on === 'enterCell');
  const stay = sf.triggers.find((x) => x.on === 'turnEnd');
  const same =
    enter && stay && enter.subject === stay.subject && describeEffects(enter.effects) === describeEffects(stay.effects);
  if (!same) return sf.triggers.map(describeTrigger);
  const rest = sf.triggers.filter((x) => x !== enter && x !== stay).map(describeTrigger);
  const kind = enter.effectTags?.length
    ? ` (${enter.effectTags.map((tag) => t(`tag.${tag}` as TextKey)).join(', ')})`
    : '';
  return [`${t('when.linger')}: ${describeEffects(enter.effects)}${kind}`, ...rest];
}

/** What a surface does: its triggers, what it carries, how it reacts. */
export function describeSurface(sf: SurfaceDef): string {
  const parts = [
    ...surfaceTriggers(sf),
    ...(sf.conducts ? [t('flag.conducts', { tag: t(`tag.${sf.conducts}` as TextKey) })] : []),
    ...(sf.reactions ?? []).map((x) =>
      x.result
        ? t('flag.reaction', { with: name(getSurface(x.with).nameKey), result: name(getSurface(x.result).nameKey) })
        : t('flag.reactionGone', { with: name(getSurface(x.with).nameKey) }),
    ),
  ];
  return capital(parts.length ? sentences(parts) : t('flag.inert'));
}

export interface GlossaryEntry {
  readonly name: string;
  readonly text: string;
}

/**
 * The statuses and surfaces an ability or rule mentions, each explained: shown under its description so
 * "Curse" or "Charge" never stays a bare word.
 */
export function glossary(source: AbilityDef | RuleDef): GlossaryEntry[] {
  const statuses = new Set<string>();
  const surfaces = new Set<string>();
  const walk = (effects: readonly EffectSpec[]) => {
    for (const e of effects) {
      if (e.kind === 'status' || e.kind === 'removeStatus') statuses.add(e.status);
      if (e.kind === 'damage' && e.fromStatus) statuses.add(e.fromStatus);
      if (e.kind === 'surface' || e.kind === 'clearSurface' || e.kind === 'scatterSurface') surfaces.add(e.surface);
      if (e.kind === 'summon') for (const sf of e.consumes ?? []) surfaces.add(sf);
      if (e.kind === 'projectile') walk(e.onHit);
      if (e.kind === 'dash') walk(e.onImpact);
      if (e.kind === 'consume') {
        surfaces.add(e.surface);
        walk(e.effects);
      }
    }
  };
  if ('effects' in source) {
    walk(source.effects);
    if (source.target.kind === 'cell') for (const sf of source.target.surface ?? []) surfaces.add(sf);
  } else {
    walk(source.onGain ?? []);
    for (const tr of source.triggers) {
      walk(tr.effects);
      if (tr.subjectStatus) statuses.add(tr.subjectStatus);
      if (tr.subjectSurface) surfaces.add(tr.subjectSurface);
      if (tr.ownerStatusAtLeast) statuses.add(tr.ownerStatusAtLeast.status);
    }
  }
  return [
    ...[...statuses].map((id) => {
      const st = getStatus(id);
      return { name: `${st.icon} ${name(st.nameKey)}`, text: describeStatus(st) };
    }),
    ...[...surfaces].map((id) => ({
      name: capital(name(getSurface(id).nameKey)),
      text: describeSurface(getSurface(id)),
    })),
  ];
}

/** The glossary as plain text, for native tooltips. */
export const glossaryText = (source: AbilityDef | RuleDef) =>
  glossary(source)
    .map((g) => `${g.name}: ${g.text}`)
    .join('\n');
