import { requestJson } from "@/lib/ui/api-response";

import { useRef, useState, type FormEvent } from "react";
import { data, Link, useLoaderData, useRevalidator, type LoaderFunctionArgs, type MetaFunction } from "react-router";
import { requireAccountUser } from "@/app/.server/auth/account-user";
import { readTimelineSettings } from "@/app/.server/db/timeline";
import { runtimeContext } from "@/app/.server/router-context";
import { AccountPageHeader } from "@/app/me/account-page-header";
import { Button } from "@/app/components/ui/button";
import { Checkbox } from "@/app/components/ui/checkbox";
import { Label } from "@/app/components/ui/label";
import { Notice } from "@/app/components/ui/notice";
import { SelectField } from "@/app/components/ui/select";
import { useConfirm } from "@/app/components/ui/confirm-provider";
import { useNavigationGuard } from "@/app/components/ui/use-navigation-guard";
import { useToast } from "@/app/components/ui/toast";
import { TIMELINE_RECORD_KINDS, TIMELINE_KIND_LABELS, isTimelineDefaultView, type TimelineRecordKind, type TimelineSettings } from "@/lib/dto/db/timeline";
import { hasPermission } from "@/lib/authz/permissions";
import { pageMetaDescriptors } from "@/lib/ui/page-metadata";

const descriptions: Record<TimelineRecordKind, string> = {
  favorite: "新增收藏作品",
  catalog: "创建新的目录",
  comment: "在作品、作者或角色页面发表评论",
  discussion: "在讨论版发布新的主题",
  upload: "成功上传作品",
  play: "初次启动某个作品",
};

export async function loader({ context }: LoaderFunctionArgs) {
  const runtime = context.get(runtimeContext);
  const user = await requireAccountUser(runtime, "/me/timeline");
  return data({ userId: user.id, showTimeline: user.profileVisibility.timeline, canRecord: hasPermission(user, "timeline.use"), settings: await readTimelineSettings(runtime, user.id) }, { headers: { "Cache-Control": "private, no-store" } });
}
export function headers() { return { "Cache-Control": "private, no-store" }; }
export const meta: MetaFunction = ({ error }) => pageMetaDescriptors({ title: ["时间线", "设置"] }, error);

export default function TimelineSettingsPage() {
  const { userId, showTimeline, settings, canRecord } = useLoaderData<typeof loader>();
  return <TimelineSettingsForm key={userId} userId={userId} showTimeline={showTimeline} initial={settings} canRecord={canRecord} />;
}

function TimelineSettingsForm({ userId, showTimeline, initial, canRecord }: { userId: number; showTimeline: boolean; initial: TimelineSettings; canRecord: boolean }) {
  const [saved, setSaved] = useState(initial);
  const [enabled, setEnabled] = useState(initial.enabled);
  const [timelineAsHomepage, setTimelineAsHomepage] = useState(initial.timelineAsHomepage);
  const [defaultView, setDefaultView] = useState(initial.defaultView);
  const [kinds, setKinds] = useState(new Set(initial.recordKinds));
  const [busy, setBusy] = useState(false);
  const [recovery, setRecovery] = useState(false);
  const submitting = useRef(false);
  const toast = useToast();
  const confirm = useConfirm();
  const revalidator = useRevalidator();
  const recordKinds = TIMELINE_RECORD_KINDS.filter((kind) => kinds.has(kind));
  const dirty = enabled !== saved.enabled || timelineAsHomepage !== saved.timelineAsHomepage || defaultView !== saved.defaultView || TIMELINE_RECORD_KINDS.some((kind) => kinds.has(kind) !== saved.recordKinds.includes(kind));
  useNavigationGuard(dirty || busy, () => !busy && confirm("时间线设置尚未保存，确定放弃修改并离开？", { confirmLabel: "放弃修改" }));

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting.current) return;
    submitting.current = true;
    setBusy(true);
    setRecovery(false);
    try {

      const result = await requestJson("/api/account/timeline", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ enabled, recordKinds, timelineAsHomepage, defaultView }) }) as { settings?: TimelineSettings; detail?: string; error?: string };

      const next = result.settings ?? { enabled, recordKinds, timelineAsHomepage, defaultView };
      setSaved(next);
      setEnabled(next.enabled);
      setTimelineAsHomepage(next.timelineAsHomepage);
      setDefaultView(next.defaultView);
      setKinds(new Set(next.recordKinds));
      toast.success("时间线设置已保存。");
      await revalidator.revalidate();
    } catch (error) {
      setRecovery(true);
      toast.error(error instanceof Error ? error.message : "设置保存失败，请重试。");
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }

  return <div>
    <AccountPageHeader title="时间线" actions={enabled && showTimeline && <Button asChild size="sm" variant="outline"><Link to={`/users/${userId}/timeline`}>查看我的时间线</Link></Button>} />
    <form onSubmit={(event) => void submit(event)} aria-busy={busy} className="mt-5 grid gap-6">
      {!canRecord && <Notice tone="warning">当前账号没有开启与记录时间线的权限，新的操作不会记录。已有历史保持原来的可见性；你仍可关闭时间线。</Notice>}
      <section aria-labelledby="timeline-switch-heading" className="rounded-lg border border-border bg-card p-4 sm:p-5">
        <div className="flex min-h-10 items-center gap-3">
          <Checkbox id="timeline-enabled" checked={enabled} onCheckedChange={(value) => setEnabled(value === true)} disabled={busy || (!canRecord && !enabled)} aria-describedby="timeline-enabled-help" />
          <Label id="timeline-switch-heading" htmlFor="timeline-enabled" className="cursor-pointer text-base font-semibold">开启时间线</Label>
        </div>
        <p id="timeline-enabled-help" className="mb-0 mt-2 text-sm leading-relaxed text-muted">关闭后，将不会再记录新动态。</p>
        {enabled && <div className="mt-4 border-t border-border pt-3">
          <div className="flex min-h-10 items-center gap-3">
            <Checkbox id="timeline-as-homepage" checked={timelineAsHomepage} onCheckedChange={(value) => setTimelineAsHomepage(value === true)} disabled={busy} aria-describedby="timeline-as-homepage-help" />
            <Label htmlFor="timeline-as-homepage" className="cursor-pointer font-semibold">将时间线设为首页</Label>
          </div>
          <div className="mt-4 grid gap-2 sm:max-w-xs">
            <Label htmlFor="timeline-default-view" className="font-semibold">默认显示</Label>
            <SelectField id="timeline-default-view" value={defaultView} disabled={busy} options={[{ value: "following", label: "好友时间线" }, { value: "all", label: "全站时间线" }]} onValueChange={(value) => { if (isTimelineDefaultView(value)) setDefaultView(value); }} aria-describedby="timeline-default-view-help" />
          </div>
        </div>}
      </section>
      {enabled && <fieldset disabled={busy} className="min-w-0">
        <legend className="text-base font-semibold">记录哪些操作</legend>
        <div className="divide-y divide-border border-y border-border">
          {TIMELINE_RECORD_KINDS.map((kind) => <div key={kind} className="flex items-start gap-3 py-3">
            <Checkbox className="mt-1" id={`timeline-kind-${kind}`} checked={kinds.has(kind)} onCheckedChange={(value) => setKinds((current) => { const next = new Set(current); if (value === true) next.add(kind); else next.delete(kind); return next; })} aria-describedby={`timeline-kind-${kind}-help`} />
            <div className="min-w-0"><Label htmlFor={`timeline-kind-${kind}`} className="cursor-pointer font-semibold">{TIMELINE_KIND_LABELS[kind]}</Label><p id={`timeline-kind-${kind}-help`} className="mb-0 mt-1 text-sm text-muted">{descriptions[kind]}</p></div>
          </div>)}
        </div>
      </fieldset>}
      <Button type="submit" className="justify-self-start" disabled={busy || !dirty}>{busy ? "正在保存…" : "保存设置"}</Button>
      {recovery && <p role="status" className="m-0 text-sm text-muted">选择已保留，请重试。如果登录失效，请<Link to="/login?next=%2Fme%2Ftimeline" target="_blank" rel="noopener noreferrer" className="text-primary underline">在新标签页登录</Link>后回来保存。</p>}
    </form>
  </div>;
}

export { TimelineError as ErrorBoundary } from "@/app/components/timeline/timeline-error";
