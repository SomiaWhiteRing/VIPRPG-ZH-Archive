import { getD1 } from "@/app/.server/db/d1";
import type { AppRuntime } from "@/app/.server/runtime";
import { json } from "@/lib/http";

export async function GET(runtime: AppRuntime) {
  try {
    const result = await getD1(runtime)
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
