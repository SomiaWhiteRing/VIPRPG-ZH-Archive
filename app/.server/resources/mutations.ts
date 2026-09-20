import type { AppRuntime } from "@/app/.server/runtime";
import type { ArchiveUser } from "@/lib/dto/db/user-access";
import { HttpError } from "@/lib/http";
import {
  MAX_TOOL_BYTES,
  RESOURCE_TARGETS,
  type ResourceLink,
  type ToolRelease,
} from "@/lib/resources";
import { getArtifact, getResource } from "./data";
import { verifyArtifactObject } from "./objects";
import { parseResourceContent } from "@/lib/resource-content";

export type Actor = Pick<ArchiveUser, "id" | "email">;
const rootSql = `EXISTS(SELECT 1 FROM users u JOIN user_roles ur ON ur.user_id=u.id JOIN roles r ON r.id=ur.role_id
 WHERE u.id=? AND u.status='active' AND r.kind='bootstrap_admin' AND r.status='active')`;
export function textField(
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
    throw new HttpError(400, `${key} 格式或长度不正确`);
  return value.trim();
}
export function integer(
  value: unknown,
  min = 0,
  max = Number.MAX_SAFE_INTEGER,
) {
  if (
    !Number.isSafeInteger(value) ||
    Number(value) < min ||
    Number(value) > max
  )
    throw new HttpError(400, "数字参数不正确");
  return Number(value);
}
function webUrl(value: string, allowAppProtocol = false) {
  if (!value) return "";
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new HttpError(400, "请输入完整的链接地址");
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
        ? "不支持此链接地址"
        : "仅支持 HTTP／HTTPS 网站地址",
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
        "资料、上传状态或权限已变化，或版本／平台已存在。请刷新后重试。",
      );
    throw error;
  }
}
export async function createResource(
  runtime: AppRuntime,
  actor: Actor,
  data: Record<string, unknown>,
) {
  const name = textField(data, "name", 100, true);
  const slug = textField(data, "slug", 80, true);
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug))
    throw new HttpError(400, "固定名称只能使用小写字母、数字和连字符");
  if (data.kind !== "tool" && data.kind !== "website")
    throw new HttpError(400, "链接类型不正确");
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
      throw new HttpError(409, "固定名称已存在或权限已变化");
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
  const revision = integer(data.revision, 1);
  const action = textField(data, "action", 40, true);
  const db = runtime.db;
  const statements: D1PreparedStatement[] = [];
  const detail: Record<string, unknown> = {};
  if (action === "save") {
    const visibility = textField(data, "visibility", 20, true);
    if (!["draft", "published", "hidden"].includes(visibility))
      throw new HttpError(400, "显示状态不正确");
    let links: ResourceLink[];
    try {
      const input: unknown = JSON.parse(textField(data, "linksJson", Infinity, true));
      if (!Array.isArray(input)) throw new Error();
      links = input.map((link) => {
        if (!link || typeof link !== "object" || Array.isArray(link)) throw new Error();
        return {
          label: textField(link, "label", Infinity, true),
          url: webUrl(textField(link, "url", 2048, true), true),
        };
      });
    } catch {
      throw new HttpError(400, "请为每个网站填写按钮文案和有效的访问地址");
    }
    let summary: string;
    try {
      summary = JSON.stringify(parseResourceContent(textField(data, "summaryJson", Infinity, true)));
    } catch {
      throw new HttpError(400, "卡片介绍格式不正确或包含无效链接");
    }
    if (
      visibility === "published" &&
      (!resource.icon_blob_sha256 || (resource.kind === "website" && !links.length))
    )
      throw new HttpError(400, "公开前请上传图标并填写访问地址");
    statements.push(
      db
        .prepare(
          `UPDATE resources SET name=?,summary_json=?,links_json=?,windows_button_label=?,android_button_label=?,source_url=?,sort_order=?,visibility=? WHERE id=?`,
        )
        .bind(
          textField(data, "name", 100, true),
          summary,
          JSON.stringify(links),
          resource.kind === "tool" ? textField(data, "windowsButtonLabel", Infinity, true) : resource.windows_button_label,
          resource.kind === "tool" ? textField(data, "androidButtonLabel", Infinity, true) : resource.android_button_label,
          webUrl(textField(data, "sourceUrl", 2048)),
          integer(data.sortOrder, -100000, 100000),
          visibility,
          id,
        ),
    );
    detail.visibility = visibility;
  } else {
    if (resource.kind !== "tool")
      throw new HttpError(400, "网站链接没有软件版本");
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
            textField(data, "version", 100, true),
            textField(data, "notes", 30000),
          ),
      );
      detail.releaseId = releaseId;
    } else if (action === "recommend") {
      const target = textField(data, "target", 40, true);
      if (
        !RESOURCE_TARGETS.includes(target as (typeof RESOURCE_TARGETS)[number])
      )
        throw new HttpError(400, "平台不正确");
      const artifactId = textField(data, "artifactId", 80) || null;
      if (artifactId) {
        const a = await getArtifact(runtime, artifactId);
        if (a.resource_id !== id)
          throw new HttpError(400, "安装包不属于该链接");
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
      const releaseId = textField(data, "releaseId", 80, true);
      const release = await db
        .prepare("SELECT * FROM tool_releases WHERE id=? AND resource_id=?")
        .bind(releaseId, id)
        .first<ToolRelease>();
      if (!release) throw new HttpError(404, "版本不存在");
      detail.releaseId = releaseId;
      if (action === "saveRelease") {
        statements.push(
          db
            .prepare(
              "UPDATE tool_releases SET version_label=?,notes=? WHERE id=?",
            )
            .bind(
              textField(data, "version", 100, true),
              textField(data, "notes", 30000),
              releaseId,
            ),
        );
      } else if (action === "publish") {
        if (release.status === "published") return;
        if (release.status !== "draft")
          throw new HttpError(409, "撤回的版本不能重新发布");
        const artifacts = (
          await db
            .prepare(
              "SELECT id FROM tool_artifacts WHERE release_id=? AND storage_status<>'cleaned'",
            )
            .bind(releaseId)
            .all<{ id: string }>()
        ).results;
        if (!artifacts.length) throw new HttpError(400, "请先上传安装包");
        for (const row of artifacts) {
          const a = await getArtifact(runtime, row.id);
          if (a.storage_status !== "ready")
            throw new HttpError(409, "所有安装包均需校验完成");
          await verifyArtifactObject(runtime, a);
        }
        if (data.visible === true && !resource.icon_blob_sha256)
          throw new HttpError(400, "公开链接前请上传图标");
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
          throw new HttpError(409, "仅已发布版本可撤回");
        detail.reason = textField(data, "reason", 1000, true);
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
      } else throw new HttpError(400, "未知操作");
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
  const releaseId = textField(data, "releaseId", 80, true);
  const release = await runtime.db
    .prepare(
      "SELECT id FROM tool_releases WHERE id=? AND resource_id=? AND status='draft'",
    )
    .bind(releaseId, id)
    .first();
  if (!release) throw new HttpError(409, "草稿不存在");
  const target = textField(data, "target", 40, true),
    format = textField(data, "format", 10, true),
    sha = textField(data, "sha256", 64, true);
  const filename = textField(data, "filename", 180, true),
    buildId = textField(data, "applicationBuildId", 200) || null;
  if (
    !/^[a-f0-9]{64}$/.test(sha) ||
    !(
      (target === "windows-x64" && ["zip", "exe"].includes(format)) ||
      (target === "android-universal" && format === "apk")
    )
  )
    throw new HttpError(400, "平台、文件格式或摘要不正确");
  if (
    resource.slug === "windy-translator" &&
    (target !== "windows-x64" || format !== "zip")
  )
    throw new HttpError(400, "Windy 更新仅支持 Windows x64 ZIP");
  if (
    /[<>:"/\\|?*]/.test(filename) ||
    Array.from(filename).some((character) => character.charCodeAt(0) < 32) ||
    /[ .]$/.test(filename) ||
    filename.startsWith(".") ||
    /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i.test(filename) ||
    !filename.toLowerCase().endsWith(`.${format}`)
  )
    throw new HttpError(400, "文件名不安全或与格式不符");
  const size = integer(data.sizeBytes, 1, MAX_TOOL_BYTES),
    artifactId = crypto.randomUUID();
  await batchMutation(
    runtime,
    actor,
    id,
    integer(data.revision, 1),
    "artifact_register",
    [
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
