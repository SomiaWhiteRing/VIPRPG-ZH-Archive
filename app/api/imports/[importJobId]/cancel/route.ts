import { requireUploader } from "@/lib/server/auth/guards";
import {
  assertImportJobAccess,
  markImportJobCanceled,
  parseImportJobId,
  requiredImportJob,
} from "@/lib/server/db/import-jobs";
import { json, jsonError } from "@/lib/server/http/json";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{
    importJobId: string;
  }>;
};

export async function POST(request: Request, context: RouteContext) {
  const auth = await requireUploader(request);

  if ("response" in auth) {
    return auth.response;
  }

  try {
    const { importJobId } = await context.params;
    const job = await requiredImportJob(parseImportJobId(importJobId));
    assertImportJobAccess(job, auth.user);
    await markImportJobCanceled(job.id);

    return json({
      ok: true,
      importJobId: job.id,
      status: "canceled",
    });
  } catch (error) {
    return jsonError("Import cancellation failed", error);
  }
}
