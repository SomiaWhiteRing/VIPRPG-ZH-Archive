import { requireBootstrapAdmin } from "@/lib/server/auth/authorize";
import { json, jsonError } from "@/lib/server/http/json";
import { createRole } from "@/lib/server/db/permissions";

export async function POST(request: Request) {
  const auth = await requireBootstrapAdmin(request);
  if ("response" in auth) return auth.response;
  try {
    const body = await request.json() as { key?: string; name?: string; description?: string; priority?: number };
    const key = body.key?.trim().toLowerCase().replace(/[^a-z0-9_]+/g, "_");
    const name = body.name?.trim();
    if (!key || !name || key.length > 64) return json({ ok: false, error: "Invalid role" }, { status: 400 });
    if (!Number.isInteger(body.priority)) return json({ ok: false, error: "Invalid role priority" }, { status: 400 });
    const id = await createRole({ actor: auth.user, key, name, description: body.description, priority: body.priority! });
    return json({ ok: true, id }, { status: 201 });
  } catch (error) {
    return jsonError("Failed to create role", error);
  }
}
