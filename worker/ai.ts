import type { Env } from './env';
import { HttpError } from './http';
import { readAnthropicKey } from './vault';

/**
 * Talks to Anthropic on the athlete's behalf.
 *
 * The browser used to call Anthropic directly with the key in hand, which meant
 * the key had to live in the browser. Going through here instead keeps it on the
 * server, decrypted only for the length of one outbound call.
 *
 * This is not a general proxy. Only the fields the coach needs are forwarded, and
 * the size of a request is capped, so a stolen session cannot be turned into
 * unlimited spending on somebody else's Anthropic account.
 */

const API_BASE = 'https://api.anthropic.com/v1';
const API_VERSION = '2023-06-01';
/** Comfortably above what a full 28-day plan needs, far below runaway usage. */
const MAX_TOKENS_CAP = 32_000;
const MAX_BODY_CHARS = 400_000;

export type AiErrorKind = 'auth' | 'rate-limit' | 'network' | 'server' | 'request' | 'response';

/** Carries a machine-readable kind so the app can say something useful. */
export class AiUpstreamError extends HttpError {
  kind: AiErrorKind;

  constructor(status: number, message: string, kind: AiErrorKind) {
    super(status, message);
    this.name = 'AiUpstreamError';
    this.kind = kind;
  }
}

interface IncomingMessage {
  role: unknown;
  content: unknown;
}

function messageRole(value: unknown): 'user' | 'assistant' {
  if (value === 'user' || value === 'assistant') return value;
  throw new HttpError(400, 'Ett meddelande hade en okänd avsändare.');
}

function messageContent(value: unknown): string {
  if (typeof value === 'string') return value;
  throw new HttpError(400, 'Ett meddelande hade oväntat innehåll.');
}

export interface MessageRequest {
  model: string;
  max_tokens: number;
  system?: string;
  messages: { role: 'user' | 'assistant'; content: string }[];
  tools?: unknown;
  tool_choice?: unknown;
}

/**
 * Rebuilds the request from scratch rather than passing the body through, so no
 * field the app does not use can reach Anthropic.
 */
export function parseMessageRequest(raw: unknown): MessageRequest {
  if (!raw || typeof raw !== 'object') throw new HttpError(400, 'Förfrågan saknade innehåll.');
  const body = raw as Record<string, unknown>;

  if (typeof body.model !== 'string' || !body.model) {
    throw new HttpError(400, 'Ingen modell angiven.');
  }

  const maxTokens = typeof body.max_tokens === 'number' ? body.max_tokens : 0;
  if (!Number.isFinite(maxTokens) || maxTokens < 1) {
    throw new HttpError(400, 'Ogiltigt tak för svarslängd.');
  }

  if (!Array.isArray(body.messages) || body.messages.length === 0) {
    throw new HttpError(400, 'Förfrågan saknade meddelanden.');
  }

  const messages = (body.messages as IncomingMessage[]).map((message) => ({
    role: messageRole(message.role),
    content: messageContent(message.content),
  }));

  const request: MessageRequest = {
    model: body.model,
    max_tokens: Math.min(Math.floor(maxTokens), MAX_TOKENS_CAP),
    messages,
  };

  if (typeof body.system === 'string') request.system = body.system;
  if (Array.isArray(body.tools)) request.tools = body.tools;
  if (body.tool_choice && typeof body.tool_choice === 'object') {
    request.tool_choice = body.tool_choice;
  }

  const size = JSON.stringify(request).length;
  if (size > MAX_BODY_CHARS) {
    throw new HttpError(413, 'Förfrågan blev för stor. Bygg ett kortare tidsspann.');
  }

  return request;
}

async function anthropic(
  env: Env,
  userId: string,
  path: string,
  init: RequestInit,
): Promise<unknown> {
  const key = await readAnthropicKey(env, userId);

  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      ...init,
      headers: {
        'content-type': 'application/json',
        'x-api-key': key,
        'anthropic-version': API_VERSION,
      },
    });
  } catch {
    throw new AiUpstreamError(502, 'Kunde inte nå Claude. Försök igen om en stund.', 'network');
  }

  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    if (response.ok) throw new AiUpstreamError(502, 'Claude svarade oläsligt.', 'response');
  }

  if (response.ok) return body;

  // Anthropic's own message can name the account or the key, so it is summarised
  // rather than handed on verbatim.
  const detail =
    body && typeof body === 'object' && 'error' in body
      ? String((body as { error: { message?: string } }).error?.message ?? '')
      : '';

  if (response.status === 401 || response.status === 403) {
    throw new AiUpstreamError(
      400,
      'API-nyckeln godtogs inte. Kontrollera att den är hel och aktiv under Mer.',
      'auth',
    );
  }
  if (response.status === 429) {
    throw new AiUpstreamError(
      429,
      'För många anrop på kort tid, eller så är krediten slut. Vänta en stund.',
      'rate-limit',
    );
  }
  if (response.status >= 500) {
    throw new AiUpstreamError(
      502,
      'Claude svarar inte just nu. Försök igen om en liten stund.',
      'server',
    );
  }

  throw new AiUpstreamError(
    400,
    detail ? `Anropet nekades: ${detail.slice(0, 200)}` : 'Anropet nekades av Claude.',
    'request',
  );
}

export interface AnthropicModel {
  id: string;
  display_name: string;
  created_at: string;
}

export async function listModels(env: Env, userId: string): Promise<AnthropicModel[]> {
  const body = (await anthropic(env, userId, '/models?limit=100', { method: 'GET' })) as {
    data?: AnthropicModel[];
  };
  return (body.data ?? []).sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
}

export async function createMessage(
  env: Env,
  userId: string,
  request: MessageRequest,
): Promise<unknown> {
  return anthropic(env, userId, '/messages', {
    method: 'POST',
    body: JSON.stringify(request),
  });
}
