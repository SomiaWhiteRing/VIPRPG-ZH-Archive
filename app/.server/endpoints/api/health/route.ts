import type { AppRuntime } from "@/app/.server/runtime";
import { json } from "@/lib/http";

export function GET(_runtime: AppRuntime) {
  return json({
    ok: true,
    service: "viprpg-zh-archive",
    runtime: "cloudflare-workers",
    timestamp: new Date().toISOString(),
  });
}
