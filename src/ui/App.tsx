import { DebugOverlay, type OverlayActions } from '../debug/Overlay';
import { BIOMES, getPatron } from '../content';
import { t, type TextKey } from '../i18n';
import { Hud, type HudActions } from './Hud';
import { Minimap } from './Minimap';
import { ResultScreen, type ResultActions } from './ResultScreen';
import { cssColor, RewardScreen, type RewardActions } from './RewardScreen';
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
    return (
      <StartScreen
        actions={actions}
        canContinue={view.canContinue}
        saveError={view.saveError}
        meta={view.meta}
        style={view.style}
      />
    );
  const hit = now - view.hitAt < HIT_FLASH_MS;
  return (
    <div class={view.topView ? 'app top-view' : 'app'}>
      <WorldOverlay store={labels} />
      {hit && <div key={view.hitAt} class="hit-flash" />}
      <Minimap game={view.game} />
      {view.pointerLocked && view.aim && <div class="crosshair" />}
      <Hud view={view} actions={actions} now={now} />
      {now - view.roomAt < 600 && <div key={view.roomAt} class="room-fade" />}
      {view.hybridNews && now - view.hybridNews.at < 3200 && (
        <div key={view.hybridNews.at} class="hybrid-news" data-testid="hybrid-news">
          {t('hybrid.announce', { name: view.hybridNews.name })}
        </div>
      )}
      {view.actNews && now - view.actNews.at < 3600 && (
        <div key={view.actNews.at} class="act-news" data-testid="act-news">
          {t('act.announce', {
            n: view.actNews.act,
            name: t((BIOMES[view.actNews.act - 1]?.nameKey ?? 'biome.crypt') as TextKey),
          })}
        </div>
      )}
      {view.patronVoice && now - view.patronVoice.at < 3600 && (
        <PatronVoice key={view.patronVoice.at} patron={view.patronVoice.patron} />
      )}
      {!view.pointerLocked && !over && !choosing && (
        <div class="prompt" data-testid="click-to-play">
          <div class="prompt-title">{t('prompt.clickToPlay')}</div>
          <div class="prompt-controls">{t('prompt.controls')}</div>
          <div class="prompt-controls">{t('prompt.combat')}</div>
        </div>
      )}
      {choosing && <RewardScreen game={view.game} actions={actions} />}
      {over && <ResultScreen game={view.game} elapsedMs={view.elapsedMs} ash={view.ashGained} actions={actions} />}
      {view.debugOpen && <DebugOverlay view={view} actions={actions} />}
    </div>
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

/** The patron's line when you take their gift: "Morra: Let them rot together." */
function PatronVoice({ patron }: { patron: string }) {
  const p = getPatron(patron);
  return (
    <div class="patron-voice" style={{ '--patron': cssColor(p.color) }} data-testid="patron-voice">
      <span class="patron-voice-name">
        {p.icon} {t(p.nameKey as TextKey)}:
      </span>{' '}
      {t(p.voiceKey as TextKey)}
    </div>
  );
}
