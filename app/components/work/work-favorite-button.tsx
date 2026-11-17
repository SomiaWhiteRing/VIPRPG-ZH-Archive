import { useMessages, useUiLocale } from "@/lib/i18n/react";
import { formatFeedbackError } from "@/lib/i18n/feedback";
import { LocaleLink as Link } from "@/app/components/ui/locale-link";
import { ApiResponseError, requestJson } from "@/lib/ui/api-response";

import { Button } from "@/app/components/ui/button";
import { useConfirm } from "@/app/components/ui/confirm-provider";
import * as Dialog from "@/app/components/ui/dialog";
import { FormField } from "@/app/components/ui/form-field";
import { Notice } from "@/app/components/ui/notice";
import { Textarea } from "@/app/components/ui/textarea";
import { TokenPicker } from "@/app/components/pickers/token-picker";
import { useToast } from "@/app/components/ui/toast";
import { normalizeEntityName } from "@/lib/entity-name";
import { MAX_FAVORITE_NOTE_LENGTH, MAX_USER_TAGS, parseFavoriteNote, parseUserTags, tagNameKey, validateUserTag, type WorkFavorite, type WorkFavoriteUpdate } from "@/lib/user-tags";
import { EllipsisVertical, Heart } from "lucide-react";
import { DropdownMenu } from "radix-ui";
import { useRef, useState } from "react";
import { useLocation } from "react-router";


type Props = {
  currentUserId: number | null;
  initialFavorited: boolean;
  workId: number;
  workTitle?: string;
  appearance?: "button" | "compact" | "manage" | "remove";
  summary?: "counts" | "tags";
  onSaved: (update: WorkFavoriteUpdate) => void | Promise<void>;
};

export function WorkFavoriteButton(props: Props) {
  return (
    <WorkFavoriteButtonContent
      key={`${props.workId}:${props.currentUserId}`}
      {...props}
    />
  );
}

function WorkFavoriteButtonContent({
  currentUserId,
  initialFavorited,
  workId,
  workTitle,
  appearance = "button",
  summary,
  onSaved,
}: Props) {
  const t = useMessages();
  const locale = useUiLocale();
  const [favoriteState, setFavoriteState] = useState({ source: initialFavorited, favorited: initialFavorited });
  if (favoriteState.source !== initialFavorited)
    setFavoriteState({ source: initialFavorited, favorited: initialFavorited });
  const favorited = favoriteState.source === initialFavorited ? favoriteState.favorited : initialFavorited;
  const setFavorited = (next: boolean) => setFavoriteState({ source: initialFavorited, favorited: next });
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [favorite, setFavorite] = useState<WorkFavorite | null>(null);
  const [tags, setTags] = useState<string[]>([]);
  const [tagQuery, setTagQuery] = useState("");
  const [note, setNote] = useState("");
  const remaining = MAX_FAVORITE_NOTE_LENGTH - [...note].length;
  const showRemaining = remaining < MAX_FAVORITE_NOTE_LENGTH * 0.1;
  const [error, setError] = useState<string | null>(null);
  const toast = useToast();
  const confirm = useConfirm();
  const location = useLocation();
  const returnFocus = useRef<HTMLElement | null>(null);
  const dialogId = `favorite-edit-${workId}`;

  async function loadFavorite() {
    setLoading(true);
    setFavorite(null);
    setError(null);
    try {

      const result = await requestJson(`/api/works/${workId}/me`, { credentials: "same-origin" }) as WorkFavorite & { error?: string; detail?: string };

      setFavorite(result);
      setFavorited(result.favorited);
      setTags(result.tags);
      setNote(result.note);
      setTagQuery("");
    } catch (error) {
      setError(error instanceof ApiResponseError ? error.messageFor(locale)
        : error instanceof Error ? error.message : t("favorite.loadFailed"));
    } finally {
      setLoading(false);
    }
  }

  function changeOpen(next: boolean) {
    if (busy) return;
    setOpen(next);
    if (next) void loadFavorite();
  }

  async function persistFavorite(next: boolean) {
    const pending = normalizeEntityName(tagQuery);
    const savedTags = next ? parseUserTags(pending && !tags.some((tag) => tagNameKey(tag) === tagNameKey(pending)) ? [...tags, pending] : tags) : [];
    const result = await requestJson<Partial<WorkFavoriteUpdate>>(`/api/works/${workId}/me${summary ? `?summary=${summary}` : ""}`, {
      method: "PATCH",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ favorited: next, tags: savedTags, note: next ? parseFavoriteNote(note) : "" }),
    }, t("favorite.saveFailed"));
    setFavorited(result.favorited ?? next);
    setOpen(false);
    toast.success(next ? t("favorite.saved") : t("favorite.removed"));
    await onSaved({ ...result, favorited: result.favorited ?? next });
  }

  async function saveFavorite(next: boolean) {
    if (!currentUserId || busy) return;
    setBusy(true);
    setError(null);
    try {
      await persistFavorite(next);
    } catch (error) {
      setError(formatFeedbackError(error, locale, t("favorite.saveRetry")));
    } finally {
      setBusy(false);
    }
  }

  async function removeFavorite() {
    if (!currentUserId || busy) return;
    await confirm(t("favorite.removeHint"), {
      title: workTitle ? t("favorite.removeNamed", { title: workTitle }) : t("favorite.removeTitle"),
      confirmLabel: t("favorite.confirmRemove"),
      destructive: true,
      action: async () => {
        setBusy(true);
        try { await persistFavorite(false); } finally { setBusy(false); }
      },
    });
  }

  if (!currentUserId) {
    if (appearance === "compact") return (
      <Button asChild className={compactButtonClass} size="sm" variant="ghost">
        <Link to={`/login?${new URLSearchParams({ next: `${location.pathname}${location.search}` })}`}>{t("favorite.add")}</Link>
      </Button>
    );
    return <p className="m-0 text-xs text-muted">{t("favorite.login")}</p>;
  }

  if (appearance === "remove") return (
    <Button type="button" variant="outline" size="sm" disabled={busy || !favorited} onClick={() => void removeFavorite()}>
      {favorited ? t("favorite.unfavorite") : t("favorite.notSaved")}
    </Button>
  );

  const workSuggestions = (favorite?.workTags ?? []).filter((value) => !validateUserTag(value)).map((value) => ({ value, meta: "" }));
  const frequentSuggestions = (favorite?.frequentTags ?? []).filter((tag) => !validateUserTag(tag.name)).map((tag) => ({ value: tag.name, meta: t("favorite.workCount", { count: tag.workCount }) }));
  const suggestions = [...new Map([...workSuggestions, ...frequentSuggestions].map((item) => [tagNameKey(item.value), item])).values()];
  return (
    <Dialog.Root open={open} onOpenChange={changeOpen}>
      {appearance === "manage" ? (
        <FavoriteManagementActions
          title={workTitle ?? t("search.scopes.works")}
          dialogId={dialogId}
          disabled={busy || loading}
          editing={open}
          onEdit={(element) => { returnFocus.current = element; changeOpen(true); }}
          onRemove={() => void removeFavorite()}
        />
      ) : <Dialog.Trigger asChild>
        <Button
          aria-pressed={favorited}
          className={appearance === "compact" ? compactButtonClass : "w-full"}
          disabled={busy || loading}
          size={appearance === "compact" ? "sm" : "default"}
          type="button"
          variant={appearance === "compact" ? "ghost" : favorited ? "default" : "outline"}
        >
          {appearance === "button" ? <Heart aria-hidden /> : null}
          {favorited ? t("favorite.active") : appearance === "compact" ? t("favorite.add") : t("favorite.label")}
        </Button>
      </Dialog.Trigger>}
      <Dialog.Portal>
        <Dialog.Overlay />
        <Dialog.Content
          id={dialogId}
          aria-describedby={undefined}
          className="left-1/2 top-1/2 grid max-h-[85dvh] w-[min(32rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 gap-4 overflow-y-auto rounded-xl p-5"
          onEscapeKeyDown={(event) => { if (busy) event.preventDefault(); }}
          onPointerDownOutside={(event) => { if (busy) event.preventDefault(); }}
          onCloseAutoFocus={(event) => {
            if (returnFocus.current?.isConnected) { event.preventDefault(); returnFocus.current.focus(); }
          }}
        >
          <Dialog.Title>{favorited ? t("favorite.edit") : t("favorite.dialog")}</Dialog.Title>
          {loading ? <p role="status" className="text-sm text-muted">{t("favorite.loading")}</p> : null}
          {error ? <Notice tone="error">{error}</Notice> : null}
          {favorite ? (
            <form className="grid gap-4" onSubmit={(event) => { event.preventDefault(); void saveFavorite(true); }}>
              <FormField label={t("library.tags")} controlId={`favorite-tags-${workId}`}>
                <TokenPicker
                  disabled={busy}
                  id={`favorite-tags-${workId}`}
                  label={t("library.tags")}
                  placeholder={t("favorite.tagPlaceholder")}
                  suggestions={suggestions}
                  recommendationGroups={[
                    { label: t("favorite.commonTags"), items: workSuggestions },
                    { label: t("favorite.myTags"), items: frequentSuggestions },
                  ]}
                  includeSelectedRecommendations
                  values={tags}
                  onChange={setTags}
                  onQueryChange={setTagQuery}
                  normalizeValue={normalizeEntityName}
                  validateValue={(value) => {
                    const error = validateUserTag(value);
                    return error ? t(error) : null;
                  }}
                  maxValues={MAX_USER_TAGS}
                  commitOnBlur
                  showHelp={false}
                />
              </FormField>
              <FormField label={t("favorite.note")} controlId={`favorite-note-${workId}`}>
                <Textarea
                  id={`favorite-note-${workId}`}
                  aria-describedby={showRemaining ? `favorite-note-${workId}-remaining` : undefined}
                  aria-invalid={remaining < 0 || undefined}
                  className="font-normal"
                  disabled={busy}
                  rows={4}
                  value={note}
                  onChange={(event) => setNote(event.target.value)}
                />
              </FormField>
              <div className="flex flex-wrap items-center justify-end gap-2">
                {favorited ? <Button className="mr-auto text-destructive hover:text-destructive" disabled={busy} type="button" variant="ghost" onClick={() => void removeFavorite()}>{t("favorite.remove")}</Button> : null}
                <Dialog.Close asChild><Button disabled={busy} type="button" variant="outline">{t("relation.edit.cancel")}</Button></Dialog.Close>
                {showRemaining ? (
                  <span
                    id={`favorite-note-${workId}-remaining`}
                    className={`font-mono text-sm tabular-nums ${remaining < 0 ? "text-destructive" : "text-muted"}`}
                    role="status"
                  >
                    <span className="sr-only">{remaining < 0 ? t("favorite.exceeded", { count: -remaining }) : t("favorite.remaining", { count: remaining })}</span>
                    <span aria-hidden="true">{remaining}</span>
                  </span>
                ) : null}
                <Button disabled={busy || remaining < 0} type="submit">{busy ? t("favorite.saving") : t("core.action.save")}</Button>
              </div>
            </form>
          ) : (
            <div className="flex justify-end gap-2">
              <Dialog.Close asChild><Button type="button" variant="outline">{t("core.action.close")}</Button></Dialog.Close>
              {!loading ? <Button type="button" onClick={() => void loadFavorite()}>{t("core.action.retry")}</Button> : null}
            </div>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

const compactButtonClass = "h-7 min-h-7 rounded-full border border-border bg-card px-2.5 text-xs shadow-sm";

function FavoriteManagementActions({ title, dialogId, disabled, editing, onEdit, onRemove }: {
  title: string;
  dialogId: string;
  disabled: boolean;
  editing: boolean;
  onEdit: (returnFocus: HTMLElement) => void;
  onRemove: () => void;
}) {
  const t = useMessages();
  const menuTrigger = useRef<HTMLButtonElement>(null);
  const openingDialog = useRef(false);
  const menuItemClass = "flex min-h-9 w-full cursor-pointer items-center rounded-sm px-2.5 py-2 text-sm outline-none focus:bg-muted/15 data-[disabled]:pointer-events-none data-[disabled]:opacity-50";
  return (
    <>
      <div className="hidden divide-x divide-border overflow-hidden rounded-full border border-border bg-card shadow-sm sm:inline-flex">
        <Button
          aria-controls={dialogId}
          aria-expanded={editing}
          aria-haspopup="dialog"
          aria-label={t("favorite.editNamed", { title })}
          className="h-7 min-h-7 rounded-none px-2.5 text-xs shadow-none focus-visible:ring-inset focus-visible:ring-offset-0"
          disabled={disabled}
          onClick={(event) => onEdit(event.currentTarget)}
          size="sm" type="button" variant="ghost"
        >{t("core.action.edit")}</Button>
        <Button
          aria-haspopup="dialog"
          aria-label={t("favorite.removeFromNamed", { title })}
          className="h-7 min-h-7 rounded-none px-2.5 text-xs text-destructive shadow-none hover:text-destructive focus-visible:ring-inset focus-visible:ring-offset-0"
          disabled={disabled}
          onClick={onRemove}
          size="sm" type="button" variant="ghost"
        >{t("core.action.remove")}</Button>
      </div>
      <DropdownMenu.Root>
        <DropdownMenu.Trigger asChild>
          <Button ref={menuTrigger} aria-label={t("favorite.manageNamed", { title })} className="size-8 rounded-full bg-card sm:hidden" disabled={disabled} size="icon" type="button" variant="ghost">
            <EllipsisVertical aria-hidden />
          </Button>
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content
            align="end" className="z-50 min-w-36 rounded-md border border-border bg-card p-1 text-foreground shadow-surface" sideOffset={6}
            onCloseAutoFocus={(event) => { if (openingDialog.current) { event.preventDefault(); openingDialog.current = false; } }}
          >
            <DropdownMenu.Item aria-controls={dialogId} aria-haspopup="dialog" className={menuItemClass} disabled={disabled} onSelect={() => {
              if (menuTrigger.current) { openingDialog.current = true; onEdit(menuTrigger.current); }
            }}>{t("favorite.edit")}</DropdownMenu.Item>
            <DropdownMenu.Item aria-haspopup="dialog" className={`${menuItemClass} text-destructive focus:text-destructive`} disabled={disabled} onSelect={() => {
              openingDialog.current = true;
              menuTrigger.current?.focus();
              onRemove();
            }}>{t("core.action.remove")}</DropdownMenu.Item>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
    </>
  );
}
