import { LocaleLink as Link } from "@/app/components/ui/locale-link";
import { translate } from "@/lib/i18n/core";
import { UI_LOCALE_PARAM } from "@/lib/i18n/locale";
import { useMessages, useNavigationLocale, useUiLocale } from "@/lib/i18n/react";
import { formatFeedbackError } from "@/lib/i18n/feedback";
import { ApiResponseError, requestJson } from "@/lib/ui/api-response";

import { useConfirm } from "@/app/components/ui/confirm-provider";
import { requireAccountUser } from "@/app/.server/auth/account-user";
import { readShowcase } from "@/app/.server/db/showcase";
import { runtimeContext } from "@/app/.server/router-context";
import { ShowcaseImage } from "@/app/components/profile/showcase-image";
import { EmojiSourcePicker } from "@/app/components/emojis/source-picker";
import { Button } from "@/app/components/ui/button";
import { Checkbox } from "@/app/components/ui/checkbox";
import { Label } from "@/app/components/ui/label";
import { Notice } from "@/app/components/ui/notice";
import { AccountPageHeader } from "@/app/me/account-page-header";
import { Rm2kButton } from "@/app/components/ui/rm2k-button";
import { SortableListItem, SortableOverlay, SortableSnapshot } from "@/app/components/ui/sortable-list-item";
import { closestCenter, DndContext, KeyboardSensor, PointerSensor, useSensor, useSensors } from "@dnd-kit/core";
import { arrayMove, SortableContext, sortableKeyboardCoordinates, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { Textarea } from "@/app/components/ui/textarea";
import { useToast } from "@/app/components/ui/toast";
import { useNavigationGuard } from "@/app/components/ui/use-navigation-guard";
import { SHOWCASE_KINDS, SHOWCASE_NOTE_LIMIT, type ShowcaseKind, type ShowcaseSnapshot, type ShowcaseTarget } from "@/lib/showcase";
import { pageMetaDescriptors, pageMetadataLocale } from "@/lib/ui/page-metadata";
import { cn } from "@/lib/ui/cn";
import { GripVertical, X } from "lucide-react";
import { useId, useRef, useState, type FormEvent } from "react";
import { useLoaderData, type LoaderFunctionArgs, type MetaFunction } from "react-router";
import { ShowcaseTargetPicker } from "./target-picker";
import { ShowcasePortraitPicker } from "./portrait-picker";
import type { CharacterPortraitChoice } from "@/lib/character-names";

export async function loader({ context }: LoaderFunctionArgs) {
  const runtime = context.get(runtimeContext);
  const user = await requireAccountUser(runtime, "/me/showcase");
  return { locale: runtime.uiLocale, userId: user.id, snapshot: await readShowcase(runtime, user.id) };
}

export const meta: MetaFunction<typeof loader> = ({ loaderData, error, location, matches }) => {
  const locale = loaderData?.locale ?? pageMetadataLocale(location.search, matches);
  return pageMetaDescriptors({ title: [translate(locale, "account.nav.showcase"), translate(locale, "header.me")] }, error, locale);
};

type Slot = {
  kind: ShowcaseKind;
  enabled: boolean;
  targetId: number | null;
  target: ShowcaseTarget | null;
  note: string;
  portrait: CharacterPortraitChoice | null;
};
function slotsFor(snapshot: ShowcaseSnapshot): Slot[] {
  return [
    ...snapshot.entries.map((entry) => ({ ...entry, enabled: true })),
    ...SHOWCASE_KINDS.filter(
      (kind) => !snapshot.entries.some((entry) => entry.kind === kind),
    ).map((kind) => ({
      kind,
      enabled: false,
      targetId: null,
      target: null,
      note: "",
      portrait: null,
    })),
  ];
}
function entriesFor(slots: Slot[]) {
  return slots
    .filter((slot) => slot.enabled && slot.targetId !== null)
    .map(({ kind, targetId, note, portrait }) => ({
      kind,
      targetId,
      note,
      portrait,
    }));
}

export default function ShowcasePage() {
  const { userId, snapshot } = useLoaderData<typeof loader>();
  return <ShowcaseEditor key={userId} userId={userId} initial={snapshot} />;
}

function ShowcaseEditor({
  userId,
  initial,
}: {
  userId: number;
  initial: ShowcaseSnapshot;
}) {
  const t = useMessages();
  const locale = useUiLocale();
  const navigationLocale = useNavigationLocale();
  const [saved, setSaved] = useState(initial);
  const [slots, setSlots] = useState(() => slotsFor(initial));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [conflict, setConflict] = useState(false);
  const dndId = useId();
  const list = useRef<HTMLUListElement>(null);
  const [drag, setDrag] = useState<{ kind: ShowcaseKind; element: HTMLElement } | null>(null);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const toast = useToast();
  const locked = busy || drag !== null;
  const dirty =
    JSON.stringify(entriesFor(slots)) !==
    JSON.stringify(entriesFor(slotsFor(saved)));
  const confirm = useConfirm();
  const navigateSaved = useNavigationGuard(
    dirty || busy,
    () => !busy && confirm(t("showcase.leave")),
  );

  function update(kind: ShowcaseKind, change: Partial<Slot>) {
    setSlots((current) =>
      current.map((slot) =>
        slot.kind === kind ? { ...slot, ...change } : slot,
      ),
    );
  }
  async function reload() {
    if (
      dirty &&
      !(await confirm(t("showcase.reloadPrompt"), { title: t("showcase.reloadTitle"), confirmLabel: t("admin.resources.reloadConfirm") }))
    )
      return;
    setBusy(true);
    setError("");
    try {

      const data = (await requestJson(`/api/account/showcase?${UI_LOCALE_PARAM}=${locale}`)) as ShowcaseSnapshot & {
        detail?: string;
        error?: string;
      };

      setSaved(data);
      setSlots(slotsFor(data));
      setConflict(false);
    } catch (error) {
      toast.error(
        formatFeedbackError(error, locale, t("showcase.readFailed")),
      );
    } finally {
      setBusy(false);
    }
  }
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (locked) return;
    setBusy(true);
    setError("");
    setConflict(false);
    try {

      await requestJson(`/api/account/showcase?${UI_LOCALE_PARAM}=${locale}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          revision: saved.revision,
          entries: entriesFor(slots),
        }),
      });

      toast.success(t("showcase.saved"));
      await navigateSaved(`/users/${userId}${navigationLocale ? `?${UI_LOCALE_PARAM}=${navigationLocale}` : ""}`);
    } catch (error) {
      if (error instanceof ApiResponseError && error.code === "showcase_conflict") {
        setConflict(true);
        setError(error.messageFor(locale));
      }
      toast.error(
        formatFeedbackError(error, locale, t("showcase.saveFailed")),
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <AccountPageHeader
        title={t("account.nav.showcase")}
      />
      <form onSubmit={save} aria-busy={busy}>
        <DndContext
          id={dndId}
          sensors={sensors}
          collisionDetection={closestCenter}
          accessibility={{
            screenReaderInstructions: { draggable: t("showcase.instructions") },
            announcements: {
              onDragStart: ({ active }) => t("showcase.start", { label: t(`showcase.favorite.${active.id as ShowcaseKind}`) }),
              onDragOver: ({ over }) => over ? t("showcase.move", { position: slots.findIndex((slot) => slot.kind === over.id) + 1 }) : t("showcase.outside"),
              onDragEnd: ({ over }) => over ? t("showcase.end", { position: slots.findIndex((slot) => slot.kind === over.id) + 1 }) : t("showcase.canceled"),
              onDragCancel: () => t("showcase.canceled"),
            },
          }}
          onDragStart={({ active }) => {
            if (busy) return;
            const row = list.current?.children[slots.findIndex((slot) => slot.kind === active.id)]?.firstElementChild;
            if (row instanceof HTMLElement) setDrag({ kind: active.id as ShowcaseKind, element: row.cloneNode(true) as HTMLElement });
          }}
          onDragCancel={() => setDrag(null)}
          onDragEnd={({ active, over }) => {
            setDrag(null);
            if (busy || !over || active.id === over.id) return;
            setSlots((current) => {
              const from = current.findIndex((slot) => slot.kind === active.id);
              const to = current.findIndex((slot) => slot.kind === over.id);
              return from < 0 || to < 0 ? current : arrayMove(current, from, to);
            });
          }}
        >
          <SortableContext items={slots.map((slot) => slot.kind)} strategy={verticalListSortingStrategy}>
            <ul className="relative grid gap-4" ref={list} aria-label={t("showcase.sort")}>
          {slots.map((slot) => (
            <SortableListItem key={slot.kind} id={slot.kind} disabled={busy} className="min-w-0">
              {({ attributes, listeners, setActivatorNodeRef }) => (
              <section
                className="min-w-0 rounded-lg border border-border bg-card"
                aria-labelledby={`showcase-heading-${slot.kind}`}
              >
                <header className="flex min-h-12 items-center">
                  <h2
                    className="m-0 flex min-w-0 flex-1 self-stretch text-base font-semibold"
                    id={`showcase-heading-${slot.kind}`}
                  >
                    <Label
                      className={cn(
                        "flex w-full items-center px-4 text-base font-semibold leading-6 sm:px-5",
                        locked ? "cursor-not-allowed" : "cursor-pointer",
                      )}
                      htmlFor={`showcase-enabled-${slot.kind}`}
                    >
                      {t(`showcase.favorite.${slot.kind}`)}
                    </Label>
                  </h2>
                  <div className="flex shrink-0 items-center gap-1.5 pr-2 sm:pr-3">
                    <span className="flex size-11 items-center justify-center">
                      <Checkbox
                        id={`showcase-enabled-${slot.kind}`}
                        checked={slot.enabled}
                        disabled={locked}
                        aria-controls={
                          slot.enabled
                            ? `showcase-form-${slot.kind}`
                            : undefined
                        }
                        onCheckedChange={(checked) =>
                          update(slot.kind, { enabled: checked === true })
                        }
                      />
                    </span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      {...attributes}
                      {...listeners}
                      ref={setActivatorNodeRef}
                      className="size-11 touch-none select-none cursor-grab active:cursor-grabbing"
                      title={t("showcase.drag", { label: t(`showcase.favorite.${slot.kind}`) })}
                      aria-label={t("showcase.sortItem", { label: t(`showcase.favorite.${slot.kind}`) })}
                      disabled={busy}
                      onContextMenu={(event) => event.preventDefault()}
                    >
                      <GripVertical aria-hidden="true" />
                    </Button>
                  </div>
                </header>
                {slot.enabled ? (
                  <div
                    id={`showcase-form-${slot.kind}`}
                    className="px-4 pt-3 pb-4 sm:px-5 sm:pb-5"
                  >
                    {slot.targetId !== null ? (
                      <div className="mb-4 flex min-w-0 items-center gap-3">
                        {slot.target ? (
                          <>
                            <span className="flex size-16 shrink-0 overflow-hidden">
                              <ShowcaseImage target={slot.target} />
                            </span>
                            <span className="min-w-0 flex-1 font-semibold wrap-anywhere">
                              {slot.target.name}
                            </span>
                            {slot.kind === "character" ? (
                              <ShowcasePortraitPicker
                                key={slot.target.id}
                                target={slot.target}
                                selection={slot.portrait}
                                disabled={locked}
                                onChoose={(portrait, preview) =>
                                  update(slot.kind, {
                                    portrait,
                                    target: {
                                      ...slot.target!,
                                      portrait: preview,
                                    },
                                  })
                                }
                              />
                            ) : null}
                          </>
                        ) : (
                          <p className="min-w-0 flex-1 text-sm text-muted">
                            {t("showcase.unavailable")}
                          </p>
                        )}
                        <Button
                          type="button"
                          size="icon"
                          variant="ghost"
                          className="size-11"
                          disabled={locked}
                          aria-label={t("showcase.remove", { label: t(`showcase.favorite.${slot.kind}`) })}
                          onClick={() =>
                            update(slot.kind, {
                              targetId: null,
                              target: null,
                              note: "",
                              portrait: null,
                            })
                          }
                        >
                          <X aria-hidden="true" />
                        </Button>
                      </div>
                    ) : null}
                    {slot.kind === "character" ? (
                      <div className="grid gap-1.5">
                        <Label htmlFor="showcase-character-picker">
                          {t("sea.avatar.character")}
                        </Label>
                        <EmojiSourcePicker
                          id="showcase-character-picker"
                          mode="showcase"
                          disabled={locked}
                          label={slot.target?.name ?? t("sea.avatar.character")}
                          character={
                            slot.target
                              ? {
                                  id: slot.target.id,
                                  name: slot.target.name,
                                  originalName: slot.target.name,
                                }
                              : undefined
                          }
                          onSelect={(character) =>
                            update(slot.kind, {
                              targetId: character.id,
                              portrait: null,
                              target: {
                                kind: "character",
                                id: character.id,
                                name: character.name,
                                imageSha256: null,
                                portrait: character.defaultPortrait ?? null,
                              },
                            })
                          }
                        />
                      </div>
                    ) : (
                      <ShowcaseTargetPicker
                        kind={slot.kind}
                        selectedName={slot.target?.name}
                        disabled={locked}
                        onChoose={(target) =>
                          update(slot.kind, { targetId: target.id, target })
                        }
                      />
                    )}
                    <div className="mt-4 grid gap-1.5">
                      <div className="flex items-center justify-between gap-2">
                        <Label htmlFor={`showcase-note-${slot.kind}`}>
                          {t("showcase.note")}
                        </Label>
                        <span className="font-mono text-xs text-muted">
                          {slot.note.length}/{SHOWCASE_NOTE_LIMIT}
                        </span>
                      </div>
                      <Textarea
                        id={`showcase-note-${slot.kind}`}
                        value={slot.note}
                        maxLength={SHOWCASE_NOTE_LIMIT}
                        rows={3}
                        disabled={locked || slot.targetId === null}
                        placeholder={t("showcase.noteHint")}
                        onChange={(event) =>
                          update(slot.kind, { note: event.target.value })
                        }
                      />
                    </div>
                  </div>
                ) : null}
              </section>
              )}
            </SortableListItem>
          ))}
            </ul>
          </SortableContext>
          <SortableOverlay>{drag && <SortableSnapshot element={drag.element} />}</SortableOverlay>
        </DndContext>
        {error ? <Notice className="mt-4">{error}</Notice> : null}
        <div className="mt-5 flex flex-wrap items-center justify-end gap-3">
          {dirty ? (
            <span className="mr-auto text-sm text-muted">{t("showcase.dirty")}</span>
          ) : null}
          {conflict ? (
            <Button
              type="button"
              variant="outline"
              disabled={locked}
              onClick={() => void reload()}
            >
              {t("admin.resources.reload")}
            </Button>
          ) : null}
          <Button asChild variant="outline" disabled={busy}>
            <Link
              to={`/users/${userId}`}
              aria-disabled={busy || undefined}
              onClick={(event) => {
                if (busy) event.preventDefault();
              }}
            >
              {t("play.save.cancel")}
            </Link>
          </Button>
          <Rm2kButton type="submit" disabled={locked}>
            {busy ? t("upload.cover.processing") : t("showcase.saveView")}
          </Rm2kButton>
        </div>
      </form>
    </div>
  );
}
