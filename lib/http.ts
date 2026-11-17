import type { MessageKey } from "./i18n/core";

export class HttpError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(
    status: number,
    message: string,
    code = "request_error",
    readonly messageKey?: MessageKey,
    readonly messageValues?: Record<string, string | number>,
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

export function jsonError(message: string, error: unknown, fallbackMessageKey?: MessageKey): Response {
  const expected = error instanceof HttpError;
  const messageKey = expected ? error.messageKey : fallbackMessageKey;
  if (!expected) console.error(message, error);

  const status = expected ? error.status : 500;
  return json(
    {
      ok: false,
      error: message,
      code: expected ? error.code : "internal_error",
      detail: publicErrorDetail(error),
      ...(messageKey ? { messageKey } : {}),
      ...(expected && error.messageKey && error.messageValues ? { messageValues: error.messageValues } : {}),
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
