import { inspectWorkImage } from "@/app/.server/storage/work-images";
import type { AppRuntime } from "@/app/.server/runtime";
import {
  assertObjectUploadAllowed,
  insertBlobRecord,
} from "@/app/.server/db/archive-objects";
import { blobKey } from "@/app/.server/storage/archive-keys";
import { sha256Hex } from "@/app/.server/crypto/sha256";
import { HttpError } from "@/lib/http";
import { MAX_RESOURCE_ICON_BYTES, type ToolArtifact } from "@/lib/resources";
import { getArtifact, getResource } from "./data";
import { batchMutation, type Actor } from "./mutations";
import { verifyWindyArtifact } from "./windy";

function checksumHex(value: ArrayBuffer | undefined) {
  return value
    ? Array.from(new Uint8Array(value), (b) =>
        b.toString(16).padStart(2, "0"),
      ).join("")
    : null;
}
export function assertArtifactObject(
  row: ToolArtifact,
  object: R2Object | null,
): asserts object is R2Object {
  if (!object) throw new HttpError(503, "安装包存储对象缺失，请联系管理员");
  if (
    object.key !== row.object_key ||
    object.size !== row.size_bytes ||
    checksumHex(object.checksums.sha256) !== row.sha256
  )
    throw new HttpError(503, "安装包存储校验信息不一致，已停止下载和发布");
}
export async function verifyArtifactObject(
  runtime: AppRuntime,
  row: ToolArtifact,
) {
  const object = await runtime.bucket.head(row.object_key);
  assertArtifactObject(row, object);
  return object;
}
export async function readLimited(
  request: Request,
  limit: number,
): Promise<ArrayBuffer> {
  if (!request.body) throw new HttpError(400, "请求内容为空");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) {
        await reader.cancel();
        throw new HttpError(413, "请求内容超过大小限制");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes.buffer;
}
export async function uploadIcon(
  runtime: AppRuntime,
  actor: Actor,
  id: string,
  revision: number,
  request: Request,
) {
  await getResource(runtime, id);
  const bytes = await readLimited(request, MAX_RESOURCE_ICON_BYTES);
  const info = inspectWorkImage(bytes);
  if (!["png", "gif", "jpeg"].includes(info.format) || info.width > 512 || info.height > 512)
    throw new HttpError(400, "图标须为边长不超过 512px 的 PNG、GIF 或 JPG／JPEG");
  const sha = await sha256Hex(bytes);
  await assertObjectUploadAllowed(runtime, { kind: "blob", sha256: sha });
  await runtime.bucket.put(blobKey(sha), bytes, {
    sha256: sha,
    httpMetadata: { contentType: info.contentType },
  });
  await insertBlobRecord(runtime, {
    sha256: sha,
    sizeBytes: bytes.byteLength,
    contentTypeHint: info.contentType,
    observedExt: info.format,
  });
  await batchMutation(
    runtime,
    actor,
    id,
    revision,
    "icon",
    [
      runtime.db
        .prepare("UPDATE resources SET icon_blob_sha256=? WHERE id=?")
        .bind(sha, id),
    ],
    { sha256: sha },
  );
}
function uploadRecent(row: ToolArtifact) {
  return (
    row.storage_status === "uploading" &&
    Date.now() - Date.parse(row.updated_at.replace(" ", "T") + "Z") <
      15 * 60 * 1000
  );
}
async function finishUpload(
  runtime: AppRuntime,
  actor: Actor,
  id: string,
  token: string,
) {
  const row = await getArtifact(runtime, id);
  if (row.storage_status === "cleanup" || row.storage_status === "cleaned") {
    await runtime.bucket.delete(row.object_key);
    throw new HttpError(409, "该上传已被清理");
  }
  if (row.storage_status === "ready") return;
  if (row.upload_token !== token)
    throw new HttpError(409, "上传结果请重新确认");
  await verifyArtifactObject(runtime, row);
  await verifyWindyArtifact(runtime, row);
  await batchMutation(
    runtime,
    actor,
    row.resource_id,
    null,
    "artifact_ready",
    [
      runtime.db
        .prepare(
          `UPDATE tool_artifacts SET storage_status=CASE WHEN upload_token=? AND storage_status IN ('uploading','uncertain','pending') THEN 'ready' ELSE NULL END,
      updated_at=CURRENT_TIMESTAMP WHERE id=?`,
        )
        .bind(token, id),
    ],
    { artifactId: id, sha256: row.sha256 },
  );
}
export async function uploadArtifact(
  runtime: AppRuntime,
  actor: Actor,
  id: string,
  revision: number,
  request: Request,
) {
  const row = await getArtifact(runtime, id);
  if (
    row.release_status !== "draft" ||
    ["cleanup", "cleaned"].includes(row.storage_status)
  )
    throw new HttpError(409, "该版本不接受上传");
  if (row.storage_status === "ready") {
    await verifyArtifactObject(runtime, row);
    return;
  }
  if (uploadRecent(row))
    throw new HttpError(409, "该文件正在上传；中断后请确认上传结果");
  const length = request.headers.get("content-length");
  if (length !== null && Number(length) !== row.size_bytes)
    throw new HttpError(400, "文件长度与登记内容不一致");
  if (!request.body) throw new HttpError(400, "安装包内容为空");
  const token = crypto.randomUUID();
  await batchMutation(
    runtime,
    actor,
    row.resource_id,
    revision,
    "artifact_upload",
    [
      runtime.db
        .prepare(
          "UPDATE tool_artifacts SET storage_status='uploading',upload_token=?,upload_actor_id=?,updated_at=CURRENT_TIMESTAMP WHERE id=?",
        )
        .bind(token, actor.id, id),
    ],
    { artifactId: id },
  );
  try {
    let object = await runtime.bucket.head(row.object_key);
    if (!object) {
      const stream = new FixedLengthStream(row.size_bytes),
        abort = new AbortController();
      const pumping = request.body.pipeTo(stream.writable, {
        signal: abort.signal,
      });
      const writing = runtime.bucket
        .put(row.object_key, stream.readable, {
          sha256: row.sha256,
          onlyIf: { etagDoesNotMatch: "*" },
          httpMetadata: {
            contentType: "application/octet-stream",
            cacheControl: "no-store",
          },
        })
        .then(
          (result) => {
            if (!result) abort.abort();
            return result;
          },
          (error) => {
            abort.abort();
            throw error;
          },
        );
      const [pump, write] = await Promise.allSettled([pumping, writing]);
      if (write.status === "rejected") throw write.reason;
      if (write.value && pump.status === "rejected") throw pump.reason;
      object = write.value ?? (await runtime.bucket.head(row.object_key));
    } else await request.body.cancel();
    assertArtifactObject(row, object);
    await finishUpload(runtime, actor, id, token);
  } catch (error) {
    await runtime.db
      .prepare(
        `UPDATE tool_artifacts SET storage_status='uncertain',updated_at=CURRENT_TIMESTAMP
      WHERE id=? AND upload_token=? AND storage_status='uploading'`,
      )
      .bind(id, token)
      .run();
    const current = await getArtifact(runtime, id);
    if (["cleanup", "cleaned"].includes(current.storage_status))
      await runtime.bucket.delete(row.object_key);
    if (error instanceof HttpError) throw error;
    throw new HttpError(
      409,
      "上传结果待确认，请先点击确认；文件完整时无需重新上传",
    );
  }
}
export async function confirmArtifact(
  runtime: AppRuntime,
  actor: Actor,
  id: string,
  revision: number,
) {
  const row = await getArtifact(runtime, id);
  if (
    row.release_status !== "draft" ||
    ["cleanup", "cleaned"].includes(row.storage_status)
  )
    throw new HttpError(409, "该上传不可确认");
  const object = await runtime.bucket.head(row.object_key);
  if (!object) {
    if (uploadRecent(row)) throw new HttpError(409, "上传尚未结束，请稍后确认");
    await batchMutation(
      runtime,
      actor,
      row.resource_id,
      revision,
      "artifact_retry",
      [
        runtime.db
          .prepare(
            "UPDATE tool_artifacts SET storage_status='pending',upload_token=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=?",
          )
          .bind(id),
      ],
      { artifactId: id },
    );
    return;
  }
  assertArtifactObject(row, object);
  await verifyWindyArtifact(runtime, row);
  await batchMutation(
    runtime,
    actor,
    row.resource_id,
    revision,
    "artifact_confirm",
    [
      runtime.db
        .prepare(
          "UPDATE tool_artifacts SET storage_status='ready',updated_at=CURRENT_TIMESTAMP WHERE id=?",
        )
        .bind(id),
    ],
    { artifactId: id, sha256: row.sha256 },
  );
}
export async function cleanupArtifact(
  runtime: AppRuntime,
  actor: Actor,
  id: string,
  revision: number,
) {
  const row = await getArtifact(runtime, id);
  if (row.published_at !== null)
    throw new HttpError(409, "已发布历史文件不允许物理删除");
  if (uploadRecent(row))
    throw new HttpError(409, "上传仍在进行，十五分钟后再清理中断的请求");
  await batchMutation(
    runtime,
    actor,
    row.resource_id,
    revision,
    "artifact_cleanup",
    [
      runtime.db
        .prepare(
          "UPDATE tool_artifacts SET storage_status='cleanup',updated_at=CURRENT_TIMESTAMP WHERE id=?",
        )
        .bind(id),
    ],
    { artifactId: id, sha256: row.sha256 },
  );
  await runtime.bucket.delete(row.object_key);
  await batchMutation(
    runtime,
    actor,
    row.resource_id,
    null,
    "artifact_cleaned",
    [
      runtime.db
        .prepare(
          "UPDATE tool_artifacts SET storage_status='cleaned',updated_at=CURRENT_TIMESTAMP WHERE id=? AND storage_status='cleanup'",
        )
        .bind(id),
    ],
    { artifactId: id },
  );
}
export async function inspectStorage(runtime: AppRuntime, cursor?: string) {
  if (cursor?.startsWith("records:")) {
    const after = cursor.slice("records:".length);
    if (after.length > 80) throw new HttpError(400, "检查游标不正确");
    const rows = (
      await runtime.db
        .prepare(
          "SELECT * FROM tool_artifacts WHERE storage_status='ready' AND id>? ORDER BY id LIMIT 101",
        )
        .bind(after)
        .all<ToolArtifact>()
    ).results;
    const issues: { key: string; issue: string }[] = [];
    for (const row of rows.slice(0, 100)) {
      try {
        await verifyArtifactObject(runtime, row);
      } catch (error) {
        issues.push({
          key: row.object_key,
          issue:
            error instanceof HttpError ? error.message : "存储服务暂时不可用",
        });
      }
    }
    return {
      issues,
      scanned: Math.min(rows.length, 100),
      nextCursor: rows.length > 100 ? `records:${rows[99].id}` : null,
      phase: "数据库引用",
    };
  }
  if (cursor && !cursor.startsWith("objects:"))
    throw new HttpError(400, "检查游标不正确");
  const listed = await runtime.bucket.list({
    prefix: "tools/artifacts/",
    limit: 100,
    cursor: cursor?.slice("objects:".length),
  });
  const issues: { key: string; issue: string }[] = [];
  for (const object of listed.objects) {
    const row = await runtime.db
      .prepare("SELECT * FROM tool_artifacts WHERE object_key=?")
      .bind(object.key)
      .first<ToolArtifact>();
    if (!row)
      issues.push({
        key: object.key,
        issue: "没有对应的安装包记录；不会自动删除",
      });
    else if (row.storage_status !== "ready")
      issues.push({
        key: object.key,
        issue: `状态为 ${row.storage_status}，请在所属链接中确认或清理`,
      });
    else {
      try {
        await verifyArtifactObject(runtime, row);
      } catch {
        issues.push({ key: object.key, issue: "文件校验不一致" });
      }
    }
  }
  return {
    issues,
    nextCursor: listed.truncated ? `objects:${listed.cursor}` : "records:",
    scanned: listed.objects.length,
    phase: "存储对象",
  };
}
