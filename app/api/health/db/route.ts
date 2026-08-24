import { getD1 } from "@/lib/server/db/d1";
import { json } from "@/lib/server/http/json";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const result = await getD1()
      .prepare("SELECT 1 AS ok")
      .first<{ ok: number }>();

    return json({
      ok: result?.ok === 1,
      dependency: "database",
      timestamp: new Date().toISOString(),
    });
  } catch {
    return json({ ok: false, error: "Database unavailable" }, { status: 503 });
  }
}
