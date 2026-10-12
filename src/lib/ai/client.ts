/**
 * Talks to Claude through Jogu's own server rather than straight from the
 * browser.
 *
 * It used to go direct, with the key held in the browser, which was the only way
 * to run without a server at all. Now the key is stored encrypted on the server
 * and never sent here, so nothing on this page ever holds it. The trade is that
 * the coach needs an account; the schedule itself still works without one.
 */

export type AiErrorKind =
  | 'auth'
  | 'rate-limit'
  | 'network'
  | 'server'
  | 'request'
  | 'response'
  | 'account';

export class AiError extends Error {
  readonly kind: AiErrorKind;

  constructor(message: string, kind: AiErrorKind) {
    super(message);
    this.name = 'AiError';
    this.kind = kind;
  }
}

interface ServerError {
  error?: string;
  kind?: AiErrorKind;
}

async function call<T>(path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      method: body === undefined ? 'GET' : 'POST',
      credentials: 'include',
      signal,
      headers: body === undefined ? undefined : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (error) {
    // An abort is the app changing its mind, not a failure worth dressing up.
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    throw new AiError(
      'Kunde inte nå servern. Kontrollera att du har internet och försök igen.',
      'network',
    );
  }

  let payload: unknown = null;
  try {
    payload = await response.json();
  } catch {
    if (response.ok) throw new AiError('Servern svarade oläsligt.', 'response');
  }

  if (response.ok) return payload as T;

  const detail = (payload ?? {}) as ServerError;

  if (response.status === 401) {
    throw new AiError('Du behöver logga in för att använda coachen.', 'account');
  }
  if (response.status === 412) {
    throw new AiError(
      detail.error ?? 'Lägg in din API-nyckel under Mer först, så kan coachen börja jobba.',
      'account',
    );
  }

  throw new AiError(
    detail.error ?? `Servern svarade ${response.status}.`,
    detail.kind ?? 'request',
  );
}

export interface AnthropicModel {
  id: string;
  display_name: string;
  created_at: string;
}

export async function listModels(): Promise<AnthropicModel[]> {
  const body = await call<{ models: AnthropicModel[] }>('/api/ai/models');
  return body.models ?? [];
}

/**
 * Picks sensible defaults from whatever models the key actually has access to,
 * so the app never depends on a model name hardcoded by me.
 */
export function chooseModels(models: AnthropicModel[]): {
  planning: string | null;
  chat: string | null;
} {
  const byPattern = (pattern: RegExp) => models.find((m) => pattern.test(m.id))?.id ?? null;
  const planning =
    byPattern(/opus/i) ?? byPattern(/sonnet/i) ?? byPattern(/haiku/i) ?? models[0]?.id ?? null;
  const chat = byPattern(/haiku/i) ?? byPattern(/sonnet/i) ?? planning;
  return { planning, chat };
}

export interface Message {
  role: 'user' | 'assistant';
  content: string;
}

interface CompletionArgs {
  model: string;
  system: string;
  messages: Message[];
  maxTokens: number;
  signal?: AbortSignal;
}

interface ToolCallArgs extends CompletionArgs {
  toolName: string;
  toolDescription: string;
  schema: Record<string, unknown>;
}

interface ContentBlock {
  type: string;
  text?: string;
  name?: string;
  input?: unknown;
}

interface MessageResponse {
  content?: ContentBlock[];
  stop_reason?: string;
}

/**
 * Forces the model to answer by calling a single tool, which is Anthropic's way
 * of guaranteeing the reply matches a JSON schema.
 */
export async function callWithSchema<T>(args: ToolCallArgs): Promise<T> {
  const body = await call<MessageResponse>(
    '/api/ai/messages',
    {
      model: args.model,
      max_tokens: args.maxTokens,
      system: args.system,
      messages: args.messages,
      tools: [
        {
          name: args.toolName,
          description: args.toolDescription,
          input_schema: args.schema,
        },
      ],
      tool_choice: { type: 'tool', name: args.toolName },
    },
    args.signal,
  );

  if (body.stop_reason === 'max_tokens') {
    throw new AiError(
      'Svaret från Claude blev avbrutet för att det var för långt. Försök med ett kortare tidsspann eller färre veckor.',
      'response',
    );
  }

  const toolUse = body.content?.find((block) => block.type === 'tool_use');
  if (!toolUse?.input) {
    const text = body.content?.find((b) => b.type === 'text')?.text;
    throw new AiError(
      `Claude svarade inte i det format appen förväntade sig.${text ? ` Svaret började: ${text.slice(0, 200)}` : ''}`,
      'response',
    );
  }

  return toolUse.input as T;
}

export async function callForText(args: CompletionArgs): Promise<string> {
  const body = await call<MessageResponse>(
    '/api/ai/messages',
    {
      model: args.model,
      max_tokens: args.maxTokens,
      system: args.system,
      messages: args.messages,
    },
    args.signal,
  );

  const text = body.content
    ?.filter((block) => block.type === 'text')
    .map((block) => block.text ?? '')
    .join('\n')
    .trim();

  if (!text) throw new AiError('Claude svarade utan innehåll.', 'response');
  return text;
}

