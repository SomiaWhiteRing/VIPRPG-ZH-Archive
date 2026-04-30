type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

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
  return json(
    {
      ok: false,
      error: message,
      detail: error instanceof Error ? error.message : "Unknown error",
      timestamp: new Date().toISOString(),
    },
    { status: 500 },
  );
}
