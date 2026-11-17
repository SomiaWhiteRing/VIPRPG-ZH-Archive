import { Button, buttonVariants } from "@/app/components/ui/button";
import { EmptyState } from "@/app/components/ui/empty-state";
import { StatusBadge } from "@/app/components/ui/status-badge";
import { TableWrap } from "@/app/components/ui/table-wrap";
import type { ArchiveActor } from "@/lib/authz/archive-permissions";
import { canDeleteArchiveVersion } from "@/lib/authz/archive-permissions";
import { hasPermission } from "@/lib/authz/permissions";
import type { AdminArchiveVersion } from "@/lib/dto/db/archive-maintenance";
import { formatBytes, formatDate } from "@/lib/format";
import { languageLabel } from "@/lib/labels";
import { LocaleLink as Link } from "@/app/components/ui/locale-link";
import { useMessages, useUiLocale } from "@/lib/i18n/react";
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
  const t = useMessages();
  const locale = useUiLocale();
  if (archiveVersions.length === 0) {
    return (
      <EmptyState title={mode === "trash" ? t("admin.archives.trashEmpty") : t("admin.archives.empty")} />
    );
  }

  return (
    <TableWrap compact label={t("admin.archives.table")} minWidth={1040}>
      <thead>
        <tr>
          <th>{t("admin.archives.version")}</th>
          <th>{t("admin.list.status")}</th>
          <th>{t("admin.works.size")}</th>
          <th>{t("admin.archives.time")}</th>
          <th className="admin-action-column">{t("admin.characterList.actions")}</th>
        </tr>
      </thead>
      <tbody>
        {archiveVersions.map((archiveVersion) => (
          <tr key={archiveVersion.id}>
            <td>
              <strong className="admin-cell-title">{archiveVersion.workTitle}</strong>
              <span className="admin-cell-meta font-mono">
                #{archiveVersion.id} / {languageLabel(archiveVersion.language, locale)}
              </span>
            </td>
            <td>
              <StatusBadge
                kind="archive"
                purgedAt={archiveVersion.purgedAt}
                value={archiveVersion.status}
              />
              {archiveVersion.isCurrent ? (
                <span className="admin-cell-meta">{t("admin.archives.current")}</span>
              ) : null}
            </td>
            <td>
              {t("admin.archives.files", { count: archiveVersion.totalFiles })}
              <span className="admin-cell-meta">
                {t("admin.archives.storage", { size: formatBytes(archiveVersion.totalSizeBytes), count: archiveVersion.estimatedR2GetCount })}
              </span>
            </td>
            <td>
              {formatDate(archiveVersion.createdAt, { locale })}
              {archiveVersion.deletedAt ? (
                <span className="admin-cell-meta">
                  {t("admin.archives.deletedAt", { date: formatDate(archiveVersion.deletedAt, { locale }) })}
                </span>
              ) : null}
              {archiveVersion.purgedAt ? (
                <span className="admin-cell-meta">
                  {t("admin.archives.purgedAt", { date: formatDate(archiveVersion.purgedAt, { locale }) })}
                </span>
              ) : null}
              {archiveVersion.uploaderName ? (
                <span className="admin-cell-meta">
                  {t("admin.archives.uploader", { name: archiveVersion.uploaderName })}
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
  const t = useMessages();
  const canRestore = hasPermission(actor, "archive_version.restore");
  const canUpdateArchive = hasPermission(actor, "archive_version.update");
  const canSetCurrent = hasPermission(actor, "archive_version.set_current");

  if (archiveVersion.status === "deleted") {
    if (archiveVersion.purgedAt) {
      return <span className="admin-cell-meta">{t("admin.archives.cannotRestore")}</span>;
    }

    if (!canRestore) {
      return <span className="admin-cell-meta">{t("admin.archives.adminRestore")}</span>;
    }

    return (
      <RedirectForm
        action={`/api/admin/archive-versions/${archiveVersion.id}/restore`}
        preserveLanguage
        method="post"
        className="inline-flex"
      >
        <Button size="sm" type="submit">{t("admin.archives.restore")}</Button>
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
          {t("admin.archives.edit")}
        </Link>
      ) : null}
      {canSetCurrent &&
      archiveVersion.status === "published" &&
      !archiveVersion.isCurrent ? (
        <RedirectForm
          action={`/api/admin/archive-versions/${archiveVersion.id}/current`}
          preserveLanguage
          method="post"
          className="inline-flex"
        >
          <Button size="sm" variant="outline" type="submit">
            {t("admin.archives.setCurrent")}
          </Button>
        </RedirectForm>
      ) : null}
      {canDelete ? (
        <RedirectForm
          action={`/api/admin/archive-versions/${archiveVersion.id}/delete`}
          preserveLanguage
          method="post"
          className="inline-flex"
        >
          <Button variant="outline" type="submit">
            {t("admin.archives.delete")}
          </Button>
        </RedirectForm>
      ) : null}
    </div>
  );
}
