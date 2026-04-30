import { getArchiveBucket } from "@/lib/server/storage/archive-bucket";
import { json, jsonError } from "@/lib/server/http/json";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const probe = await getArchiveBucket().head("manifests/.healthcheck");

    return json({
      ok: true,
      binding: "ARCHIVE_BUCKET",
      probeObjectExists: probe !== null,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    return jsonError("R2 health check failed", error);
  }
}
