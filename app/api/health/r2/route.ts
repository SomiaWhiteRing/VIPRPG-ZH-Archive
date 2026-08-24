import { getArchiveBucket } from "@/lib/server/storage/archive-bucket";
import { json } from "@/lib/server/http/json";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await getArchiveBucket().head("manifests/.healthcheck");

    return json({
      ok: true,
      dependency: "object-storage",
      timestamp: new Date().toISOString(),
    });
  } catch {
    return json({ ok: false, error: "Object storage unavailable" }, { status: 503 });
  }
}
