export class HttpError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(
    status: number,
    message: string,
    code = "request_error",
  ) {
    super(message);
    this.name = "HttpError";
    this.status = status;
    this.code = code;
  }
}

export function json(body: unknown, init?: ResponseInit): Response {
  const headers = new Headers(init?.headers);
  if (!headers.has("Cache-Control")) headers.set("Cache-Control", "no-store");
  return Response.json(body, {
    ...init,
    headers,
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
