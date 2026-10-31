import { useEffect, useState } from 'preact/hooks';
import type { GameState } from '../sim';

/** What the HTML layer shows. The game state here is read-only for the UI. */
export interface ViewState {
  readonly game: GameState;
  readonly fps: number;
  readonly debugOpen: boolean;
  readonly pointerLocked: boolean;
  readonly topView: boolean;
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
