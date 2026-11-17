import { UI_LOCALE_PARAM } from "@/lib/i18n/locale";
import { useMessages, useNavigationLocale } from "@/lib/i18n/react";

import { AdminListMeta } from "@/app/admin/admin-list-controls";
import { TableWrap } from "@/app/components/ui/table-wrap";
import { Timestamp } from "@/app/components/ui/timestamp";
import { PaginationLinks } from "@/app/components/library/pagination-links";
import { useToast } from "@/app/components/ui/toast";
import { Button } from "@/app/components/ui/button";
import { EmptyState } from "@/app/components/ui/empty-state";
import { Input } from "@/app/components/ui/input";
import { Label } from "@/app/components/ui/label";
import { PageHeader } from "@/app/components/ui/page-header";
import { SelectField } from "@/app/components/ui/select";
import { Textarea } from "@/app/components/ui/textarea";
import { ForumModal, forumRequest } from "@/app/discussions/shared";
import type { AdminForumTag } from "@/lib/dto/forum/admin";
import { type ForumPage, forumHref } from "@/lib/forum";

import { useEffect, useState } from "react";
import { useRevalidator } from "react-router";

const tagStateKeys = {
  active: "admin.discussionTags.active",
  disabled: "admin.discussionTags.disabled",
  hidden: "admin.discussionTags.hidden",
} as const;

export function AdminDiscussionTags({
  data,
  query,
  state,
}: {
  data: ForumPage<AdminForumTag>;
  query: string;
  state: string;
}) {
  const t = useMessages();
  const navigationLocale = useNavigationLocale();
  const [selected, setSelected] = useState<AdminForumTag | null>(null),
    revalidator = useRevalidator();
  return (
    <main>
      <PageHeader compact title={t("admin.discussionTags.title")} />
      <form
        action="/admin/discussion-tags"
        className="admin-filter-row"
      >
        {navigationLocale ? <input type="hidden" name={UI_LOCALE_PARAM} value={navigationLocale} /> : null}
        <div className="admin-field admin-field-search">
          <Label htmlFor="tag-admin-query">{t("admin.discussionTags.query")}</Label>
          <Input id="tag-admin-query" name="q" defaultValue={query} />
        </div>
        <div className="admin-field">
          <Label htmlFor="tag-admin-state">{t("admin.list.status")}</Label>
          <SelectField
            id="tag-admin-state"
            name="state"
            defaultValue={state}
            options={[
              { value: "", label: t("admin.discussionTags.all") },
              { value: "active", label: t("admin.discussionTags.active") },
              { value: "disabled", label: t("admin.discussionTags.disabled") },
              { value: "hidden", label: t("admin.discussionTags.hidden") },
            ]}
          />
        </div>
        <Button type="submit">{t("admin.list.search")}</Button>
      </form>
      <AdminListMeta total={data.total} noun="TAG" pageSize={data.pageSize} />
      {data.items.length ? <TableWrap compact label={t("admin.discussionTags.title")} minWidth={0}>
          <thead>
            <tr>
              <th>{t("admin.discussionTags.idName")}</th>
              <th className="hidden md:table-cell">{t("admin.discussionTags.topics")}</th>
              <th className="hidden md:table-cell">{t("admin.list.status")}</th>
              <th className="hidden md:table-cell">{t("admin.discussionTags.creator")}</th>
              <th className="hidden md:table-cell">{t("admin.characterList.updated")}</th>
              <th className="admin-action-column">{t("admin.characterList.actions")}</th>
            </tr>
          </thead>
          <tbody>
            {data.items.map((tag) => (
              <tr className="border-t border-border" key={tag.id}>
                <td className="wrap-anywhere">
                  <strong className="admin-cell-title">{tag.name}</strong>
                  <span className="admin-cell-meta font-mono">#{tag.id}</span>
                  <p className="mt-1 text-xs text-muted md:hidden">
                    {
                      t(tagStateKeys[tag.state])
                    }{" "}
                    · {t("admin.discussionTags.count", { count: tag.count })}
                  </p>
                </td>
                <td className="hidden font-mono md:table-cell">
                  {tag.count}
                </td>
                <td className="hidden md:table-cell">
                  {
                    t(tagStateKeys[tag.state])
                  }
                </td>
                <td className="hidden md:table-cell">{tag.creator}</td>
                <td className="hidden md:table-cell">
                  <Timestamp value={tag.updatedAt} />
                </td>
                <td className="admin-action-column">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setSelected(tag)}
                  >
                    {t("admin.discussionTags.manage")}
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </TableWrap> : <EmptyState title={t("admin.discussionTags.empty")} />}
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
  const t = useMessages();
  const navigationLocale = useNavigationLocale();
  const toast = useToast();
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
        [UI_LOCALE_PARAM]: navigationLocale ?? undefined,
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
  }, [action, navigationLocale, query, tag.id]);
  async function submit() {
    const target = targets.find((t) => String(t.id) === targetId);
    setBusy(true);
    setError("");
    try {
      await forumRequest(forumHref("/api/admin/discussions", { [UI_LOCALE_PARAM]: navigationLocale ?? undefined }), {
        op: "tag",
        id: tag.id,
        revision: tag.revision,
        action,
        name,
        reason,
        targetId: target?.id,
        targetRevision: target?.revision,
      });
      toast.success(t("admin.discussionTags.saved"));
      onSaved();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("admin.discussionTags.failed"));
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
      title={t("admin.discussionTags.manageName", { name: tag.name })}
    >
      <form
        className="grid gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <p className="text-sm">
          ID {tag.id} · {t("admin.discussionTags.count", { count: tag.count })}
        </p>
        <p className="wrap-anywhere text-sm">{t("admin.discussionTags.creatorName", { name: tag.creator })}</p>
        <p className="text-xs text-muted">
          {t("admin.discussionTags.updated")}
          <Timestamp value={tag.updatedAt} />
        </p>
        <div>
          <Label htmlFor="tag-action">{t("admin.characterList.actions")}</Label>
          <SelectField
            id="tag-action"
            value={action}
            onValueChange={setAction}
            options={[
              { value: "rename", label: t("admin.discussionTags.rename") },
              { value: "merge", label: t("admin.discussionTags.merge") },
              { value: "disable", label: t("admin.discussionTags.disable") },
              { value: "hide", label: t("admin.discussionTags.hide") },
              { value: "restore", label: t("admin.discussionTags.restore") },
            ]}
            disabled={busy}
          />
        </div>
        {action === "rename" ? (
          <div>
            <Label htmlFor="tag-new-name">{t("admin.discussionTags.newName")}</Label>
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
              <Label htmlFor="tag-target-query">{t("admin.discussionTags.find")}</Label>
              <Input
                id="tag-target-query"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                disabled={busy}
              />
            </div>
            <div>
              <Label htmlFor="tag-target">{t("admin.discussionTags.target")}</Label>
              <SelectField
                id="tag-target"
                value={targetId}
                onValueChange={setTargetId}
                options={targets.map((target) => ({
                  value: String(target.id),
                  label: `${target.name} · ${t("admin.discussionTags.count", { count: target.count })}`,
                }))}
                required
                disabled={busy}
              />
            </div>
            <p className="text-sm text-muted">
              {t("admin.discussionTags.mergeNotice", { count: tag.affectedCount })}
            </p>
          </>
        ) : null}
        {action === "restore" ? (
          <p className="text-sm">{t("admin.discussionTags.restoreNotice")}</p>
        ) : null}
        <div>
          <Label htmlFor="tag-action-reason">{t("admin.discussionTags.reason")}</Label>
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
            {t("play.save.cancel")}
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
            {busy ? t("admin.discussionTags.saving") : t("admin.discussionTags.confirm")}
          </Button>
        </div>
      </form>
    </ForumModal>
  );
}
