import { ACT, getAbility, getClass, getModifier } from '../content';
import { t, type TextKey } from '../i18n';
import type { GameState } from '../sim';
import { abilityName } from './describe';

export interface ResultActions {
  /** Back to the class choice for a new run. */
  newRun(): void;
  /** The same run again (same seed, same class). */
  retry(): void;
}

const clock = (ms: number) => {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

/** End of a run (death or the boss beaten), once its animations have finished: what you achieved and built. */
export function ResultScreen({
  game,
  elapsedMs,
  actions,
}: {
  game: GameState;
  elapsedMs: number;
  actions: ResultActions;
}) {
  const p = game.players[0];
  const run = game.run;
  const won = run ? run.phase === 'won' : game.combat.status === 'won';
  const cleared = run ? run.log.filter((e) => e.type === 'cleared').length : 0;
  const turns = run ? run.turns : game.combat.turn;
  const upgrades = p?.upgrades ?? [];
  return (
    <div class={`result ${won ? 'result-won' : 'result-lost'}`} data-testid="result">
      <div class="result-title">{won ? t('result.runWon') : t('result.runLost')}</div>
      <table class="result-stats">
        <tbody>
          <tr>
            <th>{t('result.class')}</th>
            <td>{p ? t(getClass(p.classId).nameKey as TextKey) : '—'}</td>
          </tr>
          <tr>
            <th>{t('result.rooms')}</th>
            <td>
              {cleared} / {ACT.rooms + 1}
            </td>
          </tr>
          <tr>
            <th>{t('result.time')}</th>
            <td>{clock(elapsedMs)}</td>
          </tr>
          <tr>
            <th>{t('result.turns')}</th>
            <td>{turns}</td>
          </tr>
        </tbody>
      </table>
      {p && (
        <div class="result-build">
          <div class="result-build-title">{t('result.build')}</div>
          <div>{p.abilities.map((id) => abilityName(getAbility(id))).join(' · ')}</div>
          {p.modifiers.length > 0 && (
            <div class="result-mods">
              ✦ {p.modifiers.map((id) => t(getModifier(id).nameKey as TextKey)).join(' · ')}
            </div>
          )}
          {upgrades.length > 0 && (
            <div class="result-ups">
              ▲{' '}
              {upgrades
                .map((u) => `${abilityName(getAbility(u.abilityId))} ${t(`upgrade.${u.kind}` as TextKey)}`)
                .join(' · ')}
            </div>
          )}
        </div>
      )}
      <div class="result-buttons">
        <button type="button" onClick={actions.newRun} data-testid="new-run">
          {t('result.newRun')}
        </button>
        <button type="button" onClick={actions.retry} data-testid="retry">
          {t('result.sameSeed')}
        </button>
      </div>
    </div>
  );
}
