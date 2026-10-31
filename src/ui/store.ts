import { useEffect, useState } from 'preact/hooks';
import type { RejectReason, GameState, Preview } from '../sim';
import type { FrameLabels, Quality } from '../render/renderer';

/** What the HTML layer shows. The game state here is read-only for the UI. */
export interface ViewState {
  readonly game: GameState;
  readonly fps: number;
  readonly debugOpen: boolean;
  readonly pointerLocked: boolean;
  readonly topView: boolean;
  /** Ability chosen and waiting for confirmation. */
  readonly selected: string | null;
  readonly preview: Preview | null;
  /** True while events are still animating (enemy phase, pushes…). */
  readonly busy: boolean;
  /** Last rejected command, shown briefly. */
  readonly notice: { readonly reason: RejectReason; readonly at: number } | null;
  /** Time of the last hit on the player, for the red screen flash. */
  readonly hitAt: number;
  /** Player health as currently animated; null = use the real value. */
  readonly shownHp: number | null;
  /** Graphics quality (debug menu); remembered per browser. */
  readonly quality: Quality;
  /** Where the selected ability is aimed (null for abilities without a choice of target). */
  readonly aim: { readonly x: number; readonly y: number } | null;
  /** Class choice (with "continue" when a saved run exists) or the game itself. */
  readonly screen: 'start' | 'play';
  readonly canContinue: boolean;
  /** A save existed but could not be read. */
  readonly saveError: boolean;
  /** Real time played in this run. */
  readonly elapsedMs: number;
  /** When the last room change happened, for the fade. */
  readonly roomAt: number;
  /** A hybrid just formed: its name and when, for the announcement. */
  readonly hybridNews: { readonly name: string; readonly at: number } | null;
  /** A gift was just taken: its patron speaks a line. */
  readonly patronVoice: { readonly patron: string; readonly at: number } | null;
}

export interface Store<T> {
  get(): T;
  set(patch: Partial<T>): void;
  subscribe(fn: (value: T) => void): () => void;
}

export function createStore<T extends object>(initial: T): Store<T> {
  let value = initial;
  const listeners = new Set<(value: T) => void>();
  return {
    get: () => value,
    set(patch) {
      value = { ...value, ...patch };
      for (const fn of listeners) fn(value);
    },
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
}

export function useStore<T>(store: Store<T>): T {
  const [value, setValue] = useState(store.get());
  useEffect(() => store.subscribe(setValue), [store]);
  return value;
}

/** Per-frame overlay data lives in its own store so the HUD does not re-render every frame. */
export type LabelsStore = Store<{ labels: FrameLabels | null }>;
