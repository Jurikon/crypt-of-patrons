import { getAbility } from '../content';
import { t, type TextKey } from '../i18n';
import { cooldownOf, intentCells, type GameState } from '../sim';
import { abilityName, describeAbility } from './describe';
import type { ViewState } from './store';

export interface HudActions {
  selectAbility(slot: number): void;
}

const NOTICE_MS = 1400;

/** Damage the telegraphed enemy attacks will deal to a player if nothing changes. */
function incomingDamage(game: GameState, playerId: string): number {
  let total = 0;
  for (const e of game.enemies) {
    if (e.intent && intentCells(game, e, e.intent).hit?.id === playerId) total += e.intent.damage;
  }
  return total;
}

/** Health, abilities and the turn counter. Every step or ability is one turn; there is no "end turn". */
export function Hud({ view, actions, now }: { view: ViewState; actions: HudActions; now: number }) {
  const { game } = view;
  const p = game.players[0];
  if (!p) return null;
  const active = game.combat.status === 'active';
  const selected = view.selected ? getAbility(view.selected) : null;
  const notice = view.notice && now - view.notice.at < NOTICE_MS ? view.notice : null;
  const hp = view.shownHp ?? p.hp;
  const incoming = active && !view.busy && !p.god ? Math.min(hp, incomingDamage(game, p.id)) : 0;
  const emptyTarget =
    view.preview && !view.preview.rejected && view.preview.damage.size === 0 && view.preview.deaths.size === 0;

  return (
    <>
      <div class="turn-banner" data-testid="turn-banner">
        <span class="turn-number">{t('hud.turn', { n: game.combat.turn })}</span>
      </div>

      {notice && (
        <div class="notice" data-testid="notice">
          {t(`reject.${notice.reason}` as TextKey)}
        </div>
      )}

      <div class="bottom-stack">
        {incoming > 0 && (
          <div class="danger-hint" data-testid="danger">
            {t('hud.incoming', { n: incoming })}
          </div>
        )}
        {selected && active && (
          <div class="selection-hint">
            {t('hud.selected', { name: abilityName(selected) })}
            {emptyTarget && <div class="selection-sub">{t('hud.noTarget')}</div>}
          </div>
        )}

        <div class="hud" data-testid="hud">
          <div class="hud-vitals">
            <div class="hp" data-testid="hp">
              <span class="hud-label">{t('hud.hp')}</span>
              <div class="hp-bar">
                <div class="hp-fill" style={{ width: `${(100 * hp) / p.maxHp}%` }} />
                {incoming > 0 && (
                  <div
                    class="hp-incoming"
                    style={{ left: `${(100 * (hp - incoming)) / p.maxHp}%`, width: `${(100 * incoming) / p.maxHp}%` }}
                  />
                )}
                <span class="hp-text">
                  {hp}/{p.maxHp}
                </span>
              </div>
            </div>
          </div>

          <div class="abilities">
            {p.abilities.map((id, slot) => {
              const a = getAbility(id);
              const cd = cooldownOf(p, id);
              const usable = active && cd === 0;
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
                  {slot === 0 && <span class="ability-cost">{t('hud.baseAttack')}</span>}
                  {cd > 0 && <span class="ability-cost">{t('hud.cooldown', { n: cd })}</span>}
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </>
  );
}
