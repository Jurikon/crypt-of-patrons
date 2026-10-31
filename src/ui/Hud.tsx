import { ACT, getAbility, getClass, getModifier, getPassive, getStatus } from '../content';
import { t, type TextKey } from '../i18n';
import { cooldownOf, intentCells, type GameState } from '../sim';
import { abilityName, describeAbility, describeRule } from './describe';
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
        <span class="turn-number">{t('hud.turn', { n: game.combat.turn })}</span>
      </div>

      {p.modifiers.length > 0 && (
        <div class="mods" data-testid="modifiers">
          <div class="mods-title">{t('hud.modifiers')}</div>
          {p.modifiers.map((id) => {
            const m = getModifier(id);
            return (
              <div key={id} class="mod" title={describeRule(m)}>
                ✦ {t(m.nameKey as TextKey)}
                <div class="mod-desc">{describeRule(m)}</div>
              </div>
            );
          })}
        </div>
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
            {emptyTarget && <div class="selection-sub">{t('hud.noTarget')}</div>}
          </div>
        )}

        <div class="hud" data-testid="hud">
          <div class="hud-vitals">
            <div class="hud-class" title={p.passives.map((id) => describeRule(getPassive(id))).join('. ')}>
              {t(getClass(p.classId).nameKey as TextKey)} ·{' '}
              {p.passives.map((id) => t(getPassive(id).nameKey as TextKey)).join(', ')}
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

/** Act progress: the rooms behind you, the one you are in, and the boss at the end. */
function RunProgress({ run }: { run: NonNullable<GameState['run']> }) {
  const rooms = Array.from({ length: ACT.rooms + 1 }, (_, i) => i + 1);
  const kindOf = (depth: number) => {
    for (const e of run.log) if (e.type === 'room' && e.depth === depth) return e.kind;
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
        {run.depth > ACT.rooms ? t('run.boss') : t('run.room', { n: run.depth, total: ACT.rooms })}
      </span>
    </div>
  );
}
