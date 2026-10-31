import { DebugOverlay, type OverlayActions } from '../debug/Overlay';
import { t } from '../i18n';
import { Hud, type HudActions } from './Hud';
import { Minimap } from './Minimap';
import { ResultScreen, type ResultActions } from './ResultScreen';
import { useStore, type LabelsStore, type Store, type ViewState } from './store';
import { WorldOverlay } from './WorldOverlay';

export type AppActions = OverlayActions & HudActions & ResultActions;

const HIT_FLASH_MS = 450;

export function App({ store, labels, actions }: { store: Store<ViewState>; labels: LabelsStore; actions: AppActions }) {
  const view = useStore(store);
  const now = performance.now();
  const over = view.game.combat.status !== 'active' && !view.busy;
  const hit = now - view.hitAt < HIT_FLASH_MS;
  return (
    <>
      <WorldOverlay store={labels} />
      {hit && <div key={view.hitAt} class="hit-flash" />}
      <Minimap game={view.game} />
      {view.pointerLocked && view.aim && <div class="crosshair" />}
      <Hud view={view} actions={actions} now={now} />
      {!view.pointerLocked && !over && (
        <div class="prompt" data-testid="click-to-play">
          <div class="prompt-title">{t('prompt.clickToPlay')}</div>
          <div class="prompt-controls">{t('prompt.controls')}</div>
          <div class="prompt-controls">{t('prompt.combat')}</div>
        </div>
      )}
      {over && <ResultScreen game={view.game} actions={actions} />}
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
