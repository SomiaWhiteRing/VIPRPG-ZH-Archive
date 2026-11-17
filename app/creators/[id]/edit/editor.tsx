import { UI_LOCALE_PARAM } from "@/lib/i18n/locale";
import { useMessages, useNavigationLocale, useUiLocale } from "@/lib/i18n/react";
import { ApiResponseError, requestJson } from "@/lib/ui/api-response";
import { CreatorLinksEditor } from "@/app/components/creators/creator-links-editor";
import { TokenPicker } from "@/app/components/pickers/token-picker";
import { normalizeEntityName } from "@/lib/entity-name";
import { AvatarCropper } from "@/app/components/ui/avatar-cropper";
import { BackLink } from "@/app/components/ui/back-link";
import { Button, buttonVariants } from "@/app/components/ui/button";
import * as Dialog from "@/app/components/ui/dialog";
import { FormField } from "@/app/components/ui/form-field";
import { Input } from "@/app/components/ui/input";
import { Notice } from "@/app/components/ui/notice";
import { Pane } from "@/app/components/ui/pane";
import { Textarea } from "@/app/components/ui/textarea";
import { useToast } from "@/app/components/ui/toast";
import { CREATOR_EDIT_LIMITS, creatorMetadataSnapshot, type CreatorMetadata } from "@/lib/creator-edit";
import { Save } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { LocaleLink as Link } from "@/app/components/ui/locale-link";
import { useNavigationGuard } from "@/app/components/ui/use-navigation-guard";

type EditableCreator = CreatorMetadata & { id: number; avatarBlobSha256: string | null };
type SaveResult = { ok: boolean; error?: string; detail?: string; code?: string };

export function CreatorEditor({ creator }: { creator: EditableCreator }) {
  const t = useMessages();
  const locale = useUiLocale();
  const [result, setResult] = useState<SaveResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [avatarBusy, setAvatarBusy] = useState(false);
  const [avatarChanged, setAvatarChanged] = useState(false);
  const saving = useRef(false);
  const toast = useToast();
  const [snapshot] = useState(() => creatorMetadataSnapshot(creator));
  const [name, setName] = useState(creator.name);
  const [aliases, setAliases] = useState(creator.aliases);
  const [aliasQuery, setAliasQuery] = useState("");
  const [links, setLinks] = useState(creator.links);
  const [bio, setBio] = useState(creator.bio ?? "");
  const redirected = useRef(false);
  const saved = result?.ok === true;
  const dirty = !saved && (avatarChanged || Boolean(aliasQuery.trim()) || snapshot !== creatorMetadataSnapshot({ name, aliases, links, bio: bio || null }));
  const [leaveOpen, setLeaveOpen] = useState(false);
  const leaveDecision = useRef<((leave: boolean) => void) | null>(null);
  const navigate = useNavigationGuard(dirty || busy, () => new Promise<boolean>((resolve) => {
    leaveDecision.current = resolve;
    setLeaveOpen(true);
  }));
  function finishLeave(leave: boolean) {
    setLeaveOpen(false);
    leaveDecision.current?.(leave);
    leaveDecision.current = null;
  }
  useEffect(() => () => leaveDecision.current?.(false), []);
  const navigationLocale = useNavigationLocale();
  const detailPath = `/creators/${creator.id}${navigationLocale ? `?${UI_LOCALE_PARAM}=${navigationLocale}` : ""}`;
  const failed = !busy && result && !result.ok;

  async function save(form: HTMLFormElement) {
    if (saving.current || avatarBusy) return;
    const pendingAlias = normalizeEntityName(aliasQuery);
    if (pendingAlias.length > CREATOR_EDIT_LIMITS.name) {
      setResult({ ok: false, detail: t("creator.edit.aliasLimit", { count: CREATOR_EDIT_LIMITS.name }) });
      document.getElementById("creator-aliases")?.focus();
      return;
    }
    const body = new FormData(form);
    aliases.forEach((alias) => body.append("alias", alias));
    if (pendingAlias) body.append("alias", pendingAlias);
    saving.current = true;
    setBusy(true);
    setResult(null);
    try {
      const data = await requestJson<SaveResult>(`/api/creators/${creator.id}/update`, {
        method: "POST", credentials: "same-origin", body,
      });
      setResult(data);
    } catch (error) {
      if (error instanceof ApiResponseError && error.status !== 0) {
        toast.error(error);
        const data = error.payload;
        setResult(data.code === "creator_edit_conflict" || error.status === 401
          ? {
              ...data,
              ok: false,
              error: error.status === 401 ? "Authentication required" : data.error,
              detail: error.status === 401 ? t("creator.edit.authExpired") : error.messageFor(locale),
            }
          : null);
      } else {
        toast.error(t("creator.edit.uncertain"));
      }
    } finally {
      saving.current = false;
      setBusy(false);
    }
  }

  useEffect(() => {
    if (!saved || busy || redirected.current) return;
    redirected.current = true;
    toast.success(t("creator.edit.saved"));
    void navigate(detailPath);
  }, [saved, busy, navigate, detailPath, toast, t]);

  return (
    <main className="mx-auto w-full max-w-3xl px-4 pb-10 pt-6">
      <BackLink className="min-h-9" href={detailPath} label={t("creator.edit.back")} variant="text" />
      <header className="mb-6 mt-2">
        <h1 className="font-serif text-3xl font-bold">{t("creator.edit.title")}</h1>
      </header>

      <form method="post" encType="multipart/form-data" action={`/api/creators/${creator.id}/update`} className="grid gap-5" aria-busy={busy} onSubmit={(event) => {
        event.preventDefault();
        void save(event.currentTarget);
      }}>
        <input name="snapshot" type="hidden" value={snapshot} />
        <input name="previousAvatar" type="hidden" value={creator.avatarBlobSha256 ?? "none"} />
        <Pane heading={t("creator.edit.avatar")}>
          <AvatarCropper allowDelete avatarBlobSha256={creator.avatarBlobSha256} displayName={name || creator.name}
            disabled={busy || saved} onChange={setAvatarChanged} onBusyChange={setAvatarBusy} shape="square" />
        </Pane>
        <fieldset disabled={busy || saved} className="min-w-0">
          <legend className="sr-only">{t("creator.details")}</legend>
          <Pane heading={t("creator.edit.basic")}>
            <div className="grid gap-5">
              <FormField controlId="creator-name" label={t("creator.edit.name")}>
                <Input id="creator-name" name="name" required maxLength={CREATOR_EDIT_LIMITS.name} value={name} onChange={(event) => setName(event.target.value)} autoComplete="off" />
              </FormField>

              <FormField controlId="creator-aliases" label={t("work.sidebar.aliases")}>
                <TokenPicker id="creator-aliases" label={t("work.sidebar.aliases")} placeholder={t("creator.edit.addAlias")}
                  values={aliases} onChange={setAliases} onQueryChange={setAliasQuery}
                  normalizeValue={normalizeEntityName} suggestions={[]} disabled={busy || saved}
                  showHelp={false} showSelectionCount={false} showRecommendations={false}
                  commitOnBlur validateValue={(value) => normalizeEntityName(value).length > CREATOR_EDIT_LIMITS.name ? t("creator.edit.aliasLimit", { count: CREATOR_EDIT_LIMITS.name }) : null} />
              </FormField>

              <CreatorLinksEditor initialLinks={creator.links} onChange={setLinks} disabled={busy || saved} />

              <FormField controlId="creator-bio" label={t("work.intro")}>
                <Textarea id="creator-bio" name="bio" rows={8} maxLength={CREATOR_EDIT_LIMITS.bio} value={bio} onChange={(event) => setBio(event.target.value)} />
              </FormField>
            </div>
          </Pane>
        </fieldset>

        {failed ? (
          <div className="grid gap-2">
            <Notice>{result?.detail || (result?.error === "Authentication required" ? t("creator.edit.authExpired") : result?.error === "Permission denied" ? t("creator.edit.denied") : t("creator.edit.failed"))}</Notice>
            {result?.code === "creator_edit_conflict" ? (
              <a className="text-sm text-primary underline" href={detailPath} target="_blank" rel="noreferrer">{t("creator.edit.openLatest")}</a>
            ) : null}
            {result?.error === "Authentication required" ? (
              <Link className="text-sm text-primary underline" to={`/login?next=${encodeURIComponent(detailPath)}`} target="_blank" rel="noreferrer">{t("creator.edit.signIn")}</Link>
            ) : null}
          </div>
        ) : null}

        <div className="sticky bottom-3 z-10 flex flex-wrap items-center justify-end gap-3 rounded-lg border border-border bg-card p-3 shadow-sm">
          <div className="flex gap-2">
            <Link className={buttonVariants({ variant: "outline" })} to={detailPath}>{t("creator.edit.return")}</Link>
            <Button type="submit" disabled={busy || avatarBusy || saved || !dirty}><Save aria-hidden />{busy ? t("forum.editor.saving") : t("profile.save")}</Button>
          </div>
        </div>
      </form>

      <Dialog.Root open={leaveOpen} onOpenChange={(open) => { if (!open) finishLeave(false); }}>
        <Dialog.Portal>
          <Dialog.Overlay />
          <Dialog.Content className="left-1/2 top-1/2 grid w-[min(92vw,420px)] -translate-x-1/2 -translate-y-1/2 gap-4 rounded-lg p-5">
            <Dialog.Title>{busy ? t("creator.edit.saving") : t("creator.edit.leave")}</Dialog.Title>
            <Dialog.Description className="text-sm text-muted">{busy ? t("creator.edit.wait") : t("creator.edit.lost")}</Dialog.Description>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => finishLeave(false)}>{t("creator.edit.keep")}</Button>
              {!busy ? <Button type="button" variant="destructive" onClick={() => finishLeave(true)}>{t("creator.edit.discard")}</Button> : null}
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </main>
  );
}
