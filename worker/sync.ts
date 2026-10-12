import type { Env } from './env';
import { HttpError, nowIso } from './http';

/**
 * Moves the athlete's training between their devices.
 *
 * Deliberately simple: the newest write to a given record wins. That is the right
 * rule here because one account is one person, so the realistic conflict is not
 * two people disagreeing but the same person having logged a session on their
 * phone that their laptop has not seen yet. Resolving per record rather than per
 * blob is what keeps that log from being overwritten.
 *
 * The user id always comes from the session, never from the payload, so a request
 * cannot reach into another account.
 */

/** Edited deliberately in one place, so whole-document replacement is fine. */
const DOCUMENT_KINDS = ['profile', 'goal', 'plan', 'settings', 'flags'];
/** Changes independently per device, so these are tracked one row at a time. */
const RECORD_KINDS = ['session', 'log', 'adjustment', 'chat'];

const MAX_RECORDS_PER_PUSH = 5000;
const MAX_BODY_CHARS = 1_000_000;

export interface DocumentRow {
  kind: string;
  body: string;
  updatedAt: string;
}

export interface RecordRow {
  kind: string;
  id: string;
  body: string;
  updatedAt: string;
  deleted: boolean;
}

export interface SyncPayload {
  documents: DocumentRow[];
  records: RecordRow[];
}

export interface PullResult extends SyncPayload {
  serverTime: string;
}

function isIsoDate(value: unknown): value is string {
  return typeof value === 'string' && !Number.isNaN(Date.parse(value));
}

function parseDocuments(raw: unknown): DocumentRow[] {
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) throw new HttpError(400, 'Fel format på dokumenten.');

  return raw.map((item) => {
    const row = item as Partial<DocumentRow>;
    if (typeof row.kind !== 'string' || !DOCUMENT_KINDS.includes(row.kind)) {
      throw new HttpError(400, 'Okänd typ av dokument.');
    }
    if (typeof row.body !== 'string') throw new HttpError(400, 'Dokumentet saknade innehåll.');
    if (!isIsoDate(row.updatedAt)) throw new HttpError(400, 'Dokumentet saknade tidsstämpel.');
    return { kind: row.kind, body: row.body, updatedAt: row.updatedAt };
  });
}

function parseRecords(raw: unknown): RecordRow[] {
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) throw new HttpError(400, 'Fel format på posterna.');
  if (raw.length > MAX_RECORDS_PER_PUSH) {
    throw new HttpError(413, 'För många poster i samma synk.');
  }

  return raw.map((item) => {
    const row = item as Partial<RecordRow>;
    if (typeof row.kind !== 'string' || !RECORD_KINDS.includes(row.kind)) {
      throw new HttpError(400, 'Okänd typ av post.');
    }
    if (typeof row.id !== 'string' || !row.id) throw new HttpError(400, 'Posten saknade id.');
    if (typeof row.body !== 'string') throw new HttpError(400, 'Posten saknade innehåll.');
    if (!isIsoDate(row.updatedAt)) throw new HttpError(400, 'Posten saknade tidsstämpel.');
    return {
      kind: row.kind,
      id: row.id,
      body: row.body,
      updatedAt: row.updatedAt,
      deleted: row.deleted === true,
    };
  });
}

export function parseSyncPayload(raw: unknown): SyncPayload {
  if (!raw || typeof raw !== 'object') throw new HttpError(400, 'Synken saknade innehåll.');
  const body = raw as Record<string, unknown>;

  const payload = {
    documents: parseDocuments(body.documents),
    records: parseRecords(body.records),
  };

  const size = JSON.stringify(payload).length;
  if (size > MAX_BODY_CHARS) throw new HttpError(413, 'Synken blev för stor.');

  return payload;
}

/**
 * Writes only what is newer than what is already stored. The comparison happens
 * in SQL so two devices syncing at once cannot leave the older copy on top.
 */
export async function push(env: Env, userId: string, payload: SyncPayload): Promise<void> {
  const statements = [];

  for (const document of payload.documents) {
    statements.push(
      env.DB.prepare(
        `INSERT INTO documents (user_id, kind, body, updated_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(user_id, kind) DO UPDATE SET
           body = excluded.body,
           updated_at = excluded.updated_at
         WHERE excluded.updated_at > documents.updated_at`,
      ).bind(userId, document.kind, document.body, document.updatedAt),
    );
  }

  for (const record of payload.records) {
    statements.push(
      env.DB.prepare(
        `INSERT INTO records (user_id, kind, id, body, updated_at, deleted)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(user_id, kind, id) DO UPDATE SET
           body = excluded.body,
           updated_at = excluded.updated_at,
           deleted = excluded.deleted
         WHERE excluded.updated_at > records.updated_at`,
      ).bind(userId, record.kind, record.id, record.body, record.updatedAt, record.deleted ? 1 : 0),
    );
  }

  if (statements.length === 0) return;

  await env.DB.batch(statements);
}

export async function pull(env: Env, userId: string, since: string | null): Promise<PullResult> {
  const cursor = since && isIsoDate(since) ? since : '';

  const documents = await env.DB.prepare(
    'SELECT kind, body, updated_at FROM documents WHERE user_id = ? AND updated_at > ?',
  )
    .bind(userId, cursor)
    .all<{ kind: string; body: string; updated_at: string }>();

  const records = await env.DB.prepare(
    'SELECT kind, id, body, updated_at, deleted FROM records WHERE user_id = ? AND updated_at > ?',
  )
    .bind(userId, cursor)
    .all<{ kind: string; id: string; body: string; updated_at: string; deleted: number }>();

  return {
    documents: (documents.results ?? []).map((row) => ({
      kind: row.kind,
      body: row.body,
      updatedAt: row.updated_at,
    })),
    records: (records.results ?? []).map((row) => ({
      kind: row.kind,
      id: row.id,
      body: row.body,
      updatedAt: row.updated_at,
      deleted: row.deleted === 1,
    })),
    serverTime: nowIso(),
  };
}

/** Used when the athlete asks to start over on the server too. */
export async function wipe(env: Env, userId: string): Promise<void> {
  await env.DB.batch([
    env.DB.prepare('DELETE FROM documents WHERE user_id = ?').bind(userId),
    env.DB.prepare('DELETE FROM records WHERE user_id = ?').bind(userId),
  ]);
}
