import type { MessageKey } from "@/lib/i18n/core";
import { LocaleLink as Link } from "@/app/components/ui/locale-link";
import { UI_LOCALE_PARAM } from "@/lib/i18n/locale";
import { useMessages, useNavigationLocale } from "@/lib/i18n/react";
import { AdminListMeta } from "@/app/admin/admin-list-controls";
import { TableWrap } from "@/app/components/ui/table-wrap";
import { useToast } from "@/app/components/ui/toast";
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
import { type ForumPage, type ForumViewer, forumHref } from "@/lib/forum";

import { useState } from "react";
import { useRevalidator } from "react-router";
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
  const t = useMessages();
  const navigationLocale = useNavigationLocale();
  const toast = useToast();
  const [selected, setSelected] = useState<{
      row: ForumAdminRow;
      detail: ForumAdminDetail;
    } | null>(null),
    [busy, setBusy] = useState(false);

  const revalidator = useRevalidator();
  async function open(row: ForumAdminRow) {
    setBusy(true);
    try {
      const result = await forumRequest<{ detail: ForumAdminDetail }>(
        forumHref("/api/admin/discussions", {
          [UI_LOCALE_PARAM]: navigationLocale,
          op: "detail",
          kind: row.kind,
          id: row.id,
        }),
      );
      setSelected({ row, detail: result.detail });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("admin.discussions.readFailed"));
    } finally {
      setBusy(false);
    }
  }
  return (
    <main>
      <PageHeader compact title={t("admin.discussions.title")} />
      <nav className="admin-tabs" aria-label={t("admin.discussions.views")}>
        {(viewer.moderate
          ? [
              ["reports", t("admin.discussions.reports")],
              ["topics", t("admin.discussions.topics")],
              ["posts", t("admin.discussions.posts")],
            ]
          : [["topics", t("admin.discussions.topics")]]
        ).map(([value, label]) => (
          <Link
            key={value}
            aria-current={view === value ? "page" : undefined}
            to={forumHref("/admin/discussions", { view: value })}
          >
            {label}
          </Link>
        ))}
        {viewer.moderate ? (
          <Link to="/admin/discussions/images" className="text-primary">
            {t("admin.discussions.images")}
          </Link>
        ) : null}
      </nav>
      <form
        className="admin-filter-row"
        action="/admin/discussions"
      >
        {navigationLocale ? <input type="hidden" name={UI_LOCALE_PARAM} value={navigationLocale} /> : null}
        <input type="hidden" name="view" value={view} />
        <div className="admin-field admin-field-search">
          <Label htmlFor="admin-forum-query">{t("admin.discussions.query")}</Label>
          <Input id="admin-forum-query" name="q" defaultValue={query} />
        </div>
        <div className="admin-field">
          <Label htmlFor="admin-forum-state">{t("admin.discussions.state")}</Label>
          <SelectField
            id="admin-forum-state"
            name="state"
            defaultValue={state}
            options={[
              { value: "", label: t("admin.discussionTags.all") },
              { value: "published", label: t("admin.discussions.public") },
              { value: "hidden", label: t("admin.discussionTags.hidden") },
              { value: "deleted", label: t("admin.discussions.deleted") },
            ]}
          />
        </div>
        <Button type="submit">{t("admin.list.search")}</Button>
      </form>
      <AdminListMeta total={data.total} noun={t("admin.discussions.record")} pageSize={data.pageSize} />
      {data.items.length ? <TableWrap compact label={t("admin.discussions.records")} minWidth={0}>
          <thead>
            <tr className="border-b border-border">
              <th>{t("admin.discussions.target")}</th>
              <th className="hidden md:table-cell">{t("admin.discussions.authorReporter")}</th>
              <th className="hidden md:table-cell">{t("admin.discussions.stateReason")}</th>
              <th className="hidden md:table-cell">{t("admin.discussions.time")}</th>
              <th className="admin-action-column">{t("admin.characterList.actions")}</th>
            </tr>
          </thead>
          <tbody>
            {data.items.map((row) => (
              <tr
                className="border-b border-border"
                key={`${row.kind}-${row.reportId ?? row.id}`}
              >
                <td className="max-w-96">
                  <strong className="admin-cell-title wrap-anywhere">
                    {row.title || t("admin.discussions.topicDeleted")}
                  </strong>
                  <p className="text-xs text-muted">
                    {row.kind === "message" ? t("admin.discussions.message") : row.kind === "topic"
                      ? t("admin.discussions.topic")
                      : `#${row.postNumber} ${t(row.kind === "comment" ? "admin.discussions.comment" : "admin.discussions.post")}`}{" "}
                    · {row.id}
                  </p>
                  {row.tags ? <p className="text-xs">{row.tags}</p> : null}
                  {row.replies !== undefined ? (
                    <p className="text-xs">
                      {t("admin.discussions.replies", { count: row.replies })}
                      {row.locked ? ` · ${t("admin.discussions.locked")}` : ""}
                      {row.featured ? ` · ${t("admin.discussions.featured")}` : ""}
                    </p>
                  ) : null}
                  <p className="line-clamp-2 whitespace-pre-wrap wrap-anywhere text-xs text-muted">
                    {row.body}
                  </p>
                  <p className="mt-2 text-xs md:hidden">
                    {row.reason ?? t(Object.hasOwn(contentStateKeys, row.state) ? contentStateKeys[row.state] : "admin.discussions.unavailable")}
                  </p>
                </td>
                <td className="hidden md:table-cell">
                  {row.author}
                  {row.reporter ? (
                    <p className="text-xs">{t("admin.discussions.reporter", { name: row.reporter ?? "" })}</p>
                  ) : null}
                </td>
                <td className="hidden md:table-cell">
                  {row.reason ?? (Object.hasOwn(contentStateKeys, row.state) ? t(contentStateKeys[row.state]) : row.state)}
                  {row.explanation ? (
                    <p className="line-clamp-2 max-w-52 whitespace-pre-wrap wrap-anywhere text-xs">
                      {row.explanation}
                    </p>
                  ) : null}
                </td>
                <td className="hidden md:table-cell">
                  <Timestamp value={row.createdAt} />
                </td>
                <td className="admin-action-column">
                  {row.kind === "message" ? <Button asChild variant="ghost" size="sm"><Link to={`/admin/discussions/messages/${row.id}`}>{t("admin.discussions.view")}</Link></Button> : <Button
                    variant="ghost"
                    size="sm"
                    disabled={busy}
                    onClick={() => void open(row)}
                    type="button"
                  >
                    {t("admin.discussions.view")}
                  </Button>}
                </td>
              </tr>
            ))}
          </tbody>
        </TableWrap> : <EmptyState title={t("admin.discussions.empty")} />}
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
const contentStateKeys: Readonly<Record<string, MessageKey>> = {
  published: "admin.discussions.public",
  hidden: "admin.discussionTags.hidden",
  deleted: "admin.discussions.deleted",
};
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
  const t = useMessages();
  const navigationLocale = useNavigationLocale();
  const toast = useToast();
  const [action, setAction] = useState("none"),
    [resolution, setResolution] = useState("resolved"),
    [reason, setReason] = useState(""),
    [tags, setTags] = useState(detail.tags),
    [busy, setBusy] = useState(false);
  const options = [
    { value: "none", label: row.reportId ? t("admin.discussions.resolveOnly") : t("admin.discussions.choose") },
    ...(viewer.moderate && detail.state !== "deleted"
      ? [
          {
            value: detail.state === "hidden" ? "restore" : "hide",
            label: t(detail.state === "hidden" ? "admin.discussions.restore" : "admin.discussionTags.hide"),
          },
        ]
      : []),
    ...(viewer.moderate &&
    detail.target.kind === "topic" &&
    detail.state !== "deleted"
      ? [
          {
            value: detail.locked ? "unlock" : "lock",
            label: detail.locked ? t("admin.discussions.unlock") : t("admin.discussions.lock"),
          },
        ]
      : []),
    ...(viewer.moderate && detail.target.kind === "topic" && detail.publicHref
      ? [{ value: detail.pinned ? "unpin" : "pin", label: detail.pinned ? t("admin.discussions.unpin") : t("admin.discussions.pin") }]
      : []),
    ...(viewer.sage && detail.target.kind === "topic" && detail.publicHref
      ? [{ value: detail.saged ? "unsage" : "sage", label: detail.saged ? t("admin.discussions.unsage") : "SAGE" }]
      : []),
    ...(viewer.feature && detail.target.kind === "topic" && detail.publicHref
      ? [
          {
            value: detail.featured ? "unfeature" : "feature",
            label: detail.featured ? t("admin.discussions.unfeature") : t("admin.discussions.feature"),
          },
          { value: "tags", label: t("admin.discussions.tags") },
        ]
      : []),
  ];
  async function submit() {
    setBusy(true);
    try {
      await forumRequest(forumHref("/api/admin/discussions", { [UI_LOCALE_PARAM]: navigationLocale }), {
        op: "moderate",
        target: detail.target,
        topicRevision: detail.topicRevision,
        action,
        reason,
        tags,
        reportId: row.reportId,
        resolution,
      });
      toast.success(t("admin.discussions.saved"));
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
      title={detail.title || t("admin.discussions.topicDeleted")}
    >
      {row.reportId && viewer.moderate ? (
        <section
          aria-label={t("admin.discussions.report")}
          className="my-3 border-b border-border pb-3 text-sm"
        >
          <h3 className="mb-2 font-bold">{t("admin.discussions.report")}</h3>
          <p className="wrap-anywhere">{t("admin.discussions.reporter", { name: row.reporter ?? "" })}</p>
          <p className="text-xs text-muted">
            <Timestamp value={row.createdAt} />
          </p>
          <p className="mt-2">{t("admin.discussions.reason", { reason: row.reason ?? "" })}</p>
          <p className="mt-1 whitespace-pre-wrap wrap-anywhere">
            {row.explanation || t("admin.discussions.noExplanation")}
          </p>
        </section>
      ) : null}
      <h3 className="mb-2 text-sm font-bold">{t("admin.discussions.current")}</h3>
      <p className="text-xs text-muted">
        {t(`admin.discussions.${detail.target.kind}`)}{" "}
        · {detail.target.id} · {t(Object.hasOwn(contentStateKeys, detail.state) ? contentStateKeys[detail.state] : "admin.discussions.unavailable")}
      </p>
      <p className="mt-1 wrap-anywhere text-sm">{t("admin.discussions.author", { name: row.author ?? "" })}</p>
      {!row.reportId ? (
        <p className="mt-1 text-xs text-muted">
          {t(row.kind === "topic" ? "admin.discussionTags.updated" : "admin.discussions.publishedAt")}
          <Timestamp value={row.createdAt} />
        </p>
      ) : null}
      <div className="my-3 max-h-64 overflow-y-auto whitespace-pre-wrap wrap-anywhere">
        <ForumImages
          diceKey={detail.target.kind === "comment" ? undefined : `${row.topicId}/${row.postNumber}`}
          body={detail.body || (detail.images.length ? "" : t("admin.discussions.bodyDeleted"))}
          images={detail.images}
        />
      </div>
      <p className="my-3 max-h-32 overflow-y-auto whitespace-pre-wrap wrap-anywhere text-sm text-muted">
        {detail.context}
      </p>
      {detail.publicHref ? (
        <Link
          className="text-primary underline"
          to={detail.publicHref}
          target="_blank"
          rel="noopener noreferrer"
        >
          {t("admin.discussions.openPublic")}
        </Link>
      ) : (
        <p className="text-sm">{t("admin.discussions.noPublic")}</p>
      )}
      <form
        className="my-4 grid gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <div>
          <Label htmlFor="admin-forum-action">{t("admin.discussions.action")}</Label>
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
            <Label htmlFor="admin-forum-resolution">{t("admin.discussions.resolution")}</Label>
            <SelectField
              id="admin-forum-resolution"
              value={resolution}
              onValueChange={setResolution}
              options={[
                { value: "resolved", label: t("admin.discussions.resolved") },
                { value: "dismissed", label: t("admin.discussions.dismissed") },
              ]}
              disabled={busy}
            />
          </div>
        ) : null}
        <div>
          <Label htmlFor="admin-forum-reason">{t("admin.discussionTags.reason")}</Label>
          <Textarea
            id="admin-forum-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            required
            maxLength={1000}
            disabled={busy}
          />
        </div>
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
            variant={action === "hide" ? "destructive" : "default"}
            disabled={busy || (!row.reportId && action === "none")}
          >
            {busy ? t("admin.discussionTags.saving") : t("admin.discussions.confirm")}
          </Button>
        </div>
      </form>
      <details>
        <summary className="cursor-pointer text-sm">{t("admin.discussions.audit")}</summary>
        <ol className="my-2 grid gap-3 text-xs">
          {detail.audit.map((entry) => (
            <li key={entry.id}>
              <strong>
                {entry.actor} · {entry.event}
              </strong>
              <p>
                <Timestamp value={entry.createdAt} />
              </p>
              <pre className="whitespace-pre-wrap wrap-anywhere">
                {entry.detail}
              </pre>
            </li>
          ))}
        </ol>
      </details>
    </ForumModal>
  );
}
