import type { AppRuntime } from "../runtime";
import type { ForumRequestRuntime } from "./request";
import type { ForumRuntime } from "./runtime";
export function getForumRuntime(runtime: AppRuntime): ForumRuntime {
  return runtime;
}
export function getForumRequestRuntime(
  runtime: AppRuntime,
): ForumRequestRuntime {
  return runtime;
}
