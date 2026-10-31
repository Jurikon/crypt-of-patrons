import { useState } from 'preact/hooks';
import { ABILITY_SLOTS, getAbility, getClass, getGift, getItem, getModifier, getPassive, getPatron } from '../content';
import { t, type TextKey } from '../i18n';
import type { GameState } from '../sim';
import { abilityName, describeAbility, describeRule } from './describe';

export interface RewardActions {
  /** Take option `index` (null = take nothing); `replace` is the slot a new ability takes over. */
  chooseReward(index: number | null, replace?: number): void;
}

type Option = NonNullable<GameState['run']>['offer'][number];

function title(o: Option): string {
  switch (o.kind) {
    case 'ability':
      return abilityName(getAbility(o.id));
    case 'modifier':
      return t(getModifier(o.id).nameKey as TextKey);
    case 'item':
      return `${getItem(o.id).icon ?? ''} ${t(getItem(o.id).nameKey as TextKey)}`;
    case 'class':
      return t(getClass(o.id).nameKey as TextKey);
    case 'upgrade':
      return `${abilityName(getAbility(o.abilityId))}: ${t(`upgrade.${o.upgrade}` as TextKey)}`;
    case 'gift':
      return t(getGift(o.id).nameKey as TextKey);
  }
}

function body(o: Option): string {
  switch (o.kind) {
    case 'ability':
      return describeAbility(getAbility(o.id));
    case 'modifier':
      return describeRule(getModifier(o.id));
    case 'item':
      return describeRule(getItem(o.id));
    case 'class': {
      const c = getClass(o.id);
      const passive = c.passives.map(
        (id) => `${t(getPassive(id).nameKey as TextKey)}: ${describeRule(getPassive(id))}`,
      );
      return [...passive, t('reward.classAbilities')].join('. ');
    }
    case 'upgrade':
      return t(`upgrade.${o.upgrade}.desc` as TextKey);
    case 'gift':
      return describeRule(getGift(o.id));
  }
}

/** The patrons a gift belongs to: one, or two for a duo gift. */
export function giftPatrons(id: string): string[] {
  const g = getGift(id);
  return g.patrons ? [...g.patrons] : g.patron ? [g.patron] : [];
}

export const cssColor = (c: number) => `#${c.toString(16).padStart(6, '0')}`;

/** A gift card wears its patron's colour and sign; a duo gift is gold and shows both signs. */
function giftLook(o: Option): { style?: Record<string, string>; signs: string } {
  if (o.kind !== 'gift') return { signs: '' };
  const patrons = giftPatrons(o.id).map(getPatron);
  const signs = patrons.map((p) => p.icon).join(' ');
  if (patrons.length > 1) return { signs };
  const c = cssColor(patrons[0]?.color ?? 0xffffff);
  return { style: { '--patron': c }, signs };
}

/** Tags shown on ability cards; a cursed item says so. */
function badges(o: Option): string[] {
  if (o.kind === 'ability') return getAbility(o.id).tags.map((tag) => t(`tag.${tag}` as TextKey));
  if (o.kind === 'item' && getItem(o.id).cursed) return [t('reward.cursed')];
  if (o.kind === 'gift' && getGift(o.id).patrons) return [t('reward.duo')];
  return [];
}

/** An altar's offer is titled with its patron: "Altar of Morra, Queen of Plague". */
function altarTitle(offer: readonly Option[]): string | null {
  const solo = offer.find((o) => o.kind === 'gift' && !getGift(o.id).patrons);
  const id = solo?.kind === 'gift' ? getGift(solo.id).patron : undefined;
  if (!id) return null;
  const p = getPatron(id);
  return `${p.icon} ${t('reward.altar', { patron: t(`${p.nameKey}.gen` as TextKey), title: t(`${p.nameKey}.title` as TextKey) })}`;
}

/** Pick 1 of 3 after a cleared room (GDD 1). A new ability with full slots asks which one to replace. */
export function RewardScreen({ game, actions }: { game: GameState; actions: RewardActions }) {
  const [replacing, setReplacing] = useState<number | null>(null);
  const run = game.run;
  const p = game.players[0];
  if (!run || !p) return null;
  const full = p.abilities.length > ABILITY_SLOTS;

  if (replacing !== null) {
    const o = run.offer[replacing];
    return (
      <div class="reward" data-testid="reward-replace">
        <div class="reward-title">{t('reward.replace', { name: o ? title(o) : '' })}</div>
        <div class="reward-cards">
          {p.abilities.slice(1).map((id, i) => (
            <button type="button" key={id} class="reward-card" onClick={() => actions.chooseReward(replacing, i + 1)}>
              <div class="reward-kind">{i + 2}</div>
              <div class="reward-name">{abilityName(getAbility(id))}</div>
              <div class="reward-desc">{describeAbility(getAbility(id))}</div>
            </button>
          ))}
        </div>
        <button type="button" class="reward-skip" onClick={() => setReplacing(null)}>
          {t('reward.back')}
        </button>
      </div>
    );
  }

  return (
    <div class="reward" data-testid="reward">
      <div class="reward-title">{altarTitle(run.offer) ?? t('reward.title')}</div>
      <div class="reward-cards">
        {run.offer.map((o, i) => (
          <button
            type="button"
            key={i}
            class={`reward-card reward-${o.kind}${o.kind === 'gift' && getGift(o.id).patrons ? ' reward-duo' : ''}`}
            style={giftLook(o).style}
            onClick={() => (o.kind === 'ability' && full ? setReplacing(i) : actions.chooseReward(i))}
            data-testid={`reward-${i}`}
          >
            <div class="reward-kind">
              {i + 1} · {t(`reward.kind.${o.kind}` as TextKey)}
            </div>
            <div class="reward-name">
              {giftLook(o).signs && <span class="reward-sign">{giftLook(o).signs}</span>}
              {title(o)}
            </div>
            {badges(o).length > 0 && (
              <div class="reward-badges">
                {badges(o).map((b) => (
                  <span
                    key={b}
                    class={o.kind === 'item' ? 'badge badge-cursed' : o.kind === 'gift' ? 'badge badge-duo' : 'badge'}
                  >
                    {b}
                  </span>
                ))}
              </div>
            )}
            <div class="reward-desc">{body(o)}</div>
          </button>
        ))}
      </div>
      <button type="button" class="reward-skip" onClick={() => actions.chooseReward(null)} data-testid="reward-skip">
        {t('reward.skip')}
      </button>
    </div>
  );
}
