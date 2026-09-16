type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

export class HttpError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly code = "request_error",
  ) {
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
  const expected = error instanceof HttpError;
  if (!expected) console.error(message, error);

  const status = expected ? error.status : 500;
  return json(
    {
      ok: false,
      error: message,
      code: expected ? error.code : "internal_error",
      detail: publicErrorDetail(error),
      timestamp: new Date().toISOString(),
    },
    { status },
  );
}

export function publicErrorDetail(error: unknown): string {
  return error instanceof HttpError
    ? error.message
    : "服务器暂时无法完成请求。请稍后重试；如果问题持续出现，请记录发生操作和时间。";
}
