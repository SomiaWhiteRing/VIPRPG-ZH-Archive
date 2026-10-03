import { useState } from "react";
import { useLoaderData, type LoaderFunctionArgs, type MetaFunction } from "react-router";
import { requireAnyPagePermission } from "@/app/.server/auth/authorize";
import { runtimeContext } from "@/app/.server/router-context";
import { seaRoom } from "@/app/.server/sea/service";
import { hasPermission } from "@/lib/authz/permissions";
import type { SeaModeration } from "@/lib/dto/sea";
import { pageMetaDescriptors } from "@/lib/ui/page-metadata";
import { Button } from "@/app/components/ui/button";
import { PageHeader } from "@/app/components/ui/page-header";
import { Table } from "@/app/components/ui/table";
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
  async function update(url?: string, method?: string, body?: unknown) {
    if (busy) return;
    setBusy(true);
    try {
      if (url) {
        await requestJson(url, { method, headers: body ? { "Content-Type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined }, "操作失败");
      }
      setView(await requestJson<SeaModeration>("/api/sea/moderation", { cache: "no-store" }, "无法读取聊天室"));
      if (url) toast.success("已更新");
    } catch (error) { toast.error(error instanceof Error ? error.message : "操作失败"); }
    finally { setBusy(false); }
  }
  return <main>
    <PageHeader compact title="永恒之海" subtitle="最近 100 条公开对话与当前禁言。" />
    <div><Button variant="outline" disabled={busy} onClick={() => void update()}>刷新</Button></div>
    <div className="overflow-x-auto">
      <Table>
        <thead><tr><th>发言者</th><th>内容</th><th>操作</th></tr></thead>
        <tbody>{view.window.messages.map(message => <tr key={message.id}>
          <td className="whitespace-nowrap">{message.name}</td>
          <td className="whitespace-pre-wrap break-words">{message.body}</td>
          <td><div className="flex gap-2 whitespace-nowrap">
            {canHide && <Button size="sm" variant="outline" disabled={busy} onClick={() => void update(`/api/sea/messages/${message.id}`, "DELETE")}>隐藏</Button>}
            {canMute && <Button size="sm" variant="outline" disabled={busy} onClick={() => void update("/api/sea/mutes", "PUT", { messageId: message.id, minutes: 30 })}>禁言 30 分钟</Button>}
          </div></td>
        </tr>)}</tbody>
      </Table>
    </div>
    {canMute && <section>
      <h2 className="text-lg font-semibold">当前禁言</h2>
      <ul className="grid gap-3">{view.mutes.map(mute => <li key={mute.messageId} className="flex flex-wrap items-center gap-3">
        <span>{mute.name} · {new Date(mute.until).toLocaleString("zh-CN")}</span>
        <Button size="sm" variant="outline" disabled={busy} onClick={() => void update("/api/sea/mutes", "PUT", { messageId: mute.messageId, minutes: 0 })}>解除禁言</Button>
      </li>)}</ul>
    </section>}
  </main>;
}
