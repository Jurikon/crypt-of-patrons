import { DebugOverlay, type OverlayActions } from '../debug/Overlay';
import { t } from '../i18n';
import { Minimap } from './Minimap';
import { useStore, type Store, type ViewState } from './store';

export function App({ store, actions }: { store: Store<ViewState>; actions: OverlayActions }) {
  const view = useStore(store);
  return (
    <>
      <Minimap game={view.game} />
      {!view.pointerLocked && (
        <div class="prompt" data-testid="click-to-play">
          <div class="prompt-title">{t('prompt.clickToPlay')}</div>
          <div class="prompt-controls">{t('prompt.controls')}</div>
        </div>
      )}
      {view.debugOpen && <DebugOverlay view={view} actions={actions} />}
    </>
  );
}

/** Shown instead of the game when WebGL is unavailable. */
export function ErrorScreen({ message }: { message: string }) {
  return (
    <div class="prompt prompt-error" role="alert">
      <div class="prompt-title">{message}</div>
    </div>
  );
}
