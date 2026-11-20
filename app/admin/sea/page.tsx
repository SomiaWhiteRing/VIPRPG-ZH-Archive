import { translate } from "@/lib/i18n/core";
import { UI_LOCALE_PARAM } from "@/lib/i18n/locale";
import { useMessages, useUiLocale } from "@/lib/i18n/react";
import { useState } from "react";
import { useLoaderData, type LoaderFunctionArgs, type MetaFunction } from "react-router";
import { requireAnyPagePermission } from "@/app/.server/auth/authorize";
import { runtimeContext } from "@/app/.server/router-context";
import { seaRoom } from "@/app/.server/sea/service";
import { hasPermission } from "@/lib/authz/permissions";
import { SEA_ROOM_LIMIT, type SeaModeration, type SeaMuteScope } from "@/lib/dto/sea";
import { pageMetaDescriptors, pageMetadataLocale } from "@/lib/ui/page-metadata";
import { Button } from "@/app/components/ui/button";
import { PageHeader } from "@/app/components/ui/page-header";
import { TableWrap } from "@/app/components/ui/table-wrap";
import { EmptyState } from "@/app/components/ui/empty-state";
import { UserAvatar } from "@/app/components/ui/user-avatar";
import { PaginationLinks } from "@/app/components/library/pagination-links";
import { AdminListMeta } from "@/app/admin/admin-list-controls";
import { useToast } from "@/app/components/ui/toast";
import { ApiResponseError, requestJson } from "@/lib/ui/api-response";
import * as Dialog from "@/app/components/ui/dialog";
import { Input } from "@/app/components/ui/input";
import { Label } from "@/app/components/ui/label";
import { Textarea } from "@/app/components/ui/textarea";
import { Checkbox } from "@/app/components/ui/checkbox";

export async function loader({ context }: LoaderFunctionArgs) {
  const runtime = context.get(runtimeContext);
  const user = await requireAnyPagePermission(runtime, "/admin/sea", ["sea.message.moderate_any", "sea.user.mute_any"]);
  return {
    locale: runtime.uiLocale,
    initial: await seaRoom(runtime).moderation(),
    canHide: hasPermission(user, "sea.message.moderate_any"),
    canMute: hasPermission(user, "sea.user.mute_any"),
  };
}
export const meta: MetaFunction<typeof loader> = ({ loaderData, error, location, matches }) => {
  const locale = loaderData?.locale ?? pageMetadataLocale(location.search, matches);
  return pageMetaDescriptors({ title: [translate(locale, "sea.title"), translate(locale, "admin.characterIndex.console")] }, error, locale);
};

export default function SeaModerationPage() {
  const t = useMessages();
  const locale = useUiLocale();
  const { initial, canHide, canMute } = useLoaderData<typeof loader>();
  const [view, setView] = useState<SeaModeration>(initial);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<{
    messageId: number; name: string; scope: SeaMuteScope; date: string; permanent: boolean; reason: string;
  } | null>(null);
  const toast = useToast();
  function editMute(messageId: number, name: string, scope: SeaMuteScope, until = Date.now() + 30 * 60000, reason = "") {
    const date = new Date(until || Date.now() + 30 * 60000);
    setEditing({ messageId, name, scope, permanent: until === 0, reason,
      date: new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16) });
  }
  async function update(page = view.page, url?: string, method?: string, body?: unknown) {
    if (busy) return;
    setBusy(true);
    try {
      if (url) {
        await requestJson(`${url}?${UI_LOCALE_PARAM}=${locale}`, { method, headers: body ? { "Content-Type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined }, t("admin.sea.failed"));
      }
      setView(await requestJson<SeaModeration>(`/api/sea/moderation?page=${page}&${UI_LOCALE_PARAM}=${locale}`, { cache: "no-store" }, t("admin.sea.read")));
      if (url) toast.success(t("admin.sea.updated"));
      return true;
    } catch (error) { toast.error(error instanceof ApiResponseError ? error.messageFor(locale) : error instanceof Error ? error.message : t("admin.sea.failed")); }
    finally { setBusy(false); }
  }
  return <main>
    <PageHeader compact title={t("sea.title")}
      actions={<Button size="sm" variant="outline" disabled={busy} onClick={() => void update()}>{t("admin.sea.refresh")}</Button>} />
    <AdminListMeta total={view.total} noun={t("admin.sea.count")} />
    {view.window.messages.length ? <TableWrap compact label={t("admin.sea.history")} minWidth={640}
      className="text-sm [&_th]:px-3 [&_th]:py-2 [&_td]:px-3 [&_td]:py-2">
        <thead><tr><th>{t("admin.sea.speaker")}</th><th>{t("admin.sea.content")}</th><th className="admin-action-column">{t("admin.characterList.actions")}</th></tr></thead>
        <tbody>{view.window.messages.map(message => <tr key={message.id}>
          <td className="w-52"><div className="flex items-center gap-2">
            <UserAvatar avatarBlobSha256={message.authorAvatarBlobSha256} displayName={message.authorName} size={28} />
            <div className="min-w-0">
              <span className="font-semibold">{message.authorName}{message.anonymous && <span className="whitespace-nowrap font-normal text-muted">{t("admin.sea.anonymous")}</span>}</span>
              <time dateTime={message.createdAt} className="block whitespace-nowrap text-xs text-muted">{new Date(message.createdAt).toLocaleString(locale)}</time>
            </div>
          </div></td>
          <td className="whitespace-pre-wrap break-words">
            {message.hiddenAt !== null && <span className="mr-2 text-xs text-muted">{t("admin.sea.hidden")}</span>}{message.body}
          </td>
          <td className="admin-action-column"><div className="flex items-center justify-end gap-1">
            {canHide && <Button size="sm" variant="outline" className="min-h-8 px-2 text-xs" disabled={busy || message.hiddenAt !== null} onClick={() => void update(view.page, `/api/sea/messages/${message.id}`, "DELETE")}>{t("admin.discussionTags.hide")}</Button>}
            {canMute && <>
              <Button size="sm" variant="outline" className="min-h-8 px-2 text-xs" disabled={busy} onClick={() => editMute(message.id, message.authorName, "identity")}>{t("admin.sea.mute")}</Button>
              <Button size="sm" variant="outline" className="min-h-8 px-2 text-xs" disabled={busy || !message.canMuteIp} onClick={() => editMute(message.id, message.authorName, "ip")}>{t("admin.sea.ip")}</Button>
            </>}
          </div></td>
        </tr>)}</tbody>
      </TableWrap> : <EmptyState title={t("admin.sea.empty")} />}
    <PaginationLinks className="my-3" page={view.page} pageSize={SEA_ROOM_LIMIT} total={view.total} disabled={busy} onPageChange={page => void update(page)} />
    {canMute && <section className="mt-4 rounded-lg border border-border bg-card px-3 py-2">
      <h2 className="mb-2 text-sm font-semibold">{t("admin.sea.active")}</h2>
      <ul className="grid gap-3">{view.mutes.map(mute => <li key={`${mute.scope}:${mute.messageId}`} className="flex flex-wrap items-center gap-2 text-sm">
        <span>{mute.name} ({mute.scope === "ip" ? t("admin.sea.ip") : t("admin.sea.identity")})</span>
        <span>{mute.until === 0 ? t("admin.sea.permanent") : new Date(mute.until).toLocaleString(locale)}</span>
        <Button size="sm" variant="outline" className="min-h-8 px-2 text-xs" disabled={busy} onClick={() => editMute(mute.messageId, mute.name, mute.scope, mute.until, mute.reason)}>{t("admin.sea.edit")}</Button>
        <Button size="sm" variant="outline" className="min-h-8 px-2 text-xs" disabled={busy} onClick={() => void update(view.page, "/api/sea/mutes", "PUT", { messageId: mute.messageId, scope: mute.scope, minutes: 0 })}>{t("admin.sea.lift")}</Button>
        {mute.reason ? <p className="w-full whitespace-pre-wrap wrap-anywhere text-muted">{mute.reason}</p> : null}
      </li>)}</ul>
      {!view.mutes.length ? <p className="text-sm text-muted">{t("admin.sea.noMutes")}</p> : null}
    </section>}
    <Dialog.Root open={editing !== null} onOpenChange={open => { if (!open && !busy) setEditing(null); }}>
      <Dialog.Portal>
        <Dialog.Overlay />
        <Dialog.Content className="left-1/2 top-1/2 max-h-[90dvh] w-[min(28rem,calc(100%-2rem))] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-md p-5">
          <Dialog.Title>{t("admin.sea.edit")}</Dialog.Title>
          <Dialog.Description className="mt-1 flex flex-wrap gap-x-2 text-sm text-muted">
            <span>{editing?.name}</span>
            <span>{editing?.scope === "ip" ? t("admin.sea.ip") : t("admin.sea.identity")}</span>
          </Dialog.Description>
          {editing ? <form className="mt-4 grid gap-4" onSubmit={async event => {
            event.preventDefault();
            const minutes = editing.permanent ? null : Math.ceil((new Date(editing.date).getTime() - Date.now()) / 60000);
            if (minutes !== null && (!Number.isFinite(minutes) || minutes <= 0 || minutes > 5256000)) {
              toast.error(t("admin.sea.date"));
              return;
            }
            if (await update(view.page, "/api/sea/mutes", "PUT", { messageId: editing.messageId, scope: editing.scope, minutes, reason: editing.reason })) setEditing(null);
          }}>
            <div className="flex items-center gap-2"><Checkbox id="sea-mute-permanent" checked={editing.permanent} disabled={busy} onCheckedChange={checked => setEditing({ ...editing, permanent: checked === true })} /><Label htmlFor="sea-mute-permanent">{t("admin.sea.permanentMute")}</Label></div>
            <div><Label htmlFor="sea-mute-until">{t("admin.sea.until")}</Label><Input id="sea-mute-until" type="datetime-local" required disabled={busy || editing.permanent} value={editing.date} onChange={event => setEditing({ ...editing, date: event.target.value })} /></div>
            <div><Label htmlFor="sea-mute-reason">{t("admin.discussionTags.reason")}</Label><Textarea id="sea-mute-reason" maxLength={1000} disabled={busy} value={editing.reason} onChange={event => setEditing({ ...editing, reason: event.target.value })} /></div>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" disabled={busy} onClick={() => setEditing(null)}>{t("play.save.cancel")}</Button>
              <Button type="submit" disabled={busy}>{t("core.action.save")}</Button>
            </div>
          </form> : null}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  </main>;
}
