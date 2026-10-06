import { useEffect, useState } from "react";
import { Button } from "@/app/components/ui/button";
import { Timestamp } from "@/app/components/ui/timestamp";
import { entityAuditChanges } from "@/lib/entity-audit";
import type { ForumHistory, ForumTarget } from "@/lib/forum";
import { forumHref } from "@/lib/forum";
import { ForumModal, forumRequest } from "./shared";

function valueText(value: unknown): string {
  if (value == null || value === "") return "（空）";
  return typeof value === "string" ? value : JSON.stringify(value, null, 2);
}

export function ForumHistoryDialog({ target, onClose }: { target: ForumTarget; onClose: () => void }) {
  const [page, setPage] = useState(1);
  const [state, setState] = useState<{ page: number; history?: ForumHistory; error?: string } | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    void forumRequest<{ history: ForumHistory }>(forumHref("/api/discussions", { op: "history", kind: target.kind, id: target.id, page }), undefined, controller.signal)
      .then(({ history }) => { if (!controller.signal.aborted) setState({ page, history }); })
      .catch((error: unknown) => { if (!controller.signal.aborted) setState({ page, error: error instanceof Error ? error.message : "读取失败。" }); });
    return () => controller.abort();
  }, [target.kind, target.id, page]);
  const history = state?.page === page ? state.history : undefined;
  const error = state?.page === page ? state.error : undefined;
  const name = target.kind === "topic" ? "主题" : target.kind === "post" ? "楼层" : "楼内回复";
  return <ForumModal open onOpenChange={(open) => { if (!open) onClose(); }} title={`${name} #${target.id} · 编辑历史`}>
    {error ? <p role="alert" className="text-sm text-danger">{error}</p> : !history ? <p role="status" className="text-sm text-muted">正在读取历史…</p> : <div className="grid gap-4">
      {history.state === "deleted" ? <p className="text-sm text-muted">内容已删除，以下记录保留删除前的信息。</p> : null}
      {!history.total ? <p className="text-sm text-muted">没有可用的编辑或删除记录。</p> : history.items.map((entry) => <article key={entry.id} className="grid min-w-0 gap-3 border-b border-border pb-4">
        <p className="text-sm"><strong>{entry.operation === "delete" ? "删除" : "编辑"}</strong> · {entry.actor.name} · <Timestamp value={entry.createdAt} /></p>
        {typeof entry.before?.authorName === "string" ? <p className="text-xs text-muted">原作者：{entry.before.authorName}
          {typeof entry.before.createdAt === "string" ? <> · 发表时间：<Timestamp value={entry.before.createdAt} /></> : null}</p> : null}
        {entityAuditChanges(entry.before, entry.operation === "delete" ? null : entry.after).map((change, index) => <div key={index} className="grid min-w-0 gap-2 text-sm">
          <strong className="wrap-anywhere">{change.field}</strong>
          <div><span className="text-xs text-muted">{entry.operation === "delete" ? "删除前" : "修改前"}</span>
            <pre className="whitespace-pre-wrap wrap-anywhere rounded border border-border p-2 font-sans">{valueText(change.before)}</pre></div>
          {entry.operation !== "delete" ? <div><span className="text-xs text-muted">修改后</span>
            <pre className="whitespace-pre-wrap wrap-anywhere rounded border border-border p-2 font-sans">{valueText(change.after)}</pre></div> : null}
        </div>)}
      </article>)}
      {history.total > history.pageSize ? <nav aria-label="编辑历史分页" className="flex items-center justify-between gap-2">
        <Button type="button" size="sm" variant="ghost" disabled={history.page <= 1} onClick={() => setPage(history.page - 1)}>上一页</Button>
        <span className="text-xs text-muted">第 {history.page} / {Math.ceil(history.total / history.pageSize)} 页</span>
        <Button type="button" size="sm" variant="ghost" disabled={history.page * history.pageSize >= history.total} onClick={() => setPage(history.page + 1)}>下一页</Button>
      </nav> : null}
    </div>}
  </ForumModal>;
}
