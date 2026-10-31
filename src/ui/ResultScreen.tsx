import { t } from '../i18n';
import type { GameState } from '../sim';

export interface ResultActions {
  retry(): void;
  newRoom(): void;
}

/** Victory or death screen once the fight is over and its animations have finished. */
export function ResultScreen({ game, actions }: { game: GameState; actions: ResultActions }) {
  const won = game.combat.status === 'won';
  return (
    <div class={`result ${won ? 'result-won' : 'result-lost'}`} data-testid="result">
      <div class="result-title">{won ? t('result.won') : t('result.lost')}</div>
      <div class="result-text">
        {won ? t('result.wonText', { n: game.combat.turn }) : t('result.lostText', { n: game.combat.turn })}
      </div>
      <div class="result-buttons">
        <button type="button" onClick={actions.retry} data-testid="retry">
          {t('result.retry')}
        </button>
        <button type="button" onClick={actions.newRoom} data-testid="new-room">
          {t('result.newRoom')}
        </button>
      </div>
    </div>
  );
}
