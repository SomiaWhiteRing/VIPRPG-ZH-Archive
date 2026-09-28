import { requirePermission } from "@/app/.server/auth/authorize";
import {
  getWorkForAdminEdit,
  parseWorkEditForm,
  updateWorkForAdmin,
} from "@/app/.server/db/game-library";
import { redirectResponse } from "@/app/.server/http/form";
import type { AppRuntime } from "@/app/.server/runtime";
import { readWorkImage, storeWorkImages, storeWorkPreviews } from "@/app/.server/storage/work-images";
import { hasPermission } from "@/lib/authz/permissions";
import { HttpError, json, jsonError } from "@/lib/http";

type RouteContext = {
  params: {
    workId: string;
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
    "work.metadata.update_any",
  );

  if ("response" in auth) {
    return auth.response;
  }

  try {
    const { workId: rawWorkId } = await context.params;
    const workId = parseWorkId(rawWorkId);
    const formData = await request.formData();
    const input = parseWorkEditForm(formData);

    if (input.workId !== workId) {
      throw new Error("Work id mismatch");
    }

    const current = await getWorkForAdminEdit(runtime, workId);
    if (!current) throw new HttpError(404, "作品不存在");
    if (!hasPermission(auth.user, "work.status.update_any") &&
      (current.status === "deleted" || (input.status && input.status !== current.status))) {
      throw new HttpError(403, "没有调整作品状态的权限");
    }
    const coverFile = formData.get("cover");
    if (coverFile instanceof File && coverFile.size > 0) {
      input.coverBlobSha256 = (await storeWorkImages(runtime, [readWorkImage(coverFile, "cover")]))[0];
    }
    if (formData.has("replace_previews")) {
      input.previewBlobSha256s = await storeWorkPreviews(runtime, formData, current.media.filter((media) => media.role === "preview").map((media) => media.blobSha256));
    }

    await updateWorkForAdmin(runtime, input, auth.user);

    if (request.headers.get("accept")?.includes("application/json")) {
      const work = await getWorkForAdminEdit(runtime, workId);
      if (!work) throw new Error("游戏更新后不可读取");
      return json({
        ok: true,
        work,
      });
    }

    return redirectResponse(new URL(`/admin/works/${workId}`, request.url));
  } catch (error) {
    return jsonError("Work update failed", error);
  }
}

function parseWorkId(value: string): number {
  const workId = Number.parseInt(value, 10);

  if (!Number.isSafeInteger(workId) || workId <= 0) {
    throw new Error("Invalid work id");
  }

  return workId;
}
