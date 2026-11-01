import { useState } from 'preact/hooks';
import { ABILITY_SLOTS, getAbility, getEvent, getItem, SHOP } from '../content';
import { t, type TextKey } from '../i18n';
import { canAfford, removableCurses, type GameState } from '../sim';
import { abilityName, describeAbility } from './describe';
import { badges, body, giftLook, Glossary, terms, title, worksWith } from './RewardScreen';

export interface PeacefulActions {
  /** Buy ware `index`; `replace` is the slot a new ability takes over. */
  buy(index: number, replace?: number): void;
  shopService(service: 'heal' | 'uncurse' | 'reroll', itemId?: string): void;
  eventChoice(index: number): void;
  /** Close the shop (walk away from the merchant). */
  closeNpc(): void;
}

/** The merchant (M6c): wares as reward cards with a price; what you cannot afford is greyed out. */
export function ShopScreen({ game, actions }: { game: GameState; actions: PeacefulActions }) {
  const [replacing, setReplacing] = useState<number | null>(null);
  const run = game.run;
  const p = game.players[0];
  if (!run?.shop || !p) return null;
  const full = p.abilities.length > ABILITY_SLOTS;
  const curses = removableCurses(p);
  const healAmount = Math.min(p.maxHp - p.hp, Math.ceil(p.maxHp * SHOP.heal.share));

  if (replacing !== null) {
    const w = run.shop.wares[replacing];
    return (
      <div class="reward" data-testid="shop-replace">
        <div class="reward-title">{t('reward.replace', { name: w ? title(w.option) : '' })}</div>
        <div class="reward-cards">
          {p.abilities.slice(1).map((id, i) => (
            <button
              type="button"
              key={id}
              class="reward-card"
              onClick={() => {
                actions.buy(replacing, i + 1);
                setReplacing(null);
              }}
            >
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
    <div class="reward shop" data-testid="shop">
      <div class="reward-title">⚖ {t('shop.title')}</div>
      <div class="reward-hint">{t('shop.text')}</div>
      <div class="shop-gold">{t('shop.gold', { n: run.gold })}</div>
      <div class="reward-cards">
        {run.shop.wares.map((w, i) => {
          const poor = run.gold < w.price;
          const o = w.option;
          return (
            <button
              type="button"
              key={i}
              class={`reward-card reward-${o.kind}${w.sold ? ' shop-sold' : ''}${poor && !w.sold ? ' shop-poor' : ''}`}
              style={giftLook(o).style}
              disabled={w.sold || poor}
              title={poor ? t('shop.tooPoor') : undefined}
              onClick={() => (o.kind === 'ability' && full ? setReplacing(i) : actions.buy(i))}
              data-testid={`ware-${i}`}
            >
              <div class="reward-kind">
                {t(`reward.kind.${o.kind}` as TextKey)} ·{' '}
                <b class="shop-price">{w.sold ? t('shop.sold') : t('shop.price', { n: w.price })}</b>
              </div>
              <div class="reward-name">{title(o)}</div>
              {badges(o).length > 0 && (
                <div class="reward-badges">
                  {badges(o).map((b) => (
                    <span key={b} class={o.kind === 'item' ? 'badge badge-cursed' : 'badge'}>
                      {b}
                    </span>
                  ))}
                </div>
              )}
              <div class="reward-desc">{body(o)}</div>
              {worksWith(o, p) && <div class="reward-works">{worksWith(o, p)}</div>}
              <Glossary entries={terms(o)} />
            </button>
          );
        })}
      </div>
      <div class="reward-hint">{t('shop.services')}</div>
      <div class="reward-actions">
        <button
          type="button"
          class="reward-skip"
          disabled={healAmount <= 0 || run.gold < SHOP.heal.price}
          onClick={() => actions.shopService('heal')}
          data-testid="shop-heal"
        >
          ♥ {healAmount > 0 ? t('shop.heal', { n: healAmount }) : t('shop.healFull')} —{' '}
          {t('shop.price', { n: SHOP.heal.price })}
        </button>
        {curses.length ? (
          curses.map((id) => (
            <button
              type="button"
              key={id}
              class="reward-skip"
              disabled={run.gold < SHOP.uncurse}
              onClick={() => actions.shopService('uncurse', id)}
            >
              ✕ {t('shop.uncurse', { name: t(getItem(id).nameKey as TextKey) })} —{' '}
              {t('shop.price', { n: SHOP.uncurse })}
            </button>
          ))
        ) : (
          <button type="button" class="reward-skip" disabled>
            ✕ {t('shop.noCurse')}
          </button>
        )}
        <button
          type="button"
          class="reward-skip"
          disabled={run.gold < SHOP.reroll}
          onClick={() => actions.shopService('reroll')}
          data-testid="shop-reroll"
        >
          ↻ {t('shop.reroll')} — {t('shop.price', { n: SHOP.reroll })}
        </button>
        <button type="button" class="reward-skip" onClick={actions.closeNpc} data-testid="shop-leave">
          {t('shop.leave')}
        </button>
      </div>
    </div>
  );
}

/** An event (M6c): its story and the options, each with its price; what you cannot pay is greyed out. */
export function EventScreen({ game, actions }: { game: GameState; actions: PeacefulActions }) {
  const run = game.run;
  const p = game.players[0];
  if (!run?.event || !p) return null;
  const def = getEvent(run.event);
  return (
    <div class="reward event" data-testid="event">
      <div class="reward-title">? {t(def.nameKey as TextKey)}</div>
      <div class="event-text">{t(def.textKey as TextKey)}</div>
      <div class="event-options">
        {def.options.map((o, i) => {
          const ok = canAfford(game, p, o.cost);
          const costs = [
            o.cost?.gold ? t('event.cost.gold', { n: o.cost.gold }) : null,
            o.cost?.hp ? t('event.cost.hp', { n: o.cost.hp }) : null,
          ].filter(Boolean);
          return (
            <button
              type="button"
              key={i}
              class={`event-option${ok ? '' : ' shop-poor'}`}
              disabled={!ok}
              onClick={() => actions.eventChoice(i)}
              data-testid={`event-${i}`}
            >
              <span class="event-num">{i + 1}</span> {t(o.textKey as TextKey)}
              {costs.length > 0 && <span class="event-cost">{costs.join(', ')}</span>}
            </button>
          );
        })}
      </div>
      <button type="button" class="reward-skip" onClick={actions.closeNpc}>
        {t('reward.back')}
      </button>
    </div>
  );
}
