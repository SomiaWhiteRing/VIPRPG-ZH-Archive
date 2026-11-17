import type { AppRuntime } from "@/app/.server/runtime";
import type { ArchiveUser } from "@/lib/dto/db/user-access";
import { HttpError } from "@/lib/http";
import { MAX_TOOL_BYTES } from "@/lib/resource-limits";
import {
  RESOURCE_TARGETS,
  type ResourceLink,
  type ToolRelease,
} from "@/lib/resources";
import { getArtifact, getResource } from "./data";
import { verifyArtifactObject } from "./objects";
import { verifyPackageArtifact } from "./packages";
import { parseResourceContent } from "@/lib/resource-content";
import { downloadFilenameTemplateError, MAX_DOWNLOAD_FILENAME_TEMPLATE_LENGTH } from "@/lib/resource-filename";
import { translate } from "@/lib/i18n/core";

export type Actor = Pick<ArchiveUser, "id" | "email">;
const rootSql = `EXISTS(SELECT 1 FROM users u JOIN user_roles ur ON ur.user_id=u.id JOIN roles r ON r.id=ur.role_id
 WHERE u.id=? AND u.status='active' AND r.kind='bootstrap_admin' AND r.status='active')`;
function textField(
  locale: AppRuntime["uiLocale"],
  data: Record<string, unknown>,
  key: string,
  max: number,
  required = false,
): string {
  const value = data[key] ?? "";
  if (
    typeof value !== "string" ||
    value.length > max ||
    (required && !value.trim())
  )
    throw new HttpError(400, translate(locale, "admin.resources.error.text", { field: key }), undefined, "admin.resources.error.text", { field: key });
  return value.trim();
}
export function integer(
  locale: AppRuntime["uiLocale"],
  value: unknown,
  min = 0,
  max = Number.MAX_SAFE_INTEGER,
) {
  if (
    !Number.isSafeInteger(value) ||
    Number(value) < min ||
    Number(value) > max
  )
    throw new HttpError(400, translate(locale, "admin.resources.error.number"), undefined, "admin.resources.error.number");
  return Number(value);
}
function webUrl(locale: AppRuntime["uiLocale"], value: string, allowAppProtocol = false) {
  if (!value) return "";
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new HttpError(400, translate(locale, "admin.resources.error.url"), undefined, "admin.resources.error.url");
  }
  if (
    (allowAppProtocol
      ? ["javascript:", "data:", "vbscript:"].includes(url.protocol)
      : !["https:", "http:"].includes(url.protocol)) ||
    url.username ||
    url.password
  )
    throw new HttpError(
      400,
      allowAppProtocol
        ? translate(locale, "admin.resources.error.unsupportedUrl")
        : translate(locale, "admin.resources.error.http"),
    );
  return url.protocol === "http:" || url.protocol === "https:" ? url.href : value;
}
function audit(
  runtime: AppRuntime,
  actor: Actor,
  event: string,
  detail: Record<string, unknown>,
) {
  return runtime.db
    .prepare(
      "INSERT INTO auth_audit_logs(user_id,email,event_type,detail_json) VALUES(?,?,?,?)",
    )
    .bind(actor.id, actor.email, `resource_${event}`, JSON.stringify(detail));
}
export async function batchMutation(
  runtime: AppRuntime,
  actor: Actor,
  id: string,
  revision: number | null,
  event: string,
  statements: D1PreparedStatement[],
  detail: Record<string, unknown> = {},
) {
  // NOT NULL turns stale revisions / revoked root status into an actual batch rollback.
  const guard = runtime.db
    .prepare(
      `UPDATE resources SET revision=CASE WHEN ${rootSql} ${revision === null ? "" : "AND revision=?"}
    THEN revision+1 ELSE NULL END,updated_at=CURRENT_TIMESTAMP WHERE id=?`,
    )
    .bind(...(revision === null ? [actor.id, id] : [actor.id, revision, id]));
  try {
    await runtime.db.batch([
      guard,
      ...statements,
      audit(runtime, actor, event, { resourceId: id, ...detail }),
    ]);
  } catch (error) {
    if (
      /constraint|immutable|draft|verified|recommended|pause recommendations|active|only tools/i.test(
        String(error),
      )
    )
      throw new HttpError(
        409,
        translate(runtime.uiLocale, "admin.resources.error.conflict"),
        undefined,
        "admin.resources.error.conflict",
      );
    throw error;
  }
}
export async function createResource(
  runtime: AppRuntime,
  actor: Actor,
  data: Record<string, unknown>,
) {
  const name = textField(runtime.uiLocale, data, "name", 100, true);
  const slug = textField(runtime.uiLocale, data, "slug", 80, true);
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug))
    throw new HttpError(400, translate(runtime.uiLocale, "admin.resources.error.slug"), undefined, "admin.resources.error.slug");
  if (data.kind !== "tool" && data.kind !== "website")
    throw new HttpError(400, translate(runtime.uiLocale, "admin.resources.error.kind"), undefined, "admin.resources.error.kind");
  const id = crypto.randomUUID();
  try {
    await runtime.db.batch([
      runtime.db
        .prepare(
          `INSERT INTO resources(id,kind,slug,name,revision) VALUES(?,?,?,?,CASE WHEN ${rootSql} THEN 1 ELSE NULL END)`,
        )
        .bind(id, data.kind, slug, name, actor.id),
      audit(runtime, actor, "create", {
        resourceId: id,
        slug,
        kind: data.kind,
      }),
    ]);
  } catch (error) {
    if (/constraint/i.test(String(error)))
      throw new HttpError(409, translate(runtime.uiLocale, "admin.resources.error.duplicate"), undefined, "admin.resources.error.duplicate");
    throw error;
  }
  return id;
}
export async function editResource(
  runtime: AppRuntime,
  actor: Actor,
  id: string,
  data: Record<string, unknown>,
) {
  const resource = await getResource(runtime, id);
  const revision = integer(runtime.uiLocale, data.revision, 1);
  const action = textField(runtime.uiLocale, data, "action", 40, true);
  const db = runtime.db;
  const statements: D1PreparedStatement[] = [];
  const detail: Record<string, unknown> = {};
  if (action === "save") {
    const downloadFilenameTemplate = resource.kind === "tool" && data.downloadFilenameTemplate !== undefined
      ? textField(runtime.uiLocale, data, "downloadFilenameTemplate", MAX_DOWNLOAD_FILENAME_TEMPLATE_LENGTH)
      : resource.download_filename_template;
    const templateError = downloadFilenameTemplateError(downloadFilenameTemplate, runtime.uiLocale);
    if (templateError) throw new HttpError(400, templateError);
    const visibility = textField(runtime.uiLocale, data, "visibility", 20, true);
    if (!["draft", "published", "hidden"].includes(visibility))
      throw new HttpError(400, translate(runtime.uiLocale, "admin.resources.error.visibility"), undefined, "admin.resources.error.visibility");
    let links: ResourceLink[];
    try {
      const input: unknown = JSON.parse(textField(runtime.uiLocale, data, "linksJson", Infinity, true));
      if (!Array.isArray(input)) throw new Error();
      links = input.map((link) => {
        if (!link || typeof link !== "object" || Array.isArray(link)) throw new Error();
        return {
          label: textField(runtime.uiLocale, link, "label", Infinity, true),
          url: webUrl(runtime.uiLocale, textField(runtime.uiLocale, link, "url", 2048, true), true),
        };
      });
    } catch {
      throw new HttpError(400, translate(runtime.uiLocale, "admin.resources.error.buttons"), undefined, "admin.resources.error.buttons");
    }
    let summary: string;
    try {
      summary = JSON.stringify(parseResourceContent(textField(runtime.uiLocale, data, "summaryJson", Infinity, true)));
    } catch {
      throw new HttpError(400, translate(runtime.uiLocale, "admin.resources.error.description"), undefined, "admin.resources.error.description");
    }
    if (
      visibility === "published" &&
      (!resource.icon_blob_sha256 || (resource.kind === "website" && !links.length))
    )
      throw new HttpError(400, translate(runtime.uiLocale, "admin.resources.error.public"), undefined, "admin.resources.error.public");
    statements.push(
      db
        .prepare(
          `UPDATE resources SET name=?,summary_json=?,links_json=?,windows_button_label=?,android_button_label=?,download_filename_template=?,source_url=?,sort_order=?,visibility=? WHERE id=?`,
        )
        .bind(
          textField(runtime.uiLocale, data, "name", 100, true),
          summary,
          JSON.stringify(links),
          resource.kind === "tool" ? textField(runtime.uiLocale, data, "windowsButtonLabel", Infinity, true) : resource.windows_button_label,
          resource.kind === "tool" ? textField(runtime.uiLocale, data, "androidButtonLabel", Infinity, true) : resource.android_button_label,
          downloadFilenameTemplate,
          webUrl(runtime.uiLocale, textField(runtime.uiLocale, data, "sourceUrl", 2048)),
          integer(runtime.uiLocale, data.sortOrder, -100000, 100000),
          visibility,
          id,
        ),
    );
    detail.visibility = visibility;
    if (downloadFilenameTemplate !== resource.download_filename_template)
      detail.downloadFilenameTemplate = { before: resource.download_filename_template, after: downloadFilenameTemplate };
  } else {
    if (resource.kind !== "tool")
      throw new HttpError(400, translate(runtime.uiLocale, "admin.resources.error.website"), undefined, "admin.resources.error.website");
    if (action === "createRelease") {
      const releaseId = crypto.randomUUID();
      statements.push(
        db
          .prepare(
            "INSERT INTO tool_releases(id,resource_id,version_label,notes) VALUES(?,?,?,?)",
          )
          .bind(
            releaseId,
            id,
            textField(runtime.uiLocale, data, "version", 100, true),
            textField(runtime.uiLocale, data, "notes", 30000),
          ),
      );
      detail.releaseId = releaseId;
    } else if (action === "recommend") {
      const target = textField(runtime.uiLocale, data, "target", 40, true);
      if (
        !RESOURCE_TARGETS.includes(target as (typeof RESOURCE_TARGETS)[number])
      )
        throw new HttpError(400, translate(runtime.uiLocale, "admin.resources.error.platform"), undefined, "admin.resources.error.platform");
      const artifactId = textField(runtime.uiLocale, data, "artifactId", 80) || null;
      if (artifactId) {
        const a = await getArtifact(runtime, artifactId);
        if (a.resource_id !== id)
          throw new HttpError(400, translate(runtime.uiLocale, "admin.resources.error.package"), undefined, "admin.resources.error.package");
        await verifyArtifactObject(runtime, a);
      }
      const before = await db
        .prepare(
          "SELECT artifact_id FROM tool_channels WHERE resource_id=? AND channel='stable' AND target=?",
        )
        .bind(id, target)
        .first<{ artifact_id: string | null }>();
      statements.push(channelStatement(runtime, id, target, artifactId));
      Object.assign(detail, {
        target,
        before: before?.artifact_id ?? null,
        after: artifactId,
      });
    } else {
      const releaseId = textField(runtime.uiLocale, data, "releaseId", 80, true);
      const release = await db
        .prepare("SELECT * FROM tool_releases WHERE id=? AND resource_id=?")
        .bind(releaseId, id)
        .first<ToolRelease>();
      if (!release) throw new HttpError(404, translate(runtime.uiLocale, "admin.resources.error.release"), undefined, "admin.resources.error.release");
      detail.releaseId = releaseId;
      if (action === "saveRelease") {
        statements.push(
          db
            .prepare(
              "UPDATE tool_releases SET version_label=?,notes=? WHERE id=?",
            )
            .bind(
              textField(runtime.uiLocale, data, "version", 100, true),
              textField(runtime.uiLocale, data, "notes", 30000),
              releaseId,
            ),
        );
      } else if (action === "publish") {
        if (release.status === "published") return;
        if (release.status !== "draft")
          throw new HttpError(409, translate(runtime.uiLocale, "admin.resources.error.withdrawn"), undefined, "admin.resources.error.withdrawn");
        if (["windy-translator", "viprpg-android"].includes(resource.slug) && data.version !== undefined) {
          statements.push(db.prepare("UPDATE tool_releases SET version_label=?,notes=? WHERE id=?").bind(textField(runtime.uiLocale, data, "version", 100, true), textField(runtime.uiLocale, data, "notes", 30000), releaseId));
        }
        const artifacts = (
          await db
            .prepare(
              "SELECT id FROM tool_artifacts WHERE release_id=? AND storage_status<>'cleaned'",
            )
            .bind(releaseId)
            .all<{ id: string }>()
        ).results;
        if (!artifacts.length) throw new HttpError(400, translate(runtime.uiLocale, "admin.resources.error.uploadFirst"), undefined, "admin.resources.error.uploadFirst");
        for (const row of artifacts) {
          const a = await getArtifact(runtime, row.id);
          if (a.storage_status !== "ready")
            throw new HttpError(409, translate(runtime.uiLocale, "admin.resources.error.verify"), undefined, "admin.resources.error.verify");
          await verifyArtifactObject(runtime, a);
          await verifyPackageArtifact(runtime, a);
        }
        if (data.visible === true && !resource.icon_blob_sha256)
          throw new HttpError(400, translate(runtime.uiLocale, "admin.resources.error.icon"), undefined, "admin.resources.error.icon");
        statements.push(
          db
            .prepare(
              "UPDATE resources SET last_release_sequence=last_release_sequence+1 WHERE id=?",
            )
            .bind(id),
        );
        statements.push(
          db
            .prepare(
              `UPDATE tool_releases SET status='published',published_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'),
          release_sequence=(SELECT last_release_sequence FROM resources WHERE id=?) WHERE id=?`,
            )
            .bind(id, releaseId),
        );
        if (data.recommend === true) {
          for (const row of artifacts) {
            const a = await getArtifact(runtime, row.id);
            statements.push(channelStatement(runtime, id, a.target, a.id));
          }
        }
        if (data.visible === true)
          statements.push(
            db
              .prepare("UPDATE resources SET visibility='published' WHERE id=?")
              .bind(id),
          );
        Object.assign(detail, {
          sequence: resource.last_release_sequence + 1,
          recommend: data.recommend === true,
          visible: data.visible === true,
        });
      } else if (action === "withdraw") {
        if (release.status === "withdrawn") return;
        if (release.status !== "published")
          throw new HttpError(409, translate(runtime.uiLocale, "admin.resources.error.withdraw"), undefined, "admin.resources.error.withdraw");
        detail.reason = textField(runtime.uiLocale, data, "reason", 1000, true);
        statements.push(
          db
            .prepare(
              `UPDATE tool_channels SET artifact_id=NULL,revision=revision+1,updated_at=CURRENT_TIMESTAMP
          WHERE resource_id=? AND artifact_id IN(SELECT id FROM tool_artifacts WHERE release_id=?)`,
            )
            .bind(id, releaseId),
        );
        statements.push(
          db
            .prepare("UPDATE tool_releases SET status='withdrawn' WHERE id=?")
            .bind(releaseId),
        );
      } else throw new HttpError(400, translate(runtime.uiLocale, "admin.resources.error.unknown"), undefined, "admin.resources.error.unknown");
    }
  }
  await batchMutation(runtime, actor, id, revision, action, statements, detail);
}
export function channelStatement(
  runtime: AppRuntime,
  id: string,
  target: string,
  artifactId: string | null,
) {
  return runtime.db
    .prepare(
      `INSERT INTO tool_channels(resource_id,channel,target,artifact_id) VALUES(?,'stable',?,?)
    ON CONFLICT(resource_id,channel,target) DO UPDATE SET artifact_id=excluded.artifact_id,revision=tool_channels.revision+1,updated_at=CURRENT_TIMESTAMP`,
    )
    .bind(id, target, artifactId);
}
export async function registerArtifact(
  runtime: AppRuntime,
  actor: Actor,
  id: string,
  data: Record<string, unknown>,
) {
  const resource = await getResource(runtime, id);
  if (resource.kind !== "tool") throw new HttpError(400, translate(runtime.uiLocale, "admin.package.error.website"), undefined, "admin.package.error.website");
  let releaseId = textField(runtime.uiLocale, data, "releaseId", 80);
  const statements: D1PreparedStatement[] = [];
  if (!releaseId && !["windy-translator", "viprpg-android"].includes(resource.slug)) throw new HttpError(400, translate(runtime.uiLocale, "admin.package.error.chooseDraft"), undefined, "admin.package.error.chooseDraft");
  const release = releaseId ? await runtime.db
    .prepare(
      "SELECT id FROM tool_releases WHERE id=? AND resource_id=? AND status='draft'",
    )
    .bind(releaseId, id)
    .first() : null;
  if (releaseId && !release) throw new HttpError(409, translate(runtime.uiLocale, "admin.package.error.missingDraft"), undefined, "admin.package.error.missingDraft");
  const target = textField(runtime.uiLocale, data, "target", 40, true),
    sha = textField(runtime.uiLocale, data, "sha256", 64, true);
  const filename = textField(runtime.uiLocale, data, "filename", 180, true),
    format = filename.toLowerCase().split(".").pop() || "",
    buildId = textField(runtime.uiLocale, data, "applicationBuildId", 200) || null;
  if (
    !/^[a-f0-9]{64}$/.test(sha) ||
    !(
      (target === "windows-x64" && ["zip", "exe"].includes(format)) ||
      (target === "android-universal" && format === "apk")
    )
  )
    throw new HttpError(400, translate(runtime.uiLocale, "admin.package.error.metadata"), undefined, "admin.package.error.metadata");
  if (
    resource.slug === "windy-translator" &&
    (target !== "windows-x64" || format !== "zip" || !buildId || !/^windy:[A-Za-z0-9:.-]{1,194}$/.test(buildId))
  )
    throw new HttpError(400, translate(runtime.uiLocale, "admin.package.windyFormat"), undefined, "admin.package.windyFormat");
  if (resource.slug === "viprpg-android" && (target !== "android-universal" || format !== "apk" || !buildId || !/^org\.viprpg\.archive:[1-9][0-9]{0,9}$/.test(buildId) || Number(buildId.split(":")[1]) > 2100000000))
    throw new HttpError(400, translate(runtime.uiLocale, "admin.package.error.androidFormat"), undefined, "admin.package.error.androidFormat");
  if (buildId) {
    const duplicate = await runtime.db.prepare(`SELECT a.id,a.sha256,a.size_bytes FROM tool_artifacts a JOIN tool_releases r ON r.id=a.release_id WHERE r.resource_id=? AND a.target=? AND a.application_build_id=? AND (a.storage_status<>'cleaned' OR r.published_at IS NOT NULL) LIMIT 1`).bind(id, target, buildId).first<{ id: string; sha256: string; size_bytes: number }>();
    if (duplicate) {
      if (duplicate.sha256 !== sha || duplicate.size_bytes !== data.sizeBytes) throw new HttpError(409, translate(runtime.uiLocale, "admin.package.error.conflict"), undefined, "admin.package.error.conflict");
      return duplicate.id;
    }
  }
  if (["windy-translator", "viprpg-android"].includes(resource.slug)) {
    if (!releaseId) {
      releaseId = crypto.randomUUID();
      const version = textField(runtime.uiLocale, data, "version", 100, true);
      const names = new Set((await runtime.db.prepare("SELECT version_label FROM tool_releases WHERE resource_id=?").bind(id).all<{ version_label: string }>()).results.map((r) => r.version_label));
      let label = version;
      let suffix = 1;
      while (names.has(label)) label = `${version.slice(0, 70)} (${new Date().toISOString().slice(0, 10)}${suffix++ > 1 ? `-${suffix - 1}` : ""})`;
      statements.push(runtime.db.prepare("INSERT INTO tool_releases(id,resource_id,version_label,notes) VALUES(?,?,?,?)").bind(releaseId, id, label, textField(runtime.uiLocale, data, "notes", 30000)));
    }
  }
  if (
    /[<>:"/\\|?*]/.test(filename) ||
    Array.from(filename).some((character) => character.charCodeAt(0) < 32) ||
    /[ .]$/.test(filename) ||
    filename.startsWith(".") ||
    /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i.test(filename) ||
    !filename.toLowerCase().endsWith(`.${format}`)
  )
    throw new HttpError(400, translate(runtime.uiLocale, "admin.package.error.filename"), undefined, "admin.package.error.filename");
  const size = integer(runtime.uiLocale, data.sizeBytes, 1, MAX_TOOL_BYTES),
    artifactId = crypto.randomUUID();
  await batchMutation(
    runtime,
    actor,
    id,
    integer(runtime.uiLocale, data.revision, 1),
    "artifact_register",
    [
      ...statements,
      runtime.db
        .prepare(
          `INSERT INTO tool_artifacts(id,release_id,target,format,application_build_id,filename,object_key,size_bytes,sha256,upload_actor_id)
      VALUES(?,?,?,?,?,?,?,?,?,?)`,
        )
        .bind(
          artifactId,
          releaseId,
          target,
          format,
          buildId,
          filename,
          `tools/artifacts/${artifactId}/${sha}`,
          size,
          sha,
          actor.id,
        ),
    ],
    {
      artifactId,
      releaseId,
      target,
      sha256: sha,
      sizeBytes: size,
      applicationBuildId: buildId,
    },
  );
  return artifactId;
}
