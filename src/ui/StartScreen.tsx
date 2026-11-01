import { CLASSES, getAbility, getPassive, PERKS } from '../content';
import { t, type TextKey } from '../i18n';
import { nextCost, perkLevel, type MetaSave } from '../sim';
import { abilityName, describeAbility, describeRule } from './describe';

export interface StartActions {
  startRun(classId: string): void;
  continueRun(): void;
  /** Buy the next level of a Chapel upgrade with Ash. */
  buyPerk(id: string): void;
}

/** Run start: pick a class (GDD 2), or continue the saved run. */
export function StartScreen({
  actions,
  canContinue,
  saveError,
  meta,
}: {
  actions: StartActions;
  canContinue: boolean;
  saveError: boolean;
  meta: MetaSave;
}) {
  return (
    <div class="start" data-testid="start-screen">
      <div class="start-title">{t('game.title')}</div>
      {saveError && <div class="start-error">{t('start.saveError')}</div>}
      {canContinue && (
        <button type="button" class="start-continue" onClick={actions.continueRun} data-testid="continue">
          {t('start.continue')}
        </button>
      )}
      <div class="start-sub">{t('start.choose')}</div>
      <div class="start-classes">
        {CLASSES.map((c) => {
          const [base, start] = c.abilities.map((id) => getAbility(id));
          return (
            <button
              type="button"
              key={c.id}
              class="class-card"
              onClick={() => actions.startRun(c.id)}
              data-testid={`start-${c.id}`}
            >
              <div class="class-name">{t(c.nameKey as TextKey)}</div>
              <div class="class-hp">
                {t('hud.hp')} {c.maxHp}
              </div>
              {[base, start].map(
                (a) =>
                  a && (
                    <div key={a.id} class="class-line">
                      <b>{abilityName(a)}</b> — {describeAbility(a)}
                    </div>
                  ),
              )}
              {c.passives.map((id) => (
                <div key={id} class="class-line class-passive">
                  <b>{t(getPassive(id).nameKey as TextKey)}</b> — {describeRule(getPassive(id))}
                </div>
              ))}
            </button>
          );
        })}
      </div>
      <Chapel meta={meta} buy={actions.buyPerk} />
    </div>
  );
}

/** The Chapel (M6b, GDD 3): Ash from past runs buys upgrades that every new run starts with. */
function Chapel({ meta, buy }: { meta: MetaSave; buy: (id: string) => void }) {
  return (
    <div class="chapel" data-testid="chapel">
      <div class="chapel-title">
        {t('chapel.title')} <span class="chapel-ash">✧ {meta.ash}</span>
      </div>
      <div class="chapel-sub">{t('chapel.sub')}</div>
      <div class="chapel-perks">
        {PERKS.map((p) => {
          const level = perkLevel(meta, p.id);
          const cost = nextCost(meta, p.id);
          return (
            <button
              type="button"
              key={p.id}
              class={`chapel-perk${cost === null ? ' maxed' : ''}`}
              disabled={cost === null || meta.ash < cost}
              onClick={() => buy(p.id)}
              data-testid={`perk-${p.id}`}
            >
              <div class="chapel-perk-name">
                {p.icon} {t(p.nameKey as TextKey)}
              </div>
              <div class="chapel-perk-desc">{t(`${p.nameKey}.desc` as TextKey)}</div>
              <div class="chapel-perk-level">
                {'●'.repeat(level)}
                {'○'.repeat(p.costs.length - level)} {cost === null ? t('chapel.max') : `✧ ${cost}`}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
