import type { Command } from '../sim';
import { actionToCommand, DEFAULT_BINDINGS, type Bindings } from './bindings';

export interface InputHandlers {
  /** A game command for the simulation. Input never touches game state itself. */
  command(c: Command): void;
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
    if (command) {
      // Holding a key repeats the command; the caller buffers one while an animation plays.
      handlers.command(command);
      return;
    }
    if (e.repeat) return;
    if (action === 'topView') handlers.topView(true);
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

  const onClick = () => {
    if (document.pointerLockElement !== canvas) {
      // Some browsers reject the request (e.g. right after leaving lock); ignore it, the next click retries.
      Promise.resolve(canvas.requestPointerLock()).catch(() => undefined);
    }
  };

  const onMouseMove = (e: MouseEvent) => {
    if (document.pointerLockElement === canvas) handlers.look(e.movementX, e.movementY);
  };

  const onLockChange = () => handlers.pointerLockChanged(document.pointerLockElement === canvas);

  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('blur', onBlur);
  canvas.addEventListener('click', onClick);
  document.addEventListener('mousemove', onMouseMove);
  document.addEventListener('pointerlockchange', onLockChange);

  return () => {
    window.removeEventListener('keydown', onKeyDown);
    window.removeEventListener('keyup', onKeyUp);
    window.removeEventListener('blur', onBlur);
    canvas.removeEventListener('click', onClick);
    document.removeEventListener('mousemove', onMouseMove);
    document.removeEventListener('pointerlockchange', onLockChange);
  };
}
