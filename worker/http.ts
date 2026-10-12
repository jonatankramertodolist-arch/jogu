/** An error whose message is safe to show the athlete, with a status to match. */
export class HttpError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
  }
}

export function json(data: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      // The API answers about one person's training. Never let a cache hold it.
      'cache-control': 'no-store',
      ...init.headers,
    },
  });
}

export function fail(status: number, message: string): Response {
  return json({ error: message }, { status });
}

export async function readJson<T>(request: Request): Promise<T> {
  try {
    return (await request.json()) as T;
  } catch {
    throw new HttpError(400, 'Kunde inte läsa förfrågan.');
  }
}

export function nowIso(): string {
  return new Date().toISOString();
}
