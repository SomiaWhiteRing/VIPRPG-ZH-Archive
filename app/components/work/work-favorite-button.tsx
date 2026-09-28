import { Button } from "@/app/components/ui/button";
import { useConfirm } from "@/app/components/ui/confirm-provider";
import * as Dialog from "@/app/components/ui/dialog";
import { FormField } from "@/app/components/ui/form-field";
import { Notice } from "@/app/components/ui/notice";
import { Textarea } from "@/app/components/ui/textarea";
import { TokenPicker } from "@/app/components/pickers/token-picker";
import { useToast } from "@/app/components/ui/toast";
import { normalizeEntityName } from "@/lib/entity-name";
import { MAX_FAVORITE_NOTE_LENGTH, MAX_USER_TAGS, parseFavoriteNote, parseUserTags, tagNameKey, validateUserTag, type WorkFavorite } from "@/lib/user-tags";
import { EllipsisVertical, Heart } from "lucide-react";
import { DropdownMenu } from "radix-ui";
import { useRef, useState } from "react";
import { Link, useLocation, useRevalidator } from "react-router";

type Props = {
  currentUserId: number | null;
  initialFavorited: boolean;
  workId: number;
  workTitle?: string;
  appearance?: "button" | "compact" | "manage" | "remove";
};

export function WorkFavoriteButton(props: Props) {
  return (
    <WorkFavoriteButtonContent
      key={`${props.workId}:${props.currentUserId}:${props.initialFavorited}`}
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
}: Props) {
  const [favorited, setFavorited] = useState(initialFavorited);
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
  const revalidator = useRevalidator();
  const location = useLocation();
  const returnFocus = useRef<HTMLElement | null>(null);
  const dialogId = `favorite-edit-${workId}`;

  async function loadFavorite() {
    setLoading(true);
    setFavorite(null);
    setError(null);
    try {
      const response = await fetch(`/api/works/${workId}/me`, { credentials: "same-origin" });
      const result = await response.json() as WorkFavorite & { error?: string; detail?: string };
      if (!response.ok) throw new Error(result.detail || result.error || "收藏信息加载失败。");
      setFavorite(result);
      setFavorited(result.favorited);
      setTags(result.tags);
      setNote(result.note);
      setTagQuery("");
    } catch (error) {
      setError(error instanceof Error ? error.message : "收藏信息加载失败，请重试。");
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
    const response = await fetch(`/api/works/${workId}/me`, {
      method: "PATCH",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ favorited: next, tags: savedTags, note: next ? parseFavoriteNote(note) : "" }),
    });
    if (!response.ok) {
      const result = await response.json() as { detail?: string; error?: string };
      throw new Error(result.detail || result.error || "收藏状态保存失败，请稍后重试。");
    }
    setFavorited(next);
    setOpen(false);
    toast.success(next ? "收藏已保存。" : "已取消收藏。");
    void revalidator.revalidate();
  }

  async function saveFavorite(next: boolean) {
    if (!currentUserId || busy) return;
    setBusy(true);
    setError(null);
    try {
      await persistFavorite(next);
    } catch (error) {
      setError(error instanceof Error ? error.message : "收藏状态保存失败，请稍后重试。");
    } finally {
      setBusy(false);
    }
  }

  async function removeFavorite() {
    if (!currentUserId || busy) return;
    await confirm("这会同时移除本次收藏的标签和吐槽。", {
      title: workTitle ? `移除“${workTitle}”？` : "移除收藏？",
      confirmLabel: "确认移除",
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
        <Link to={`/login?${new URLSearchParams({ next: `${location.pathname}${location.search}` })}`}>加入收藏</Link>
      </Button>
    );
    return <p className="m-0 text-xs text-muted">登录后可以收藏作品。</p>;
  }

  if (appearance === "remove") return (
    <Button type="button" variant="outline" size="sm" disabled={busy || !favorited} onClick={() => void removeFavorite()}>
      {favorited ? "取消收藏" : "已取消收藏"}
    </Button>
  );

  const workSuggestions = (favorite?.workTags ?? []).filter((value) => !validateUserTag(value)).map((value) => ({ value, meta: "" }));
  const frequentSuggestions = (favorite?.frequentTags ?? []).filter((tag) => !validateUserTag(tag.name)).map((tag) => ({ value: tag.name, meta: `${tag.workCount} 部作品` }));
  const suggestions = [...new Map([...workSuggestions, ...frequentSuggestions].map((item) => [tagNameKey(item.value), item])).values()];
  return (
    <Dialog.Root open={open} onOpenChange={changeOpen}>
      {appearance === "manage" ? (
        <FavoriteManagementActions
          title={workTitle ?? "作品"}
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
          {favorited ? "已收藏" : appearance === "compact" ? "加入收藏" : "收藏"}
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
          <Dialog.Title>{favorited ? "编辑收藏" : "收藏作品"}</Dialog.Title>
          {loading ? <p role="status" className="text-sm text-muted">正在加载收藏…</p> : null}
          {error ? <Notice tone="error">{error}</Notice> : null}
          {favorite ? (
            <form className="grid gap-4" onSubmit={(event) => { event.preventDefault(); void saveFavorite(true); }}>
              <FormField label="标签" controlId={`favorite-tags-${workId}`}>
                <TokenPicker
                  disabled={busy}
                  id={`favorite-tags-${workId}`}
                  label="标签"
                  placeholder="作品在收藏中的标签"
                  suggestions={suggestions}
                  recommendationGroups={[
                    { label: "常用标签", items: workSuggestions },
                    { label: "我的标签", items: frequentSuggestions },
                  ]}
                  includeSelectedRecommendations
                  values={tags}
                  onChange={setTags}
                  onQueryChange={setTagQuery}
                  normalizeValue={normalizeEntityName}
                  validateValue={validateUserTag}
                  maxValues={MAX_USER_TAGS}
                  commitOnBlur
                  showHelp={false}
                />
              </FormField>
              <FormField label="吐槽" controlId={`favorite-note-${workId}`}>
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
                {favorited ? <Button className="mr-auto text-destructive hover:text-destructive" disabled={busy} type="button" variant="ghost" onClick={() => void removeFavorite()}>移除收藏</Button> : null}
                <Dialog.Close asChild><Button disabled={busy} type="button" variant="outline">取消</Button></Dialog.Close>
                {showRemaining ? (
                  <span
                    id={`favorite-note-${workId}-remaining`}
                    className={`font-mono text-sm tabular-nums ${remaining < 0 ? "text-destructive" : "text-muted"}`}
                    role="status"
                  >
                    <span className="sr-only">{remaining < 0 ? `超出上限 ${-remaining} 字` : `还可输入 ${remaining} 字`}</span>
                    <span aria-hidden="true">{remaining}</span>
                  </span>
                ) : null}
                <Button disabled={busy || remaining < 0} type="submit">{busy ? "保存中…" : "保存"}</Button>
              </div>
            </form>
          ) : (
            <div className="flex justify-end gap-2">
              <Dialog.Close asChild><Button type="button" variant="outline">关闭</Button></Dialog.Close>
              {!loading ? <Button type="button" onClick={() => void loadFavorite()}>重试</Button> : null}
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
          aria-label={`编辑收藏：${title}`}
          className="h-7 min-h-7 rounded-none px-2.5 text-xs shadow-none focus-visible:ring-inset focus-visible:ring-offset-0"
          disabled={disabled}
          onClick={(event) => onEdit(event.currentTarget)}
          size="sm" type="button" variant="ghost"
        >编辑</Button>
        <Button
          aria-haspopup="dialog"
          aria-label={`从收藏移除：${title}`}
          className="h-7 min-h-7 rounded-none px-2.5 text-xs text-destructive shadow-none hover:text-destructive focus-visible:ring-inset focus-visible:ring-offset-0"
          disabled={disabled}
          onClick={onRemove}
          size="sm" type="button" variant="ghost"
        >移除</Button>
      </div>
      <DropdownMenu.Root>
        <DropdownMenu.Trigger asChild>
          <Button ref={menuTrigger} aria-label={`管理收藏：${title}`} className="size-8 rounded-full bg-card sm:hidden" disabled={disabled} size="icon" type="button" variant="ghost">
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
            }}>编辑收藏</DropdownMenu.Item>
            <DropdownMenu.Item aria-haspopup="dialog" className={`${menuItemClass} text-destructive focus:text-destructive`} disabled={disabled} onSelect={() => {
              openingDialog.current = true;
              menuTrigger.current?.focus();
              onRemove();
            }}>移除</DropdownMenu.Item>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
    </>
  );
}
