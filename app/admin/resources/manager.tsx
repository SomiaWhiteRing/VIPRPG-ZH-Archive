import { UI_LOCALE_PARAM } from "@/lib/i18n/locale";
import { useMessages, useNavigationLocale, useUiLocale } from "@/lib/i18n/react";
import { useState, type FormEvent } from "react";
import { LocaleLink as Link } from "@/app/components/ui/locale-link";
import { PageHeader } from "@/app/components/ui/page-header";
import { Button } from "@/app/components/ui/button";
import { useToast } from "@/app/components/ui/toast";
import { Input } from "@/app/components/ui/input";
import { Label } from "@/app/components/ui/label";
import { SelectField } from "@/app/components/ui/select";
import { AdminListMeta } from "@/app/admin/admin-list-controls";
import { Badge } from "@/app/components/ui/badge";
import { EmptyState } from "@/app/components/ui/empty-state";
import { TableWrap } from "@/app/components/ui/table-wrap";
import type { ResourceRecord, ResourceEditorData } from "@/lib/resources";
import { postJson, requestJsonValue as requestJson } from "@/lib/ui/api-response";
export function ResourceManager({
  resources,
}: {
  resources: ResourceRecord[];
}) {
  const t = useMessages();
  const locale = useUiLocale();
  const navigationLocale = useNavigationLocale();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState<{
    issues: { key: string; issue: string }[];
    nextCursor: string | null;
    scanned: number;
    phase: string;
  } | null>(null);
  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    try {
      const data = await postJson<ResourceEditorData>(
        `/api/admin/resources?${UI_LOCALE_PARAM}=${locale}`,
        Object.fromEntries(form),
      );
      toast.success(t("admin.resources.created"));
      const target = new URL(`/admin/resources/${data.resource.id}`, window.location.origin);
      if (navigationLocale) target.searchParams.set(UI_LOCALE_PARAM, navigationLocale);
      window.location.assign(target.href);
    } catch (error) {
      toast.error(error instanceof Error ? error : String(error));
      setBusy(false);
    }
  }
  async function inspect(cursor?: string | null) {
    setBusy(true);
    try {
      setReport(
        await requestJson(
          `/api/admin/resources/storage?${new URLSearchParams({ [UI_LOCALE_PARAM]: locale, ...(cursor ? { cursor } : {}) })}`,
        ),
      );
    } catch (error) {
      toast.error(error instanceof Error ? error : String(error));
    } finally {
      setBusy(false);
    }
  }
  return (
    <main>
      <PageHeader compact title={t("admin.resources.title")} />
      <AdminListMeta total={resources.length} noun={t("core.nav.resources")} />
      {resources.length ? <TableWrap compact label={t("admin.resources.list")} minWidth={760}>
        <thead><tr><th>{t("creator.name")}</th><th>{t("admin.genres.genres")}</th><th>{t("admin.list.status")}</th><th>{t("admin.resources.order")}</th><th className="admin-action-column">{t("admin.characterList.actions")}</th></tr></thead>
        <tbody>{resources.map((resource) => <tr key={resource.id}>
          <td><Link className="admin-cell-title" to={`/admin/resources/${resource.id}`}>{resource.name}</Link>
            <span className="admin-cell-meta font-mono">{resource.slug}</span></td>
          <td>{resource.kind === "tool" ? t("admin.resources.tool") : t("admin.resources.website")}</td>
          <td><Badge variant={resource.visibility === "published" ? "positive" : resource.visibility === "hidden" ? "negative" : "pending"}>
            {t(resource.visibility === "published" ? "admin.discussions.public" : resource.visibility === "hidden" ? "admin.discussionTags.hidden" : "admin.resources.draft")}
          </Badge></td>
          <td className="tabular-nums">{resource.sort_order}</td>
          <td className="admin-action-column"><Button asChild variant="ghost" size="sm"><Link to={`/admin/resources/${resource.id}`}>{t("core.action.edit")}</Link></Button></td>
        </tr>)}</tbody>
      </TableWrap> : <EmptyState title={t("admin.resources.empty")} />}
      <details className="admin-panel admin-details">
      <summary>{t("admin.resources.add")}</summary>
      <form
        onSubmit={create}
        aria-busy={busy}
        className="mt-4 grid gap-4 sm:grid-cols-2"
      >
        <div className="admin-field">
        <Label htmlFor="resource-name">{t("creator.name")}</Label>
        <Input id="resource-name" name="name" maxLength={100} required />
        </div>
        <div className="admin-field">
        <Label htmlFor="resource-slug">{t("admin.resources.slug")}</Label>
        <Input
          id="resource-slug"
          name="slug"
          maxLength={80}
          pattern="[a-z0-9]+(-[a-z0-9]+)*"
          placeholder={t("admin.resources.example")}
          required
        />
        </div>
        <div className="admin-field">
        <Label htmlFor="resource-kind">{t("admin.genres.genres")}</Label>
        <SelectField
          id="resource-kind"
          name="kind"
          defaultValue="website"
          options={[
            { value: "website", label: t("admin.resources.external") },
            { value: "tool", label: t("admin.resources.tool") },
          ]}
        />
        </div>
        <div className="flex items-end"><Button disabled={busy}>
          {t("admin.resources.create")}
        </Button></div>
      </form>
      </details>
      <details className="admin-panel admin-details">
        <summary>{t("admin.resources.storage")}</summary>
        <div className="mt-4 grid gap-3">
        <Button
          variant="outline"
          className="justify-self-start"
          disabled={busy}
          onClick={() => void inspect()}
        >
          {t("admin.resources.start")}
        </Button>
        {report ? (
          <>
            <p className="text-sm">
              {t("admin.resources.report", { phase: report.phase, count: report.scanned })}
            </p>
            {report.issues.map((issue, i) => (
              <p key={i} className="break-all text-sm">
                {issue.key}：{issue.issue}
              </p>
            ))}
            {!report.issues.length ? (
              <p className="text-sm">{t("admin.resources.noIssues")}</p>
            ) : null}
            {report.nextCursor ? (
              <Button
                variant="outline"
                disabled={busy}
                onClick={() => void inspect(report.nextCursor)}
              >
                {t("admin.resources.next")}
              </Button>
            ) : null}
          </>
        ) : null}
        </div>
      </details>
    </main>
  );
}
