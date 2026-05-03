import { requireAdmin } from "@/lib/server/auth/guards";
import { writeAuthAuditLog } from "@/lib/server/db/auth-audit";
import { parseTagEditForm, updateTagForAdmin } from "@/lib/server/db/taxonomy-library";
import { redirectResponse } from "@/lib/server/http/form";
import { json, jsonError } from "@/lib/server/http/json";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{
    tagId: string;
  }>;
};

export async function POST(request: Request, context: RouteContext) {
  const auth = await requireAdmin(request);

  if ("response" in auth) {
    return auth.response;
  }

  try {
    const { tagId: rawTagId } = await context.params;
    const tagId = parseId(rawTagId);
    const formData = await request.formData();
    const input = parseTagEditForm(formData);

    if (input.tagId !== tagId) {
      throw new Error("Tag id mismatch");
    }

    const tag = await updateTagForAdmin(input);

    await writeAuthAuditLog({
      userId: auth.user.id,
      email: auth.user.email,
      eventType: "admin_tag_update",
      detail: {
        tagId,
        resultingTagId: tag.id,
        slug: tag.slug,
        merged: Boolean(input.mergeTargetSlug),
      },
    });

    if (request.headers.get("accept")?.includes("application/json")) {
      return json({ ok: true, tag });
    }

    return redirectResponse(new URL(`/admin/tags/${tag.id}`, request.url));
  } catch (error) {
    return jsonError("Tag update failed", error);
  }
}

function parseId(value: string): number {
  const id = Number.parseInt(value, 10);

  if (!Number.isSafeInteger(id) || id <= 0) {
    throw new Error("Invalid tag id");
  }

  return id;
}
