import { data, Form, Link, redirect, useLoaderData, useNavigation, type ActionFunctionArgs, type LoaderFunctionArgs, type MetaFunction } from "react-router";
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
import { pageMetaDescriptors } from "@/lib/ui/page-metadata";

export async function loader(args: LoaderFunctionArgs) {
  const runtime = args.context.get(runtimeContext);
  const id = parsePageId(args.params.reportId ?? "");
  const user = await requireAccountUser(runtime, `/admin/discussions/messages/${id}`);
  const before = new URL(args.request.url).searchParams.get("before");
  try {
    return data(await listReportedDirectMessages(runtime, user, id, before === null ? undefined : parsePageId(before)), { headers: { "Cache-Control": "private, no-store" } });
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
  return redirect(`/admin/discussions/messages/${id}`);
}

export function headers() { return { "Cache-Control": "private, no-store" }; }
export const meta: MetaFunction = ({ error }) => pageMetaDescriptors({ title: ["私信举报", "控制台"] }, error);

export default function MessageReportPage() {
  const { report, messages, emojis, nextCursor } = useLoaderData<typeof loader>();
  const busy = useNavigation().state !== "idle";
  return <main>
    <PageHeader compact title="私信举报" actions={<Button asChild variant="outline"><Link to="/admin/discussions?view=reports">返回</Link></Button>} />
    <div className="space-y-2">
      <p>{report.reporterName} → {report.peerName}</p>
      <p>{report.reason}</p>
      {report.explanation ? <p className="whitespace-pre-wrap wrap-anywhere">{report.explanation}</p> : null}
      <Timestamp className="text-muted" value={report.createdAt} />
    </div>
    {nextCursor !== null ? <div className="text-center"><Button asChild variant="ghost" size="sm"><Link to={`?before=${nextCursor}`}>更早的短信</Link></Button></div> : null}
    <ol className="grid gap-4 rounded-lg border border-border bg-card p-4" aria-label="举报会话记录">
      {messages.map(message => <li key={message.id} className="min-w-0">
        <div className="mb-2 flex flex-wrap items-center gap-3 text-sm"><strong>{message.senderUserId === report.reporterId ? report.reporterName : report.peerName}</strong><Timestamp className="text-muted" value={message.createdAt} /></div>
        {message.image ? <a href={message.image.url} target="_blank" rel="noreferrer"><img src={message.image.url} width={message.image.width} height={message.image.height} alt="图片短信" loading="lazy" className="block h-auto max-h-72 w-auto max-w-full rounded-md object-contain" /></a>
          : <p className="whitespace-pre-wrap wrap-anywhere text-sm"><MessageText body={message.body} emojis={emojis} /></p>}
      </li>)}
    </ol>
    {report.status === "pending" ? <Form method="post" className="grid gap-3">
      <div><Label htmlFor="message-report-resolution">处理结果</Label><SelectField id="message-report-resolution" name="resolution" defaultValue="resolved" options={[{ value: "resolved", label: "已处理" }, { value: "dismissed", label: "无需处理" }]} disabled={busy} /></div>
      <div><Label htmlFor="message-report-note">原因／内部备注</Label><Textarea id="message-report-note" name="note" required maxLength={1000} disabled={busy} /></div>
      <div className="flex justify-end"><Button type="submit" disabled={busy}>确认处理</Button></div>
    </Form> : <div><p>{report.status === "resolved" ? "已处理" : "无需处理"}</p><p className="whitespace-pre-wrap wrap-anywhere">{report.note}</p></div>}
  </main>;
}
