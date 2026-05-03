import { requireAdmin } from "@/lib/server/auth/guards";
import { writeAuthAuditLog } from "@/lib/server/db/auth-audit";
import {
  parseCreatorEditForm,
  updateCreatorForAdmin,
} from "@/lib/server/db/creator-library";
import { redirectResponse } from "@/lib/server/http/form";
import { json, jsonError } from "@/lib/server/http/json";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{
    creatorId: string;
  }>;
};

export async function POST(request: Request, context: RouteContext) {
  const auth = await requireAdmin(request);

  if ("response" in auth) {
    return auth.response;
  }

  try {
    const { creatorId: rawCreatorId } = await context.params;
    const creatorId = parseCreatorId(rawCreatorId);
    const formData = await request.formData();
    const input = parseCreatorEditForm(formData);

    if (input.creatorId !== creatorId) {
      throw new Error("Creator id mismatch");
    }

    const creator = await updateCreatorForAdmin(input);

    await writeAuthAuditLog({
      userId: auth.user.id,
      email: auth.user.email,
      eventType: "admin_creator_update",
      detail: {
        creatorId: creator.id,
        slug: creator.slug,
        name: creator.name,
      },
    });

    if (request.headers.get("accept")?.includes("application/json")) {
      return json({
        ok: true,
        creator: {
          id: creator.id,
          slug: creator.slug,
          name: creator.name,
          originalName: creator.originalName,
          websiteUrl: creator.websiteUrl,
          bio: creator.bio,
        },
      });
    }

    return redirectResponse(new URL(`/admin/creators/${creator.id}`, request.url));
  } catch (error) {
    return jsonError("Creator update failed", error);
  }
}

function parseCreatorId(value: string): number {
  const id = Number.parseInt(value, 10);

  if (!Number.isSafeInteger(id) || id <= 0) {
    throw new Error("Invalid creator id");
  }

  return id;
}
