import { useState } from 'preact/hooks';
import { t, type TextKey } from '../i18n';
import type { ViewState } from '../ui/store';

export interface OverlayActions {
  newSeed(): void;
  /** Returns the text for a bug report: seed plus the command list. */
  exportState(): string;
}

/** Debug overlay toggled with the backquote key. */
export function DebugOverlay({ view, actions }: { view: ViewState; actions: OverlayActions }) {
  const [copied, setCopied] = useState(false);
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
      <div class="debug-title">{t('debug.title')}</div>
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
