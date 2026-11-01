import { h, render } from 'preact';
import './style.css';
import { formatHash, parseHash, randomSeed } from './debug/url';
import { detectLang, setLang, t, type TextKey } from './i18n';
import { attachInput } from './input/input';
import { GameRenderer, type Quality } from './render/renderer';
import type { Vec2 } from './core/grid';
import { CLASSES, getAbility, getGift, getHybrid } from './content';
import {
  addAsh,
  apply,
  ashEarned,
  buyPerk,
  createGame,
  preview,
  readMeta,
  readSave,
  validTargets,
  writeSave,
  type Command,
  type DebugAction,
  type GameState,
  type MetaSave,
} from './sim';
import { App, ErrorScreen, type AppActions } from './ui/App';
import { createStore, type LabelsStore, type ViewState } from './ui/store';

const PLAYER_ID = 'p1';

const lang = detectLang(navigator.languages ?? [navigator.language]);
setLang(lang);
document.documentElement.lang = lang;

const gameEl = document.getElementById('game') as HTMLElement;
const uiEl = document.getElementById('ui') as HTMLElement;

// ---- saved run ----------------------------------------------------------------------------------

const SAVE_KEY = 'cop.run';
function loadSaveText(): string | null {
  try {
    return localStorage.getItem(SAVE_KEY);
  } catch {
    return null;
  }
}
function storeSave(text: string | null): void {
  try {
    if (text === null) localStorage.removeItem(SAVE_KEY);
    else localStorage.setItem(SAVE_KEY, text);
  } catch {
    // Storage blocked or full: the run just isn't saved.
  }
}
const savedText = loadSaveText();

// ---- what carries over between runs (Ash and the Chapel, M6b) ---------------------------------------

const META_KEY = 'cop.meta';
function loadMeta(): MetaSave {
  try {
    return readMeta(localStorage.getItem(META_KEY));
  } catch {
    return readMeta(null);
  }
}
function storeMeta(m: MetaSave): void {
  try {
    localStorage.setItem(META_KEY, JSON.stringify(m));
  } catch {
    // Storage blocked: the Ash is kept only for this session.
  }
}
let meta = loadMeta();
let saved = readSave(savedText);

// A seed in the URL starts that run directly (links, bug reports, tests); otherwise the start screen.
const params = parseHash(location.hash);
let seed = params.seed ?? saved?.state.seed ?? randomSeed();
const knownClass = (id: string | null | undefined) => (CLASSES.some((c) => c.id === id) ? (id as string) : 'knight');
let classId = knownClass(params.classId ?? saved?.classId);
const writeHash = () => history.replaceState(null, '', formatHash({ ...parseHash(location.hash), seed, classId }));

/**
 * `#god` in the URL: the hero is immortal in every run. Goes through the same debug command as the
 * menu's button, so the run still replays exactly.
 */
function godFromUrl(): void {
  const p = state.players[0];
  if (parseHash(location.hash).god && p && !p.god)
    dispatch({ type: 'debug', playerId: PLAYER_ID, action: 'toggleGod' });
}

let state: GameState = createGame(seed, { classId, perks: meta.perks });
/** Every command of the run: seed + class + this list reproduces it exactly. */
let commands: Command[] = [];
let elapsedMs = 0;
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
  screen: params.seed !== null ? 'play' : 'start',
  canContinue: saved !== null && !runOver(saved.state),
  saveError: savedText !== null && saved === null,
  elapsedMs: 0,
  roomAt: -1e9,
  hybridNews: null,
  actNews: null,
  patronVoice: null,
  meta,
  ashGained: null,
});
if (params.seed !== null) writeHash();

function runOver(s: GameState): boolean {
  return s.run?.phase === 'won' || s.run?.phase === 'lost';
}

/** Writes the run after every command; a finished run leaves nothing to continue. */
function persist(): void {
  if (runOver(state)) storeSave(null);
  else storeSave(writeSave({ state, commands, classId, elapsedMs }));
}
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
  if (result.events.some((e) => e.type === 'roomEntered')) {
    // A new room: rebuild the scene at once behind a short fade.
    selected = null;
    renderer.reset(state, now);
    store.set({ roomAt: now });
  } else renderer.play(result.events, state);
  persist();
  const formed = result.events.find((e) => e.type === 'hybridFormed');
  if (formed?.type === 'hybridFormed')
    store.set({ hybridNews: { name: t(getHybrid(formed.hybrid).nameKey as TextKey), at: now } });
  // The run is over: its Ash goes to the Chapel.
  if (result.events.some((e) => e.type === 'runEnded')) {
    const ash = ashEarned(state);
    meta = addAsh(meta, ash);
    storeMeta(meta);
    store.set({ meta, ashGained: ash });
  }
  const act = result.events.find((e) => e.type === 'actEntered');
  if (act?.type === 'actEntered') store.set({ actNews: { act: act.act, at: now } });
  // Taking a gift: its patron (the altar's, for a duo gift) says a line.
  const taken = result.events.find((e) => e.type === 'rewardTaken');
  if (taken?.type === 'rewardTaken' && taken.option?.kind === 'gift') {
    const patron = getGift(taken.option.id).patron ?? before.run?.patron;
    if (patron) store.set({ patronVoice: { patron, at: now } });
  }
  if (state.run?.phase === 'reward' && document.pointerLockElement) document.exitPointerLock();
  if (command.type === 'useAbility') selected = null;
  // Keep showing the old health until the hit is actually animated.
  if (result.events.some((e) => e.type === 'phaseChanged')) store.set({ shownHp: before.players[0]?.hp ?? null });
  if (runOver(state) && document.pointerLockElement) document.exitPointerLock();
  store.set({ game: state });
  refreshPreview();
}

/** Commands arriving mid-animation are buffered (one at a time; the latest wins). */
function dispatch(command: Command): void {
  // Nothing plays behind the start screen (it would overwrite the saved run).
  if (store.get().screen !== 'play') return;
  const now = performance.now();
  // Only actions wait for animations; debug cheats and reward choices go through at once.
  const action = command.type === 'move' || command.type === 'turn' || command.type === 'useAbility';
  if (action && renderer.isBusy(now)) buffered = command;
  else run(command, now);
}

function loadSeed(next: number): void {
  seed = next;
  state = createGame(seed, { classId, perks: meta.perks });
  commands = [];
  elapsedMs = 0;
  store.set({ screen: 'play', elapsedMs: 0 });
  persist();
  buffered = null;
  selected = null;
  aimManual = false;
  renderer.reset(state, performance.now());
  store.set({ game: state, notice: null });
  refreshPreview();
  godFromUrl();
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

/** Starts a fresh run with a class (start screen). */
function startRun(id: string): void {
  classId = knownClass(id);
  seed = randomSeed();
  writeHash();
  loadSeed(seed);
}

/** Picks up the saved run where it was left. */
function continueRun(): void {
  if (!saved) return;
  state = saved.state;
  commands = [...saved.commands];
  classId = saved.classId;
  seed = state.seed;
  elapsedMs = saved.elapsedMs;
  buffered = null;
  selected = null;
  writeHash();
  renderer.reset(state, performance.now());
  store.set({ game: state, screen: 'play', elapsedMs, notice: null });
  refreshPreview();
  godFromUrl();
}

function selectAbility(slot: number): void {
  // On the reward screen the number keys pick a card.
  if (state.run?.phase === 'reward') {
    if (slot < state.run.offer.length) chooseReward(slot);
    return;
  }
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

function chooseReward(index: number | null, replace?: number): void {
  const p = player();
  const option = index === null ? null : state.run?.offer[index];
  // A new ability with every slot full has to say which one it replaces (the reward screen asks).
  if (option?.kind === 'ability' && p && p.abilities.length > 4 && replace === undefined) return;
  dispatch(
    replace === undefined
      ? { type: 'chooseReward', playerId: PLAYER_ID, index }
      : { type: 'chooseReward', playerId: PLAYER_ID, index, replace },
  );
}

const actions: AppActions = {
  newSeed,
  exportState: () => JSON.stringify({ seed, classId, perks: state.run?.perks ?? [], commands }),
  cheat: (action: DebugAction) => dispatch({ type: 'debug', playerId: PLAYER_ID, action }),
  setClass,
  grantAbility: (abilityId: string, slot: number) =>
    dispatch({ type: 'debugGrant', playerId: PLAYER_ID, abilityId, slot }),
  toggleModifier: (modifierId: string) => dispatch({ type: 'debugModifier', playerId: PLAYER_ID, modifierId }),
  toggleItem: (itemId: string) => dispatch({ type: 'debugItem', playerId: PLAYER_ID, itemId }),
  toggleGift: (giftId: string) => dispatch({ type: 'debugGift', playerId: PLAYER_ID, giftId }),
  closeDebug: () => store.set({ debugOpen: false }),
  buyPerk: (id: string) => {
    const next = buyPerk(meta, id);
    if (!next) return;
    meta = next;
    storeMeta(meta);
    store.set({ meta });
  },
  reroll: () => dispatch({ type: 'reroll', playerId: PLAYER_ID }),
  jump: (act: number, depth: number) => dispatch({ type: 'debugJump', playerId: PLAYER_ID, act, depth }),
  addClass: (id: string) => dispatch({ type: 'debugClass', playerId: PLAYER_ID, classId: id }),
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
  newRun: () => {
    storeSave(null);
    saved = null;
    store.set({ screen: 'start', canContinue: false, saveError: false });
  },
  startRun,
  continueRun,
  chooseReward,
  resetSave: () => {
    storeSave(null);
    saved = null;
    store.set({ canContinue: false });
  },
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
      // Looking past 45° turns the hero (free, like Q/E): the view and the facing never split.
      const turn = renderer.lookTurn();
      if (turn !== 0 && !renderer.isBusy(performance.now()) && store.get().screen === 'play' && player()?.hp) {
        renderer.expectMouseTurn();
        dispatch({ type: 'turn', playerId: PLAYER_ID, dir: turn > 0 ? 'left' : 'right' });
      }
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
  godFromUrl();
});
window.addEventListener('resize', () => renderer.resize());

render(h(App, { store, labels, actions }), uiEl);

// Frame loop with an FPS counter refreshed twice a second.
let frames = 0;
let fpsWindowStart = performance.now();
let wasBusy = false;
let lastFrame = performance.now();
function frame(now: number): void {
  // Real time played: only while a run is on screen and going.
  if (store.get().screen === 'play' && !runOver(state) && document.visibilityState === 'visible')
    elapsedMs += Math.min(250, now - lastFrame);
  lastFrame = now;
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
    store.set({ fps: (frames * 1000) / (now - fpsWindowStart), elapsedMs });
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
