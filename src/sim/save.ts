import type { Command } from './commands';
import { STATE_VERSION, type GameState } from './state';

/**
 * Save files (CLAUDE.md rule 8): plain JSON with a version, upgraded step by step by migrations.
 * Pure: reading and writing storage is the caller's job (and always guarded there).
 */

export const SAVE_VERSION = 1;

export interface SaveFile {
  readonly version: number;
  readonly state: GameState;
  /** Every command of the run: with the seed and class it replays the run exactly (bug reports). */
  readonly commands: readonly Command[];
  readonly classId: string;
  /** Real time played, for the results screen. */
  readonly elapsedMs: number;
}

type Json = Record<string, unknown>;
const isObject = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * Game-state migrations: `STATE_MIGRATIONS[v]` turns a version-v state into version v+1.
 * States older than the first entry cannot be upgraded.
 */
const STATE_MIGRATIONS: Record<number, (s: Json) => Json> = {
  // v5 → v6 (M3): runs, elite enemies with attack patterns, ability upgrades.
  5: (s) => ({
    ...s,
    version: 6,
    players: (s.players as Json[]).map((p) => ({ upgrades: [], ...p })),
    enemies: (s.enemies as Json[]).map((e) => ({ elite: false, strikes: 0, ...e })),
    run: {
      depth: 1,
      kind: 'combat',
      phase: 'combat',
      pending: 'ability',
      offer: [],
      doors: [],
      elites: 0,
      turns: 0,
      log: [{ type: 'room', depth: 1, kind: 'combat' }],
    },
  }),
  // v6 → v7 (M4): several classes, hybrids, items, Initiation and treasure doors.
  6: (s) => ({
    ...s,
    version: 7,
    players: (s.players as Json[]).map((p) => ({
      classes: [p.classId],
      hybrid: null,
      items: [],
      ruleUses: [],
      ...p,
    })),
    run: s.run ? { initiation: false, treasures: 0, ...(s.run as Json) } : null,
  }),
  // v7 → v8 (M5): patron gifts and altars.
  7: (s) => ({
    ...s,
    version: 8,
    players: (s.players as Json[]).map((p) => ({ gifts: [], turnUses: [], ...p })),
    run: s.run ? { patron: null, altars: 0, forceAltar: false, ...(s.run as Json) } : null,
  }),
  // v8 → v9 (M6): three acts, boss phases.
  8: (s) => ({
    ...s,
    version: 9,
    enemies: Array.isArray(s.enemies) ? (s.enemies as Json[]).map((e) => ({ phase: 0, ...e })) : s.enemies,
    run: s.run ? { act: 1, ...(s.run as Json) } : null,
  }),
  // v9 → v10: counters for "every n-th" rules (Static charge).
  9: (s) => ({
    ...s,
    version: 10,
    players: (s.players as Json[]).map((p) => ({ counters: [], ...p })),
  }),
};

export function migrateState(raw: unknown): GameState | null {
  if (!isObject(raw) || typeof raw.version !== 'number') return null;
  let s: Json = raw;
  while ((s.version as number) < STATE_VERSION) {
    const step = STATE_MIGRATIONS[s.version as number];
    if (!step) return null;
    s = step(s);
  }
  if (s.version !== STATE_VERSION) return null;
  // A minimal shape check: enough that a broken file is rejected instead of crashing later.
  for (const key of ['seed', 'room', 'players', 'allies', 'enemies', 'surfaces', 'combat', 'run'])
    if (!(key in s)) return null;
  if (!Array.isArray(s.players) || s.players.length === 0) return null;
  return s as unknown as GameState;
}

/** Parses and upgrades a save; null if it is missing, broken or too old to upgrade. */
export function readSave(text: string | null): SaveFile | null {
  if (!text) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isObject(raw) || typeof raw.version !== 'number' || raw.version > SAVE_VERSION) return null;
  const state = migrateState(raw.state);
  if (!state || !Array.isArray(raw.commands) || typeof raw.classId !== 'string') return null;
  return {
    version: SAVE_VERSION,
    state,
    commands: raw.commands as Command[],
    classId: raw.classId,
    elapsedMs: typeof raw.elapsedMs === 'number' ? raw.elapsedMs : 0,
  };
}

export function writeSave(save: Omit<SaveFile, 'version'>): string {
  return JSON.stringify({ version: SAVE_VERSION, ...save });
}
