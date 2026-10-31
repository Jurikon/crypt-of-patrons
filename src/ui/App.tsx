import { DebugOverlay, type OverlayActions } from '../debug/Overlay';
import { t } from '../i18n';
import { Hud, type HudActions } from './Hud';
import { Minimap } from './Minimap';
import { ResultScreen, type ResultActions } from './ResultScreen';
import { RewardScreen, type RewardActions } from './RewardScreen';
import { StartScreen, type StartActions } from './StartScreen';
import { useStore, type LabelsStore, type Store, type ViewState } from './store';
import { WorldOverlay } from './WorldOverlay';

export type AppActions = OverlayActions & HudActions & ResultActions & RewardActions & StartActions;

const HIT_FLASH_MS = 450;

export function App({ store, labels, actions }: { store: Store<ViewState>; labels: LabelsStore; actions: AppActions }) {
  const view = useStore(store);
  const now = performance.now();
  const run = view.game.run;
  const over = (run ? run.phase === 'won' || run.phase === 'lost' : view.game.combat.status !== 'active') && !view.busy;
  const choosing = run?.phase === 'reward' && !view.busy;
  if (view.screen === 'start')
    return <StartScreen actions={actions} canContinue={view.canContinue} saveError={view.saveError} />;
  const hit = now - view.hitAt < HIT_FLASH_MS;
  return (
    <>
      <WorldOverlay store={labels} />
      {hit && <div key={view.hitAt} class="hit-flash" />}
      <Minimap game={view.game} />
      {view.pointerLocked && view.aim && <div class="crosshair" />}
      <Hud view={view} actions={actions} now={now} />
      {now - view.roomAt < 600 && <div key={view.roomAt} class="room-fade" />}
      {!view.pointerLocked && !over && !choosing && (
        <div class="prompt" data-testid="click-to-play">
          <div class="prompt-title">{t('prompt.clickToPlay')}</div>
          <div class="prompt-controls">{t('prompt.controls')}</div>
          <div class="prompt-controls">{t('prompt.combat')}</div>
        </div>
      )}
      {choosing && <RewardScreen game={view.game} actions={actions} />}
      {over && <ResultScreen game={view.game} elapsedMs={view.elapsedMs} actions={actions} />}
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
