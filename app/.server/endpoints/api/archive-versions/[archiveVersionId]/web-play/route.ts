import {
  getArchiveNetplayEndpoint,
  getPublishedArchiveDownloadRecord,
  parseArchiveVersionId,
} from "@/app/.server/db/archive-downloads";
import type { AppRuntime } from "@/app/.server/runtime";
import { readWebPlayMetadata } from "@/app/.server/resources/web-play";
import { json, jsonError } from "@/lib/http";

type RouteContext = {
  params: {
    archiveVersionId: string;
  };
};

export async function GET(
  runtime: AppRuntime,
  request: Request,
  context: RouteContext,
) {
  try {
    const { archiveVersionId: rawArchiveVersionId } = await context.params;
    const archiveVersionId = parseArchiveVersionId(rawArchiveVersionId);
    const options = new URL(request.url).searchParams;
    const endpointOnly = options.get("fields") === "netplayEndpoint";
    const record = await getPublishedArchiveDownloadRecord(
      runtime,
      archiveVersionId,
      endpointOnly,
    );

    if (!record) {
      return json(
        {
          ok: false,
          error: "Archive version not found",
        },
        { status: 404 },
      );
    }

    if (endpointOnly) {
      return json({ ok: true, netplayEndpoint: await getArchiveNetplayEndpoint(runtime, record, options.get("netplayExternal") === "1") });
    }

    return json(await readWebPlayMetadata(runtime, record));
  } catch (error) {
    return jsonError("Web Play metadata failed", error);
  }
}
