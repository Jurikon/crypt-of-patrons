import { h, render } from 'preact';
import './style.css';
import { formatHash, parseHash, randomSeed } from './debug/url';
import { detectLang, setLang, t } from './i18n';
import { attachInput } from './input/input';
import { GameRenderer, type Quality } from './render/renderer';
import { add, dirVec } from './core/grid';
import { apply, createGame, preview, type Command, type DebugAction, type GameState } from './sim';
import { App, ErrorScreen, type AppActions } from './ui/App';
import { createStore, type LabelsStore, type ViewState } from './ui/store';

const PLAYER_ID = 'p1';

const lang = detectLang(navigator.languages ?? [navigator.language]);
setLang(lang);
document.documentElement.lang = lang;

const gameEl = document.getElementById('game') as HTMLElement;
const uiEl = document.getElementById('ui') as HTMLElement;

// Seed from the URL, or a fresh one written back so the link reproduces this room.
const params = parseHash(location.hash);
let seed = params.seed ?? randomSeed();
if (params.seed === null) history.replaceState(null, '', formatHash({ seed, debug: params.debug }));

let state: GameState = createGame(seed);
/** Every command since the room was created: seed + this list reproduces the session exactly. */
let commands: Command[] = [];
let buffered: Command | null = null;
let selected: string | null = null;

const QUALITY_KEY = 'cop.quality';
/** The player's saved choice, or null if they never picked one. */
function savedQuality(): Quality | null {
  try {
    const q = localStorage.getItem(QUALITY_KEY);
    return q === 'low' || q === 'high' ? q : null;
  } catch {
    return null;
  }
}

let renderer: GameRenderer;
let quality: Quality = savedQuality() ?? 'high';
try {
  renderer = new GameRenderer(gameEl, quality);
  // No GPU (software rendering): start on low unless the player chose otherwise.
  if (!savedQuality() && renderer.isSoftwareRendered()) {
    quality = 'low';
    renderer.setQuality(quality);
  }
} catch (err) {
  console.warn('WebGL init failed', err);
  render(h(ErrorScreen, { message: t('error.webgl') }), uiEl);
  throw new Error('WebGL unavailable', { cause: err });
}
renderer.reset(state, performance.now());
renderer.onPlayerHit = (hp, now) => store.set({ shownHp: hp, hitAt: now });

const store = createStore<ViewState>({
  game: state,
  fps: 0,
  debugOpen: params.debug,
  pointerLocked: false,
  topView: false,
  selected: null,
  preview: null,
  busy: false,
  notice: null,
  hitAt: -1e9,
  shownHp: null,
  quality,
});
const labels: LabelsStore = createStore({ labels: null });

const player = () => state.players[0];

/** Recomputes the ability preview: the same `apply` on the current state, nothing committed. */
function refreshPreview(): void {
  const p = player();
  if (!selected || !p || state.combat.status !== 'active') {
    renderer.setPreview(null, null);
    store.set({ selected, preview: null });
    return;
  }
  const pv = preview(state, { type: 'useAbility', playerId: PLAYER_ID, abilityId: selected });
  renderer.setPreview(pv, add(p, dirVec(p.dir)));
  store.set({ selected, preview: pv });
}

function run(command: Command, now: number): void {
  const before = state;
  const result = apply(state, command);
  const rejected = result.events.find((e) => e.type === 'rejected');
  if (rejected && rejected.type === 'rejected') {
    store.set({ notice: { reason: rejected.reason, at: now } });
    return;
  }
  state = result.state;
  commands.push(command);
  renderer.play(result.events, state);
  if (command.type === 'useAbility') selected = null;
  // Keep showing the old health until the hit is actually animated.
  if (result.events.some((e) => e.type === 'phaseChanged')) store.set({ shownHp: before.players[0]?.hp ?? null });
  if (state.combat.status !== 'active' && document.pointerLockElement) document.exitPointerLock();
  store.set({ game: state });
  refreshPreview();
}

/** Commands arriving mid-animation are buffered (one at a time; the latest wins). */
function dispatch(command: Command): void {
  const now = performance.now();
  if (renderer.isBusy(now)) buffered = command;
  else run(command, now);
}

function loadSeed(next: number): void {
  seed = next;
  state = createGame(seed);
  commands = [];
  buffered = null;
  selected = null;
  renderer.reset(state, performance.now());
  store.set({ game: state, notice: null });
  refreshPreview();
}

function newSeed(): void {
  const next = randomSeed();
  history.replaceState(null, '', formatHash({ seed: next, debug: parseHash(location.hash).debug }));
  loadSeed(next);
}

function selectAbility(slot: number): void {
  const id = player()?.abilities[slot];
  if (!id || state.combat.status !== 'active') return;
  if (selected === id) {
    confirm();
    return;
  }
  selected = id;
  refreshPreview();
}

/** LMB / F: the selected ability, or the base attack when nothing is selected. */
function confirm(): void {
  const abilityId = selected ?? player()?.abilities[0];
  if (!abilityId || state.combat.status !== 'active') return;
  dispatch({ type: 'useAbility', playerId: PLAYER_ID, abilityId });
}

function cancel(): void {
  selected = null;
  refreshPreview();
}

const actions: AppActions = {
  newSeed,
  exportState: () => JSON.stringify({ seed, commands }),
  cheat: (action: DebugAction) => dispatch({ type: 'debug', playerId: PLAYER_ID, action }),
  toggleQuality: () => {
    const quality: Quality = store.get().quality === 'high' ? 'low' : 'high';
    renderer.setQuality(quality);
    store.set({ quality });
    try {
      localStorage.setItem(QUALITY_KEY, quality);
    } catch {
      // Storage blocked (private mode): the choice just isn't remembered.
    }
  },
  selectAbility,
  retry: () => loadSeed(seed),
  newRoom: newSeed,
};

attachInput(
  renderer.canvas,
  {
    command: dispatch,
    selectAbility,
    confirm,
    cancel,
    topView: (held) => {
      renderer.setTopView(held, performance.now());
      store.set({ topView: held });
    },
    toggleDebug: () => store.set({ debugOpen: !store.get().debugOpen }),
    newSeed,
    look: (dx, dy) => renderer.look(dx, dy),
    pointerLockChanged: (locked) => store.set({ pointerLocked: locked }),
  },
  { playerId: PLAYER_ID },
);

window.addEventListener('hashchange', () => {
  const p = parseHash(location.hash);
  if (p.seed !== null && p.seed !== seed) loadSeed(p.seed);
  if (p.debug && !store.get().debugOpen) store.set({ debugOpen: true });
});
window.addEventListener('resize', () => renderer.resize());

render(h(App, { store, labels, actions }), uiEl);

// Frame loop with an FPS counter refreshed twice a second.
let frames = 0;
let fpsWindowStart = performance.now();
let wasBusy = false;
function frame(now: number): void {
  if (buffered && !renderer.isBusy(now)) {
    const c = buffered;
    buffered = null;
    run(c, now);
  }
  labels.set({ labels: renderer.render(now) });
  const busy = renderer.isBusy(now);
  if (busy !== wasBusy) {
    wasBusy = busy;
    store.set(busy ? { busy } : { busy, shownHp: null });
  }
  frames++;
  if (now - fpsWindowStart >= 500) {
    store.set({ fps: (frames * 1000) / (now - fpsWindowStart) });
    frames = 0;
    fpsWindowStart = now;
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// Read-only hook for automated smoke tests and console debugging.
(window as unknown as { __cop: unknown }).__cop = {
  getState: () => state,
  getCommands: () => commands.slice(),
  isBusy: () => renderer.isBusy(performance.now()),
  benchmark: (frames: number) => renderer.benchmark(frames),
};
