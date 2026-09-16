import { requireBootstrapAdmin } from "@/app/.server/auth/authorize";
import { createRole, listRoles } from "@/app/.server/db/permissions";
import type { AppRuntime } from "@/app/.server/runtime";
import { ROLE_TEMPLATES } from "@/lib/authz/roles";
import { json, jsonError } from "@/lib/http";

export async function POST(runtime: AppRuntime, request: Request) {
  const auth = await requireBootstrapAdmin(runtime, request);
  if ("response" in auth) return auth.response;
  try {
    const body = (await request.json()) as {
      key?: string;
      name?: string;
      description?: string;
      priority?: number;
      template?: unknown;
    };
    if (body.template !== undefined) {
      if (body.template !== "wiki_editor")
        return json(
          { ok: false, error: "Unknown role template" },
          { status: 400 },
        );
      const preset = ROLE_TEMPLATES[body.template];
      const id = await createRole(runtime, {
        actor: auth.user,
        ...preset,
        template: body.template,
      });
      const role = (await listRoles(runtime)).find((item) => item.id === id);
      if (!role) throw new Error("创建的角色不可读取");
      return json({ ok: true, id, role }, { status: 201 });
    }
    const key = body.key
      ?.trim()
      .toLowerCase()
      .replace(/[^a-z0-9_]+/g, "_");
    const name = body.name?.trim();
    if (!key || !name || key.length > 64)
      return json({ ok: false, error: "Invalid role" }, { status: 400 });
    if (!Number.isInteger(body.priority))
      return json(
        { ok: false, error: "Invalid role priority" },
        { status: 400 },
      );
    const id = await createRole(runtime, {
      actor: auth.user,
      key,
      name,
      description: body.description,
      priority: body.priority!,
    });
    return json({ ok: true, id }, { status: 201 });
  } catch (error) {
    return jsonError("Failed to create role", error);
  }
}
