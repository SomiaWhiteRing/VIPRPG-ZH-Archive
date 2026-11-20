import { useMessages } from "@/lib/i18n/react";
import { useEffect, useState } from "react";
import { Button } from "@/app/components/ui/button";
import { Timestamp } from "@/app/components/ui/timestamp";
import { entityAuditChanges } from "@/lib/entity-audit";
import type { ForumHistory, ForumTarget } from "@/lib/forum";
import { forumHref } from "@/lib/forum";
import { ForumModal, forumRequest } from "./shared";

function valueText(value: unknown, empty: string): string {
  if (value == null || value === "") return empty;
  return typeof value === "string" ? value : JSON.stringify(value, null, 2);
}

export function ForumHistoryDialog({ target, onClose }: { target: ForumTarget; onClose: () => void }) {
  const t = useMessages();
  const [page, setPage] = useState(1);
  const [state, setState] = useState<{ page: number; history?: ForumHistory; error?: string } | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    void forumRequest<{ history: ForumHistory }>(forumHref("/api/discussions", { op: "history", kind: target.kind, id: target.id, page }), undefined, controller.signal)
      .then(({ history }) => { if (!controller.signal.aborted) setState({ page, history }); })
      .catch((error: unknown) => { if (!controller.signal.aborted) setState({ page, error: error instanceof Error ? error.message : t("admin.discussions.readFailed") }); });
    return () => controller.abort();
  }, [target.kind, target.id, page, t]);
  const history = state?.page === page ? state.history : undefined;
  const error = state?.page === page ? state.error : undefined;
  const name = t(`admin.discussions.${target.kind}`);
  return <ForumModal open onOpenChange={(open) => { if (!open) onClose(); }} title={t("work.sidebar.history")} description={`${name} #${target.id}`}>
    {error ? <p role="alert" className="text-sm text-danger">{error}</p> : !history ? <p role="status" className="text-sm text-muted">{t("forum.history.loading")}</p> : <div className="grid gap-4">
      {history.state === "deleted" ? <p className="text-sm text-muted">{t("forum.history.deleted")}</p> : null}
      {!history.total ? <p className="text-sm text-muted">{t("forum.history.empty")}</p> : history.items.map((entry) => <article key={entry.id} className="grid min-w-0 gap-3 border-b border-border pb-4">
        <p className="flex flex-wrap items-center gap-x-2 text-sm">
          <strong>{entry.operation === "delete" ? t("timeline.action.delete") : t("core.action.edit")}</strong>
          <span>{entry.actor.name}</span>
          <Timestamp value={entry.createdAt} />
        </p>
        {typeof entry.before?.authorName === "string" ? <p className="flex flex-wrap items-center gap-x-2 text-xs text-muted">
          <span>{t("forum.history.author", { name: entry.before.authorName })}</span>
          {typeof entry.before.createdAt === "string" ? <span>{t("forum.history.published")}<Timestamp value={entry.before.createdAt} /></span> : null}
        </p> : null}
        {entityAuditChanges(entry.before, entry.operation === "delete" ? null : entry.after).map((change, index) => <div key={index} className="grid min-w-0 gap-2 text-sm">
          <strong className="wrap-anywhere">{change.field}</strong>
          <div><span className="text-xs text-muted">{entry.operation === "delete" ? t("forum.history.beforeDelete") : t("forum.history.beforeEdit")}</span>
            <pre className="whitespace-pre-wrap wrap-anywhere rounded border border-border p-2 font-sans">{valueText(change.before, t("entryHistory.blank"))}</pre></div>
          {entry.operation !== "delete" ? <div><span className="text-xs text-muted">{t("forum.history.after")}</span>
            <pre className="whitespace-pre-wrap wrap-anywhere rounded border border-border p-2 font-sans">{valueText(change.after, t("entryHistory.blank"))}</pre></div> : null}
        </div>)}
      </article>)}
      {history.total > history.pageSize ? <nav aria-label={t("forum.history.pages")} className="flex items-center justify-between gap-2">
        <Button type="button" size="sm" variant="ghost" disabled={history.page <= 1} onClick={() => setPage(history.page - 1)}>{t("pagination.previous")}</Button>
        <span className="text-xs text-muted">{t("forum.history.page", { page: history.page, total: Math.ceil(history.total / history.pageSize) })}</span>
        <Button type="button" size="sm" variant="ghost" disabled={history.page * history.pageSize >= history.total} onClick={() => setPage(history.page + 1)}>{t("pagination.next")}</Button>
      </nav> : null}
    </div>}
  </ForumModal>;
}
