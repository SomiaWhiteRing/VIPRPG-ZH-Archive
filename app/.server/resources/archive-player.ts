import { Crc32 } from "../../../lib/archive/crc32";
import { HttpError } from "../../../lib/http";
import type { ToolArtifact } from "../../../lib/resources";

export async function getSharedArchivePlayer(db: D1Database, artifactId: string | null = null): Promise<ToolArtifact> {
  const row = await db.prepare(`SELECT a.* FROM resources p
    JOIN tool_releases r ON r.resource_id=p.id
    JOIN tool_artifacts a ON a.release_id=r.id
    WHERE p.slug='easyrpg-kai' AND p.kind='tool' AND p.visibility='published'
      AND r.status='published' AND r.channel='stable'
      AND a.target='windows-x64' AND a.id=${artifactId ? "?" : "(SELECT c.artifact_id FROM tool_channels c WHERE c.resource_id=p.id AND c.channel='stable' AND c.target='windows-x64')"}`)
    .bind(...(artifactId ? [artifactId] : [])).first<ToolArtifact>();
  if (row && ["cleanup", "cleaned"].includes(row.storage_status))
    throw new HttpError(410, "此下载使用的旧播放器已回收，请从游戏页面重新下载。");
  if (!row || row.format !== "exe" || row.storage_status !== "ready") throw new HttpError(503, "共享 Kai 播放器不可用，请在“链接”中发布并推荐 Windows EXE 安装包。");
  return row;
}

export function assertSharedPlayerObject(row: ToolArtifact, object: R2Object | null): asserts object is R2Object {
  const checksum = object?.checksums.sha256;
  const sha256 = checksum ? Array.from(new Uint8Array(checksum), (byte) => byte.toString(16).padStart(2, "0")).join("") : null;
  if (!object || object.key !== row.object_key || object.size !== row.size_bytes || sha256 !== row.sha256)
    throw new HttpError(503, "共享 Kai 播放器文件缺失或校验失败，请联系管理员。");
}

/** Used on administrative uploads. Legacy artifacts can compute this read-only on download. */
export async function artifactCrc32(bucket: R2Bucket, row: ToolArtifact): Promise<number> {
  const object = await bucket.get(row.object_key);
  assertSharedPlayerObject(row, object);
  if (!object) throw new HttpError(503, "播放器文件缺失");
  const checksum = new Crc32();
  const reader = object.body.getReader();
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > row.size_bytes) throw new HttpError(503, "播放器文件长度不一致");
      checksum.update(value);
    }
  } catch (error) {
    await reader.cancel(error).catch(() => undefined);
    throw error;
  } finally {
    reader.releaseLock();
  }
  if (size !== row.size_bytes) throw new HttpError(503, "播放器文件长度不一致");
  return checksum.digest();
}
