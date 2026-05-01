import type { ArchiveCommitMetadata, ExcludedFileTypeSummary } from "@/lib/archive/manifest";
import { requireUploader } from "@/lib/server/auth/guards";
import { commitArchiveImport } from "@/lib/server/db/archive-commit";
import { markImportJobFailed, parseImportJobId } from "@/lib/server/db/import-jobs";
import { json, jsonError } from "@/lib/server/http/json";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{
    importJobId: string;
  }>;
};

type CommitRequest = {
  localTaskId?: string;
  manifestSha256?: string;
  manifestJson?: string;
  metadata?: ArchiveCommitMetadata;
  excludedFileTypes?: ExcludedFileTypeSummary[];
};

export async function POST(request: Request, context: RouteContext) {
  const auth = await requireUploader(request);

  if ("response" in auth) {
    return auth.response;
  }

  const { importJobId } = await context.params;
  const id = parseImportJobId(importJobId);

  try {
    const payload = (await request.json()) as CommitRequest;

    if (
      typeof payload.localTaskId !== "string" ||
      typeof payload.manifestSha256 !== "string" ||
      typeof payload.manifestJson !== "string" ||
      !payload.metadata
    ) {
      return json(
        {
          ok: false,
          error: "Invalid commit payload",
        },
        { status: 400 },
      );
    }

    const result = await commitArchiveImport({
      importJobId: id,
      user: auth.user,
      localTaskId: payload.localTaskId,
      manifestSha256: payload.manifestSha256,
      manifestJson: payload.manifestJson,
      metadata: payload.metadata,
      excludedFileTypes: payload.excludedFileTypes ?? [],
    });

    return json({
      ok: true,
      result,
    });
  } catch (error) {
    await markImportJobFailed(id, error instanceof Error ? error.message : "Unknown error");
    return jsonError("Import commit failed", error);
  }
}
