import { json } from "@/lib/server/http/json";

export const dynamic = "force-dynamic";

export function GET() {
  return json({
    ok: true,
    service: "viprpg-zh-archive",
    runtime: "cloudflare-workers",
    timestamp: new Date().toISOString(),
  });
}
