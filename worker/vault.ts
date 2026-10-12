import type { Env } from './env';
import { HttpError, nowIso } from './http';

/**
 * Where the athlete's Anthropic key is kept.
 *
 * The key is encrypted with AES-GCM against a secret that lives in Cloudflare's
 * secret store rather than in the database, so a copy of the data on its own
 * reveals nothing. The account id is passed as additional authenticated data,
 * which means a row cannot be moved from one account to another to make somebody
 * else's key work under your login. Decryption happens only to make an outbound
 * call to Anthropic; the plaintext is never sent back to a browser.
 */

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

async function masterKey(env: Env): Promise<CryptoKey> {
  if (!env.KEY_ENCRYPTION_SECRET) {
    throw new HttpError(503, 'Servern saknar krypteringsnyckel, så nyckeln kan inte sparas.');
  }

  const raw = base64ToBytes(env.KEY_ENCRYPTION_SECRET);
  if (raw.length !== 32) {
    throw new HttpError(503, 'Serverns krypteringsnyckel har fel längd.');
  }

  return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

export interface StoredKey {
  connected: boolean;
  hint: string | null;
  updatedAt: string | null;
}

/** What the interface may show: enough to recognise the key, never enough to use it. */
function hintFor(key: string): string {
  return key.length <= 4 ? '••••' : `sk-ant-…${key.slice(-4)}`;
}

export async function saveAnthropicKey(env: Env, userId: string, key: string): Promise<StoredKey> {
  const trimmed = key.trim();
  if (!trimmed.startsWith('sk-ant-')) {
    throw new HttpError(400, 'Nyckeln ska börja med sk-ant-. Kopiera den igen från Anthropic.');
  }
  if (trimmed.length < 20) throw new HttpError(400, 'Nyckeln ser för kort ut.');

  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: new TextEncoder().encode(userId) },
    await masterKey(env),
    new TextEncoder().encode(trimmed),
  );

  const now = nowIso();
  const hint = hintFor(trimmed);

  await env.DB.prepare(
    `INSERT INTO user_secrets (user_id, key_cipher, key_iv, key_hint, updated_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET
       key_cipher = excluded.key_cipher,
       key_iv = excluded.key_iv,
       key_hint = excluded.key_hint,
       updated_at = excluded.updated_at`,
  )
    .bind(userId, bytesToBase64(new Uint8Array(cipher)), bytesToBase64(iv), hint, now)
    .run();

  return { connected: true, hint, updatedAt: now };
}

export async function describeAnthropicKey(env: Env, userId: string): Promise<StoredKey> {
  const row = await env.DB.prepare(
    'SELECT key_hint, updated_at FROM user_secrets WHERE user_id = ?',
  )
    .bind(userId)
    .first<{ key_hint: string; updated_at: string }>();

  if (!row) return { connected: false, hint: null, updatedAt: null };
  return { connected: true, hint: row.key_hint, updatedAt: row.updated_at };
}

export async function deleteAnthropicKey(env: Env, userId: string): Promise<void> {
  await env.DB.prepare('DELETE FROM user_secrets WHERE user_id = ?').bind(userId).run();
}

/**
 * Only ever called on the way to Anthropic. Kept internal to the server: no route
 * returns what this produces.
 */
export async function readAnthropicKey(env: Env, userId: string): Promise<string> {
  const row = await env.DB.prepare(
    'SELECT key_cipher, key_iv FROM user_secrets WHERE user_id = ?',
  )
    .bind(userId)
    .first<{ key_cipher: string; key_iv: string }>();

  if (!row) throw new HttpError(412, 'Du behöver lägga in din API-nyckel under Mer först.');

  try {
    const plain = await crypto.subtle.decrypt(
      {
        name: 'AES-GCM',
        iv: base64ToBytes(row.key_iv),
        additionalData: new TextEncoder().encode(userId),
      },
      await masterKey(env),
      base64ToBytes(row.key_cipher),
    );
    return new TextDecoder().decode(plain);
  } catch (error) {
    if (error instanceof HttpError) throw error;
    // Either the master secret was rotated or the row was tampered with. Both
    // mean the stored key is unusable, and saying so beats a vague failure.
    throw new HttpError(422, 'Den sparade nyckeln kunde inte läsas. Lägg in den igen under Mer.');
  }
}
