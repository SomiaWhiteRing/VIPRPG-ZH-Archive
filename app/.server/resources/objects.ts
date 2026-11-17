import { translate } from "@/lib/i18n/core";
import { DEFAULT_UI_LOCALE, type UiLocale } from "@/lib/i18n/locale";
import { inspectWorkImage } from "@/app/.server/storage/work-images";
import type { AppRuntime } from "@/app/.server/runtime";
import {
  assertObjectUploadAllowed,
  insertBlobRecord,
} from "@/app/.server/db/archive-objects";
import { blobKey } from "@/lib/archive/object-keys";
import { sha256Hex } from "@/lib/sha256";
import { HttpError } from "@/lib/http";
import { MAX_RESOURCE_ICON_BYTES, type ToolArtifact } from "@/lib/resources";
import { getArtifact, getResource } from "./data";
import { batchMutation, type Actor } from "./mutations";
import { verifyPackageArtifact } from "./packages";
import { artifactCrc32 } from "./archive-player";

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
  locale: UiLocale = DEFAULT_UI_LOCALE,
): asserts object is R2Object {
  if (!object) throw new HttpError(503, translate(locale, "admin.resources.missingObject"), undefined, "admin.resources.missingObject");
  if (
    object.key !== row.object_key ||
    object.size !== row.size_bytes ||
    checksumHex(object.checksums.sha256) !== row.sha256
  )
    throw new HttpError(503, translate(locale, "admin.resources.mismatch"), undefined, "admin.resources.mismatch");
}
export async function verifyArtifactObject(
  runtime: AppRuntime,
  row: ToolArtifact,
) {
  const object = await runtime.bucket.head(row.object_key);
  assertArtifactObject(row, object, runtime.uiLocale);
  return object;
}
export async function readLimited(
  request: Request,
  limit: number,
  locale: UiLocale = DEFAULT_UI_LOCALE,
): Promise<ArrayBuffer> {
  if (!request.body) throw new HttpError(400, translate(locale, "admin.package.error.emptyBody"), undefined, "admin.package.error.emptyBody");
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
        throw new HttpError(413, translate(locale, "admin.package.error.largeBody"), undefined, "admin.package.error.largeBody");
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
  const bytes = await readLimited(request, MAX_RESOURCE_ICON_BYTES, runtime.uiLocale);
  const info = inspectWorkImage(bytes);
  if (!["png", "gif", "jpeg"].includes(info.format) || info.width > 512 || info.height > 512)
    throw new HttpError(400, translate(runtime.uiLocale, "admin.package.error.iconFormat"), undefined, "admin.package.error.iconFormat");
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
    throw new HttpError(409, translate(runtime.uiLocale, "admin.package.error.cleaned"), undefined, "admin.package.error.cleaned");
  }
  if (row.storage_status === "ready") return;
  if (row.upload_token !== token)
    throw new HttpError(409, translate(runtime.uiLocale, "admin.package.error.recheck"), undefined, "admin.package.error.recheck");
  await verifyArtifactObject(runtime, row);
  await verifyPackageArtifact(runtime, row);
  const crc = row.format === "exe" ? row.crc32 ?? await artifactCrc32(runtime.bucket, row) : null;
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
      crc32=COALESCE(crc32,?),updated_at=CURRENT_TIMESTAMP WHERE id=?`,
        )
        .bind(token, crc, id),
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
    throw new HttpError(409, translate(runtime.uiLocale, "admin.package.error.closed"), undefined, "admin.package.error.closed");
  if (row.storage_status === "ready") {
    await verifyArtifactObject(runtime, row);
    return;
  }
  if (uploadRecent(row))
    throw new HttpError(409, translate(runtime.uiLocale, "admin.package.error.inProgress"), undefined, "admin.package.error.inProgress");
  const length = request.headers.get("content-length");
  if (length !== null && Number(length) !== row.size_bytes)
    throw new HttpError(400, translate(runtime.uiLocale, "admin.package.error.sizeMismatch"), undefined, "admin.package.error.sizeMismatch");
  if (!request.body) throw new HttpError(400, translate(runtime.uiLocale, "admin.package.error.emptyPackage"), undefined, "admin.package.error.emptyPackage");
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
    assertArtifactObject(row, object, runtime.uiLocale);
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
      translate(runtime.uiLocale, "admin.package.error.pending"),
      undefined,
      "admin.package.error.pending",
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
    throw new HttpError(409, translate(runtime.uiLocale, "admin.package.error.cannotConfirm"), undefined, "admin.package.error.cannotConfirm");
  const object = await runtime.bucket.head(row.object_key);
  if (!object) {
    if (uploadRecent(row)) throw new HttpError(409, translate(runtime.uiLocale, "admin.package.error.wait"), undefined, "admin.package.error.wait");
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
  assertArtifactObject(row, object, runtime.uiLocale);
  await verifyPackageArtifact(runtime, row);
  const crc = row.format === "exe" ? row.crc32 ?? await artifactCrc32(runtime.bucket, row) : null;
  await batchMutation(
    runtime,
    actor,
    row.resource_id,
    revision,
    "artifact_confirm",
    [
      runtime.db
        .prepare(
          "UPDATE tool_artifacts SET storage_status='ready',crc32=COALESCE(crc32,?),updated_at=CURRENT_TIMESTAMP WHERE id=?",
        )
        .bind(crc, id),
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
    throw new HttpError(409, translate(runtime.uiLocale, "admin.package.error.published"), undefined, "admin.package.error.published");
  if (uploadRecent(row))
    throw new HttpError(409, translate(runtime.uiLocale, "admin.package.error.cleanupWait"), undefined, "admin.package.error.cleanupWait");
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
    if (after.length > 80) throw new HttpError(400, translate(runtime.uiLocale, "admin.resources.badCursor"), undefined, "admin.resources.badCursor");
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
            error instanceof HttpError ? error.message : translate(runtime.uiLocale, "admin.resources.storageUnavailable"),
        });
      }
    }
    return {
      issues,
      scanned: Math.min(rows.length, 100),
      nextCursor: rows.length > 100 ? `records:${rows[99].id}` : null,
      phase: translate(runtime.uiLocale, "admin.resources.storageRecords"),
    };
  }
  if (cursor && !cursor.startsWith("objects:"))
    throw new HttpError(400, translate(runtime.uiLocale, "admin.resources.badCursor"), undefined, "admin.resources.badCursor");
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
        issue: translate(runtime.uiLocale, "admin.resources.untracked"),
      });
    else if (row.storage_status !== "ready")
      issues.push({
        key: object.key,
        issue: translate(runtime.uiLocale, "admin.resources.storageState", { status: row.storage_status }),
      });
    else {
      try {
        await verifyArtifactObject(runtime, row);
      } catch {
        issues.push({ key: object.key, issue: translate(runtime.uiLocale, "admin.resources.checksum") });
      }
    }
  }
  return {
    issues,
    nextCursor: listed.truncated ? `objects:${listed.cursor}` : "records:",
    scanned: listed.objects.length,
    phase: translate(runtime.uiLocale, "admin.resources.storageObjects"),
  };
}
