import { useState } from 'preact/hooks';
import { ABILITIES, ABILITY_SLOTS, ACT, CLASSES, EVENTS, GIFTS, ITEMS, MODIFIERS, PATRONS } from '../content';
import { abilityName, describeAbility, describeRule } from '../ui/describe';
import { t, type TextKey } from '../i18n';
import type { DebugAction } from '../sim';
import type { ViewState } from '../ui/store';

export interface OverlayActions {
  newSeed(): void;
  /** Returns the text for a bug report: seed plus the command list. */
  exportState(): string;
  /** Debug cheats go through the simulation as commands, so bug reports replay exactly. */
  cheat(action: DebugAction): void;
  toggleQuality(): void;
  /** Smooth or retro pixels. */
  toggleStyle(): void;
  /** Restart the room with another class. */
  setClass(classId: string): void;
  grantAbility(abilityId: string, slot: number): void;
  toggleModifier(modifierId: string): void;
  toggleItem(itemId: string): void;
  toggleGift(giftId: string): void;
  /** Hide the menu (F1 does the same). */
  closeDebug(): void;
  /** Go to a room of an act (ACT.rooms + 1 = its boss). */
  jump(act: number, depth: number): void;
  addClass(classId: string): void;
  resetSave(): void;
  /** The next doors include this event. */
  forceEvent(eventId: string): void;
}

/** Debug overlay toggled with the backquote key. */
export function DebugOverlay({ view, actions }: { view: ViewState; actions: OverlayActions }) {
  const [copied, setCopied] = useState(false);
  const [grant, setGrant] = useState(ABILITIES[0]?.id ?? '');
  const { game, fps } = view;
  const p = game.players[0];

  const copy = async () => {
    const text = actions.exportState();
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard can be blocked (permissions, insecure origin): fall back to a prompt the user can copy from.
      window.prompt(t('debug.copyState'), text);
    }
  };

  return (
    <div class="debug" data-testid="debug-overlay">
      <div class="debug-title">
        {t('debug.title')}
        <span class="debug-hint">{t('debug.hint')}</span>
        <button type="button" class="debug-close" onClick={actions.closeDebug} data-testid="debug-close">
          ✕
        </button>
      </div>
      <table>
        <tbody>
          <Row label={t('debug.seed')} value={String(game.seed)} testId="debug-seed" />
          <Row label={t('debug.fps')} value={String(Math.round(fps))} testId="debug-fps" />
          <Row label={t('debug.position')} value={p ? `${p.x}, ${p.y}` : '—'} testId="debug-pos" />
          <Row label={t('debug.direction')} value={p ? t(`dir.${p.dir}` as TextKey) : '—'} />
          <Row
            label={t('debug.shape')}
            value={`${t(`shape.${game.room.shape}` as TextKey)} ${game.room.interior.w}×${game.room.interior.h}`}
          />
        </tbody>
      </table>
      <div class="debug-buttons">
        <button type="button" onClick={actions.newSeed} data-testid="new-seed">
          {t('debug.newSeed')}
        </button>
        <button type="button" onClick={copy}>
          {copied ? t('debug.copied') : t('debug.copyState')}
        </button>
      </div>
      <div class="debug-buttons">
        <button type="button" onClick={() => actions.cheat('killAll')} data-testid="kill-all">
          {t('debug.skipRoom')}
        </button>
        <button type="button" onClick={() => actions.cheat('toBoss')} data-testid="to-boss">
          {t('debug.toBoss')}
        </button>
        <button type="button" onClick={() => actions.cheat('heal')}>
          {t('debug.heal')}
        </button>
        <button type="button" onClick={() => actions.cheat('altarNext')} data-testid="altar-next">
          {t('debug.altarNext')}
        </button>
        <button type="button" onClick={() => actions.cheat('merchantNext')} data-testid="merchant-next">
          {t('debug.merchantNext')}
        </button>
        <button type="button" onClick={() => actions.cheat('gold')} data-testid="give-gold">
          {t('debug.gold')}
        </button>
        <select
          data-testid="event-next"
          onChange={(e) => {
            const id = (e.target as HTMLSelectElement).value;
            if (id) actions.forceEvent(id);
            (e.target as HTMLSelectElement).value = '';
          }}
        >
          <option value="">{t('debug.eventNext')}</option>
          {EVENTS.map((ev) => (
            <option key={ev.id} value={ev.id}>
              {t(ev.nameKey as TextKey)}
            </option>
          ))}
        </select>
      </div>
      <div class="debug-buttons">
        <button type="button" onClick={actions.toggleStyle} data-testid="style">
          {t('settings.style')}: {t(view.style === 'smooth' ? 'settings.smooth' : 'settings.retro')}
        </button>
        <button type="button" onClick={actions.toggleQuality} data-testid="quality">
          {t('debug.quality')}: {t(view.quality === 'high' ? 'debug.qualityHigh' : 'debug.qualityLow')}
        </button>
        <button type="button" onClick={() => actions.cheat('toggleGod')} data-testid="god">
          {t('debug.god')}: {p?.god ? t('debug.on') : t('debug.off')}
        </button>
      </div>
      <div class="debug-buttons">
        <button type="button" onClick={actions.resetSave} data-testid="reset-save">
          {t('debug.resetSave')}
        </button>
      </div>

      <div class="debug-section">{t('debug.jump')}</div>
      {Array.from({ length: ACT.acts }, (_, a) => (
        <div key={a} class="debug-buttons debug-slots">
          <span>{t('debug.act', { n: a + 1 })}</span>
          {Array.from({ length: ACT.rooms + 1 }, (_, d) => (
            <button
              type="button"
              key={d}
              class={game.run?.act === a + 1 && game.run.depth === d + 1 ? 'active' : ''}
              onClick={() => actions.jump(a + 1, d + 1)}
              data-testid={`jump-${a + 1}-${d + 1}`}
            >
              {d === ACT.rooms ? '☠' : d + 1}
            </button>
          ))}
        </div>
      ))}

      <div class="debug-section">{t('debug.class')}</div>
      <div class="debug-buttons">
        {CLASSES.map((c) => (
          <button
            type="button"
            key={c.id}
            class={p?.classId === c.id ? 'active' : ''}
            onClick={() => actions.setClass(c.id)}
            data-testid={`class-${c.id}`}
          >
            {t(c.nameKey as TextKey)}
          </button>
        ))}
      </div>

      <div class="debug-buttons">
        <span>{t('debug.addClass')}</span>
        {CLASSES.filter((c) => !p?.classes.includes(c.id)).map((c) => (
          <button type="button" key={c.id} onClick={() => actions.addClass(c.id)} data-testid={`add-${c.id}`}>
            + {t(c.nameKey as TextKey)}
          </button>
        ))}
      </div>

      <div class="debug-section">{t('debug.grant')}</div>
      <select
        class="debug-select"
        value={grant}
        onChange={(e) => setGrant((e.target as HTMLSelectElement).value)}
        data-testid="grant-select"
      >
        {CLASSES.map((c) => (
          <optgroup key={c.id} label={t(c.nameKey as TextKey)}>
            {ABILITIES.filter((a) => [...c.abilities, ...c.pool].includes(a.id)).map((a) => (
              <option key={a.id} value={a.id} title={describeAbility(a)}>
                {abilityName(a)}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
      <div class="debug-buttons debug-slots">
        <span>{t('debug.slot')}</span>
        {Array.from({ length: ABILITY_SLOTS }, (_, i) => (
          <button
            type="button"
            key={i}
            onClick={() => actions.grantAbility(grant, i + 1)}
            data-testid={`grant-${i + 1}`}
          >
            {i + 2}
          </button>
        ))}
      </div>

      <div class="debug-section">{t('debug.modifiers')}</div>
      <div class="debug-mods">
        {MODIFIERS.map((m) => (
          <label key={m.id} title={describeRule(m)}>
            <input
              type="checkbox"
              checked={p?.modifiers.includes(m.id) ?? false}
              onChange={() => actions.toggleModifier(m.id)}
              data-testid={`mod-${m.id}`}
            />
            {t(m.nameKey as TextKey)}
          </label>
        ))}
      </div>

      <div class="debug-section">{t('debug.items')}</div>
      <div class="debug-mods">
        {ITEMS.map((it) => (
          <label key={it.id} title={describeRule(it)}>
            <input
              type="checkbox"
              checked={p?.items.includes(it.id) ?? false}
              onChange={() => actions.toggleItem(it.id)}
              data-testid={`item-${it.id}`}
            />
            {it.icon} {t(it.nameKey as TextKey)}
            {it.cursed ? ' ☠' : ''}
          </label>
        ))}
      </div>

      <div class="debug-section">{t('debug.gifts')}</div>
      {[
        ...PATRONS.map((pt) => ({ key: pt.id, label: `${pt.icon} ${t(pt.nameKey as TextKey)}`, ids: pt.gifts })),
        {
          key: 'duo',
          label: t('reward.duo'),
          ids: GIFTS.filter((g) => g.patrons).map((g) => g.id),
        },
      ].map((group) => (
        <div key={group.key} class="debug-mods">
          <span class="debug-group">{group.label}</span>
          {group.ids.map((id) => {
            const g = GIFTS.find((x) => x.id === id)!;
            return (
              <label key={id} title={describeRule(g)}>
                <input
                  type="checkbox"
                  checked={p?.gifts.includes(id) ?? false}
                  onChange={() => actions.toggleGift(id)}
                  data-testid={`gift-${id}`}
                />
                {t(g.nameKey as TextKey)}
              </label>
            );
          })}
        </div>
      ))}
    </div>
  );
}

function Row({ label, value, testId }: { label: string; value: string; testId?: string }) {
  return (
    <tr>
      <th>{label}</th>
      <td data-testid={testId}>{value}</td>
    </tr>
  );
}
