import type { AppRuntime } from "@/app/.server/runtime";
import { parsePositiveId } from "@/app/.server/http/request";
import { getPublishedArchiveDownloadRecord } from "@/app/.server/db/archive-downloads";
import { readWebPlayMetadata } from "@/app/.server/resources/web-play";
import { HttpError, json } from "@/lib/http";

export async function GET(runtime: AppRuntime, _request: Request, context: { params: { workId: string } }) {
  const workId = parsePositiveId(context.params.workId);
  const current = await runtime.db.prepare(
    "SELECT id FROM archive_versions WHERE work_id = ? AND is_current = 1 AND status = 'published' AND purged_at IS NULL",
  ).bind(workId).first<{ id: number }>();
  const record = current ? await getPublishedArchiveDownloadRecord(runtime, current.id) : null;
  if (!record) throw new HttpError(404, "Archive version not found");
  return json(await readWebPlayMetadata(runtime, record));
}
