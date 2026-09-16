import { PaginationLinks } from "@/app/components/library/pagination-links";
import { Button } from "@/app/components/ui/button";
import { EmptyState } from "@/app/components/ui/empty-state";
import { Input } from "@/app/components/ui/input";
import { Label } from "@/app/components/ui/label";
import { PageHeader } from "@/app/components/ui/page-header";
import { SelectField } from "@/app/components/ui/select";
import { Textarea } from "@/app/components/ui/textarea";
import { ForumModal, ForumTime, forumRequest } from "@/app/discussions/shared";
import type { AdminForumTag } from "@/lib/dto/forum/admin";
import type { ForumPage } from "@/lib/forum";
import { forumHref } from "@/lib/forum";
import { useEffect, useState } from "react";
import { useRevalidator } from "react-router";
export function AdminDiscussionTags({
  data,
  query,
  state,
}: {
  data: ForumPage<AdminForumTag>;
  query: string;
  state: string;
}) {
  const [selected, setSelected] = useState<AdminForumTag | null>(null),
    revalidator = useRevalidator();
  return (
    <main>
      <PageHeader compact title="讨论 TAG" />
      <form
        action="/admin/discussion-tags"
        className="flex flex-wrap items-end gap-3"
      >
        <div className="flex-1">
          <Label htmlFor="tag-admin-query">名称或 ID</Label>
          <Input id="tag-admin-query" name="q" defaultValue={query} />
        </div>
        <div>
          <Label htmlFor="tag-admin-state">状态</Label>
          <SelectField
            id="tag-admin-state"
            name="state"
            defaultValue={state}
            options={[
              { value: "", label: "全部" },
              { value: "active", label: "启用" },
              { value: "disabled", label: "停用" },
              { value: "hidden", label: "隐藏" },
            ]}
          />
        </div>
        <Button type="submit">查询</Button>
      </form>
      <div className="overflow-x-auto rounded-md border border-border">
        <table className="w-full text-left text-sm">
          <thead>
            <tr>
              <th className="p-3">ID／名称</th>
              <th className="hidden p-3 md:table-cell">公开主题数</th>
              <th className="hidden p-3 md:table-cell">状态</th>
              <th className="hidden p-3 md:table-cell">创建者</th>
              <th className="hidden p-3 md:table-cell">更新时间</th>
              <th className="w-20 whitespace-nowrap p-3">操作</th>
            </tr>
          </thead>
          <tbody>
            {data.items.map((tag) => (
              <tr className="border-t border-border" key={tag.id}>
                <td className="break-words p-3">
                  {tag.id} · {tag.name}
                  <p className="mt-1 text-xs text-muted md:hidden">
                    {
                      { active: "启用", disabled: "停用", hidden: "隐藏" }[
                        tag.state
                      ]
                    }{" "}
                    · {tag.count} 个公开主题
                  </p>
                </td>
                <td className="hidden p-3 font-mono md:table-cell">
                  {tag.count}
                </td>
                <td className="hidden p-3 md:table-cell">
                  {
                    { active: "启用", disabled: "停用", hidden: "隐藏" }[
                      tag.state
                    ]
                  }
                </td>
                <td className="hidden p-3 md:table-cell">{tag.creator}</td>
                <td className="hidden p-3 md:table-cell">
                  <ForumTime value={tag.updatedAt} />
                </td>
                <td className="p-3">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setSelected(tag)}
                  >
                    管理
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!data.items.length ? (
          <EmptyState
            title="没有匹配的 TAG。"
            variant="plain"
            className="p-4"
          />
        ) : null}
      </div>
      <PaginationLinks
        basePath="/admin/discussion-tags"
        page={data.page}
        pageSize={data.pageSize}
        total={data.total}
        params={{ q: query, state }}
      />
      {selected ? (
        <ManageTag
          key={selected.id}
          tag={selected}
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
function ManageTag({
  tag,
  onClose,
  onSaved,
}: {
  tag: AdminForumTag;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [action, setAction] = useState("rename"),
    [name, setName] = useState(tag.name),
    [query, setQuery] = useState(""),
    [targets, setTargets] = useState<AdminForumTag[]>([]),
    [targetId, setTargetId] = useState(""),
    [reason, setReason] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  useEffect(() => {
    if (action !== "merge") return;
    const controller = new AbortController();
    void forumRequest<{ page: ForumPage<AdminForumTag> }>(
      forumHref("/api/admin/discussions", {
        op: "tags",
        state: "active",
        q: query,
      }),
      undefined,
      controller.signal,
    )
      .then((result) =>
        setTargets(result.page.items.filter((t) => t.id !== tag.id)),
      )
      .catch((e) => {
        if (e.name !== "AbortError") setError(e.message);
      });
    return () => controller.abort();
  }, [action, query, tag.id]);
  async function submit() {
    const target = targets.find((t) => String(t.id) === targetId);
    setBusy(true);
    setError("");
    try {
      await forumRequest("/api/admin/discussions", {
        op: "tag",
        id: tag.id,
        revision: tag.revision,
        action,
        name,
        reason,
        targetId: target?.id,
        targetRevision: target?.revision,
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
      title={`管理 TAG：${tag.name}`}
    >
      <form
        className="grid gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <p className="text-sm">
          ID {tag.id} · {tag.count} 个公开主题
        </p>
        <p className="break-words text-sm">创建者：{tag.creator}</p>
        <p className="text-xs text-muted">
          更新时间：
          <ForumTime value={tag.updatedAt} />
        </p>
        <div>
          <Label htmlFor="tag-action">操作</Label>
          <SelectField
            id="tag-action"
            value={action}
            onValueChange={setAction}
            options={[
              { value: "rename", label: "改名" },
              { value: "merge", label: "合并" },
              { value: "disable", label: "停用" },
              { value: "hide", label: "隐藏" },
              { value: "restore", label: "恢复启用" },
            ]}
            disabled={busy}
          />
        </div>
        {action === "rename" ? (
          <div>
            <Label htmlFor="tag-new-name">新名称</Label>
            <Input
              id="tag-new-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              disabled={busy}
            />
          </div>
        ) : null}
        {action === "merge" ? (
          <>
            <div>
              <Label htmlFor="tag-target-query">查找目标 TAG</Label>
              <Input
                id="tag-target-query"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                disabled={busy}
              />
            </div>
            <div>
              <Label htmlFor="tag-target">合并到</Label>
              <SelectField
                id="tag-target"
                value={targetId}
                onValueChange={setTargetId}
                options={targets.map((t) => ({
                  value: String(t.id),
                  label: `${t.name} · ${t.count} 个公开主题`,
                }))}
                required
                disabled={busy}
              />
            </div>
            <p className="text-sm text-muted">
              此次合并将影响 {tag.affectedCount}{" "}
              个主题。全部源关系将迁移到目标；重复关系保留目标原位置，其余保留源位置。源
              ID 删除，旧筛选链接失效。
            </p>
          </>
        ) : null}
        {action === "restore" ? (
          <p className="text-sm">恢复后将重新公开，并允许新主题选用。</p>
        ) : null}
        <div>
          <Label htmlFor="tag-action-reason">管理原因</Label>
          <Textarea
            id="tag-action-reason"
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
            disabled={busy || (action === "merge" && !targetId)}
            variant={
              action === "hide" || action === "merge"
                ? "destructive"
                : "default"
            }
          >
            {busy ? "正在保存…" : "确认"}
          </Button>
        </div>
      </form>
    </ForumModal>
  );
}
