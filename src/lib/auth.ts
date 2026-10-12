import { useSyncExternalStore } from 'react';

import { api, OfflineError } from './api';

/**
 * Who is signed in, kept apart from the training data in `store.ts`.
 *
 * The app deliberately still works without an account. Sign-in can be missing
 * because Google is not configured yet, because the athlete is offline, or
 * because they simply have not signed in, and none of those should leave a
 * person unable to look at today's session.
 */

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  picture: string | null;
}

export type AuthStatus = 'loading' | 'anonymous' | 'signed-in';

interface AuthState {
  status: AuthStatus;
  user: AuthUser | null;
  /** Null when sign-in is not configured on the server. */
  googleClientId: string | null;
  /** True once the athlete has chosen to carry on without an account. */
  localMode: boolean;
  /** Set when the server could not be reached at all. */
  offline: boolean;
  error: string | null;
}

const LOCAL_MODE_KEY = 'jogu.localmode';

function readLocalMode(): boolean {
  try {
    return localStorage.getItem(LOCAL_MODE_KEY) === 'yes';
  } catch {
    return false;
  }
}

let state: AuthState = {
  status: 'loading',
  user: null,
  googleClientId: null,
  localMode: readLocalMode(),
  offline: false,
  error: null,
};

const listeners = new Set<() => void>();

function set(next: Partial<AuthState>): void {
  state = { ...state, ...next };
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getAuth(): AuthState {
  return state;
}

export function useAuth(): AuthState {
  return useSyncExternalStore(subscribe, getAuth);
}

let started = false;

/** Asks the server who we are. Safe to call more than once. */
export async function initAuth(): Promise<void> {
  if (started) return;
  started = true;

  try {
    const [config, me] = await Promise.all([
      api.get<{ googleClientId: string | null }>('/api/config'),
      api.get<{ user: AuthUser | null }>('/api/me'),
    ]);
    set({
      status: me.user ? 'signed-in' : 'anonymous',
      user: me.user,
      googleClientId: config.googleClientId,
      offline: false,
    });
  } catch (error) {
    // No contact with the server is not a reason to block the app, so this falls
    // back to what is already cached in the browser.
    set({
      status: 'anonymous',
      user: null,
      offline: error instanceof OfflineError,
      error: error instanceof OfflineError ? null : (error as Error).message,
    });
  }
}

export async function signInWithGoogle(credential: string): Promise<void> {
  set({ error: null });
  const result = await api.post<{ user: AuthUser }>('/api/auth/google', { credential });
  clearLocalMode();
  set({ status: 'signed-in', user: result.user, offline: false });
}

export async function signOut(): Promise<void> {
  try {
    await api.post('/api/auth/logout');
  } finally {
    set({ status: 'anonymous', user: null });
  }
}

export function continueWithoutAccount(): void {
  try {
    localStorage.setItem(LOCAL_MODE_KEY, 'yes');
  } catch {
    // Not being able to remember the choice only costs one extra tap next time.
  }
  set({ localMode: true });
}

export function clearLocalMode(): void {
  try {
    localStorage.removeItem(LOCAL_MODE_KEY);
  } catch {
    // Nothing to undo if storage is unavailable.
  }
  set({ localMode: false });
}

export function setAuthError(message: string | null): void {
  set({ error: message });
}
