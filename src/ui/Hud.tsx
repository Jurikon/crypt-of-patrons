import {
  ACT,
  getAbility,
  getClass,
  getGift,
  getHybrid,
  getItem,
  getModifier,
  getPassive,
  getPatron,
  getStatus,
  PATRONS,
  type RuleDef,
} from '../content';
import { t, type TextKey } from '../i18n';
import { cooldownOf, intentCells, type GameState } from '../sim';
import { abilityName, describeAbility, describeRule, glossary, glossaryText } from './describe';
import { cssColor, giftPatrons } from './RewardScreen';
import { GOAL_ICONS } from './WorldOverlay';
import type { ViewState } from './store';

export interface HudActions {
  selectAbility(slot: number): void;
}

const NOTICE_MS = 1400;

/** Damage the telegraphed enemy attacks will deal to a player if nothing changes. */
function incomingDamage(game: GameState, playerId: string): number {
  let total = 0;
  for (const e of game.enemies) {
    if (e.intent && intentCells(game, e, e.intent).hits.some((u) => u.id === playerId)) total += e.intent.damage;
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
  const aimed = selected && ['line', 'unit', 'cell'].includes(selected.target.kind);
  const emptyTarget =
    selected?.target.kind === 'front' &&
    view.preview &&
    !view.preview.rejected &&
    view.preview.damage.size === 0 &&
    view.preview.deaths.size === 0;

  return (
    <>
      <div class="turn-banner" data-testid="turn-banner">
        {game.run && <RunProgress run={game.run} />}
        {game.combat.goal && game.combat.status === 'active' && <GoalBanner game={game} />}
        <span class="turn-number">{t('hud.turn', { n: game.combat.turn })}</span>
      </div>

      {!view.topView && (p.modifiers.length > 0 || p.items.length > 0 || p.gifts.length > 0 || p.hybrid) && (
        <BuildPanel player={p} />
      )}

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
        {p.freeActions > 0 && active && (
          <div class="free-hint" data-testid="free-action">
            {t('hud.freeReady')}
          </div>
        )}
        {selected && active && (
          <div class="selection-hint">
            {t(aimed ? 'hud.aim' : 'hud.selected', { name: abilityName(selected) })}
            <div class="selection-sub">{describeAbility(selected)}</div>
            {glossary(selected).map((g) => (
              <div key={g.name} class="selection-sub glossary-line">
                <span class="glossary-name">{g.name}:</span> {g.text}
              </div>
            ))}
            {emptyTarget && <div class="selection-sub">{t('hud.noTarget')}</div>}
          </div>
        )}

        <div class="hud" data-testid="hud">
          <div class="hud-vitals">
            <div class="hud-class" title={p.passives.map((id) => describeRule(getPassive(id))).join('. ')}>
              {p.hybrid ? (
                <b class="hud-hybrid">{t(getHybrid(p.hybrid).nameKey as TextKey)}</b>
              ) : (
                p.classes.map((c) => t(getClass(c).nameKey as TextKey)).join(' + ')
              )}{' '}
              · {p.passives.map((id) => t(getPassive(id).nameKey as TextKey)).join(', ')}
            </div>
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
            {p.statuses.length > 0 && (
              <div class="hud-statuses">
                {p.statuses.map((st) => (
                  <span key={st.id} class="hud-status" title={t(getStatus(st.id).nameKey as TextKey)}>
                    {getStatus(st.id).icon}
                    {st.amount > 0 ? st.amount : ''}
                    <sub>{st.turns}</sub>
                  </span>
                ))}
              </div>
            )}
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
                  title={[describeAbility(a), glossaryText(a)].filter(Boolean).join('\n')}
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

/** What this fight asks (M6b): survive for a few more turns, break the totem, hunt the leader. */
function GoalBanner({ game }: { game: GameState }) {
  const goal = game.combat.goal ?? 'clear';
  const left = Math.max(0, ACT.surviveTurns - game.combat.turn + 1);
  return (
    <div class="goal-banner" data-testid="goal">
      {GOAL_ICONS[goal]} {t(`goal.${goal}.now` as TextKey, { n: left })}
    </div>
  );
}

/** Act progress: the rooms behind you, the one you are in, and the boss at the end. */
function RunProgress({ run }: { run: NonNullable<GameState['run']> }) {
  const rooms = Array.from({ length: ACT.rooms + 1 }, (_, i) => i + 1);
  // Only this act's rooms: the log runs on across acts.
  const start = run.log.map((e) => e.type).lastIndexOf('act') + 1;
  const kindOf = (depth: number) => {
    for (const e of run.log.slice(start)) if (e.type === 'room' && e.depth === depth) return e.kind;
    return null;
  };
  return (
    <div class="run-progress" data-testid="run-progress">
      {rooms.map((d) => {
        const boss = d === ACT.rooms + 1;
        const kind = kindOf(d);
        const state = d < run.depth ? 'done' : d === run.depth ? 'here' : 'ahead';
        return (
          <span key={d} class={`run-pip run-${state} ${kind ? `run-kind-${kind}` : ''}`}>
            {boss ? '☠' : kind === 'rest' ? '♥' : kind === 'elite' ? '✦' : ''}
          </span>
        );
      })}
      <span class="run-label">
        {t('run.act', { n: run.act })} ·{' '}
        {run.depth > ACT.rooms ? t('run.boss') : t('run.room', { n: run.depth, total: ACT.rooms })}
      </span>
    </div>
  );
}

/** A rule's description and the terms it uses, for a hover tooltip. */
const withTerms = (r: RuleDef) => [describeRule(r), glossaryText(r)].filter(Boolean).join('\n');

/** The build at a glance (GDD 2): classes and hybrid, modifiers, items. Hover a line for what it does. */
function BuildPanel({ player: p }: { player: GameState['players'][number] }) {
  return (
    <div class="mods" data-testid="build">
      <div class="mods-title">{t('hud.build')}</div>
      {p.hybrid && (
        <div class="mod mod-hybrid" title={withTerms(getHybrid(p.hybrid).rule)}>
          ✶ {t(getHybrid(p.hybrid).nameKey as TextKey)}
          <div class="mod-desc">{describeRule(getHybrid(p.hybrid).rule)}</div>
        </div>
      )}
      {p.modifiers.map((id) => {
        const m = getModifier(id);
        return (
          <div key={id} class="mod" title={withTerms(m)}>
            ✦ {t(m.nameKey as TextKey)}
          </div>
        );
      })}
      {PATRONS.filter((pt) => p.gifts.some((g) => giftPatrons(g)[0] === pt.id)).map((pt) => (
        <div key={pt.id} class="mod-patron" style={{ '--patron': cssColor(pt.color) }} data-testid={`build-${pt.id}`}>
          <div class="mod-patron-name">
            {pt.icon} {t(pt.nameKey as TextKey)}
          </div>
          {p.gifts
            .filter((g) => giftPatrons(g)[0] === pt.id)
            .map((id) => {
              const g = getGift(id);
              return (
                <div key={id} class={g.patrons ? 'mod mod-gift mod-duo' : 'mod mod-gift'} title={withTerms(g)}>
                  {g.patrons
                    ? `${giftPatrons(id)
                        .map((x) => getPatron(x).icon)
                        .join('')} `
                    : ''}
                  {t(g.nameKey as TextKey)}
                </div>
              );
            })}
        </div>
      ))}
      {p.items.map((id) => {
        const it = getItem(id);
        return (
          <div key={id} class={it.cursed ? 'mod mod-item cursed' : 'mod mod-item'} title={withTerms(it)}>
            {it.icon} {t(it.nameKey as TextKey)}
            {it.cursed && <span class="badge badge-cursed">{t('reward.cursed')}</span>}
          </div>
        );
      })}
    </div>
  );
}
