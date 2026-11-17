import { isMessageKey, translate, type MessageKey } from "../i18n/core";
import { DEFAULT_UI_LOCALE, parseUiLocale, type UiLocale } from "../i18n/locale";

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
  messageKey?: string;
  messageValues?: Record<string, string | number>;
  error?: string;
  redirectTo?: string;
};

export class ApiResponseError extends Error {
  readonly status: number;
  readonly payload: ApiResponsePayload;
  readonly messageValues?: Record<string, string | number>;
  constructor(
    message: string,
    status: number,
    payload: ApiResponsePayload,
  ) {
    super(message);
    this.name = "ApiResponseError";
    this.status = status;
    this.payload = payload;
    const values = payload.messageValues;
    if (isRecord(values) && Object.values(values).every(value => typeof value === "string" || typeof value === "number")) {
      this.messageValues = values;
    }
  }

  get code(): string | undefined {
    return this.payload.code;
  }

  messageFor(locale: UiLocale): string {
    if (isMessageKey(this.payload.messageKey)) {
      try {
        return translate(locale, this.payload.messageKey, this.messageValues);
      } catch {
        // Older responses and messages requiring unavailable arguments retain their detail.
      }
    }
    return this.message;
  }
}

function requestLocale(): UiLocale {
  return typeof document === "undefined"
    ? DEFAULT_UI_LOCALE
    : parseUiLocale(document.documentElement.lang) ?? DEFAULT_UI_LOCALE;
}

function defaultFailureLabel() {
  return translate(requestLocale(), "core.request.failed");
}

export async function requestResponse(
  input: RequestInfo | URL,
  init: RequestInit = {},
  failureLabel = defaultFailureLabel(),
): Promise<Response> {
  try {
    return await fetch(input, init);
  } catch (error) {
    if (init.signal?.aborted || isAbortError(error)) throw error;
    const locale = requestLocale();
    throw new ApiResponseError(
      translate(locale, "core.request.detail", { label: failureLabel, detail: translate(locale, "core.form.network") }),
      0,
      { code: "network_error" },
    );
  }
}

// Binary bodies and 204 responses share HTTP failure handling without JSON decoding on success.
export async function requestOk(input: RequestInfo | URL, init: RequestInit = {}, failureLabel = defaultFailureLabel()): Promise<Response> {
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
export async function readJsonResponse<T>(response: Response, failureLabel = defaultFailureLabel(), allowFailure = false): Promise<T> {
  const locale = requestLocale();
  let payload: unknown;
  try {
    payload = await response.json();
  } catch (error) {
    if (isAbortError(error)) throw error;
    throw new ApiResponseError(
      translate(locale, "core.request.detail", {
        label: failureLabel,
        detail: translate(locale, response.redirected ? "core.request.redirected" : "core.form.badResponse"),
      }),
      response.status,
      { code: "invalid_response" },
    );
  }
  if (!isRecord(payload)) {
    throw new ApiResponseError(
      translate(locale, "core.request.detail", { label: failureLabel, detail: translate(locale, "core.form.badResponse") }),
      response.status,
      { code: "invalid_response" },
    );
  }
  if (!allowFailure && (!response.ok || payload.ok === false)) {
    throw apiResponseError(response.status, payload, failureLabel);
  }
  return payload as T;
}

export async function requestJsonValue<T>(
  input: RequestInfo | URL,
  init: RequestInit = {},
  failureLabel = defaultFailureLabel(),
): Promise<T> {
  return readSuccessfulJson<T>(input, init, failureLabel, false);
}

export async function requestJson<T>(
  input: RequestInfo | URL,
  init: RequestInit = {},
  failureLabel: string | { messageKey: MessageKey; messageValues?: Record<string, string | number> } = defaultFailureLabel(),
): Promise<T> {
  const label = typeof failureLabel === "string"
    ? failureLabel
    : translate(requestLocale(), failureLabel.messageKey, failureLabel.messageValues);
  return readSuccessfulJson<T>(input, init, label, true);
}

export function postJson<T>(url: string, body: unknown, failureLabel = defaultFailureLabel()): Promise<T> {
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

export function apiResponseError(status: number, payload: ApiResponsePayload, failureLabel = defaultFailureLabel()): ApiResponseError {
  const locale = requestLocale();
  if (payload.code === "internal_error" && !isMessageKey(payload.messageKey)) {
    const messageKey = "core.request.internal";
    return new ApiResponseError(translate(locale, messageKey), status, { ...payload, messageKey });
  }
  const detail = stringValue(payload.detail);
  const fallbackKey = status === 401
    ? "core.request.session"
    : status === 403
      ? "core.request.forbidden"
      : status === 405 && payload.error === "Method not allowed"
        ? "core.request.methodNotAllowed"
        : null;
  if (!detail && fallbackKey && !isMessageKey(payload.messageKey)) {
    return new ApiResponseError(translate(locale, fallbackKey), status, { ...payload, messageKey: fallbackKey });
  }
  const error = new ApiResponseError(
    detail
      ?? (fallbackKey ? translate(locale, fallbackKey) : null)
      ?? stringValue(payload.error)
      ?? translate(locale, "core.request.status", { label: failureLabel, status }),
    status,
    payload,
  );
  error.message = error.messageFor(locale);
  return error;
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
