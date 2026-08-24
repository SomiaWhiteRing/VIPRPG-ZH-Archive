type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

export class HttpError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
    this.name = "HttpError";
  }
}

export function json(body: JsonValue, init?: ResponseInit): Response {
  return Response.json(body, {
    headers: {
      "Cache-Control": "no-store",
      ...init?.headers,
    },
    ...init,
  });
}

export function jsonError(message: string, error: unknown): Response {
  const status = error instanceof HttpError ? error.status : 500;
  return json(
    {
      ok: false,
      error: message,
      detail: error instanceof Error ? error.message : "Unknown error",
      timestamp: new Date().toISOString(),
    },
    { status },
  );
}
