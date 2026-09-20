import { Timestamp } from "@/app/components/ui/timestamp";
import { PaginationLinks } from "@/app/components/library/pagination-links";
import { Button } from "@/app/components/ui/button";
import { EmptyState } from "@/app/components/ui/empty-state";
import { Input } from "@/app/components/ui/input";
import { Label } from "@/app/components/ui/label";
import { PageHeader } from "@/app/components/ui/page-header";
import { SelectField } from "@/app/components/ui/select";
import { Textarea } from "@/app/components/ui/textarea";
import { ForumImages } from "@/app/discussions/images";
import {
  ForumModal,
  ForumTagEditor,
  forumRequest,
} from "@/app/discussions/shared";
import type { ForumAdminDetail, ForumAdminRow } from "@/lib/dto/forum/admin";
import type { ForumPage, ForumViewer } from "@/lib/forum";
import { forumHref } from "@/lib/forum";
import { useState } from "react";
import { Link, useRevalidator } from "react-router";
export function AdminDiscussions({
  data,
  view,
  query,
  state,
  viewer,
}: {
  data: ForumPage<ForumAdminRow>;
  view: string;
  query: string;
  state: string;
  viewer: NonNullable<ForumViewer>;
}) {
  const [selected, setSelected] = useState<{
      row: ForumAdminRow;
      detail: ForumAdminDetail;
    } | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);

  const revalidator = useRevalidator();
  async function open(row: ForumAdminRow) {
    setBusy(true);
    setError("");
    try {
      const result = await forumRequest<{ detail: ForumAdminDetail }>(
        forumHref("/api/admin/discussions", {
          op: "detail",
          kind: row.kind,
          id: row.id,
        }),
      );
      setSelected({ row, detail: result.detail });
    } catch (e) {
      setError(e instanceof Error ? e.message : "读取失败。");
    } finally {
      setBusy(false);
    }
  }
  return (
    <main>
      <PageHeader compact title="讨论管理" />
      <nav className="flex flex-wrap gap-4 text-sm" aria-label="讨论管理视图">
        {(viewer.moderate
          ? [
              ["reports", "待处理举报"],
              ["topics", "主题"],
              ["posts", "帖子"],
            ]
          : [["topics", "主题"]]
        ).map(([value, label]) => (
          <Link
            key={value}
            className={view === value ? "font-bold text-primary underline" : ""}
            aria-current={view === value ? "page" : undefined}
            to={forumHref("/admin/discussions", { view: value })}
          >
            {label}
          </Link>
        ))}
        {viewer.moderate ? (
          <Link to="/admin/discussions/images" className="text-primary">
            图片清理
          </Link>
        ) : null}
      </nav>
      <form
        className="flex flex-wrap items-end gap-3"
        action="/admin/discussions"
      >
        <input type="hidden" name="view" value={view} />
        <div className="min-w-48 flex-1">
          <Label htmlFor="admin-forum-query">标题、正文、TAG、作者或 ID</Label>
          <Input id="admin-forum-query" name="q" defaultValue={query} />
        </div>
        <div>
          <Label htmlFor="admin-forum-state">内容状态</Label>
          <SelectField
            id="admin-forum-state"
            name="state"
            defaultValue={state}
            options={[
              { value: "", label: "全部" },
              { value: "published", label: "公开" },
              { value: "hidden", label: "隐藏" },
              { value: "deleted", label: "删除" },
            ]}
          />
        </div>
        <Button type="submit">查询</Button>
      </form>
      {error ? (
        <p role="alert" className="text-destructive">
          {error}
        </p>
      ) : null}
      <div className="overflow-x-auto rounded-md border border-border">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-border">
              <th className="p-3">目标</th>
              <th className="hidden p-3 md:table-cell">作者／举报人</th>
              <th className="hidden p-3 md:table-cell">状态／原因</th>
              <th className="hidden p-3 md:table-cell">时间</th>
              <th className="w-20 whitespace-nowrap p-3">操作</th>
            </tr>
          </thead>
          <tbody>
            {data.items.map((row) => (
              <tr
                className="border-b border-border"
                key={`${row.reportId ?? row.kind}-${row.id}`}
              >
                <td className="max-w-96 p-3">
                  <strong className="break-words">
                    {row.title || "已删除主题"}
                  </strong>
                  <p className="text-xs text-muted">
                    {row.kind === "topic"
                      ? "主题"
                      : `#${row.postNumber}${row.kind === "comment" ? " 楼中楼" : " 普通楼层"}`}{" "}
                    · {row.id}
                  </p>
                  {row.tags ? <p className="text-xs">{row.tags}</p> : null}
                  {row.replies !== undefined ? (
                    <p className="text-xs">
                      {row.replies} 回复{row.locked ? " · 已锁定" : ""}
                      {row.featured ? " · 精品" : ""}
                    </p>
                  ) : null}
                  <p className="line-clamp-2 break-words text-xs text-muted">
                    {row.body}
                  </p>
                  <p className="mt-2 text-xs md:hidden">
                    {row.reason ?? contentStateLabel(row.state)}
                  </p>
                </td>
                <td className="hidden p-3 md:table-cell">
                  {row.author}
                  {row.reporter ? (
                    <p className="text-xs">举报人：{row.reporter}</p>
                  ) : null}
                </td>
                <td className="hidden p-3 md:table-cell">
                  {row.reason ??
                    { published: "公开", hidden: "隐藏", deleted: "删除" }[
                      row.state
                    ] ??
                    row.state}
                  {row.explanation ? (
                    <p className="line-clamp-2 max-w-52 text-xs">
                      {row.explanation}
                    </p>
                  ) : null}
                </td>
                <td className="hidden p-3 md:table-cell">
                  <Timestamp value={row.createdAt} />
                </td>
                <td className="p-3">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={busy}
                    onClick={() => void open(row)}
                    type="button"
                  >
                    查看
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!data.items.length ? (
          <EmptyState
            title="没有匹配的记录。"
            variant="plain"
            className="p-4"
          />
        ) : null}
      </div>
      <PaginationLinks
        basePath="/admin/discussions"
        page={data.page}
        pageSize={data.pageSize}
        total={data.total}
        params={{ view, q: query, state }}
      />
      {selected ? (
        <AdminDiscussionPanel
          key={`${selected.row.reportId}-${selected.detail.target.kind}-${selected.detail.target.id}`}
          row={selected.row}
          detail={selected.detail}
          viewer={viewer}
          onClose={() => setSelected(null)}
          onSaved={() => {
            setSelected(null);
            revalidator.revalidate();
          }}
        />
      ) : null}
    </main>
  );
}
function contentStateLabel(state: string) {
  return (
    { published: "公开", hidden: "隐藏", deleted: "已删除" }[state] ?? "不可用"
  );
}
function AdminDiscussionPanel({
  row,
  detail,
  viewer,
  onClose,
  onSaved,
}: {
  row: ForumAdminRow;
  detail: ForumAdminDetail;
  viewer: NonNullable<ForumViewer>;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [action, setAction] = useState("none"),
    [resolution, setResolution] = useState("resolved"),
    [reason, setReason] = useState(""),
    [tags, setTags] = useState(detail.tags),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const options = [
    { value: "none", label: row.reportId ? "只记录处理结果" : "选择管理动作" },
    ...(viewer.moderate && detail.state !== "deleted"
      ? [
          {
            value: detail.state === "hidden" ? "restore" : "hide",
            label: detail.state === "hidden" ? "恢复" : "隐藏",
          },
        ]
      : []),
    ...(viewer.moderate &&
    detail.target.kind === "topic" &&
    detail.state !== "deleted"
      ? [
          {
            value: detail.locked ? "unlock" : "lock",
            label: detail.locked ? "解锁" : "锁定",
          },
        ]
      : []),
    ...(viewer.moderate && detail.target.kind === "topic" && detail.publicHref
      ? [{ value: detail.pinned ? "unpin" : "pin", label: detail.pinned ? "取消置顶" : "置顶" }]
      : []),
    ...(viewer.feature && detail.target.kind === "topic" && detail.publicHref
      ? [
          {
            value: detail.featured ? "unfeature" : "feature",
            label: detail.featured ? "取消加精" : "加精",
          },
          { value: "tags", label: "调整 TAG" },
        ]
      : []),
  ];
  async function submit() {
    setBusy(true);
    setError("");
    try {
      await forumRequest("/api/admin/discussions", {
        op: "moderate",
        target: detail.target,
        topicRevision: detail.topicRevision,
        action,
        reason,
        tags,
        reportId: row.reportId,
        resolution,
      });
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : "保存失败。");
    } finally {
      setBusy(false);
    }
  }
  return (
    <ForumModal
      confirm
      open
      onOpenChange={(value) => {
        if (!value && !busy) onClose();
      }}
      title={detail.title || "已删除主题"}
    >
      {row.reportId && viewer.moderate ? (
        <section
          aria-label="举报信息"
          className="my-3 border-b border-border pb-3 text-sm"
        >
          <h3 className="mb-2 font-bold">举报信息</h3>
          <p className="break-words">举报人：{row.reporter}</p>
          <p className="text-xs text-muted">
            <Timestamp value={row.createdAt} />
          </p>
          <p className="mt-2">原因：{row.reason}</p>
          <p className="mt-1 whitespace-pre-wrap break-words">
            {row.explanation || "未填写补充说明。"}
          </p>
        </section>
      ) : null}
      <h3 className="mb-2 text-sm font-bold">当前内容</h3>
      <p className="text-xs text-muted">
        {
          { topic: "主题", post: "普通楼层", comment: "楼中楼" }[
            detail.target.kind
          ]
        }{" "}
        · {detail.target.id} · {contentStateLabel(detail.state)}
      </p>
      <p className="mt-1 break-words text-sm">作者：{row.author}</p>
      {!row.reportId ? (
        <p className="mt-1 text-xs text-muted">
          {row.kind === "topic" ? "更新时间：" : "发布时间："}
          <Timestamp value={row.createdAt} />
        </p>
      ) : null}
      <div className="my-3 max-h-64 overflow-y-auto whitespace-pre-wrap break-words">
        <ForumImages
          body={detail.body || (detail.images.length ? "" : "正文已删除")}
          images={detail.images}
        />
      </div>
      <p className="my-3 max-h-32 overflow-y-auto whitespace-pre-wrap break-words text-sm text-muted">
        {detail.context}
      </p>
      {detail.publicHref ? (
        <a
          className="text-primary underline"
          href={detail.publicHref}
          target="_blank"
          rel="noopener noreferrer"
        >
          打开公开永久入口
        </a>
      ) : (
        <p className="text-sm">公开入口不可用。</p>
      )}
      <form
        className="my-4 grid gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <div>
          <Label htmlFor="admin-forum-action">管理动作</Label>
          <SelectField
            id="admin-forum-action"
            value={action}
            onValueChange={setAction}
            options={options}
            disabled={busy}
          />
        </div>
        {action === "tags" ? (
          <ForumTagEditor
            id="admin-forum-tags"
            values={tags}
            onChange={setTags}
            disabled={busy}
          />
        ) : null}
        {row.reportId ? (
          <div>
            <Label htmlFor="admin-forum-resolution">处理结果</Label>
            <SelectField
              id="admin-forum-resolution"
              value={resolution}
              onValueChange={setResolution}
              options={[
                { value: "resolved", label: "已处理" },
                { value: "dismissed", label: "无需处理" },
              ]}
              disabled={busy}
            />
          </div>
        ) : null}
        <div>
          <Label htmlFor="admin-forum-reason">原因／内部备注</Label>
          <Textarea
            id="admin-forum-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            required
            maxLength={1000}
            disabled={busy}
          />
        </div>
        {error ? (
          <p role="alert" className="text-destructive">
            {error}
          </p>
        ) : null}
        <div className="flex justify-end gap-2">
          <Button
            type="button"
            variant="outline"
            disabled={busy}
            data-forum-cancel
            onClick={onClose}
          >
            取消
          </Button>
          <Button
            type="submit"
            variant={action === "hide" ? "destructive" : "default"}
            disabled={busy || (!row.reportId && action === "none")}
          >
            {busy ? "正在保存…" : "确认处理"}
          </Button>
        </div>
      </form>
      <details>
        <summary className="cursor-pointer text-sm">审计记录</summary>
        <ol className="my-2 grid gap-3 text-xs">
          {detail.audit.map((entry) => (
            <li key={entry.id}>
              <strong>
                {entry.actor} · {entry.event}
              </strong>
              <p>
                <Timestamp value={entry.createdAt} />
              </p>
              <pre className="whitespace-pre-wrap break-words">
                {entry.detail}
              </pre>
            </li>
          ))}
        </ol>
      </details>
    </ForumModal>
  );
}
