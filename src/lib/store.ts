import { useSyncExternalStore } from 'react';

import type { AppState, AthleteProfile, Settings } from './types';

/**
 * The single place that touches persistent storage.
 *
 * Everything else in the app goes through `getState` / `update`, which is what
 * makes it possible to add cloud storage without rewriting a single component.
 * Writes land in the browser first and are pushed to the server afterwards, so
 * logging a session in a gym with no signal still works.
 *
 * Change tracking lives here rather than in the data model. Because `update` is
 * the only way state changes, this file can compare before and after and stamp
 * whatever moved. Putting an `updatedAt` on every session would have meant every
 * caller remembering to set it, and one that forgot would silently stop syncing.
 */

const STATE_KEY = 'jogu.state.v1';
const SYNC_KEY = 'jogu.sync.v1';
/** Kept apart from the rest of the state so backups never contain the key. */
const API_KEY_KEY = 'jogu.apikey';

/**
 * The app was called TriCoach until the rename. Browser storage is keyed by
 * name, so without carrying these across, the rename alone would have looked
 * to every existing user like their plan and key had disappeared.
 */
const LEGACY_KEYS: Record<string, string> = {
  [STATE_KEY]: 'tricoach.state.v1',
  [API_KEY_KEY]: 'tricoach.apikey',
};

const SCHEMA_VERSION = 1;

/**
 * Reads a key, falling back to its pre-rename name and moving the value over.
 * The old copy is dropped only once the new one is confirmed written, so a
 * failed write leaves the athlete's history where it was rather than nowhere.
 */
function readMigrated(key: string): string | null {
  const current = localStorage.getItem(key);
  if (current !== null) return current;

  const legacy = LEGACY_KEYS[key] ? localStorage.getItem(LEGACY_KEYS[key]) : null;
  if (legacy === null) return null;

  try {
    localStorage.setItem(key, legacy);
    if (localStorage.getItem(key) === legacy) localStorage.removeItem(LEGACY_KEYS[key]);
  } catch {
    // Out of quota. Serving the old value still beats starting up empty.
  }
  return legacy;
}

export const DEFAULT_PROFILE: AthleteProfile = {
  name: '',
  birthYear: null,
  weightKg: null,
  weeklyHours: 10,
  availableDays: [1, 2, 3, 4, 5, 6, 7],
  longSessionDays: [6, 7],
  experience: 'intermediate',
  swimBackground: '',
  bikeBackground: '',
  runBackground: '',
  injuries: '',
  notes: '',
};

export const DEFAULT_SETTINGS: Settings = {
  planningModel: null,
  chatModel: null,
  coachTone: 'balanced',
  detailWindowDays: 28,
  ambition: 50,
};

function emptyState(): AppState {
  return {
    schemaVersion: SCHEMA_VERSION,
    profile: { ...DEFAULT_PROFILE },
    goal: null,
    plan: null,
    sessions: [],
    logs: {},
    adjustments: [],
    chat: [],
    settings: { ...DEFAULT_SETTINGS },
    isDemo: false,
  };
}

/**
 * Fills in anything a stored state is missing. Without this, adding a field
 * later would crash the app for anyone with existing data in their browser.
 */
function migrate(raw: unknown): AppState {
  const base = emptyState();
  if (!raw || typeof raw !== 'object') return base;
  const stored = raw as Partial<AppState>;
  return {
    ...base,
    ...stored,
    schemaVersion: SCHEMA_VERSION,
    profile: { ...base.profile, ...(stored.profile ?? {}) },
    settings: { ...base.settings, ...(stored.settings ?? {}) },
    sessions: stored.sessions ?? [],
    logs: stored.logs ?? {},
    adjustments: stored.adjustments ?? [],
    chat: stored.chat ?? [],
  };
}

function load(): AppState {
  try {
    const raw = readMigrated(STATE_KEY);
    if (!raw) return emptyState();
    return migrate(JSON.parse(raw));
  } catch {
    return emptyState();
  }
}

// ---------------------------------------------------------------------------
// Change tracking
// ---------------------------------------------------------------------------

/** Whole documents: only ever edited deliberately, in one place at a time. */
export const DOCUMENT_KINDS = ['profile', 'goal', 'plan', 'settings', 'flags'] as const;
/** Rows that change independently on different devices. */
export const RECORD_KINDS = ['session', 'log', 'adjustment', 'chat'] as const;

export type DocumentKind = (typeof DOCUMENT_KINDS)[number];
export type RecordKind = (typeof RECORD_KINDS)[number];

export interface SyncMeta {
  /** When each document or record last changed, by key such as `session:abc`. */
  stamps: Record<string, string>;
  /** Keys changed here and not yet accepted by the server. */
  dirty: string[];
  /** Keys deleted here, kept so the deletion also reaches the other devices. */
  tombstones: Record<string, string>;
  /** Server time of the last successful pull. */
  cursor: string | null;
}

function emptyMeta(): SyncMeta {
  return { stamps: {}, dirty: [], tombstones: {}, cursor: null };
}

function loadMeta(): SyncMeta {
  try {
    const raw = localStorage.getItem(SYNC_KEY);
    if (!raw) return emptyMeta();
    const parsed = JSON.parse(raw) as Partial<SyncMeta>;
    return {
      stamps: parsed.stamps ?? {},
      dirty: parsed.dirty ?? [],
      tombstones: parsed.tombstones ?? {},
      cursor: parsed.cursor ?? null,
    };
  } catch {
    return emptyMeta();
  }
}

function documentValue(state: AppState, kind: DocumentKind): unknown {
  switch (kind) {
    case 'profile':
      return state.profile;
    case 'goal':
      return state.goal;
    case 'plan':
      return state.plan;
    case 'settings':
      return state.settings;
    case 'flags':
      return { isDemo: state.isDemo };
  }
}

function recordMap(state: AppState, kind: RecordKind): Map<string, unknown> {
  switch (kind) {
    case 'session':
      return new Map(state.sessions.map((session) => [session.id, session]));
    case 'log':
      return new Map(Object.entries(state.logs));
    case 'adjustment':
      return new Map(state.adjustments.map((adjustment) => [adjustment.id, adjustment]));
    case 'chat':
      return new Map(state.chat.map((message) => [message.id, message]));
  }
}

/**
 * `flags` is rebuilt on every read, so it needs comparing by value. Everything
 * else is replaced wholesale by immutable updates, where identity is enough and
 * far cheaper than deep comparison on a plan with hundreds of sessions.
 */
function documentChanged(kind: DocumentKind, before: unknown, after: unknown): boolean {
  if (kind === 'flags') return JSON.stringify(before) !== JSON.stringify(after);
  return before !== after;
}

let state: AppState = load();
let meta: SyncMeta = loadMeta();

const listeners = new Set<() => void>();
const changeListeners = new Set<() => void>();

let persistTimer: number | undefined;

function persist(): void {
  // Writing on every keystroke in a text field would be wasteful, so batch.
  window.clearTimeout(persistTimer);
  persistTimer = window.setTimeout(() => {
    try {
      localStorage.setItem(STATE_KEY, JSON.stringify(state));
      localStorage.setItem(SYNC_KEY, JSON.stringify(meta));
    } catch (error) {
      console.error('Kunde inte spara data lokalt', error);
    }
  }, 150);
}

function touch(keys: string[], at: string): void {
  if (keys.length === 0) return;
  const stamps = { ...meta.stamps };
  const dirty = new Set(meta.dirty);
  for (const key of keys) {
    stamps[key] = at;
    dirty.add(key);
  }
  meta = { ...meta, stamps, dirty: [...dirty] };
}

function entomb(keys: string[], at: string): void {
  if (keys.length === 0) return;
  const tombstones = { ...meta.tombstones };
  const stamps = { ...meta.stamps };
  const dirty = new Set(meta.dirty);
  for (const key of keys) {
    tombstones[key] = at;
    stamps[key] = at;
    dirty.add(key);
  }
  meta = { ...meta, tombstones, stamps, dirty: [...dirty] };
}

/** Works out what moved between two states, so nothing has to be declared. */
function trackChanges(before: AppState, after: AppState): void {
  const at = new Date().toISOString();
  const changed: string[] = [];
  const removed: string[] = [];

  for (const kind of DOCUMENT_KINDS) {
    if (documentChanged(kind, documentValue(before, kind), documentValue(after, kind))) {
      changed.push(kind);
    }
  }

  for (const kind of RECORD_KINDS) {
    const previous = recordMap(before, kind);
    const next = recordMap(after, kind);

    for (const [id, value] of next) {
      if (previous.get(id) !== value) changed.push(`${kind}:${id}`);
    }
    for (const id of previous.keys()) {
      if (!next.has(id)) removed.push(`${kind}:${id}`);
    }
  }

  touch(changed, at);
  entomb(removed, at);
}

export function getState(): AppState {
  return state;
}

export function getSyncMeta(): SyncMeta {
  return meta;
}

function announce(): void {
  listeners.forEach((listener) => listener());
  changeListeners.forEach((listener) => listener());
}

export function update(updater: (current: AppState) => AppState): void {
  const before = state;
  state = updater(before);
  if (state !== before) trackChanges(before, state);
  persist();
  announce();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Lets the sync layer know something changed, without storage knowing about it. */
export function onStateChanged(listener: () => void): () => void {
  changeListeners.add(listener);
  return () => changeListeners.delete(listener);
}

/**
 * Returns the whole state. Components read the fields they need; the reference
 * only changes when `update` runs, so this does not over-render in practice.
 */
export function useAppState(): AppState {
  return useSyncExternalStore(subscribe, getState);
}

export function replaceState(next: AppState): void {
  update(() => migrate(next));
}

export function resetState(): void {
  update(() => emptyState());
}

/**
 * Applies what came from the server. Kept apart from `update` because these
 * changes must not be marked dirty: pushing them straight back would turn every
 * sync into a loop of two devices echoing each other.
 */
export function applyFromServer(
  apply: (current: AppState) => { next: AppState; stamps: Record<string, string> },
): void {
  const result = apply(state);
  state = result.next;
  meta = { ...meta, stamps: { ...meta.stamps, ...result.stamps } };
  persist();
  announce();
}

/** Records that the server has accepted these keys. */
export function markPushed(keys: string[], cursor: string | null): void {
  const dirty = meta.dirty.filter((key) => !keys.includes(key));
  const tombstones = { ...meta.tombstones };
  // A deletion the server has taken no longer needs remembering here.
  for (const key of keys) delete tombstones[key];
  meta = { ...meta, dirty, tombstones, cursor: cursor ?? meta.cursor };
  persist();
}

export function setCursor(cursor: string): void {
  meta = { ...meta, cursor };
  persist();
}

/**
 * Forgets what has been synced, so the next sync treats everything here as new.
 * Used when signing in on a device that already holds training.
 */
export function markEverythingDirty(): void {
  const at = new Date().toISOString();
  const keys: string[] = [...DOCUMENT_KINDS];
  for (const kind of RECORD_KINDS) {
    for (const id of recordMap(state, kind).keys()) keys.push(`${kind}:${id}`);
  }
  meta = { stamps: {}, dirty: [], tombstones: {}, cursor: null };
  touch(keys, at);
  persist();
}

/** Drops the local copy and the sync bookkeeping, for signing out. */
export function clearLocalCopy(): void {
  meta = emptyMeta();
  state = emptyState();
  try {
    localStorage.removeItem(STATE_KEY);
    localStorage.removeItem(SYNC_KEY);
  } catch {
    // Nothing more to do if storage is unavailable.
  }
  announce();
}

/**
 * The key from before it moved to the server. Only read once, when offering to
 * carry an existing browser's setup into a new account.
 */
export function readLegacyApiKey(): string | null {
  try {
    return readMigrated(API_KEY_KEY);
  } catch {
    return null;
  }
}

export function forgetLegacyApiKey(): void {
  try {
    localStorage.removeItem(API_KEY_KEY);
  } catch {
    // Nothing to remove if storage is unavailable.
  }
}

export function newId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `id-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}
