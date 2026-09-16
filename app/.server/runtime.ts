export type AppRuntime = {
  request: Request;
  env: CloudflareEnv;
  execution: Pick<ExecutionContext, "waitUntil" | "passThroughOnException">;
  db: D1Database;
  bucket: R2Bucket;
  origin: string;
  memo: Map<string, unknown>;
};

export function createRuntime(
  request: Request,
  env: CloudflareEnv,
  execution: AppRuntime["execution"],
): AppRuntime {
  return {
    request,
    env,
    execution,
    db: env.DB,
    bucket: env.ARCHIVE_BUCKET,
    origin: env.APP_ORIGIN,
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
