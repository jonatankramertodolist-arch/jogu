import type { Env } from './env';
import { HttpError, nowIso } from './http';
import type { GoogleIdentity } from './jwt';

const COOKIE_NAME = 'jogu_session';
const SESSION_DAYS = 90;

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  picture: string | null;
}

function randomToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

/**
 * Sessions are looked up by the hash of the cookie, never the cookie itself, so
 * the stored rows cannot be lifted and replayed as somebody else's login.
 */
async function hashToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function readCookie(request: Request, name: string): string | null {
  const header = request.headers.get('cookie');
  if (!header) return null;
  for (const part of header.split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return rest.join('=');
  }
  return null;
}

/**
 * `SameSite=Lax` is what keeps another site from making a logged-in request on
 * the athlete's behalf, which is why no separate CSRF token is needed.
 */
function cookie(value: string, maxAgeSeconds: number): string {
  return [
    `${COOKIE_NAME}=${value}`,
    'Path=/',
    'HttpOnly',
    'Secure',
    'SameSite=Lax',
    `Max-Age=${maxAgeSeconds}`,
  ].join('; ');
}

export function sessionCookie(token: string): string {
  return cookie(token, SESSION_DAYS * 24 * 60 * 60);
}

export function clearedCookie(): string {
  return cookie('', 0);
}

/** Finds or creates the account behind a verified Google identity. */
export async function upsertUser(env: Env, identity: GoogleIdentity): Promise<AuthUser> {
  const now = nowIso();
  const row = await env.DB.prepare(
    `INSERT INTO users (id, google_sub, email, name, picture_url, created_at, last_seen_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(google_sub) DO UPDATE SET
       email = excluded.email,
       name = excluded.name,
       picture_url = excluded.picture_url,
       last_seen_at = excluded.last_seen_at
     RETURNING id, email, name, picture_url`,
  )
    .bind(crypto.randomUUID(), identity.sub, identity.email, identity.name, identity.picture, now, now)
    .first<{ id: string; email: string; name: string; picture_url: string | null }>();

  if (!row) throw new HttpError(500, 'Kunde inte skapa kontot.');
  return { id: row.id, email: row.email, name: row.name, picture: row.picture_url };
}

export async function createSession(env: Env, userId: string): Promise<string> {
  const token = randomToken();
  const expires = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000).toISOString();

  await env.DB.prepare(
    'INSERT INTO auth_sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)',
  )
    .bind(await hashToken(token), userId, nowIso(), expires)
    .run();

  // Housekeeping on the way past, so dead sessions do not pile up forever.
  await env.DB.prepare('DELETE FROM auth_sessions WHERE expires_at < ?').bind(nowIso()).run();

  return token;
}

export async function currentUser(request: Request, env: Env): Promise<AuthUser | null> {
  const token = readCookie(request, COOKIE_NAME);
  if (!token) return null;

  const row = await env.DB.prepare(
    `SELECT u.id, u.email, u.name, u.picture_url
     FROM auth_sessions s
     JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = ? AND s.expires_at > ?`,
  )
    .bind(await hashToken(token), nowIso())
    .first<{ id: string; email: string; name: string; picture_url: string | null }>();

  if (!row) return null;
  return { id: row.id, email: row.email, name: row.name, picture: row.picture_url };
}

/**
 * The gate every route holding athlete data goes through. The user id comes from
 * here and never from the request body, which is what makes it impossible to ask
 * for somebody else's training.
 */
export async function requireUser(request: Request, env: Env): Promise<AuthUser> {
  const user = await currentUser(request, env);
  if (!user) throw new HttpError(401, 'Du behöver logga in.');
  return user;
}

export async function endSession(request: Request, env: Env): Promise<void> {
  const token = readCookie(request, COOKIE_NAME);
  if (!token) return;
  await env.DB.prepare('DELETE FROM auth_sessions WHERE token_hash = ?')
    .bind(await hashToken(token))
    .run();
}
