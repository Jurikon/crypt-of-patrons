import { t, type TextKey } from '../i18n';
import type { Intent } from '../sim';
import type { LabelUnit } from '../render/renderer';
import { useStore, type LabelsStore } from './store';

const EDGE = 44;

function intentIcon(intent: Intent): string {
  return intent.kind === 'melee' ? '⚔' : '➶';
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
        labels.units.map((u) => (u.head.onScreen ? null : <EdgeArrow key={u.id} u={u} w={width} h={height} />))}
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
      title={t(`enemy.${u.type}` as TextKey)}
    >
      {u.intent && (
        <div class="intent-badge">
          <span class="intent-icon">{intentIcon(u.intent)}</span>
          <span class="intent-dmg">{u.intent.damage}</span>
        </div>
      )}
      <div class="unit-hp">
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
