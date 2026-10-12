import { useSyncExternalStore } from 'react';

import { api, OfflineError } from './api';
import { getAuth, signOut } from './auth';
import {
  applyFromServer,
  clearLocalCopy,
  DOCUMENT_KINDS,
  getState,
  getSyncMeta,
  markPushed,
  onStateChanged,
  RECORD_KINDS,
  setCursor,
  type DocumentKind,
  type RecordKind,
} from './store';
import type { Adjustment, AppState, ChatMessage, Session, SessionLog } from './types';

/**
 * Keeps the browser's copy and the server's copy in step.
 *
 * Local first: a change is saved in the browser immediately and sent afterwards.
 * That is the whole point, because the moment somebody most wants to log a session
 * is right after finishing one, which is often exactly where the signal is worst.
 */

/** Waits this long after a change before pushing, so a burst becomes one call. */
const PUSH_DELAY_MS = 1500;
/** Also checks in on this interval, to notice changes from another device. */
const POLL_INTERVAL_MS = 60_000;

export type SyncPhase = 'idle' | 'syncing' | 'offline' | 'error';

interface SyncState {
  phase: SyncPhase;
  /** Number of local changes not yet accepted by the server. */
  pending: number;
  lastSyncedAt: string | null;
  error: string | null;
}

interface DocumentRow {
  kind: string;
  body: string;
  updatedAt: string;
}

interface RecordRow {
  kind: string;
  id: string;
  body: string;
  updatedAt: string;
  deleted: boolean;
}

interface PullResult {
  documents: DocumentRow[];
  records: RecordRow[];
  serverTime: string;
}

let syncState: SyncState = { phase: 'idle', pending: 0, lastSyncedAt: null, error: null };

const listeners = new Set<() => void>();

function set(patch: Partial<SyncState>): void {
  syncState = { ...syncState, ...patch };
  listeners.forEach((listener) => listener());
}

export function getSyncState(): SyncState {
  return syncState;
}

export function useSyncState(): SyncState {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getSyncState,
  );
}

// ---------------------------------------------------------------------------
// Turning state into rows and back
// ---------------------------------------------------------------------------

function documentBody(state: AppState, kind: DocumentKind): unknown {
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

function findRecord(state: AppState, kind: RecordKind, id: string): unknown {
  switch (kind) {
    case 'session':
      return state.sessions.find((session) => session.id === id);
    case 'log':
      return state.logs[id];
    case 'adjustment':
      return state.adjustments.find((adjustment) => adjustment.id === id);
    case 'chat':
      return state.chat.find((message) => message.id === id);
  }
}

function isDocumentKind(value: string): value is DocumentKind {
  return (DOCUMENT_KINDS as readonly string[]).includes(value);
}

function isRecordKind(value: string): value is RecordKind {
  return (RECORD_KINDS as readonly string[]).includes(value);
}

function buildPayload(): { documents: DocumentRow[]; records: RecordRow[] } {
  const state = getState();
  const meta = getSyncMeta();
  const documents: DocumentRow[] = [];
  const records: RecordRow[] = [];

  for (const key of meta.dirty) {
    const updatedAt = meta.stamps[key];
    if (!updatedAt) continue;

    const separator = key.indexOf(':');

    if (separator === -1) {
      if (!isDocumentKind(key)) continue;
      documents.push({
        kind: key,
        body: JSON.stringify(documentBody(state, key) ?? null),
        updatedAt,
      });
      continue;
    }

    const kind = key.slice(0, separator);
    const id = key.slice(separator + 1);
    if (!isRecordKind(kind)) continue;

    const value = findRecord(state, kind, id);
    const deleted = value === undefined || meta.tombstones[key] !== undefined;

    records.push({
      kind,
      id,
      body: JSON.stringify(deleted ? null : value),
      updatedAt,
      deleted,
    });
  }

  return { documents, records };
}

/**
 * Folds the server's rows into the local copy. A row only wins if it is newer
 * than what this device last recorded for that key, which is what stops a stale
 * pull from undoing something just typed.
 */
function mergeIntoState(result: PullResult): void {
  if (result.documents.length === 0 && result.records.length === 0) return;

  applyFromServer((current) => {
    const meta = getSyncMeta();
    const stamps: Record<string, string> = {};
    let next = current;

    for (const row of result.documents) {
      if (!isDocumentKind(row.kind)) continue;
      const local = meta.stamps[row.kind];
      if (local && local >= row.updatedAt) continue;

      const body = JSON.parse(row.body) as unknown;
      stamps[row.kind] = row.updatedAt;

      switch (row.kind) {
        case 'profile':
          next = { ...next, profile: body as AppState['profile'] };
          break;
        case 'goal':
          next = { ...next, goal: body as AppState['goal'] };
          break;
        case 'plan':
          next = { ...next, plan: body as AppState['plan'] };
          break;
        case 'settings':
          next = { ...next, settings: body as AppState['settings'] };
          break;
        case 'flags':
          next = { ...next, isDemo: (body as { isDemo?: boolean })?.isDemo === true };
          break;
      }
    }

    // Collected first, then applied in one go per kind, so a pull with hundreds of
    // sessions does not rebuild the array hundreds of times.
    const sessions = new Map(next.sessions.map((session) => [session.id, session]));
    const adjustments = new Map(next.adjustments.map((item) => [item.id, item]));
    const chat = new Map(next.chat.map((message) => [message.id, message]));
    const logs: Record<string, SessionLog> = { ...next.logs };
    let touchedSessions = false;
    let touchedAdjustments = false;
    let touchedChat = false;
    let touchedLogs = false;

    for (const row of result.records) {
      if (!isRecordKind(row.kind)) continue;
      const key = `${row.kind}:${row.id}`;
      const local = meta.stamps[key];
      if (local && local >= row.updatedAt) continue;

      const body = row.deleted ? null : (JSON.parse(row.body) as unknown);
      stamps[key] = row.updatedAt;

      switch (row.kind) {
        case 'session':
          touchedSessions = true;
          if (body === null) sessions.delete(row.id);
          else sessions.set(row.id, body as Session);
          break;
        case 'log':
          touchedLogs = true;
          if (body === null) delete logs[row.id];
          else logs[row.id] = body as SessionLog;
          break;
        case 'adjustment':
          touchedAdjustments = true;
          if (body === null) adjustments.delete(row.id);
          else adjustments.set(row.id, body as Adjustment);
          break;
        case 'chat':
          touchedChat = true;
          if (body === null) chat.delete(row.id);
          else chat.set(row.id, body as ChatMessage);
          break;
      }
    }

    if (touchedSessions) {
      next = {
        ...next,
        sessions: [...sessions.values()].sort((a, b) =>
          a.date === b.date ? a.order - b.order : a.date < b.date ? -1 : 1,
        ),
      };
    }
    if (touchedLogs) next = { ...next, logs };
    if (touchedAdjustments) {
      next = { ...next, adjustments: [...adjustments.values()].sort((a, b) => (a.at < b.at ? -1 : 1)) };
    }
    if (touchedChat) {
      next = { ...next, chat: [...chat.values()].sort((a, b) => (a.at < b.at ? -1 : 1)) };
    }

    return { next, stamps };
  });
}

// ---------------------------------------------------------------------------
// The loop
// ---------------------------------------------------------------------------

let running = false;
let queuedAgain = false;

export async function syncNow(): Promise<void> {
  if (getAuth().status !== 'signed-in') {
    set({ phase: 'idle', pending: getSyncMeta().dirty.length });
    return;
  }

  if (running) {
    // Something changed mid-flight. Rather than racing, note it and go again.
    queuedAgain = true;
    return;
  }

  running = true;
  set({ phase: 'syncing', error: null });

  try {
    const meta = getSyncMeta();
    const payload = buildPayload();
    const pushedKeys = meta.dirty;
    const since = meta.cursor;

    if (payload.documents.length > 0 || payload.records.length > 0) {
      const query = since ? `?since=${encodeURIComponent(since)}` : '';
      const result = await api.post<PullResult>(`/api/sync${query}`, payload);
      // Merge before clearing dirty, so the stamps the server just accepted are
      // not mistaken for remote changes on the way back in.
      markPushed(pushedKeys, result.serverTime);
      mergeIntoState(result);
    } else {
      const query = since ? `?since=${encodeURIComponent(since)}` : '';
      const result = await api.get<PullResult>(`/api/sync${query}`);
      mergeIntoState(result);
      setCursor(result.serverTime);
    }

    set({
      phase: 'idle',
      pending: getSyncMeta().dirty.length,
      lastSyncedAt: new Date().toISOString(),
      error: null,
    });
  } catch (error) {
    if (error instanceof OfflineError) {
      // Not a failure worth alarming anybody about: the queue simply waits.
      set({ phase: 'offline', pending: getSyncMeta().dirty.length });
    } else {
      set({
        phase: 'error',
        pending: getSyncMeta().dirty.length,
        error: error instanceof Error ? error.message : 'Kunde inte synka.',
      });
    }
  } finally {
    running = false;
    if (queuedAgain) {
      queuedAgain = false;
      void syncNow();
    }
  }
}

let pushTimer: number | undefined;
let started = false;

/** Wires up the triggers. Safe to call more than once. */
export function startSync(): void {
  if (started) return;
  started = true;

  onStateChanged(() => {
    set({ pending: getSyncMeta().dirty.length });
    window.clearTimeout(pushTimer);
    pushTimer = window.setTimeout(() => void syncNow(), PUSH_DELAY_MS);
  });

  window.addEventListener('online', () => void syncNow());

  // Coming back to the app is the most likely moment for another device to have
  // moved on, so that is worth a check even without any local change.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void syncNow();
  });

  window.setInterval(() => void syncNow(), POLL_INTERVAL_MS);

  // Anything still queued from a previous visit goes out now.
  void syncNow();
}

/**
 * Signs out and leaves nothing behind. Clearing the local copy matters most on a
 * shared computer: without it the next person to sign in would briefly be looking
 * at somebody else's training.
 */
export async function signOutAndClear(): Promise<void> {
  try {
    await syncNow();
  } catch {
    // Getting out is more important than one last save.
  }
  await signOut();
  clearLocalCopy();
  set({ phase: 'idle', pending: 0, lastSyncedAt: null, error: null });
}
