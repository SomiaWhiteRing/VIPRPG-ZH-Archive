export type ApiConfirmation = {
  title: string;
  description: string;
  confirmLabel: string;
  fieldName: string;
  fieldValue: string;
};

export type ApiResponsePayload = {
  ok?: boolean;
  code?: string;
  confirmation?: ApiConfirmation;
  detail?: string;
  error?: string;
  redirectTo?: string;
};

export class ApiResponseError extends Error {
  readonly status: number;
  readonly payload: ApiResponsePayload;
  constructor(
    message: string,
    status: number,
    payload: ApiResponsePayload,
  ) {
    super(message);
    this.name = "ApiResponseError";
    this.status = status;
    this.payload = payload;
  }

  get code(): string | undefined {
    return this.payload.code;
  }
}

export async function requestResponse(
  input: RequestInfo | URL,
  init: RequestInit = {},
  failureLabel = "请求失败",
): Promise<Response> {
  try {
    return await fetch(input, init);
  } catch (error) {
    if (init.signal?.aborted || isAbortError(error)) throw error;
    throw new ApiResponseError(`${failureLabel}：无法连接服务器，请检查网络后重试。`, 0, { code: "network_error" });
  }
}

// Binary bodies and 204 responses share HTTP failure handling without JSON decoding on success.
export async function requestOk(input: RequestInfo | URL, init: RequestInit = {}, failureLabel = "请求失败"): Promise<Response> {
  const response = await requestResponse(input, init, failureLabel);
  if (!response.ok) {
    const payload = await readJsonResponse<ApiResponsePayload>(response, failureLabel, true).catch((error: unknown) => {
      if (isAbortError(error)) throw error;
      return {};
    });
    throw apiResponseError(response.status, payload, failureLabel);
  }
  return response;
}

// Recovery flows can inspect a failed response before deciding whether to retry or recover.
export async function readJsonResponse<T>(response: Response, failureLabel = "请求失败", allowFailure = false): Promise<T> {
  let payload: unknown;
  try {
    payload = await response.json();
  } catch (error) {
    if (isAbortError(error)) throw error;
    throw new ApiResponseError(
      response.redirected
        ? `${failureLabel}：登录状态可能已失效，请刷新页面并重新登录。`
        : `${failureLabel}：服务器返回了无法识别的响应，请刷新页面后重试。`,
      response.status,
      { code: "invalid_response" },
    );
  }
  if (!isRecord(payload)) {
    throw new ApiResponseError(`${failureLabel}：服务器返回了无法识别的响应，请刷新页面后重试。`, response.status, { code: "invalid_response" });
  }
  if (!allowFailure && (!response.ok || payload.ok === false)) {
    throw apiResponseError(response.status, payload, failureLabel);
  }
  return payload as T;
}

export async function requestJsonValue<T>(
  input: RequestInfo | URL,
  init: RequestInit = {},
  failureLabel = "请求失败",
): Promise<T> {
  return readSuccessfulJson<T>(input, init, failureLabel, false);
}

export async function requestJson<T>(
  input: RequestInfo | URL,
  init: RequestInit = {},
  failureLabel = "请求失败",
): Promise<T> {
  return readSuccessfulJson<T>(input, init, failureLabel, true);
}

export function postJson<T>(url: string, body: unknown, failureLabel = "请求失败"): Promise<T> {
  return requestJsonValue<T>(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }, failureLabel);
}

async function readSuccessfulJson<T>(input: RequestInfo | URL, init: RequestInit, failureLabel: string, requireOk: boolean): Promise<T> {
  const response = await requestResponse(input, init, failureLabel);
  const payload = await readJsonResponse<ApiResponsePayload>(response, failureLabel);
  if (requireOk && payload.ok !== true) {
    throw apiResponseError(response.status, payload, failureLabel);
  }
  return payload as T;
}

export function apiResponseError(status: number, payload: ApiResponsePayload, failureLabel = "请求失败"): ApiResponseError {
  const authorizationMessage = status === 401
    ? "登录状态已失效，请刷新页面并重新登录。"
    : status === 403
      ? "当前账户没有执行此操作的权限，请确认登录状态和权限后重试。"
      : null;
  return new ApiResponseError(
    stringValue(payload.detail)
      ?? authorizationMessage
      ?? stringValue(payload.error)
      ?? `${failureLabel}（状态码 ${status}），请稍后重试。`,
    status,
    payload,
  );
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && ["AbortError", "TimeoutError"].includes(error.name);
}

export function apiConfirmationFromError(error: unknown): ApiConfirmation | null {
  if (!(error instanceof ApiResponseError)) return null;
  const value = error.payload.confirmation;
  if (!isRecord(value)) return null;
  const title = stringValue(value.title);
  const description = stringValue(value.description);
  const confirmLabel = stringValue(value.confirmLabel);
  const fieldName = stringValue(value.fieldName);
  const fieldValue = stringValue(value.fieldValue);
  if (
    !title ||
    !description ||
    !confirmLabel ||
    !fieldName ||
    !/^[a-z][a-z0-9_]*$/u.test(fieldName) ||
    !fieldValue
  ) {
    return null;
  }
  return { title, description, confirmLabel, fieldName, fieldValue };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}
