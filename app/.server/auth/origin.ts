import type { AppRuntime } from "@/app/.server/runtime";
import { getAppOrigin } from "./config";
import { assertRequestOrigin } from "./request-origin";
export { SameOriginError } from "./request-origin";

export function assertSameOrigin(runtime: AppRuntime, request: Request): void {
  assertRequestOrigin(request, getAppOrigin(runtime));
}
