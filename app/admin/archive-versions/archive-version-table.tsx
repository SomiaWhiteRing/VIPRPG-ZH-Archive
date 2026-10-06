import { Button, buttonVariants } from "@/app/components/ui/button";
import { EmptyState } from "@/app/components/ui/empty-state";
import { StatusBadge } from "@/app/components/ui/status-badge";
import { TableWrap } from "@/app/components/ui/table-wrap";
import type { ArchiveActor } from "@/lib/authz/archive-permissions";
import { canDeleteArchiveVersion } from "@/lib/authz/archive-permissions";
import { hasPermission } from "@/lib/authz/permissions";
import type { AdminArchiveVersion } from "@/lib/dto/db/archive-maintenance";
import { formatBytes, formatDate, formatNumber } from "@/lib/format";
import { languageLabel } from "@/lib/labels";
import { Link } from "react-router";
import { RedirectForm } from "@/app/components/ui/redirect-form";

export function ArchiveVersionTable({
  actor,
  archiveVersions,
  mode,
}: {
  actor: ArchiveActor;
  archiveVersions: AdminArchiveVersion[];
  mode: "active" | "trash";
}) {
  if (archiveVersions.length === 0) {
    return (
      <EmptyState title={mode === "trash" ? "回收站为空" : "暂无文件版本"} />
    );
  }

  return (
    <TableWrap compact label="文件版本列表" minWidth={1040}>
      <thead>
        <tr>
          <th>文件版本</th>
          <th>状态</th>
          <th>规模</th>
          <th>时间</th>
          <th className="admin-action-column">操作</th>
        </tr>
      </thead>
      <tbody>
        {archiveVersions.map((archiveVersion) => (
          <tr key={archiveVersion.id}>
            <td>
              <strong className="admin-cell-title">{archiveVersion.workTitle}</strong>
              <span className="admin-cell-meta font-mono">
                #{archiveVersion.id} / {languageLabel(archiveVersion.language)}
              </span>
            </td>
            <td>
              <StatusBadge
                kind="archive"
                purgedAt={archiveVersion.purgedAt}
                value={archiveVersion.status}
              />
              {archiveVersion.isCurrent ? (
                <span className="admin-cell-meta">当前版本</span>
              ) : null}
            </td>
            <td>
              {formatNumber(archiveVersion.totalFiles)} 文件
              <span className="admin-cell-meta">
                {formatBytes(archiveVersion.totalSizeBytes)} / 约{" "}
                {formatNumber(archiveVersion.estimatedR2GetCount)}{" "}
                次对象存储读取
              </span>
            </td>
            <td>
              {formatDate(archiveVersion.createdAt)}
              {archiveVersion.deletedAt ? (
                <span className="admin-cell-meta">
                  放入回收站：{formatDate(archiveVersion.deletedAt)}
                </span>
              ) : null}
              {archiveVersion.purgedAt ? (
                <span className="admin-cell-meta">
                  最终清理：{formatDate(archiveVersion.purgedAt)}
                </span>
              ) : null}
              {archiveVersion.uploaderName ? (
                <span className="admin-cell-meta">
                  上传者：{archiveVersion.uploaderName}
                </span>
              ) : null}
            </td>
            <td className="admin-action-column">
              <ArchiveActions
                actor={actor}
                archiveVersion={archiveVersion}
                mode={mode}
              />
            </td>
          </tr>
        ))}
      </tbody>
    </TableWrap>
  );
}

function ArchiveActions({
  actor,
  archiveVersion,
  mode,
}: {
  actor: ArchiveActor;
  archiveVersion: AdminArchiveVersion;
  mode: "active" | "trash";
}) {
  const canRestore = hasPermission(actor, "archive_version.restore");
  const canUpdateArchive = hasPermission(actor, "archive_version.update");
  const canSetCurrent = hasPermission(actor, "archive_version.set_current");

  if (archiveVersion.status === "deleted") {
    if (archiveVersion.purgedAt) {
      return <span className="admin-cell-meta">已最终清理，不能还原</span>;
    }

    if (!canRestore) {
      return <span className="admin-cell-meta">需要管理员还原</span>;
    }

    return (
      <RedirectForm
        action={`/api/admin/archive-versions/${archiveVersion.id}/restore`}
        method="post"
        className="inline-flex"
      >
        <Button size="sm" type="submit">还原</Button>
      </RedirectForm>
    );
  }

  const maintainerId = archiveVersion.workDeleted
    ? null
    : (archiveVersion.maintainerIds.find((id) => id === actor.id) ?? null);
  const canDelete =
    mode === "active" && canDeleteArchiveVersion(actor, maintainerId);

  return (
    <div className="admin-row-actions">
      {canUpdateArchive ? (
        <Link
          className={buttonVariants({ variant: "ghost", size: "sm" })}
          to={`/admin/archive-versions/${archiveVersion.id}`}
        >
          编辑版本
        </Link>
      ) : null}
      {canSetCurrent &&
      archiveVersion.status === "published" &&
      !archiveVersion.isCurrent ? (
        <RedirectForm
          action={`/api/admin/archive-versions/${archiveVersion.id}/current`}
          method="post"
          className="inline-flex"
        >
          <Button size="sm" variant="outline" type="submit">
            设为当前
          </Button>
        </RedirectForm>
      ) : null}
      {canDelete ? (
        <RedirectForm
          action={`/api/admin/archive-versions/${archiveVersion.id}/delete`}
          method="post"
          className="inline-flex"
        >
          <Button variant="outline" type="submit">
            删除
          </Button>
        </RedirectForm>
      ) : null}
    </div>
  );
}
