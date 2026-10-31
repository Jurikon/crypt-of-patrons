import { h, render } from 'preact';
import './style.css';
import { formatHash, parseHash, randomSeed } from './debug/url';
import { detectLang, setLang, t } from './i18n';
import { attachInput } from './input/input';
import { GameRenderer } from './render/renderer';
import { apply, createGame, type Command, type GameState } from './sim';
import { App, ErrorScreen } from './ui/App';
import { createStore, type ViewState } from './ui/store';

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

let renderer: GameRenderer;
try {
  renderer = new GameRenderer(gameEl);
} catch (err) {
  console.warn('WebGL init failed', err);
  render(h(ErrorScreen, { message: t('error.webgl') }), uiEl);
  throw new Error('WebGL unavailable', { cause: err });
}
renderer.setState(state, performance.now());

const store = createStore<ViewState>({
  game: state,
  fps: 0,
  debugOpen: params.debug,
  pointerLocked: false,
  topView: false,
});

function run(command: Command, now: number): void {
  const result = apply(state, command);
  state = result.state;
  commands.push(command);
  renderer.onEvents(result.events, now);
  store.set({ game: state });
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
  renderer.setState(state, performance.now());
  store.set({ game: state });
}

function newSeed(): void {
  const next = randomSeed();
  history.replaceState(null, '', formatHash({ seed: next, debug: parseHash(location.hash).debug }));
  loadSeed(next);
}

const actions = {
  newSeed,
  exportState: () => JSON.stringify({ seed, commands }),
};

attachInput(
  renderer.canvas,
  {
    command: dispatch,
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

render(h(App, { store, actions }), uiEl);

// Frame loop with an FPS counter refreshed twice a second.
let frames = 0;
let fpsWindowStart = performance.now();
function frame(now: number): void {
  if (buffered && !renderer.isBusy(now)) {
    const c = buffered;
    buffered = null;
    run(c, now);
  }
  renderer.render(state, now);
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
};
