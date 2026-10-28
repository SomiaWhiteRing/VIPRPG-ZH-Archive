import { useState } from "react";
import { useLoaderData, type LoaderFunctionArgs, type MetaFunction } from "react-router";
import { requireAnyPagePermission } from "@/app/.server/auth/authorize";
import { runtimeContext } from "@/app/.server/router-context";
import { seaRoom } from "@/app/.server/sea/service";
import { hasPermission } from "@/lib/authz/permissions";
import { SEA_ROOM_LIMIT, type SeaModeration } from "@/lib/dto/sea";
import { pageMetaDescriptors } from "@/lib/ui/page-metadata";
import { Button } from "@/app/components/ui/button";
import { PageHeader } from "@/app/components/ui/page-header";
import { TableWrap } from "@/app/components/ui/table-wrap";
import { EmptyState } from "@/app/components/ui/empty-state";
import { UserAvatar } from "@/app/components/ui/user-avatar";
import { PaginationLinks } from "@/app/components/library/pagination-links";
import { AdminListMeta } from "@/app/admin/admin-list-controls";
import { useToast } from "@/app/components/ui/toast";
import { requestJson } from "@/lib/ui/api-response";

export async function loader({ context }: LoaderFunctionArgs) {
  const runtime = context.get(runtimeContext);
  const user = await requireAnyPagePermission(runtime, "/admin/sea", ["sea.message.moderate_any", "sea.user.mute_any"]);
  return {
    initial: await seaRoom(runtime).moderation(),
    canHide: hasPermission(user, "sea.message.moderate_any"),
    canMute: hasPermission(user, "sea.user.mute_any"),
  };
}
export const meta: MetaFunction = ({ error }) => pageMetaDescriptors({ title: ["永恒之海", "控制台"] }, error);

export default function SeaModerationPage() {
  const { initial, canHide, canMute } = useLoaderData<typeof loader>();
  const [view, setView] = useState<SeaModeration>(initial);
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  async function update(page = view.page, url?: string, method?: string, body?: unknown) {
    if (busy) return;
    setBusy(true);
    try {
      if (url) {
        await requestJson(url, { method, headers: body ? { "Content-Type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined }, "操作失败");
      }
      setView(await requestJson<SeaModeration>(`/api/sea/moderation?page=${page}`, { cache: "no-store" }, "无法读取聊天室"));
      if (url) toast.success("已更新");
    } catch (error) { toast.error(error instanceof Error ? error.message : "操作失败"); }
    finally { setBusy(false); }
  }
  return <main>
    <PageHeader compact title="永恒之海"
      actions={<Button size="sm" variant="outline" disabled={busy} onClick={() => void update()}>刷新</Button>} />
    <AdminListMeta total={view.total} noun="发言" />
    {view.window.messages.length ? <TableWrap compact label="发言历史" minWidth={640}
      className="text-sm [&_th]:px-3 [&_th]:py-2 [&_td]:px-3 [&_td]:py-2">
        <thead><tr><th>发言者</th><th>内容</th><th className="admin-action-column">操作</th></tr></thead>
        <tbody>{view.window.messages.map(message => <tr key={message.id}>
          <td className="w-52"><div className="flex items-center gap-2">
            <UserAvatar avatarBlobSha256={message.authorAvatarBlobSha256} displayName={message.authorName} size={28} />
            <div className="min-w-0">
              <span className="font-semibold">{message.authorName}{message.anonymous && <span className="whitespace-nowrap font-normal text-muted">（匿名）</span>}</span>
              <time dateTime={message.createdAt} className="block whitespace-nowrap text-xs text-muted">{new Date(message.createdAt).toLocaleString("zh-CN")}</time>
            </div>
          </div></td>
          <td className="whitespace-pre-wrap break-words">
            {message.hiddenAt !== null && <span className="mr-2 text-xs text-muted">已隐藏</span>}{message.body}
          </td>
          <td className="admin-action-column"><div className="flex items-center justify-end gap-1">
            {canHide && <Button size="sm" variant="outline" className="min-h-8 px-2 text-xs" disabled={busy || message.hiddenAt !== null} onClick={() => void update(view.page, `/api/sea/messages/${message.id}`, "DELETE")}>隐藏</Button>}
            {canMute && <Button size="sm" variant="outline" className="min-h-8 px-2 text-xs" disabled={busy} onClick={() => void update(view.page, "/api/sea/mutes", "PUT", { messageId: message.id, minutes: 30 })}>禁言 30 分钟</Button>}
          </div></td>
        </tr>)}</tbody>
      </TableWrap> : <EmptyState title="暂无发言。" />}
    <PaginationLinks className="my-3" page={view.page} pageSize={SEA_ROOM_LIMIT} total={view.total} disabled={busy} onPageChange={page => void update(page)} />
    {canMute && <section className="mt-4 rounded-lg border border-border bg-card px-3 py-2">
      <h2 className="mb-2 text-sm font-semibold">当前禁言</h2>
      <ul className="flex flex-wrap gap-x-4 gap-y-2">{view.mutes.map(mute => <li key={mute.messageId} className="flex flex-wrap items-center gap-2 text-sm">
        <span>{mute.name} · {new Date(mute.until).toLocaleString("zh-CN")}</span>
        <Button size="sm" variant="outline" className="min-h-8 px-2 text-xs" disabled={busy} onClick={() => void update(view.page, "/api/sea/mutes", "PUT", { messageId: mute.messageId, minutes: 0 })}>解除禁言</Button>
      </li>)}</ul>
      {!view.mutes.length ? <p className="text-sm text-muted">当前没有禁言。</p> : null}
    </section>}
  </main>;
}
