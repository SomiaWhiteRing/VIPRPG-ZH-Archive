import type { AppRuntime } from "@/app/.server/runtime";
import { getArchiveBucket } from "@/app/.server/storage/archive-bucket";
import { json } from "@/lib/http";

export async function GET(runtime: AppRuntime) {
  try {
    await getArchiveBucket(runtime).head("manifests/.healthcheck");

    return json({
      ok: true,
      dependency: "object-storage",
      timestamp: new Date().toISOString(),
    });
  } catch {
    return json(
      { ok: false, error: "Object storage unavailable" },
      { status: 503 },
    );
  }
}
