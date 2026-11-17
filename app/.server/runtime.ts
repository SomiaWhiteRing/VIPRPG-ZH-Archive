import { normalizeAppOrigin } from "./auth/config";
import type { SessionCookieRefresh } from "./auth/session";
import { requestUiLocale, type UiLocale } from "@/lib/i18n/locale";

export type AppRuntime = {
  request: Request;
  env: CloudflareEnv;
  execution: Pick<ExecutionContext, "waitUntil" | "passThroughOnException">;
  db: D1Database;
  bucket: R2Bucket;
  origin: string;
  uiLocale: UiLocale;
  memo: Map<string, unknown>;
  sessionCookieRefresh?: SessionCookieRefresh;
};

export function createRuntime(
  request: Request,
  env: CloudflareEnv,
  execution: AppRuntime["execution"],
  development = false,
): AppRuntime {
  return {
    request,
    uiLocale: requestUiLocale(request),
    env,
    execution,
    db: env.DB,
    bucket: env.ARCHIVE_BUCKET,
    origin: normalizeAppOrigin(
      development ? request.url : env.APP_ORIGIN,
      development,
    ),
    memo: new Map(),
  };
}

export function memoizeRequest<T>(
  runtime: AppRuntime,
  key: string,
  load: () => T,
): T {
  if (!runtime.memo.has(key)) runtime.memo.set(key, load());
  return runtime.memo.get(key) as T;
}
