import { getAbility } from '../content';
import { t, type TextKey } from '../i18n';
import { cooldownOf } from '../sim';
import { abilityName, describeAbility } from './describe';
import type { ViewState } from './store';

export interface HudActions {
  selectAbility(slot: number): void;
  endTurn(): void;
  undo(): void;
}

const NOTICE_MS = 1400;

/** Health, action points, abilities and turn controls. */
export function Hud({ view, actions, now }: { view: ViewState; actions: HudActions; now: number }) {
  const { game } = view;
  const p = game.players[0];
  if (!p) return null;
  const active = game.combat.status === 'active';
  const yourTurn = active && !view.busy;
  const selected = view.selected ? getAbility(view.selected) : null;
  const notice = view.notice && now - view.notice.at < NOTICE_MS ? view.notice : null;
  const hp = view.shownHp ?? p.hp;
  const target =
    view.preview && !view.preview.rejected && view.preview.damage.size === 0 && view.preview.deaths.size === 0;

  return (
    <>
      <div class="turn-banner" data-testid="turn-banner">
        <span class="turn-number">{t('hud.turn', { n: game.combat.turn })}</span>
        {active && (
          <span class={yourTurn ? 'phase phase-player' : 'phase phase-enemy'}>
            {yourTurn ? t('hud.yourTurn') : t('hud.enemyTurn')}
          </span>
        )}
      </div>

      {notice && (
        <div class="notice" data-testid="notice">
          {t(`reject.${notice.reason}` as TextKey)}
        </div>
      )}
      <div class="bottom-stack">
        {selected && yourTurn && (
          <div class="selection-hint">
            {t('hud.selected', { name: abilityName(selected) })}
            {target && <div class="selection-sub">{t('hud.noTarget')}</div>}
          </div>
        )}

        <div class="hud" data-testid="hud">
          <div class="hud-vitals">
            <div class="hp" data-testid="hp">
              <span class="hud-label">{t('hud.hp')}</span>
              <div class="hp-bar">
                <div class="hp-fill" style={{ width: `${(100 * hp) / p.maxHp}%` }} />
                <span class="hp-text">
                  {hp}/{p.maxHp}
                </span>
              </div>
            </div>
            <div class="ap" data-testid="ap">
              <span class="hud-label">{t('hud.ap')}</span>
              {Array.from({ length: p.maxAp }, (_, i) => (
                <span
                  key={i}
                  class={`ap-pip ${i < p.ap ? 'full' : ''} ${selected && i >= p.ap - selected.apCost && i < p.ap ? 'spend' : ''}`}
                />
              ))}
            </div>
          </div>

          <div class="abilities">
            {p.abilities.map((id, slot) => {
              const a = getAbility(id);
              const cd = cooldownOf(p, id);
              const usable = yourTurn && cd === 0 && p.ap >= a.apCost;
              return (
                <button
                  key={id}
                  type="button"
                  class={`ability ${view.selected === id ? 'selected' : ''} ${usable ? '' : 'disabled'}`}
                  onClick={() => actions.selectAbility(slot)}
                  title={describeAbility(a)}
                  data-testid={`ability-${slot + 1}`}
                >
                  <span class="ability-key">{slot + 1}</span>
                  <span class="ability-name">{abilityName(a)}</span>
                  <span class="ability-desc">{describeAbility(a)}</span>
                  <span class="ability-cost">
                    {cd > 0 ? t('hud.cooldown', { n: cd }) : t('hud.apCost', { n: a.apCost })}
                  </span>
                </button>
              );
            })}
          </div>

          <div class="turn-buttons">
            <button
              type="button"
              class="end-turn"
              disabled={!yourTurn}
              onClick={actions.endTurn}
              data-testid="end-turn"
            >
              {t('hud.endTurn')} <kbd>Space</kbd>
            </button>
            <button type="button" class="undo" disabled={!view.canUndo} onClick={actions.undo}>
              {t('hud.undo')} <kbd>Z</kbd>
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
