"use client";

import { EllipsisVertical } from "lucide-react";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { Dialog, DropdownMenu } from "radix-ui";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogTitle,
} from "@/app/components/ui/alert-dialog";
import { Button } from "@/app/components/ui/button";
import { EmptyState } from "@/app/components/ui/empty-state";
import { InfoTooltip } from "@/app/components/ui/info-tooltip";
import { Input } from "@/app/components/ui/input";
import { SelectField } from "@/app/components/ui/select";
import {
  WorkListItem,
  type WorkListItemData,
} from "@/app/components/work/work-list-item";
import {
  WORK_RELATION_TYPES,
  TRANSLATION_ROLE_LABELS,
  relationLabel,
} from "@/lib/labels";
import type {
  GameTranslationRelation,
  GameWorkRelation,
} from "@/lib/server/db/game-library";

type Candidate = WorkListItemData & {
  id: number;
  isOriginal: boolean;
  isTranslation: boolean;
};

type RelationChoice =
  | `work:${string}`
  | `translation:${keyof typeof TRANSLATION_ROLE_LABELS}`;

type RelationEditorProps = {
  workId: number;
  language: string;
  relations: GameWorkRelation[];
  translations: GameTranslationRelation[];
  parallelTranslations: GameTranslationRelation[];
  currentUserId: number | null;
  canCreateRelation: boolean;
  canCreateTranslation: boolean;
  canUpdate: boolean;
  canDeleteRelation: boolean;
  canDeleteTranslation: boolean;
  canManageRelationsAny: boolean;
  canManageTranslationsAny: boolean;
};

type RelationCreateDialogProps = Pick<
  RelationEditorProps,
  "workId" | "language" | "canCreateRelation" | "canCreateTranslation"
>;

type PendingRemoval = {
  kind: "work" | "translation";
  id: number;
  title: string;
};

const menuItemClass =
  "flex min-h-9 w-full cursor-default items-center rounded-sm px-2.5 py-2 text-sm outline-none focus:bg-muted/15 data-[disabled]:pointer-events-none data-[disabled]:opacity-50";

export function RelationEditor(props: RelationEditorProps) {
  const showCreate = props.canCreateRelation || props.canCreateTranslation;

  return (
    <div className="grid gap-5 border-t border-border pt-5">
      {showCreate ? (
        <div className="flex justify-end">
          <RelationCreateDialog
            canCreateRelation={props.canCreateRelation}
            canCreateTranslation={props.canCreateTranslation}
            language={props.language}
            workId={props.workId}
          />
        </div>
      ) : null}
      <RelationManager {...props} />
    </div>
  );
}

export function RelationCreateDialog({
  workId,
  language,
  canCreateRelation,
  canCreateTranslation,
}: RelationCreateDialogProps) {
  const router = useRouter();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [selected, setSelected] = useState<Candidate | null>(null);
  const [relationChoice, setRelationChoice] = useState<RelationChoice>(() =>
    canCreateRelation ? "work:same_setting" : "translation:original",
  );
  const [searching, setSearching] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  function changeOpen(nextOpen: boolean) {
    if (busy) return;
    setOpen(nextOpen);
    if (nextOpen) {
      setQuery("");
      setCandidates([]);
      setSelected(null);
      setMessage(null);
    }
  }

  async function lookup() {
    if (!query.trim()) return;
    setSearching(true);
    setMessage(null);
    setSelected(null);
    try {
      const response = await fetch(
        `/api/works/lookup?title=${encodeURIComponent(query.trim())}`,
        { credentials: "same-origin" },
      );
      const body = (await response.json()) as {
        ok?: boolean;
        works?: Array<Omit<Candidate, "workId" | "title">>;
        detail?: string;
      };
      if (!response.ok || !body.ok) {
        setMessage(body.detail ?? "查找游戏失败。");
        return;
      }
      const works = (body.works ?? [])
        .filter((candidate) => candidate.id !== workId)
        .map((candidate) => ({
          ...candidate,
          workId: candidate.id,
          title: candidate.chineseTitle || candidate.originalTitle,
        }));
      setCandidates(works);
      if (!works.length) setMessage("没有找到可关联的游戏。");
    } catch {
      setMessage("网络请求失败，请检查连接后重试。");
    } finally {
      setSearching(false);
    }
  }

  async function createRelation() {
    if (!selected) {
      setMessage("请先查找并选择关联对象。");
      return;
    }
    if (relationChoice.startsWith("translation:") && selected.language === language) {
      setMessage("原版和译版语言必须不同。");
      return;
    }

    const translationRole = relationChoice.startsWith("translation:")
      ? (relationChoice.slice("translation:".length) as keyof typeof TRANSLATION_ROLE_LABELS)
      : null;
    const path = translationRole
      ? `/api/works/${workId}/translation-relations`
      : `/api/works/${workId}/relations`;
    const payload = translationRole
      ? {
          targetWorkId: selected.id,
          targetRole: translationRole === "original" ? "translation" : "original",
        }
      : {
          targetWorkId: selected.id,
          relationType: relationChoice.slice("work:".length),
        };

    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch(path, {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = (await response.json()) as { ok?: boolean; detail?: string };
      if (!response.ok || !body.ok) {
        setMessage(body.detail ?? "保存关联失败。");
        return;
      }
      setOpen(false);
      router.refresh();
    } catch {
      setMessage("网络请求失败，请检查连接后重试。");
    } finally {
      setBusy(false);
    }
  }

  const relationOptions = [
    ...(canCreateRelation
      ? WORK_RELATION_TYPES.map((value) => ({
          value: `work:${value}`,
          label: relationLabel(value),
        }))
      : []),
    ...(canCreateTranslation
      ? (
          Object.entries(TRANSLATION_ROLE_LABELS) as Array<
            [keyof typeof TRANSLATION_ROLE_LABELS, string]
          >
        ).map(([value, label], index) => ({
          value: `translation:${value}`,
          label,
          separatorBefore: canCreateRelation && index === 0,
        }))
      : []),
  ];

  return (
    <Dialog.Root open={open} onOpenChange={changeOpen}>
      <Dialog.Trigger asChild>
        <Button ref={triggerRef} type="button">添加关联</Button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/45" />
        <Dialog.Content
          aria-describedby="relation-create-description"
          className="fixed left-1/2 top-1/2 z-50 grid h-[min(85dvh,680px)] w-[min(92vw,680px)] -translate-x-1/2 -translate-y-1/2 grid-rows-[auto_auto_auto_minmax(0,1fr)_auto] gap-4 overflow-hidden rounded-lg border border-border bg-card p-5 shadow-surface"
          id="relation-create-dialog"
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            triggerRef.current?.focus();
          }}
        >
          <Dialog.Title className="m-0 text-lg font-bold">添加关联</Dialog.Title>
          <Dialog.Description className="sr-only" id="relation-create-description">
            选择关联类型，查找关联对象并建立关联。
          </Dialog.Description>
          <div className="grid gap-2 text-sm font-semibold">
            <div className="flex items-center gap-1">
              <span>关联类型</span>
              <InfoTooltip>本作品之于关联对象的关系。</InfoTooltip>
            </div>
            <SelectField
              aria-label="关联类型"
              disabled={busy}
              onValueChange={(value) => {
                setRelationChoice(value as RelationChoice);
                setMessage(null);
              }}
              options={relationOptions}
              value={relationChoice}
            />
          </div>
          <form
            className="flex gap-2 max-sm:flex-col"
            onSubmit={(event) => {
              event.preventDefault();
              void lookup();
            }}
          >
            <Input
              aria-label="查找关联对象"
              onChange={(event) => setQuery(event.target.value)}
              placeholder="输入游戏标题"
              value={query}
            />
            <Button
              disabled={searching || busy || !query.trim()}
              type="submit"
              variant="outline"
            >
              {searching ? "正在查找…" : "查找"}
            </Button>
          </form>
          <div className="min-h-0 overflow-y-auto">
            {candidates.length ? (
              <ol aria-label="查找结果" className="divide-y divide-border border-y border-border">
                {candidates.map((candidate, index) => (
                  <WorkListItem
                    index={index}
                    item={candidate}
                    key={candidate.id}
                    management={
                      <Button
                        disabled={busy}
                        onClick={() => {
                          setSelected(candidate);
                          setMessage(null);
                        }}
                        size="sm"
                        type="button"
                        variant={selected?.id === candidate.id ? "default" : "outline"}
                      >
                        {selected?.id === candidate.id ? "已选择" : "选择"}
                      </Button>
                    }
                  />
                ))}
              </ol>
            ) : null}
            {message ? (
              <p className="m-0 py-3 text-sm font-normal text-muted" role="status">
                {message}
              </p>
            ) : null}
          </div>
          <div className="flex justify-end gap-2 border-t border-border pt-4">
            <Dialog.Close asChild>
              <Button disabled={busy} type="button" variant="outline">取消</Button>
            </Dialog.Close>
            <Button
              disabled={busy || searching || !selected}
              onClick={() => void createRelation()}
              type="button"
            >
              {busy ? "正在建立…" : "建立关联"}
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export function RelationManager({
  workId,
  relations,
  translations,
  parallelTranslations,
  currentUserId,
  canUpdate,
  canDeleteRelation,
  canDeleteTranslation,
  canManageRelationsAny,
  canManageTranslationsAny,
}: RelationEditorProps) {
  const router = useRouter();
  const removalReturnFocusRef = useRef<HTMLElement | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [pendingRemoval, setPendingRemoval] = useState<PendingRemoval | null>(null);

  const allTranslations = [
    ...translations,
    ...parallelTranslations.filter(
      (item) =>
        item.workId !== workId &&
        !translations.some((direct) => direct.workId === item.workId) &&
        !parallelTranslations.some(
          (candidate) => candidate.workId === item.workId && candidate.id < item.id,
        ),
    ),
  ].sort(compareTranslations);
  const relationGroups = WORK_RELATION_TYPES.map((type) => ({
    type,
    items: relations
      .filter((relation) => relation.relationType === type)
      .sort(compareRelatedWorks),
  })).filter((group) => group.items.length);

  async function changeType(relation: GameWorkRelation, relationType: string) {
    if (relationType === relation.relationType) return;
    await mutate(
      `/api/work-relations/${relation.id}`,
      "PATCH",
      { relationType },
      "关联类型已更新。",
      "关联类型更新失败。",
    );
  }

  async function removePending() {
    if (!pendingRemoval) return;
    const path = pendingRemoval.kind === "work"
      ? `/api/work-relations/${pendingRemoval.id}`
      : `/api/translation-relations/${pendingRemoval.id}`;
    const removed = await mutate(
      path,
      "DELETE",
      undefined,
      "关联已删除。",
      "删除关联失败。",
    );
    if (removed) setPendingRemoval(null);
  }

  function requestRemoval(removal: PendingRemoval, returnFocus: HTMLElement | null) {
    removalReturnFocusRef.current = returnFocus;
    setMessage(null);
    setPendingRemoval(removal);
  }

  async function mutate(
    path: string,
    method: "PATCH" | "DELETE",
    payload: Record<string, unknown> | undefined,
    successMessage: string,
    failureMessage: string,
  ): Promise<boolean> {
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch(path, {
        method,
        credentials: "same-origin",
        ...(payload
          ? {
              headers: { "content-type": "application/json" },
              body: JSON.stringify(payload),
            }
          : {}),
      });
      const body = (await response.json()) as { ok?: boolean; detail?: string };
      if (!response.ok || !body.ok) {
        setMessage(body.detail ?? failureMessage);
        return false;
      }
      setMessage(successMessage);
      router.refresh();
      return true;
    } catch {
      setMessage("网络请求失败，请检查连接后重试。");
      return false;
    } finally {
      setBusy(false);
    }
  }

  if (!allTranslations.length && !relationGroups.length) {
    return <EmptyState title="这个作品还没有关联作品。" />;
  }

  return (
    <div className="grid gap-7">
      {message ? <p className="m-0 text-sm text-muted" role="status">{message}</p> : null}

      {allTranslations.length ? (
        <section aria-labelledby="translation-relations-heading">
          <RelationSectionHeader
            count={allTranslations.length}
            id="translation-relations-heading"
            title="翻译关联"
          />
          <ol className="divide-y divide-border border-b border-border">
            {allTranslations.map((translation, index) => {
              const ownsRelation =
                translation.createdByUserId === currentUserId || canManageTranslationsAny;
              return (
                <WorkListItem
                  index={index}
                  item={translation}
                  key={`translation-${translation.id}`}
                  management={
                    <TranslationRelationActions
                      busy={busy}
                      canDelete={canDeleteTranslation && ownsRelation}
                      onDelete={(returnFocus) =>
                        requestRemoval(
                          {
                            kind: "translation",
                            id: translation.id,
                            title: translation.title,
                          },
                          returnFocus,
                        )
                      }
                      role={translation.role}
                      title={translation.title}
                    />
                  }
                />
              );
            })}
          </ol>
        </section>
      ) : null}

      {relationGroups.map((group) => (
        <section aria-labelledby={`work-relations-${group.type}`} key={group.type}>
          <RelationSectionHeader
            count={group.items.length}
            id={`work-relations-${group.type}`}
            title={relationLabel(group.type)}
          />
          <ol className="divide-y divide-border border-b border-border">
            {group.items.map((relation, index) => {
              const ownsRelation =
                relation.createdByUserId === currentUserId || canManageRelationsAny;
              return (
                <WorkListItem
                  index={index}
                  item={relation}
                  key={relation.id}
                  management={
                    <WorkRelationActions
                      busy={busy}
                      canDelete={canDeleteRelation && ownsRelation}
                      canEdit={canUpdate && ownsRelation}
                      onChangeType={(relationType) => void changeType(relation, relationType)}
                      onDelete={(returnFocus) =>
                        requestRemoval(
                          {
                            kind: "work",
                            id: relation.id,
                            title: relation.title,
                          },
                          returnFocus,
                        )
                      }
                      relationType={relation.relationType}
                      title={relation.title}
                    />
                  }
                />
              );
            })}
          </ol>
        </section>
      ))}

      <AlertDialog
        open={pendingRemoval !== null}
        onOpenChange={(open) => {
          if (!open && !busy) setPendingRemoval(null);
        }}
      >
        <AlertDialogContent
          id="relation-remove-dialog"
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            if (removalReturnFocusRef.current?.isConnected) {
              removalReturnFocusRef.current.focus();
            }
          }}
        >
          <AlertDialogTitle className="m-0 text-lg font-bold">
            删除与“{pendingRemoval?.title}”的关联？
          </AlertDialogTitle>
          <AlertDialogDescription className="m-0 text-sm leading-6 text-muted">
            对向关系也会同时删除。
          </AlertDialogDescription>
          {message ? <p className="m-0 text-sm text-red-700" role="status">{message}</p> : null}
          <AlertDialogFooter>
            <AlertDialogCancel asChild>
              <Button disabled={busy} type="button" variant="outline">取消</Button>
            </AlertDialogCancel>
            <Button
              disabled={busy || !pendingRemoval}
              onClick={() => void removePending()}
              type="button"
              variant="destructive"
            >
              {busy ? "正在删除…" : "确认删除"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function RelationSectionHeader({ count, id, title }: { count: number; id: string; title: string }) {
  return (
    <header className="flex items-baseline gap-3 border-b border-border pb-3">
      <h2 className="m-0 font-display text-xl font-bold" id={id}>{title}</h2>
      <span className="font-mono text-xs text-muted">共 {count} 个</span>
    </header>
  );
}

function WorkRelationActions({
  busy,
  canDelete,
  canEdit,
  onChangeType,
  onDelete,
  relationType,
  title,
}: {
  busy: boolean;
  canDelete: boolean;
  canEdit: boolean;
  onChangeType: (relationType: string) => void;
  onDelete: (returnFocus: HTMLElement | null) => void;
  relationType: string;
  title: string;
}) {
  const menuTriggerRef = useRef<HTMLButtonElement>(null);

  if (!canEdit && !canDelete) {
    return <span className="text-sm text-muted">{relationLabel(relationType)}</span>;
  }

  return (
    <>
      <div className="hidden items-center gap-1 sm:flex">
        {canEdit ? (
          <SelectField
            aria-label={`${title}的关联类型`}
            className="w-36"
            disabled={busy}
            onValueChange={onChangeType}
            options={WORK_RELATION_TYPES.map((value) => ({
              value,
              label: relationLabel(value),
            }))}
            value={relationType}
          />
        ) : (
          <span className="px-2 text-sm text-muted">{relationLabel(relationType)}</span>
        )}
        {canDelete ? (
          <Button
            aria-controls="relation-remove-dialog"
            aria-haspopup="dialog"
            className="text-destructive hover:text-destructive"
            disabled={busy}
            onClick={(event) => onDelete(event.currentTarget)}
            size="sm"
            type="button"
            variant="ghost"
          >
            删除
          </Button>
        ) : null}
      </div>
      <DropdownMenu.Root>
        <DropdownMenu.Trigger asChild>
          <Button
            ref={menuTriggerRef}
            aria-label={`管理关联：${title}`}
            className="size-8 rounded-full sm:hidden"
            disabled={busy}
            size="icon"
            type="button"
            variant="ghost"
          >
            <EllipsisVertical aria-hidden />
          </Button>
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content
            align="end"
            className="z-50 min-w-44 rounded-md border border-border bg-card p-1 text-foreground shadow-surface"
            sideOffset={6}
          >
            {canEdit ? (
              <>
                <DropdownMenu.Label className="px-2.5 py-1.5 text-xs font-semibold text-muted">
                  关联类型
                </DropdownMenu.Label>
                <DropdownMenu.RadioGroup value={relationType} onValueChange={onChangeType}>
                  {WORK_RELATION_TYPES.map((value) => (
                    <DropdownMenu.RadioItem className={menuItemClass} key={value} value={value}>
                      {relationLabel(value)}
                    </DropdownMenu.RadioItem>
                  ))}
                </DropdownMenu.RadioGroup>
              </>
            ) : null}
            {canEdit && canDelete ? <DropdownMenu.Separator className="my-1 h-px bg-border" /> : null}
            {canDelete ? (
              <DropdownMenu.Item
                aria-controls="relation-remove-dialog"
                aria-haspopup="dialog"
                className={`${menuItemClass} text-destructive focus:text-destructive`}
                onSelect={() => onDelete(menuTriggerRef.current)}
              >
                删除关联
              </DropdownMenu.Item>
            ) : null}
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
    </>
  );
}

function TranslationRelationActions({
  busy,
  canDelete,
  onDelete,
  role,
  title,
}: {
  busy: boolean;
  canDelete: boolean;
  onDelete: (returnFocus: HTMLElement | null) => void;
  role: "original" | "translation";
  title: string;
}) {
  const menuTriggerRef = useRef<HTMLButtonElement>(null);
  const roleLabel = TRANSLATION_ROLE_LABELS[role];

  return (
    <div className="flex items-center gap-1">
      <span className="px-2 text-sm text-muted">{roleLabel}</span>
      {canDelete ? (
        <Button
          aria-controls="relation-remove-dialog"
          aria-haspopup="dialog"
          className="hidden text-destructive hover:text-destructive sm:inline-flex"
          disabled={busy}
          onClick={(event) => onDelete(event.currentTarget)}
          size="sm"
          type="button"
          variant="ghost"
        >
          删除
        </Button>
      ) : null}
      {canDelete ? (
        <DropdownMenu.Root>
          <DropdownMenu.Trigger asChild>
            <Button
              ref={menuTriggerRef}
              aria-label={`管理翻译关联：${title}`}
              className="size-8 rounded-full sm:hidden"
              disabled={busy}
              size="icon"
              type="button"
              variant="ghost"
            >
              <EllipsisVertical aria-hidden />
            </Button>
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content
              align="end"
              className="z-50 min-w-36 rounded-md border border-border bg-card p-1 text-foreground shadow-surface"
              sideOffset={6}
            >
              <DropdownMenu.Item
                aria-controls="relation-remove-dialog"
                aria-haspopup="dialog"
                className={`${menuItemClass} text-destructive focus:text-destructive`}
                onSelect={() => onDelete(menuTriggerRef.current)}
              >
                删除关联
              </DropdownMenu.Item>
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
      ) : null}
    </div>
  );
}

function compareRelatedWorks(left: GameWorkRelation, right: GameWorkRelation): number {
  return left.title.localeCompare(right.title, "zh-CN") || left.workId - right.workId;
}

function compareTranslations(
  left: GameTranslationRelation,
  right: GameTranslationRelation,
): number {
  const roleOrder = Number(left.role === "translation") - Number(right.role === "translation");
  return roleOrder || left.title.localeCompare(right.title, "zh-CN") || left.workId - right.workId;
}
