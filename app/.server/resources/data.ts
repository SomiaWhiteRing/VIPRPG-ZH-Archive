import type { AppRuntime } from "@/app/.server/runtime";
import type {
  PublicResource,
  ResourceRecord,
  ResourceDownload,
  ResourceEditorData,
  ToolArtifact,
  ToolChannel,
  ToolRelease,
} from "@/lib/resources";
import { HttpError } from "@/lib/http";

export async function getResource(runtime: AppRuntime, id: string) {
  const row = await runtime.db
    .prepare("SELECT * FROM resources WHERE id=?")
    .bind(id)
    .first<ResourceRecord>();
  if (!row) throw new HttpError(404, "链接不存在");
  return row;
}
export async function getEditor(
  runtime: AppRuntime,
  id: string,
): Promise<ResourceEditorData> {
  const resource = await getResource(runtime, id);
  const releases = await runtime.db
    .prepare(
      "SELECT * FROM tool_releases WHERE resource_id=? ORDER BY created_at DESC,id DESC",
    )
    .bind(id)
    .all<ToolRelease>();
  const artifacts = await runtime.db
    .prepare(
      "SELECT a.* FROM tool_artifacts a JOIN tool_releases r ON r.id=a.release_id WHERE r.resource_id=? ORDER BY a.target,a.id",
    )
    .bind(id)
    .all<ToolArtifact>();
  const channels = await runtime.db
    .prepare("SELECT * FROM tool_channels WHERE resource_id=? ORDER BY target")
    .bind(id)
    .all<ToolChannel>();
  return {
    resource,
    releases: releases.results,
    artifacts: artifacts.results,
    channels: channels.results,
  };
}
export async function listResources(runtime: AppRuntime, admin = false) {
  return (
    await runtime.db
      .prepare(
        `SELECT * FROM resources ${admin ? "" : "WHERE visibility='published'"} ORDER BY sort_order,id`,
      )
      .all<ResourceRecord>()
  ).results;
}
export async function listPublicResources(
  runtime: AppRuntime,
): Promise<PublicResource[]> {
  const resources = await listResources(runtime);
  const downloads = (
    await runtime.db
      .prepare(
        `SELECT c.resource_id,a.id,a.target,a.format,a.filename,a.size_bytes,a.sha256,a.release_id,r.version_label
    FROM tool_channels c JOIN resources p ON p.id=c.resource_id
    JOIN tool_artifacts a ON a.id=c.artifact_id JOIN tool_releases r ON r.id=a.release_id
    WHERE p.visibility='published' AND r.status='published' AND a.storage_status='ready'
    ORDER BY CASE a.target WHEN 'windows-x64' THEN 0 ELSE 1 END`,
      )
      .all<ResourceDownload & { resource_id: string }>()
  ).results;
  return resources.map((resource) => ({
    ...resource,
    downloads: downloads.filter((d) => d.resource_id === resource.id),
  }));
}
export async function getArtifact(runtime: AppRuntime, id: string) {
  const row = await runtime.db
    .prepare(
      `SELECT a.*,r.resource_id,r.status AS release_status,r.published_at
    FROM tool_artifacts a JOIN tool_releases r ON r.id=a.release_id WHERE a.id=?`,
    )
    .bind(id)
    .first<
      ToolArtifact & {
        resource_id: string;
        release_status: ToolRelease["status"];
        published_at: string | null;
      }
    >();
  if (!row) throw new HttpError(404, "安装包不存在");
  return row;
}
