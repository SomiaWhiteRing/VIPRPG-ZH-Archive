import { LocaleLink as Link } from "@/app/components/ui/locale-link";
import { translate } from "@/lib/i18n/core";
import { preserveUiLocale } from "@/lib/i18n/locale";
import { useMessages } from "@/lib/i18n/react";
import { data, Form, redirect, useLoaderData, useLocation, useNavigation, type ActionFunctionArgs, type LoaderFunctionArgs, type MetaFunction } from "react-router";
import { requireAccountUser } from "@/app/.server/auth/account-user";
import { requireUser } from "@/app/.server/auth/guards";
import { listReportedDirectMessages } from "@/app/.server/db/messages";
import { resolveDirectMessageReport } from "@/app/.server/db/message-reports";
import { parsePageId } from "@/app/.server/http/page-response";
import { runtimeContext } from "@/app/.server/router-context";
import { Button } from "@/app/components/ui/button";
import { Label } from "@/app/components/ui/label";
import { PageHeader } from "@/app/components/ui/page-header";
import { SelectField } from "@/app/components/ui/select";
import { Textarea } from "@/app/components/ui/textarea";
import { Timestamp } from "@/app/components/ui/timestamp";
import { MessageText } from "@/app/me/messages/thread";
import { HttpError } from "@/lib/http";
import { pageMetaDescriptors, pageMetadataLocale } from "@/lib/ui/page-metadata";

export async function loader(args: LoaderFunctionArgs) {
  const runtime = args.context.get(runtimeContext);
  const id = parsePageId(args.params.reportId ?? "");
  const user = await requireAccountUser(runtime, `/admin/discussions/messages/${id}`);
  const before = new URL(args.request.url).searchParams.get("before");
  try {
    return data({ ...await listReportedDirectMessages(runtime, user, id, before === null ? undefined : parsePageId(before)), locale: runtime.uiLocale }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    if (error instanceof HttpError) throw new Response(null, { status: error.status });
    throw error;
  }
}

export async function action(args: ActionFunctionArgs) {
  const runtime = args.context.get(runtimeContext);
  const auth = await requireUser(runtime, args.request);
  if ("response" in auth) throw auth.response;
  const id = parsePageId(args.params.reportId ?? "");
  const form = await args.request.formData();
  const status = form.get("resolution"), note = String(form.get("note") ?? "").trim();
  if ((status !== "resolved" && status !== "dismissed") || !note || note.length > 1000) throw new Response(null, { status: 400 });
  try { await resolveDirectMessageReport(runtime, auth.user, id, status, note); }
  catch (error) {
    if (error instanceof HttpError) throw new Response(null, { status: error.status });
    throw error;
  }
  const url = new URL(args.request.url);
  const target = preserveUiLocale(new URL(`/admin/discussions/messages/${id}`, url), url);
  return redirect(target.pathname + target.search);
}

export function headers() { return { "Cache-Control": "private, no-store" }; }
export const meta: MetaFunction<typeof loader> = ({ loaderData, error, location, matches }) => {
  const locale = loaderData?.locale ?? pageMetadataLocale(location.search, matches);
  return pageMetaDescriptors({ title: [translate(locale, "admin.discussions.messageTitle"), translate(locale, "admin.characterIndex.console")] }, error, locale);
};

export default function MessageReportPage() {
  const t = useMessages();
  const { report, messages, emojis, nextCursor } = useLoaderData<typeof loader>();
  const location = useLocation();
  const busy = useNavigation().state !== "idle";
  return <main>
    <PageHeader compact title={t("admin.discussions.messageTitle")} actions={<Button asChild variant="outline"><Link to="/admin/discussions?view=reports">{t("creator.edit.return")}</Link></Button>} />
    <div className="space-y-2">
      <p>{report.reporterName} → {report.peerName}</p>
      <p>{report.reason}</p>
      {report.explanation ? <p className="whitespace-pre-wrap wrap-anywhere">{report.explanation}</p> : null}
      <Timestamp className="text-muted" value={report.createdAt} />
    </div>
    {nextCursor !== null ? <div className="text-center"><Button asChild variant="ghost" size="sm"><Link to={`${location.pathname}?before=${nextCursor}`}>{t("admin.discussions.older")}</Link></Button></div> : null}
    <ol className="grid gap-4 rounded-lg border border-border bg-card p-4" aria-label={t("admin.discussions.thread")}>
      {messages.map(message => <li key={message.id} className="min-w-0">
        <div className="mb-2 flex flex-wrap items-center gap-3 text-sm"><strong>{message.senderUserId === report.reporterId ? report.reporterName : report.peerName}</strong><Timestamp className="text-muted" value={message.createdAt} /></div>
        {message.image ? <a href={message.image.url} target="_blank" rel="noreferrer"><img src={message.image.url} width={message.image.width} height={message.image.height} alt={t("admin.discussions.messageImage")} loading="lazy" className="block h-auto max-h-72 w-auto max-w-full rounded-md object-contain" /></a>
          : <p className="whitespace-pre-wrap wrap-anywhere text-sm"><MessageText body={message.body} emojis={emojis} /></p>}
      </li>)}
    </ol>
    {report.status === "pending" ? <Form method="post" action={location.pathname + location.search} className="grid gap-3">
      <div><Label htmlFor="message-report-resolution">{t("admin.discussions.resolution")}</Label><SelectField id="message-report-resolution" name="resolution" defaultValue="resolved" options={[{ value: "resolved", label: t("admin.discussions.resolved") }, { value: "dismissed", label: t("admin.discussions.dismissed") }]} disabled={busy} /></div>
      <div><Label htmlFor="message-report-note">{t("admin.discussionTags.reason")}</Label><Textarea id="message-report-note" name="note" required maxLength={1000} disabled={busy} /></div>
      <div className="flex justify-end"><Button type="submit" disabled={busy}>{t("admin.discussions.confirm")}</Button></div>
    </Form> : <div><p>{report.status === "resolved" ? t("admin.discussions.resolved") : t("admin.discussions.dismissed")}</p><p className="whitespace-pre-wrap wrap-anywhere">{report.note}</p></div>}
  </main>;
}
