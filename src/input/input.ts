import type { Command } from '../sim';
import { ABILITY_ACTIONS, actionToCommand, DEFAULT_BINDINGS, type Bindings } from './bindings';

export interface InputHandlers {
  /** A game command for the simulation. Input never touches game state itself. */
  command(c: Command): void;
  /** Ability slot (0-based) pressed: select it, or use it if already selected. */
  selectAbility(slot: number): void;
  /** Use the selected ability, or the base attack if none is selected. */
  confirm(): void;
  cancel(): void;
  topView(held: boolean): void;
  toggleDebug(): void;
  newSeed(): void;
  /** Raw mouse delta in pixels while pointer lock is active. */
  look(dx: number, dy: number): void;
  pointerLockChanged(locked: boolean): void;
}

export interface InputOptions {
  readonly playerId: string;
  readonly bindings?: Bindings;
}

/** Wires keyboard and mouse to handlers. Returns a function that removes all listeners. */
export function attachInput(canvas: HTMLElement, handlers: InputHandlers, opts: InputOptions): () => void {
  const bindings = opts.bindings ?? DEFAULT_BINDINGS;

  const isTyping = (e: KeyboardEvent) =>
    e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement;

  const onKeyDown = (e: KeyboardEvent) => {
    if (isTyping(e) || e.ctrlKey || e.metaKey || e.altKey) return;
    const action = bindings[e.code];
    if (!action) return;
    e.preventDefault();
    const command = actionToCommand(action, opts.playerId);
    // Holding a movement key repeats it; the caller buffers one command while an animation plays.
    if (command) {
      handlers.command(command);
      return;
    }
    if (e.repeat) return;
    const slot = ABILITY_ACTIONS.indexOf(action);
    if (slot >= 0) handlers.selectAbility(slot);
    else if (action === 'confirm') handlers.confirm();
    else if (action === 'cancel') handlers.cancel();
    else if (action === 'topView') handlers.topView(true);
    else if (action === 'toggleDebug') handlers.toggleDebug();
    else if (action === 'newSeed') handlers.newSeed();
  };

  const onKeyUp = (e: KeyboardEvent) => {
    if (bindings[e.code] === 'topView') {
      e.preventDefault();
      handlers.topView(false);
    }
  };

  // Losing focus while Tab is held must not leave the camera stuck overhead.
  const onBlur = () => handlers.topView(false);

  const locked = () => document.pointerLockElement === canvas;

  const onMouseDown = (e: MouseEvent) => {
    if (!locked()) {
      if (e.button === 0) {
        // Some browsers reject the request (e.g. right after leaving lock); ignore it, the next click retries.
        Promise.resolve(canvas.requestPointerLock()).catch(() => undefined);
      }
      return;
    }
    if (e.button === 0) handlers.confirm();
    else if (e.button === 2) handlers.cancel();
  };

  const onContextMenu = (e: Event) => e.preventDefault();

  const onMouseMove = (e: MouseEvent) => {
    if (locked()) handlers.look(e.movementX, e.movementY);
  };

  const onLockChange = () => handlers.pointerLockChanged(locked());

  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('blur', onBlur);
  canvas.addEventListener('mousedown', onMouseDown);
  canvas.addEventListener('contextmenu', onContextMenu);
  document.addEventListener('mousemove', onMouseMove);
  document.addEventListener('pointerlockchange', onLockChange);

  return () => {
    window.removeEventListener('keydown', onKeyDown);
    window.removeEventListener('keyup', onKeyUp);
    window.removeEventListener('blur', onBlur);
    canvas.removeEventListener('mousedown', onMouseDown);
    canvas.removeEventListener('contextmenu', onContextMenu);
    document.removeEventListener('mousemove', onMouseMove);
    document.removeEventListener('pointerlockchange', onLockChange);
  };
}
