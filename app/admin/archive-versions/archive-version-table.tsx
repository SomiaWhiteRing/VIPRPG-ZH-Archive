import Link from "next/link";
import type { AdminArchiveVersion } from "@/lib/server/db/archive-maintenance";
import { canManageUsersRole } from "@/lib/server/auth/roles";
import type { ArchiveUser } from "@/lib/server/db/users";
import { formatNumber, formatDate, formatBytes } from "@/lib/format";
import { archiveStatusBadgeClass, archiveStatusLabel } from "@/lib/labels";

export function ArchiveVersionTable({
  actor,
  archiveVersions,
  mode,
}: {
  actor: ArchiveUser;
  archiveVersions: AdminArchiveVersion[];
  mode: "active" | "trash";
}) {
  if (archiveVersions.length === 0) {
    return (
      <section className="card empty-card">
        <h2>{mode === "trash" ? "回收站为空" : "暂无归档快照"}</h2>
      </section>
    );
  }

  return (
    <section className="table-wrap" aria-label="归档快照列表">
      <table className="data-table admin-archive-table">
        <thead>
          <tr>
            <th>归档</th>
            <th>状态</th>
            <th>规模</th>
            <th>时间</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          {archiveVersions.map((archiveVersion) => (
            <tr key={archiveVersion.id}>
              <td>
                <strong>{archiveVersion.workTitle}</strong>
                <span className="muted-line">
                  {archiveVersion.releaseLabel} / {archiveVersion.archiveLabel}
                </span>
                <span className="mono muted-line">
                  #{archiveVersion.id} {archiveVersion.archiveKey} /{" "}
                  {archiveVersion.language}
                </span>
              </td>
              <td>
                <span
                  className={`badge ${archiveStatusBadgeClass(
                    archiveVersion.status,
                    archiveVersion.purgedAt,
                  )}`}
                >
                  {archiveStatusLabel(archiveVersion.status, archiveVersion.purgedAt)}
                </span>
                {archiveVersion.isCurrent ? (
                  <span className="muted-line">当前版本</span>
                ) : null}
              </td>
              <td>
                {formatNumber(archiveVersion.totalFiles)} 文件
                <span className="muted-line">
                  {formatBytes(archiveVersion.totalSizeBytes)} / 约{" "}
                  {formatNumber(archiveVersion.estimatedR2GetCount)} 次对象存储读取
                </span>
              </td>
              <td>
                {formatDate(archiveVersion.createdAt)}
                {archiveVersion.deletedAt ? (
                  <span className="muted-line">
                    放入回收站：{formatDate(archiveVersion.deletedAt)}
                  </span>
                ) : null}
                {archiveVersion.purgedAt ? (
                  <span className="muted-line">
                    最终清理：{formatDate(archiveVersion.purgedAt)}
                  </span>
                ) : null}
                {archiveVersion.uploaderName ? (
                  <span className="muted-line">
                    上传者：{archiveVersion.uploaderName}
                  </span>
                ) : null}
              </td>
              <td>
                <ArchiveActions
                  actor={actor}
                  archiveVersion={archiveVersion}
                  mode={mode}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

function ArchiveActions({
  actor,
  archiveVersion,
  mode,
}: {
  actor: ArchiveUser;
  archiveVersion: AdminArchiveVersion;
  mode: "active" | "trash";
}) {
  const isAdmin = canManageUsersRole(actor.role);

  if (archiveVersion.status === "deleted") {
    if (archiveVersion.purgedAt) {
      return <span className="muted-line">已最终清理，不能还原</span>;
    }

    if (!isAdmin) {
      return <span className="muted-line">需要管理员还原</span>;
    }

    return (
      <form
        action={`/api/admin/archive-versions/${archiveVersion.id}/restore`}
        method="post"
        className="inline-form"
      >
        <button className="button primary" type="submit">
          还原
        </button>
      </form>
    );
  }

  const canDelete =
    mode === "active" &&
    (isAdmin || (archiveVersion.uploaderId !== null && archiveVersion.uploaderId === actor.id));

  return (
    <div className="actions compact-actions">
      {isAdmin ? (
        <>
          <Link className="button primary" href={`/admin/archive-versions/${archiveVersion.id}`}>
            编辑归档
          </Link>
          <Link className="button" href={`/admin/releases/${archiveVersion.releaseId}`}>
            编辑发布版本
          </Link>
        </>
      ) : null}
      {isAdmin && archiveVersion.status === "published" && !archiveVersion.isCurrent ? (
        <form
          action={`/api/admin/archive-versions/${archiveVersion.id}/current`}
          method="post"
          className="inline-form"
        >
          <button className="button" type="submit">
            设为当前
          </button>
        </form>
      ) : null}
      {canDelete ? (
        <form
          action={`/api/admin/archive-versions/${archiveVersion.id}/delete`}
          method="post"
          className="inline-form"
        >
          <button className="button" type="submit">
            删除
          </button>
        </form>
      ) : null}
    </div>
  );
}
