import { CLASSES, getAbility, getPassive } from '../content';
import { t, type TextKey } from '../i18n';
import { abilityName, describeAbility, describeRule } from './describe';

export interface StartActions {
  startRun(classId: string): void;
  continueRun(): void;
}

/** Run start: pick a class (GDD 2), or continue the saved run. */
export function StartScreen({
  actions,
  canContinue,
  saveError,
}: {
  actions: StartActions;
  canContinue: boolean;
  saveError: boolean;
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
    </div>
  );
}
