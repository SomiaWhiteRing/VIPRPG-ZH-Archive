import type { AppRuntime } from "@/app/.server/runtime";
import { HttpError } from "@/lib/http";
import type { ToolArtifact, ToolRelease } from "@/lib/resources";
import { assertArtifactObject, verifyArtifactObject } from "./objects";

export async function downloadArtifact(
  runtime: AppRuntime,
  request: Request,
  id: string,
) {
  const row = await runtime.db
    .prepare(
      `SELECT a.* FROM tool_artifacts a JOIN tool_releases r ON r.id=a.release_id JOIN resources p ON p.id=r.resource_id
    WHERE a.id=? AND a.storage_status='ready' AND r.status='published' AND p.visibility='published'`,
    )
    .bind(id)
    .first<ToolArtifact>();
  if (!row) throw new HttpError(404, "安装包不可用");
  const object = await verifyArtifactObject(runtime, row);
  const etag = `"sha256-${row.sha256}"`;
  const headers = new Headers({
    "Content-Type":
      row.format === "zip"
        ? "application/zip"
        : row.format === "apk"
          ? "application/vnd.android.package-archive"
          : "application/octet-stream",
    "Content-Disposition": `attachment; filename="download.${row.format}"; filename*=UTF-8''${encodeURIComponent(row.filename).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16)}`)}`,
    "Content-Length": String(row.size_bytes),
    "Accept-Ranges": "bytes",
    ETag: etag,
    "Cache-Control": "no-store, no-transform",
    "X-Content-Type-Options": "nosniff",
    "Last-Modified": object.uploaded.toUTCString(),
  });
  if (request.method === "HEAD") return new Response(null, { headers });
  let offset = 0,
    length = row.size_bytes,
    status = 200;
  const ifRange = request.headers.get("if-range");
  const range = request.headers.get("range");
  const dateMatches =
    ifRange !== null &&
    !ifRange.startsWith('"') &&
    !ifRange.startsWith("W/") &&
    Number.isFinite(Date.parse(ifRange)) &&
    Math.floor(object.uploaded.getTime() / 1000) <=
      Math.floor(Date.parse(ifRange) / 1000);
  if (range && (!ifRange || ifRange === etag || dateMatches)) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(range);
    const fail = () => {
      headers.set("Content-Range", `bytes */${row.size_bytes}`);
      headers.set("Content-Length", "0");
      return new Response(null, { status: 416, headers });
    };
    if (!match || (!match[1] && !match[2])) return fail();
    if (!match[1]) {
      const suffix = Number(match[2]);
      if (!Number.isSafeInteger(suffix) || suffix <= 0) return fail();
      length = Math.min(suffix, row.size_bytes);
      offset = row.size_bytes - length;
    } else {
      offset = Number(match[1]);
      const end = match[2] ? Number(match[2]) : row.size_bytes - 1;
      if (
        !Number.isSafeInteger(offset) ||
        !Number.isSafeInteger(end) ||
        offset >= row.size_bytes ||
        end < offset
      )
        return fail();
      length = Math.min(end, row.size_bytes - 1) - offset + 1;
    }
    status = 206;
    headers.set("Content-Length", String(length));
    headers.set(
      "Content-Range",
      `bytes ${offset}-${offset + length - 1}/${row.size_bytes}`,
    );
  }
  const body = await runtime.bucket.get(
    row.object_key,
    status === 206 ? { range: { offset, length } } : undefined,
  );
  assertArtifactObject(row, body);
  // R2 reports full object size/checksum even when body is a byte range.
  if (!body || !("body" in body))
    throw new HttpError(503, "安装包暂时不可读取");
  return new Response(body.body, { status, headers });
}
export async function updateManifest(
  runtime: AppRuntime,
  slug: string,
  channel: string,
  target: string,
  buildId: string | null,
) {
  if (buildId && buildId.length > 200) throw new HttpError(400, "构建标识过长");
  const selection = await runtime.db
    .prepare(
      `SELECT c.*,p.slug FROM tool_channels c JOIN resources p ON p.id=c.resource_id
    WHERE p.slug=? AND p.kind='tool' AND p.visibility='published' AND c.channel=? AND c.target=?`,
    )
    .bind(slug, channel, target)
    .first<{
      resource_id: string;
      artifact_id: string | null;
      revision: number;
    }>();
  if (!selection) throw new HttpError(404, "工具或平台尚未配置");
  const base = {
    schemaVersion: 1,
    tool: slug,
    channel,
    target,
    selectionRevision: selection.revision,
  };
  if (!selection.artifact_id) return { ...base, status: "paused" };
  const row = await runtime.db
    .prepare(
      `SELECT a.*,r.version_label,r.release_sequence,r.published_at,r.notes
    FROM tool_artifacts a JOIN tool_releases r ON r.id=a.release_id
    WHERE a.id=? AND a.target=? AND r.resource_id=? AND r.channel=? AND r.status='published' AND a.storage_status='ready'`,
    )
    .bind(selection.artifact_id, target, selection.resource_id, channel)
    .first<
      ToolArtifact &
        Pick<
          ToolRelease,
          "version_label" | "release_sequence" | "published_at" | "notes"
        >
    >();
  if (!row) throw new HttpError(503, "推荐版本记录不一致");
  await verifyArtifactObject(runtime, row);
  let installedRelease: null | {
    applicationBuildId: string;
    releaseId: string;
    releaseSequence: number | null;
    version: string;
  } = null;
  if (buildId) {
    const matches = (
      await runtime.db
        .prepare(
          `SELECT DISTINCT r.id,r.release_sequence,r.version_label FROM tool_artifacts a
      JOIN tool_releases r ON r.id=a.release_id WHERE r.resource_id=? AND r.channel=? AND a.target=? AND a.application_build_id=? AND r.published_at IS NOT NULL LIMIT 2`,
        )
        .bind(selection.resource_id, channel, target, buildId)
        .all<Pick<ToolRelease, "id" | "release_sequence" | "version_label">>()
    ).results;
    if (matches.length === 1)
      installedRelease = {
        applicationBuildId: buildId,
        releaseId: matches[0].id,
        releaseSequence: matches[0].release_sequence,
        version: matches[0].version_label,
      };
  }
  return {
    ...base,
    status: "available",
    releaseId: row.release_id,
    releaseSequence: row.release_sequence,
    version: row.version_label,
    publishedAt: row.published_at,
    notes: row.notes,
    notesUrl: new URL(
      `/resources#${slug}`,
      runtime.origin,
    ).href,
    artifact: {
      id: row.id,
      url: new URL(`/api/tool-artifacts/${row.id}/download`, runtime.origin)
        .href,
      filename: row.filename,
      sizeBytes: row.size_bytes,
      sha256: row.sha256,
      format: row.format,
    },
    installedRelease,
  };
}
