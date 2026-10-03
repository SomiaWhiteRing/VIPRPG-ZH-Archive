import { parsePositiveId } from "@/app/.server/http/request";
import { requireUser } from "@/app/.server/auth/guards";
import { resolveRoleRequest } from "@/app/.server/db/permissions";
import { getInboxItemForUser } from "@/app/.server/db/inbox";
import { resolveWorkMaintainerRequest } from "@/app/.server/db/work-maintainers";
import { HttpError, json, jsonError } from "@/lib/http";
import {
  readRequiredFormString,
  redirectResponse,
} from "@/app/.server/http/form";
import type { AppRuntime } from "@/app/.server/runtime";


type RouteContext = {
  params: {
    itemId: string;
  };
};

export async function POST(
  runtime: AppRuntime,
  request: Request,
  context: RouteContext,
) {
  const auth = await requireUser(runtime, request);

  if ("response" in auth) {
    return auth.response;
  }

  try {
    const { itemId: rawItemId } = await context.params;
    const form = await request.formData();
    const decision = readRequiredFormString(form, "decision");

    if (decision !== "approve" && decision !== "reject" && decision !== "withdraw") {
      throw new HttpError(400, "无效的处理操作。");
    }
    const itemId = parsePositiveId(rawItemId, "id", "Invalid inbox item id");
    const item = await getInboxItemForUser(runtime, itemId, auth.user);
    if (item.maintainerRequest) {
      if (form.get('confirm') !== '1') throw new HttpError(400, '请确认处理申请的后果。');
      await resolveWorkMaintainerRequest(runtime, auth.user, itemId, decision, form.get('rejection_reason'));
    } else {
      if (decision === 'withdraw') throw new HttpError(400, '此申请不支持撤回。');
      await resolveRoleRequest(runtime, { actor: auth.user, itemId, decision, rejectionReason: form.get('rejection_reason') });
    }

    if (request.headers.get("accept")?.includes("application/json")) {
      return json({ ok: true });
    }

    return redirectResponse(new URL("/inbox", request.url));
  } catch (error) {
    return jsonError("Inbox request resolution failed", error);
  }
}
