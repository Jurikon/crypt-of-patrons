import { useState } from 'preact/hooks';
import { ABILITY_SLOTS, getAbility, getModifier } from '../content';
import { t, type TextKey } from '../i18n';
import type { GameState } from '../sim';
import { abilityName, describeAbility, describeRule } from './describe';

export interface RewardActions {
  /** Take option `index` (null = take nothing); `replace` is the slot a new ability takes over. */
  chooseReward(index: number | null, replace?: number): void;
}

type Option = NonNullable<GameState['run']>['offer'][number];

function title(o: Option): string {
  if (o.kind === 'ability') return abilityName(getAbility(o.id));
  if (o.kind === 'modifier') return t(getModifier(o.id).nameKey as TextKey);
  return `${abilityName(getAbility(o.abilityId))}: ${t(`upgrade.${o.upgrade}` as TextKey)}`;
}

function body(o: Option): string {
  if (o.kind === 'ability') return describeAbility(getAbility(o.id));
  if (o.kind === 'modifier') return describeRule(getModifier(o.id));
  return t(`upgrade.${o.upgrade}.desc` as TextKey);
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
      <div class="reward-title">{t('reward.title')}</div>
      <div class="reward-cards">
        {run.offer.map((o, i) => (
          <button
            type="button"
            key={i}
            class={`reward-card reward-${o.kind}`}
            onClick={() => (o.kind === 'ability' && full ? setReplacing(i) : actions.chooseReward(i))}
            data-testid={`reward-${i}`}
          >
            <div class="reward-kind">
              {i + 1} · {t(`reward.kind.${o.kind}` as TextKey)}
            </div>
            <div class="reward-name">{title(o)}</div>
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
