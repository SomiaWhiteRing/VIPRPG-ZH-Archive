import { requirePermission } from "@/app/.server/auth/authorize";
import {
  markImportJobCanceled,
  parseImportJobId,
  requiredOwnedImportJob,
} from "@/app/.server/db/import-jobs";
import type { AppRuntime } from "@/app/.server/runtime";
import { json, jsonError } from "@/lib/http";

type RouteContext = {
  params: {
    importJobId: string;
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
    "import_job.cancel_own",
  );

  if ("response" in auth) {
    return auth.response;
  }

  try {
    const { importJobId } = await context.params;
    const job = await requiredOwnedImportJob(
      runtime,
      parseImportJobId(importJobId),
      auth.user,
    );
    await markImportJobCanceled(runtime, job.id);

    return json({
      ok: true,
      importJobId: job.id,
      status: "canceled",
    });
  } catch (error) {
    return jsonError("Import cancellation failed", error);
  }
}
