import { requestJson } from "@/lib/ui/api-response";

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
import { SHOWCASE_KINDS, SHOWCASE_LABELS, SHOWCASE_NOTE_LIMIT, type ShowcaseKind, type ShowcaseSnapshot, type ShowcaseTarget } from "@/lib/showcase";
import { pageMetaDescriptors } from "@/lib/ui/page-metadata";
import { cn } from "@/lib/ui/cn";
import { GripVertical, X } from "lucide-react";
import { useId, useRef, useState, type FormEvent } from "react";
import { Link, useLoaderData, type LoaderFunctionArgs, type MetaFunction } from "react-router";
import { ShowcaseTargetPicker } from "./target-picker";
import { ShowcasePortraitPicker } from "./portrait-picker";
import type { CharacterPortraitChoice } from "@/lib/character-names";

export async function loader({ context }: LoaderFunctionArgs) {
  const runtime = context.get(runtimeContext);
  const user = await requireAccountUser(runtime, "/me/showcase");
  return { userId: user.id, snapshot: await readShowcase(runtime, user.id) };
}

export const meta: MetaFunction = ({ error }) =>
  pageMetaDescriptors({ title: ["喜爱展柜", "个人中心"] }, error);

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
    () => !busy && confirm("展柜尚未保存，确定放弃修改并离开？"),
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
      !(await confirm("重新读取会丢弃当前尚未保存的修改，确定继续？", { title: "重新读取展柜", confirmLabel: "放弃修改并读取" }))
    )
      return;
    setBusy(true);
    setError("");
    try {

      const data = (await requestJson("/api/account/showcase")) as ShowcaseSnapshot & {
        detail?: string;
        error?: string;
      };

      setSaved(data);
      setSlots(slotsFor(data));
      setConflict(false);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "展柜读取失败，请重试。",
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

      await requestJson("/api/account/showcase", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          revision: saved.revision,
          entries: entriesFor(slots),
        }),
      });

      toast.success("喜爱展柜已保存。");
      await navigateSaved(`/users/${userId}`);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "展柜保存失败，请重试。",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <AccountPageHeader
        title="喜爱展柜"
      />
      <form onSubmit={save} aria-busy={busy}>
        <DndContext
          id={dndId}
          sensors={sensors}
          collisionDetection={closestCenter}
          accessibility={{
            screenReaderInstructions: { draggable: "按 Enter 开始排序，用方向键移动，按 Enter 确认，按 Escape 取消。" },
            announcements: {
              onDragStart: ({ active }) => `开始排序：最喜欢的${SHOWCASE_LABELS[active.id as ShowcaseKind]}。`,
              onDragOver: ({ over }) => over ? `移动到第 ${slots.findIndex((slot) => slot.kind === over.id) + 1} 项。` : "已离开排序区域。",
              onDragEnd: ({ over }) => over ? `排序完成，位于第 ${slots.findIndex((slot) => slot.kind === over.id) + 1} 项。` : "排序取消。",
              onDragCancel: () => "排序取消。",
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
            <ul className="relative grid gap-4" ref={list} aria-label="喜爱展柜排序">
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
                      最喜欢的{SHOWCASE_LABELS[slot.kind]}
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
                      title={`拖动排序${SHOWCASE_LABELS[slot.kind]}`}
                      aria-label={`排序${SHOWCASE_LABELS[slot.kind]}`}
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
                            原选项已不可公开访问，请重新选择或移除。
                          </p>
                        )}
                        <Button
                          type="button"
                          size="icon"
                          variant="ghost"
                          className="size-11"
                          disabled={locked}
                          aria-label={`移除${SHOWCASE_LABELS[slot.kind]}`}
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
                          选择角色
                        </Label>
                        <EmojiSourcePicker
                          id="showcase-character-picker"
                          mode="showcase"
                          disabled={locked}
                          label={slot.target?.name ?? "选择角色"}
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
                          附言
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
                        placeholder="写下喜欢的理由……"
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
            <span className="mr-auto text-sm text-muted">有未保存的修改</span>
          ) : null}
          {conflict ? (
            <Button
              type="button"
              variant="outline"
              disabled={locked}
              onClick={() => void reload()}
            >
              重新读取
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
              取消
            </Link>
          </Button>
          <Rm2kButton type="submit" disabled={locked}>
            {busy ? "正在处理…" : "保存并查看主页"}
          </Rm2kButton>
        </div>
      </form>
    </div>
  );
}
