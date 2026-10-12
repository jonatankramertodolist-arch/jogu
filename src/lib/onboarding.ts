import { useSyncExternalStore } from 'react';

import { api } from './api';
import { storeKey } from './apikey';
import {
  clearLocalCopy,
  forgetLegacyApiKey,
  getState,
  getSyncMeta,
  markEverythingDirty,
  readLegacyApiKey,
} from './store';
import { syncNow } from './sync';

/**
 * The one awkward moment in moving from a browser-only app to accounts: somebody
 * signs in for the first time and already has weeks of training saved locally.
 * Throwing that away silently would be the worst possible welcome, so it is
 * offered explicitly, once, with the consequence spelled out either way.
 */

export type ImportChoice = 'adopt' | 'discard';

interface OnboardingState {
  /** Set when the athlete needs to choose what happens to the browser's copy. */
  question: {
    localSessions: number;
    localGoal: string | null;
    serverHasData: boolean;
    hasLegacyKey: boolean;
  } | null;
  busy: boolean;
  /** True once this device has settled the question, so it is asked only once. */
  settled: boolean;
}

let state: OnboardingState = { question: null, busy: false, settled: false };
const listeners = new Set<() => void>();

function set(patch: Partial<OnboardingState>): void {
  state = { ...state, ...patch };
  listeners.forEach((listener) => listener());
}

export function getOnboarding(): OnboardingState {
  return state;
}

export function useOnboarding(): OnboardingState {
  return useSyncExternalStore((listener) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  }, getOnboarding);
}

function hasLocalTraining(): boolean {
  const current = getState();
  return current.goal !== null || current.plan !== null || current.sessions.length > 0;
}

let checked = false;

/**
 * Decides whether to ask. Only ever asks on a device that has never synced, since
 * after that the local copy is the account's own data rather than something that
 * predates it.
 */
export async function checkFirstSignIn(): Promise<void> {
  if (checked) return;
  checked = true;

  const neverSynced = getSyncMeta().cursor === null;
  const legacyKey = readLegacyApiKey();

  if (!neverSynced || (!hasLocalTraining() && !legacyKey)) {
    set({ settled: true });
    return;
  }

  let serverHasData = false;
  try {
    const result = await api.get<{ documents: unknown[]; records: unknown[] }>('/api/sync');
    serverHasData = result.documents.length > 0 || result.records.length > 0;
  } catch {
    // Cannot tell yet. Leaving it unsettled means asking next time rather than
    // guessing wrong about somebody's training.
    checked = false;
    return;
  }

  const current = getState();

  set({
    question: {
      localSessions: current.sessions.length,
      localGoal: current.goal?.raceName || null,
      serverHasData,
      hasLegacyKey: legacyKey !== null,
    },
  });
}

export async function resolveFirstSignIn(choice: ImportChoice): Promise<void> {
  set({ busy: true });

  try {
    const legacyKey = readLegacyApiKey();

    if (choice === 'adopt') {
      // Everything local is presented to the server as new, which given the
      // newest-write-wins rule is exactly what "use this copy" means.
      markEverythingDirty();
      if (legacyKey) {
        try {
          await storeKey(legacyKey);
          forgetLegacyApiKey();
        } catch {
          // The key can be pasted again under Mer. Losing the training would be
          // the real problem, and that part has already been queued.
        }
      }
    } else {
      clearLocalCopy();
      if (legacyKey) forgetLegacyApiKey();
    }

    await syncNow();
  } finally {
    set({ question: null, busy: false, settled: true });
  }
}
