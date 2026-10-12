import { useEffect, useSyncExternalStore } from 'react';

import { api } from './api';
import { getAuth, useAuth } from './auth';

/**
 * The athlete's Anthropic key, as far as the browser is allowed to know it.
 *
 * Only ever a hint like `sk-ant-…4f2a` and a timestamp. The key itself is stored
 * encrypted on the server and never sent back here, so nothing on this page can
 * leak it, and clearing the browser does not lose it.
 *
 * Kept as a small shared store rather than page state, because three screens need
 * to know whether the coach can work and they should not each ask the server.
 */

export interface KeyStatus {
  connected: boolean;
  hint: string | null;
  updatedAt: string | null;
}

export const NO_KEY: KeyStatus = { connected: false, hint: null, updatedAt: null };

let status: KeyStatus = NO_KEY;
let pending: Promise<KeyStatus> | null = null;

const listeners = new Set<() => void>();

function set(next: KeyStatus): void {
  status = next;
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getKeyStatus(): KeyStatus {
  return status;
}

/** Asks the server once, and shares the same request with any parallel callers. */
export function refreshKeyStatus(): Promise<KeyStatus> {
  if (getAuth().status !== 'signed-in') {
    set(NO_KEY);
    return Promise.resolve(NO_KEY);
  }
  if (pending) return pending;

  pending = api
    .get<KeyStatus>('/api/secrets/anthropic')
    .then((next) => {
      set(next);
      return next;
    })
    .catch(() => {
      set(NO_KEY);
      return NO_KEY;
    })
    .finally(() => {
      pending = null;
    });

  return pending;
}

export function useKeyStatus(): KeyStatus {
  const auth = useAuth();
  const current = useSyncExternalStore(subscribe, getKeyStatus);
  const signedIn = auth.status === 'signed-in';

  // Fetched by whichever screen first cares, rather than at start-up. Clearing on
  // sign-out matters: otherwise the next person to sign in on the same device
  // would briefly see that somebody else has a key connected.
  useEffect(() => {
    if (signedIn) void refreshKeyStatus();
    else forgetKeyStatus();
  }, [signedIn]);

  return signedIn ? current : NO_KEY;
}

/** Whether the AI coach can actually do anything: an account plus a stored key. */
export function useCoachReady(): boolean {
  const auth = useAuth();
  const key = useKeyStatus();
  return auth.status === 'signed-in' && key.connected;
}

export async function storeKey(key: string): Promise<KeyStatus> {
  const next = await api.put<KeyStatus>('/api/secrets/anthropic', { key });
  set(next);
  return next;
}

export async function removeKey(): Promise<KeyStatus> {
  const next = await api.delete<KeyStatus>('/api/secrets/anthropic');
  set(next);
  return next;
}

export function forgetKeyStatus(): void {
  set(NO_KEY);
}
