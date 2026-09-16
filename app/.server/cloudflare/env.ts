import type { AppRuntime } from "../runtime";
export function getCloudflareEnv(runtime: AppRuntime): CloudflareEnv {
  return runtime.env;
}
