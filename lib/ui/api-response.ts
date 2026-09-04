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
  constructor(
    message: string,
    public readonly status: number,
    public readonly payload: ApiResponsePayload,
  ) {
    super(message);
    this.name = "ApiResponseError";
  }
}

export async function requestJson<T extends ApiResponsePayload>(
  input: RequestInfo | URL,
  init: RequestInit,
  failureLabel: string,
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(input, init);
  } catch {
    throw new Error(`${failureLabel}：无法连接服务器，请检查网络后重试。`);
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new Error(
      response.redirected
        ? `${failureLabel}：登录状态可能已失效，请刷新页面并重新登录。`
        : `${failureLabel}：服务器返回了无法识别的响应，请刷新页面后重试。`,
    );
  }

  if (!isRecord(payload)) {
    throw new Error(`${failureLabel}：服务器返回了无法识别的响应，请刷新页面后重试。`);
  }

  if (!response.ok || payload.ok !== true) {
    const detail = stringValue(payload.detail);
    const authorizationMessage = response.status === 401
      ? "登录状态已失效，请刷新页面并重新登录。"
      : response.status === 403
        ? "当前账户没有执行此操作的权限，请确认登录状态和权限后重试。"
        : null;
    throw new ApiResponseError(
      detail
        ?? authorizationMessage
        ?? stringValue(payload.error)
        ?? `${failureLabel}，请稍后重试。`,
      response.status,
      payload as ApiResponsePayload,
    );
  }

  return payload as T;
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
