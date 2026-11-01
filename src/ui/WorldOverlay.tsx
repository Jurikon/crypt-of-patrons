import { getPatron, type RewardKind, type RoomGoal } from '../content';
import { t, type TextKey } from '../i18n';
import type { Intent } from '../sim';
import type { DoorLabel, LabelUnit } from '../render/renderer';
import { useStore, type LabelsStore } from './store';

const EDGE = 44;

const DOOR_ICONS: Record<RewardKind, string> = {
  ability: '✧',
  modifier: '✦',
  upgrade: '▲',
  rest: '♥',
  elite: '☠',
  boss: '♛',
  initiation: '✶',
  treasure: '◆',
  altar: '✟',
};

/** What a fight behind a door asks. */
export const GOAL_ICONS: Record<RoomGoal, string> = {
  clear: '⚔',
  survive: '⌛',
  totem: '☗',
  ambush: '⚠',
  hunt: '★',
};

function intentIcon(intent: Intent): string {
  switch (intent.kind) {
    case 'melee':
      return '⚔';
    case 'line':
      return '➶';
    case 'sweep':
      return '⚔⚔⚔';
    case 'summon':
      return '☠+';
    case 'burst':
      return '✺';
    case 'blast':
      return '☄';
    case 'aid':
      return '✚';
  }
}

/** HTML labels pinned to the 3D world: health and intents over enemies, edge arrows, floating numbers. */
export function WorldOverlay({ store }: { store: LabelsStore }) {
  const { labels } = useStore(store);
  if (!labels) return null;
  const { width, height } = labels;
  const fade = 1 - labels.topView * 0.4;

  return (
    <div class="world-overlay">
      {labels.units.map((u) => (u.head.onScreen ? <UnitTag key={u.id} u={u} fade={fade} /> : null))}
      {labels.topView < 0.5 &&
        labels.units.map((u) =>
          u.head.onScreen || u.ally ? null : <EdgeArrow key={u.id} u={u} w={width} h={height} />,
        )}
      {labels.doors.map((d, i) =>
        d.at.onScreen ? <DoorTag key={`door${i}`} d={d} hint={labels.topView > 0.5} /> : null,
      )}
      {labels.cells.map((c, i) =>
        c.at.onScreen ? (
          <div key={i} class={`cell-label cell-${c.kind}`} style={{ left: `${c.at.x}px`, top: `${c.at.y}px` }}>
            {c.text}
          </div>
        ) : null,
      )}
      {labels.floaters.map((f) =>
        f.at.onScreen ? (
          <div
            key={f.id}
            class={`floater floater-${f.kind}`}
            style={{ left: `${f.at.x}px`, top: `${f.at.y - f.age * 30}px`, opacity: String(1 - f.age * f.age) }}
          >
            {f.text}
          </div>
        ) : null,
      )}
    </div>
  );
}

function UnitTag({ u, fade }: { u: LabelUnit; fade: number }) {
  // Shrink with distance, within limits, so far tags do not clutter the view.
  const scale = Math.max(0.65, Math.min(1.15, 6 / Math.max(1, u.distance)));
  return (
    <div
      class="unit-tag"
      style={{
        left: `${u.head.x}px`,
        top: `${u.head.y}px`,
        transform: `translate(-50%, -100%) scale(${scale})`,
        opacity: String(fade),
      }}
      title={u.ally ? t('hud.ally') : t(`enemy.${u.type}` as TextKey)}
    >
      {u.statuses.length > 0 && <div class="unit-statuses">{u.statuses.join('')}</div>}
      {u.intent && (
        <div class="intent-badge">
          <span class="intent-icon">{intentIcon(u.intent)}</span>
          {u.intent.damage > 0 && <span class="intent-dmg">{u.intent.damage}</span>}
        </div>
      )}
      <div class={u.ally ? 'unit-hp ally' : 'unit-hp'}>
        {Array.from({ length: u.maxHp }, (_, i) => (
          <span key={i} class={i < u.hp ? 'hp-pip full' : 'hp-pip'} />
        ))}
      </div>
    </div>
  );
}

function EdgeArrow({ u, w, h }: { u: LabelUnit; w: number; h: number }) {
  // Place on an ellipse just inside the screen edge, in the direction of the enemy.
  const b = u.head.bearing;
  const x = w / 2 + Math.sin(b) * (w / 2 - EDGE);
  const y = h / 2 - Math.cos(b) * (h / 2 - EDGE);
  return (
    <div class="edge-arrow" style={{ left: `${x}px`, top: `${y}px` }} data-testid="edge-arrow">
      <div class="edge-pointer" style={{ transform: `rotate(${b}rad)` }}>
        ▲
      </div>
      {u.intent && (
        <div class="edge-intent">
          {intentIcon(u.intent)}
          {u.intent.damage}
        </div>
      )}
    </div>
  );
}

/** An altar door shows its patron's sign, name and colour: "Altar of Morra". */
/** In top view the tag also says what the reward is. */
function DoorTag({ d, hint }: { d: DoorLabel; hint: boolean }) {
  const patron = d.patron ? getPatron(d.patron) : null;
  return (
    <div
      class={`door-tag door-${d.reward}`}
      style={{
        left: `${d.at.x}px`,
        top: `${d.at.y}px`,
        ...(patron ? { '--patron': `#${patron.color.toString(16).padStart(6, '0')}` } : {}),
      }}
      data-testid="door-tag"
    >
      <span class="door-icon">{patron ? patron.icon : DOOR_ICONS[d.reward]}</span>
      {patron ? t('door.altar', { patron: t(`${patron.nameKey}.gen` as TextKey) }) : t(`door.${d.reward}` as TextKey)}
      {d.goal && (
        <div class="door-goal">
          {GOAL_ICONS[d.goal]} {t(`goal.${d.goal}` as TextKey)}
        </div>
      )}
      {hint && <div class="door-hint">{t(`door.${d.reward}.hint` as TextKey)}</div>}
      {hint && d.goal && <div class="door-hint">{t(`goal.${d.goal}.hint` as TextKey)}</div>}
    </div>
  );
}
