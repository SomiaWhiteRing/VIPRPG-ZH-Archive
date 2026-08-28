import { Button, buttonVariants } from "@/app/components/ui/button";
import Link from "next/link";
import { EmptyState } from "@/app/components/ui/empty-state";
import { StatusBadge } from "@/app/components/ui/status-badge";
import { TableWrap } from "@/app/components/ui/table-wrap";
import { canDeleteArchiveVersion, type AdminArchiveVersion } from "@/lib/server/db/archive-maintenance";
import { hasPermission } from "@/lib/authz/permissions";
import type { ArchiveUser } from "@/lib/server/db/users";
import { formatNumber, formatDate, formatBytes } from "@/lib/format";
import { languageLabel } from "@/lib/labels";

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
    return <EmptyState title={mode === "trash" ? "回收站为空" : "暂无文件版本"} />;
  }

  return (
    <TableWrap label="文件版本列表" minWidth={1040}>
      <thead>
        <tr>
          <th>文件版本</th>
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
              <span className="font-mono text-sm text-primary text-sm text-muted">
                #{archiveVersion.id} / {languageLabel(archiveVersion.language)}
              </span>
            </td>
            <td>
              <StatusBadge kind="archive" purgedAt={archiveVersion.purgedAt} value={archiveVersion.status} />
              {archiveVersion.isCurrent ? <span className="text-sm text-muted">当前版本</span> : null}
            </td>
            <td>
              {formatNumber(archiveVersion.totalFiles)} 文件
              <span className="text-sm text-muted">
                {formatBytes(archiveVersion.totalSizeBytes)} / 约 {formatNumber(archiveVersion.estimatedR2GetCount)}{" "}
                次对象存储读取
              </span>
            </td>
            <td>
              {formatDate(archiveVersion.createdAt)}
              {archiveVersion.deletedAt ? (
                <span className="text-sm text-muted">放入回收站：{formatDate(archiveVersion.deletedAt)}</span>
              ) : null}
              {archiveVersion.purgedAt ? (
                <span className="text-sm text-muted">最终清理：{formatDate(archiveVersion.purgedAt)}</span>
              ) : null}
              {archiveVersion.uploaderName ? (
                <span className="text-sm text-muted">上传者：{archiveVersion.uploaderName}</span>
              ) : null}
            </td>
            <td>
              <ArchiveActions actor={actor} archiveVersion={archiveVersion} mode={mode} />
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
  actor: ArchiveUser;
  archiveVersion: AdminArchiveVersion;
  mode: "active" | "trash";
}) {
  const canRestore = hasPermission(actor, "archive_version.restore");
  const canUpdateArchive = hasPermission(actor, "archive_version.update");
  const canSetCurrent = hasPermission(actor, "archive_version.set_current");

  if (archiveVersion.status === "deleted") {
    if (archiveVersion.purgedAt) {
      return <span className="text-sm text-muted">已最终清理，不能还原</span>;
    }

    if (!canRestore) {
      return <span className="text-sm text-muted">需要管理员还原</span>;
    }

    return (
      <form action={`/api/admin/archive-versions/${archiveVersion.id}/restore`} method="post" className="inline-flex">
        <Button type="submit">还原</Button>
      </form>
    );
  }

  const canDelete = mode === "active" && canDeleteArchiveVersion(actor, archiveVersion.uploaderId);

  return (
    <div className="flex flex-wrap items-center gap-3">
      {canUpdateArchive ? (
        <Link className={buttonVariants()} href={`/admin/archive-versions/${archiveVersion.id}`}>
          编辑版本
        </Link>
      ) : null}
      {canSetCurrent && archiveVersion.status === "published" && !archiveVersion.isCurrent ? (
        <form action={`/api/admin/archive-versions/${archiveVersion.id}/current`} method="post" className="inline-flex">
          <Button variant="outline" type="submit">
            设为当前
          </Button>
        </form>
      ) : null}
      {canDelete ? (
        <form action={`/api/admin/archive-versions/${archiveVersion.id}/delete`} method="post" className="inline-flex">
          <Button variant="outline" type="submit">
            删除
          </Button>
        </form>
      ) : null}
    </div>
  );
}
