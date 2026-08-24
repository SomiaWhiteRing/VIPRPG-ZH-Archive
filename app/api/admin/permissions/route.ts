import { requireBootstrapAdmin } from "@/lib/server/auth/authorize";
import { json, jsonError } from "@/lib/server/http/json";
import { listPermissions, listRoles } from "@/lib/server/db/permissions";

export async function GET(request: Request) {
  const auth = await requireBootstrapAdmin(request);
  if ("response" in auth) return auth.response;
  try {
    return json({ ok: true, permissions: [...listPermissions()], roles: await listRoles() });
  } catch (error) {
    return jsonError("Failed to load permission model", error);
  }
}
