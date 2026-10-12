import { AiUpstreamError, createMessage, listModels, parseMessageRequest } from './ai';
import {
  clearedCookie,
  createSession,
  currentUser,
  endSession,
  requireUser,
  sessionCookie,
  upsertUser,
} from './auth';
import type { Env } from './env';
import { fail, HttpError, json, nowIso, readJson } from './http';
import { verifyGoogleIdToken } from './jwt';
import { parseSyncPayload, pull, push, wipe } from './sync';
import { deleteAnthropicKey, describeAnthropicKey, saveAnthropicKey } from './vault';

export interface Route {
  method: string;
  path: string;
  handler: (request: Request, env: Env, url: URL) => Promise<Response>;
}

const routes: Route[] = [
  {
    method: 'GET',
    path: '/api/health',
    handler: async (_request, env) => {
      // Touches the database rather than just returning true, so a broken
      // binding shows up here instead of in the middle of someone's session.
      const row = await env.DB.prepare('SELECT 1 AS ok').first<{ ok: number }>();
      return json({ ok: row?.ok === 1, time: nowIso() });
    },
  },

  {
    method: 'GET',
    path: '/api/config',
    handler: async (_request, env) =>
      // Lets the app render the Google button without the client id being baked
      // into the bundle at build time.
      json({ googleClientId: env.GOOGLE_CLIENT_ID || null }),
  },

  {
    method: 'POST',
    path: '/api/auth/google',
    handler: async (request, env) => {
      if (!env.GOOGLE_CLIENT_ID) {
        throw new HttpError(503, 'Inloggning är inte konfigurerad än.');
      }

      const body = await readJson<{ credential?: string }>(request);
      if (!body.credential) throw new HttpError(400, 'Ingen inloggning skickades med.');

      const identity = await verifyGoogleIdToken(body.credential, env.GOOGLE_CLIENT_ID);
      const user = await upsertUser(env, identity);
      const token = await createSession(env, user.id);

      return json({ user }, { headers: { 'set-cookie': sessionCookie(token) } });
    },
  },

  {
    method: 'POST',
    path: '/api/auth/logout',
    handler: async (request, env) => {
      await endSession(request, env);
      return json({ ok: true }, { headers: { 'set-cookie': clearedCookie() } });
    },
  },

  {
    method: 'GET',
    path: '/api/me',
    handler: async (request, env) => {
      const user = await currentUser(request, env);
      return json({ user });
    },
  },

  {
    method: 'GET',
    path: '/api/secrets/anthropic',
    handler: async (request, env) => {
      const user = await requireUser(request, env);
      return json(await describeAnthropicKey(env, user.id));
    },
  },

  {
    method: 'PUT',
    path: '/api/secrets/anthropic',
    handler: async (request, env) => {
      const user = await requireUser(request, env);
      const body = await readJson<{ key?: string }>(request);
      if (!body.key) throw new HttpError(400, 'Ingen nyckel skickades med.');
      return json(await saveAnthropicKey(env, user.id, body.key));
    },
  },

  {
    method: 'DELETE',
    path: '/api/secrets/anthropic',
    handler: async (request, env) => {
      const user = await requireUser(request, env);
      await deleteAnthropicKey(env, user.id);
      return json({ connected: false, hint: null, updatedAt: null });
    },
  },

  {
    method: 'GET',
    path: '/api/sync',
    handler: async (request, env, url) => {
      const user = await requireUser(request, env);
      return json(await pull(env, user.id, url.searchParams.get('since')));
    },
  },

  {
    method: 'POST',
    path: '/api/sync',
    handler: async (request, env, url) => {
      const user = await requireUser(request, env);
      const payload = parseSyncPayload(await readJson<unknown>(request));
      await push(env, user.id, payload);
      // The same response carries everything the server has that this device has
      // not seen, so one round trip both saves and catches up.
      return json(await pull(env, user.id, url.searchParams.get('since')));
    },
  },

  {
    method: 'DELETE',
    path: '/api/sync',
    handler: async (request, env) => {
      const user = await requireUser(request, env);
      await wipe(env, user.id);
      return json({ ok: true });
    },
  },

  {
    method: 'GET',
    path: '/api/ai/models',
    handler: async (request, env) => {
      const user = await requireUser(request, env);
      return json({ models: await listModels(env, user.id) });
    },
  },

  {
    method: 'POST',
    path: '/api/ai/messages',
    handler: async (request, env) => {
      const user = await requireUser(request, env);
      const payload = parseMessageRequest(await readJson<unknown>(request));
      return json(await createMessage(env, user.id, payload));
    },
  },

  {
    method: 'DELETE',
    path: '/api/me',
    handler: async (request, env) => {
      const user = await requireUser(request, env);
      // Everything else references users(id) with ON DELETE CASCADE, so this one
      // statement removes the training, the logs and the stored key with it.
      await env.DB.prepare('DELETE FROM users WHERE id = ?').bind(user.id).run();
      return json({ ok: true }, { headers: { 'set-cookie': clearedCookie() } });
    },
  },
];

export async function handleApi(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const matches = routes.filter((route) => route.path === url.pathname);

  if (matches.length === 0) return fail(404, 'Okänd adress.');

  const route = matches.find((candidate) => candidate.method === request.method);
  if (!route) return fail(405, 'Fel metod för den adressen.');

  try {
    return await route.handler(request, env, url);
  } catch (error) {
    // The kind rides along so the app can tell a rejected key apart from a busy
    // model, and say something the athlete can act on.
    if (error instanceof AiUpstreamError) {
      return json({ error: error.message, kind: error.kind }, { status: error.status });
    }
    if (error instanceof HttpError) return fail(error.status, error.message);
    // Anything unexpected stays out of the response: the athlete gets a plain
    // message while the detail goes to the log where only we can read it.
    console.error('Oväntat fel i API:t', error);
    return fail(500, 'Något gick fel på servern.');
  }
}
