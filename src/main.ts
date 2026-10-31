import { h, render } from 'preact';
import './style.css';
import { formatHash, parseHash, randomSeed } from './debug/url';
import { detectLang, setLang, t } from './i18n';
import { attachInput } from './input/input';
import { GameRenderer, type Quality } from './render/renderer';
import type { Vec2 } from './core/grid';
import { CLASSES, getAbility } from './content';
import { apply, createGame, preview, validTargets, type Command, type DebugAction, type GameState } from './sim';
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
const knownClass = (id: string | null | undefined) => (CLASSES.some((c) => c.id === id) ? (id as string) : 'knight');
let classId = knownClass(params.classId);
const writeHash = () =>
  history.replaceState(null, '', formatHash({ seed, classId, debug: parseHash(location.hash).debug }));
if (params.seed === null) writeHash();

let state: GameState = createGame(seed, { classId });
/** Every command since the room was created: seed + this list reproduces the session exactly. */
let commands: Command[] = [];
let buffered: Command | null = null;
let selected: string | null = null;
/** Where the selected ability is aimed; `aimManual` once the wheel picked a target. */
let aim: Vec2 | null = null;
let aimManual = false;
/** Cursor position (−1..1) when the pointer is not locked. */
let pointerNdc = { x: 0, y: 0 };

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
  aim: null,
});
const labels: LabelsStore = createStore({ labels: null });

const player = () => state.players[0];

const same = (a: Vec2 | null, b: Vec2 | null) => !!a && !!b && a.x === b.x && a.y === b.y;

/** Abilities aimed at a chosen cell (lines, units, cells) rather than straight ahead or at yourself. */
function aimable(abilityId: string | null): boolean {
  if (!abilityId) return false;
  const k = getAbility(abilityId).target.kind;
  return k === 'line' || k === 'unit' || k === 'cell';
}

function targetOptions(): Vec2[] {
  const p = player();
  return p && selected ? validTargets(state, p, getAbility(selected)) : [];
}

/** Recomputes the ability preview: the same `apply` on the current state, nothing committed. */
function refreshPreview(): void {
  const p = player();
  if (!selected || !p || state.combat.status !== 'active') {
    aim = null;
    renderer.setPreview(null, null);
    store.set({ selected, preview: null, aim: null });
    return;
  }
  const options = targetOptions();
  if (!aimable(selected)) aim = options[0] ?? null;
  else if (!options.some((o) => same(o, aim))) aim = options[0] ?? null;
  const command: Command = aim
    ? { type: 'useAbility', playerId: PLAYER_ID, abilityId: selected, target: aim }
    : { type: 'useAbility', playerId: PLAYER_ID, abilityId: selected };
  const pv = preview(state, command);
  renderer.setPreview(pv, aim, aimable(selected) ? options : []);
  store.set({ selected, preview: pv, aim });
}

/** Follows the crosshair (or the cursor): the valid target nearest to the floor cell under it. */
function updateAim(): void {
  if (!aimable(selected) || aimManual || renderer.isBusy(performance.now())) return;
  const ndc = document.pointerLockElement ? { x: 0, y: 0 } : pointerNdc;
  const cell = renderer.cellAt(ndc.x, ndc.y);
  const options = targetOptions();
  if (!cell || options.length === 0) return;
  let best = options[0] as Vec2;
  for (const o of options)
    if (Math.abs(o.x - cell.x) + Math.abs(o.y - cell.y) < Math.abs(best.x - cell.x) + Math.abs(best.y - cell.y))
      best = o;
  if (!same(best, aim)) {
    aim = best;
    refreshPreview();
  }
}

function cycleTarget(step: number): void {
  if (!aimable(selected)) return;
  const options = targetOptions();
  if (options.length === 0) return;
  const i = options.findIndex((o) => same(o, aim));
  aim = options[(i + step + options.length) % options.length] ?? null;
  aimManual = true;
  refreshPreview();
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
  state = createGame(seed, { classId });
  commands = [];
  buffered = null;
  selected = null;
  aimManual = false;
  renderer.reset(state, performance.now());
  store.set({ game: state, notice: null });
  refreshPreview();
}

function newSeed(): void {
  seed = randomSeed();
  writeHash();
  loadSeed(seed);
}

/** Restarts the same room with another class. */
function setClass(id: string): void {
  classId = knownClass(id);
  writeHash();
  loadSeed(seed);
}

function selectAbility(slot: number): void {
  const id = player()?.abilities[slot];
  if (!id || state.combat.status !== 'active') return;
  if (selected === id) {
    confirm();
    return;
  }
  selected = id;
  aimManual = false;
  refreshPreview();
}

/** LMB / F: the selected ability, or the base attack when nothing is selected. */
function confirm(): void {
  const abilityId = selected ?? player()?.abilities[0];
  if (!abilityId || state.combat.status !== 'active') return;
  dispatch(
    aimable(abilityId) && aim
      ? { type: 'useAbility', playerId: PLAYER_ID, abilityId, target: aim }
      : { type: 'useAbility', playerId: PLAYER_ID, abilityId },
  );
}

function cancel(): void {
  selected = null;
  refreshPreview();
}

const actions: AppActions = {
  newSeed,
  exportState: () => JSON.stringify({ seed, classId, commands }),
  cheat: (action: DebugAction) => dispatch({ type: 'debug', playerId: PLAYER_ID, action }),
  setClass,
  grantAbility: (abilityId: string, slot: number) =>
    dispatch({ type: 'debugGrant', playerId: PLAYER_ID, abilityId, slot }),
  toggleModifier: (modifierId: string) => dispatch({ type: 'debugModifier', playerId: PLAYER_ID, modifierId }),
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
    look: (dx, dy) => {
      renderer.look(dx, dy);
      aimManual = false;
    },
    cycleTarget,
    pointer: (x, y) => {
      pointerNdc = { x, y };
      aimManual = false;
    },
    pointerLockChanged: (locked) => store.set({ pointerLocked: locked }),
  },
  { playerId: PLAYER_ID },
);

window.addEventListener('hashchange', () => {
  const p = parseHash(location.hash);
  const nextClass = knownClass(p.classId);
  if ((p.seed !== null && p.seed !== seed) || nextClass !== classId) {
    classId = nextClass;
    loadSeed(p.seed ?? seed);
  }
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
  if (selected) updateAim();
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
