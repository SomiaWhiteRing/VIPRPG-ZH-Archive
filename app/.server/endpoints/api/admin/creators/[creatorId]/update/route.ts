import { requirePermission } from "@/app/.server/auth/authorize";
import { writeAuthAuditLog } from "@/app/.server/db/auth-audit";
import {
  parseCreatorEditForm,
  updateCreatorForAdmin,
} from "@/app/.server/db/creator-library";
import { redirectResponse } from "@/app/.server/http/form";
import type { AppRuntime } from "@/app/.server/runtime";
import { json, jsonError } from "@/lib/http";

type RouteContext = {
  params: {
    creatorId: string;
  };
};

export async function POST(
  runtime: AppRuntime,
  request: Request,
  context: RouteContext,
) {
  const auth = await requirePermission(
    runtime,
    request,
    "creator.metadata.update_any",
  );

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

    const creator = await updateCreatorForAdmin(runtime, input);

    await writeAuthAuditLog(runtime, {
      userId: auth.user.id,
      email: auth.user.email,
      eventType: "admin_creator_update",
      detail: {
        creatorId: creator.id,
        name: creator.name,
      },
    });

    if (request.headers.get("accept")?.includes("application/json")) {
      return json({
        ok: true,
        creator: {
          id: creator.id,
          name: creator.name,
          avatarBlobSha256: creator.avatarBlobSha256,
          links: creator.links,
          bio: creator.bio,
        },
      });
    }

    return redirectResponse(
      new URL(`/admin/creators/${creator.id}`, request.url),
    );
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
