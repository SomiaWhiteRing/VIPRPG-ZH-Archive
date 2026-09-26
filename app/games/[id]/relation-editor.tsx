import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogTitle,
} from "@/app/components/ui/alert-dialog";
import { Button } from "@/app/components/ui/button";
import { useToast } from "@/app/components/ui/toast";
import { EmptyState } from "@/app/components/ui/empty-state";
import { InfoTooltip } from "@/app/components/ui/info-tooltip";
import { SearchComboBox } from "@/app/components/ui/search-combobox";
import { WorkThumbnail } from "@/app/components/work/work-thumbnail";
import { SelectField } from "@/app/components/ui/select";
import type { WorkListItemData } from "@/app/components/work/work-list-item";
import { WorkListItem } from "@/app/components/work/work-list-item";
import type {
  GameTranslationRelation,
  GameWorkRelation,
} from "@/lib/dto/db/game-library";
import {
  TRANSLATION_ROLE_LABELS,
  WORK_RELATION_TYPES,
  relationLabel,
} from "@/lib/labels";
import { EllipsisVertical } from "lucide-react";
import { DropdownMenu } from "radix-ui";
import { useEffect, useRef, useState } from "react";
import { useRevalidator } from "react-router";

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
  canCreateRelation: boolean;
  canCreateTranslation: boolean;
  canUpdate: boolean;
  canDeleteRelation: boolean;
  canDeleteTranslation: boolean;
};

type RelationCreateFormProps = Pick<
  RelationEditorProps,
  "workId" | "language" | "canCreateRelation" | "canCreateTranslation"
> & { excludedWorkIds: number[] };

type PendingRemoval = {
  kind: "work" | "translation";
  id: number;
  title: string;
};

const menuItemClass =
  "flex min-h-9 w-full cursor-pointer data-[disabled]:cursor-not-allowed items-center rounded-sm px-2.5 py-2 text-sm outline-none focus:bg-muted/15 data-[disabled]:pointer-events-none data-[disabled]:opacity-50";

export function RelationEditor(props: RelationEditorProps) {
  const showCreate = props.canCreateRelation || props.canCreateTranslation;

  return (
    <div className="grid gap-5 border-t border-border pt-5">
      {showCreate ? (
        <div className="flex justify-end">
          <RelationCreateForm
            canCreateRelation={props.canCreateRelation}
            canCreateTranslation={props.canCreateTranslation}
            language={props.language}
            workId={props.workId}
            excludedWorkIds={[
              ...props.relations,
              ...props.translations,
              ...props.parallelTranslations,
            ].map((item) => item.workId)}
          />
        </div>
      ) : null}
      <RelationManager {...props} />
    </div>
  );
}

export function RelationCreateForm({
  workId,
  language,
  canCreateRelation,
  canCreateTranslation,
  excludedWorkIds,
}: RelationCreateFormProps) {
  const revalidator = useRevalidator();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [result, setResult] = useState<{
    query: string;
    candidates: Candidate[];
  } | null>(null);
  const [searchError, setSearchError] = useState("");
  const [retry, setRetry] = useState(0);
  const [selected, setSelected] = useState<Candidate | null>(null);
  const [relationChoice, setRelationChoice] = useState<RelationChoice>(() =>
    canCreateRelation ? "work:same_setting" : "translation:original",
  );
  const [searching, setSearching] = useState(false);
  const [busy, setBusy] = useState(false);

  const menuOpen = open && !busy;
  const excludedIds = new Set([workId, ...excludedWorkIds]);
  const exclusions = [...excludedIds].sort((a, b) => a - b).join(",");
  const candidates = result?.query === query
    ? result.candidates.filter((candidate) => !excludedIds.has(candidate.id))
    : [];

  useEffect(() => {
    if (!menuOpen || !query.trim() || selected) return;
    const controller = new AbortController();
    setSearching(true);
    setSearchError("");
    const timer = window.setTimeout(async () => {
      try {
        const params = new URLSearchParams({
          title: query.trim(),
          excludeWorkIds: exclusions,
        });
        const response = await fetch(
          `/api/works/lookup?${params}`,
          { credentials: "same-origin", signal: controller.signal },
        );
        const body = (await response.json()) as {
          ok?: boolean;
          works?: Array<Omit<Candidate, "workId" | "title">>;
          detail?: string;
        };
        if (!response.ok || !body.ok)
          throw new Error(body.detail ?? "查找游戏失败。");
        if (!controller.signal.aborted) {
          setResult({
            query,
            candidates: (body.works ?? [])
              .filter((candidate) => candidate.id !== workId)
              .map((candidate) => ({
                ...candidate,
                workId: candidate.id,
                title: candidate.chineseTitle || candidate.originalTitle,
              })),
          });
        }
      } catch (error) {
        if (!controller.signal.aborted)
          setSearchError(
            error instanceof Error ? error.message : "搜索失败，请重试。",
          );
      } finally {
        if (!controller.signal.aborted) setSearching(false);
      }
    }, 200);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [menuOpen, query, retry, selected, workId, exclusions]);

  async function createRelation() {
    if (busy) return;
    if (!selected) {
      toast.error("请先查找并选择关联对象。");
      return;
    }
    if (excludedIds.has(selected.id)) {
      toast.error("该作品已在关联列表中。");
      return;
    }
    if (
      relationChoice.startsWith("translation:") &&
      selected.language === language
    ) {
      toast.error("原版和译版语言必须不同。");
      return;
    }

    const translationRole = relationChoice.startsWith("translation:")
      ? (relationChoice.slice(
          "translation:".length,
        ) as keyof typeof TRANSLATION_ROLE_LABELS)
      : null;
    const path = translationRole
      ? `/api/works/${workId}/translation-relations`
      : `/api/works/${workId}/relations`;
    const payload = translationRole
      ? {
          targetWorkId: selected.id,
          targetRole:
            translationRole === "original" ? "translation" : "original",
        }
      : {
          targetWorkId: selected.id,
          relationType: relationChoice.slice("work:".length),
        };

    setBusy(true);
    try {
      const response = await fetch(path, {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = (await response.json()) as { ok?: boolean; detail?: string };
      if (!response.ok || !body.ok) {
        toast.error(body.detail ?? "保存关联失败。");
        return;
      }
      setSelected(null);
      setQuery("");
      setResult(null);
      setSearching(false);
      setSearchError("");
      toast.success("关联已建立。");
      await revalidator.revalidate();
    } catch {
      toast.error("网络请求失败，请检查连接后重试。");
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
    <div className="grid gap-2">
      <div className="flex flex-wrap items-center gap-3">
        <div className="w-64 max-w-full">
          <SearchComboBox
            id={`relation-target-${workId}`}
            label="关联作品"
            query={query}
            selectedKey={selected?.id ?? null}
            onClear={() => {
              setSelected(null);
              setQuery("");
              setResult(null);
              setSearching(false);
              setSearchError("");
            }}
            onQueryChange={(value) => {
              setQuery(value);
              setSelected(null);
              setSearchError("");
              setSearching(Boolean(value.trim()));
            }}
            onOpenChange={setOpen}
            disabled={busy}
            loading={searching && Boolean(query.trim())}
            items={searching || searchError ? [] : candidates}
            getKey={(candidate) => candidate.id}
            getText={(candidate) => candidate.title}
            placeholder="搜索作品名称或别名"
            maxLength={100}
            onChoose={(candidate) => {
              setSelected(candidate);
              setQuery(candidate.title);
              setResult({ query: candidate.title, candidates });
              setSearching(false);
              setSearchError("");
            }}
            itemClassName="min-h-16 justify-start"
            renderItem={(candidate) => (
              <>
                <span
                  className="flex size-12 shrink-0 overflow-hidden"
                  aria-hidden="true"
                >
                  <WorkThumbnail
                    blobSha256={candidate.coverBlobSha256}
                    width={320}
                    height={240}
                    fallback="暂无封面"
                    fallbackClassName="flex h-full items-center text-xs text-muted"
                    imageClassName="block h-full w-auto max-w-none object-contain object-left"
                  />
                </span>
                <span className="min-w-0 wrap-anywhere">{candidate.title}</span>
              </>
            )}
            emptyState={
              <p
                className="px-3 py-2 text-sm text-muted"
                role={searchError ? "alert" : "status"}
              >
                {!query.trim()
                  ? "输入作品名称或别名开始搜索。"
                  : searching
                    ? "正在搜索…"
                    : searchError || "没有找到可关联的作品。"}
              </p>
            }
            footer={
              searchError && !searching ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="m-2"
                  onClick={() => setRetry((value) => value + 1)}
                >
                  重新搜索
                </Button>
              ) : null
            }
          />
        </div>
        <div className="flex items-center gap-1">
          <SelectField
            aria-label="关联类型"
            disabled={busy}
            onValueChange={(value) => {
              setRelationChoice(value as RelationChoice);
            }}
            options={relationOptions}
            value={relationChoice}
          />
          <InfoTooltip>本作品之于关联对象的关系。</InfoTooltip>
        </div>
        <Button
          disabled={busy || !selected || excludedIds.has(selected.id)}
          onClick={() => void createRelation()}
          type="button"
        >
          {busy ? "正在添加…" : "添加关联"}
        </Button>
      </div>
    </div>
  );
}

export function RelationManager({
  workId,
  relations,
  translations,
  parallelTranslations,
  canUpdate,
  canDeleteRelation,
  canDeleteTranslation,
}: RelationEditorProps) {
  const revalidator = useRevalidator();
  const toast = useToast();
  const removalReturnFocusRef = useRef<HTMLElement | null>(null);
  const [busy, setBusy] = useState(false);
  const [pendingRemoval, setPendingRemoval] = useState<PendingRemoval | null>(
    null,
  );

  const allTranslations = [
    ...translations,
    ...parallelTranslations.filter(
      (item) =>
        item.workId !== workId &&
        !translations.some((direct) => direct.workId === item.workId) &&
        !parallelTranslations.some(
          (candidate) =>
            candidate.workId === item.workId && candidate.id < item.id,
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
    const path =
      pendingRemoval.kind === "work"
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

  function requestRemoval(
    removal: PendingRemoval,
    returnFocus: HTMLElement | null,
  ) {
    removalReturnFocusRef.current = returnFocus;
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
        toast.error(body.detail ?? failureMessage);
        return false;
      }
      toast.success(successMessage);
      revalidator.revalidate();
      return true;
    } catch {
      toast.error("网络请求失败，请检查连接后重试。");
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
      {allTranslations.length ? (
        <section aria-labelledby="translation-relations-heading">
          <RelationSectionHeader
            count={allTranslations.length}
            id="translation-relations-heading"
            title="翻译关联"
          />
          <ol className="divide-y divide-border border-b border-border">
            {allTranslations.map((translation, index) => {
              const isDirectRelation = translations.some(
                (item) => item.id === translation.id,
              );
              return (
                <WorkListItem
                  index={index}
                  item={translation}
                  key={`translation-${translation.id}`}
                  management={
                    <TranslationRelationActions
                      busy={busy}
                      canDelete={canDeleteTranslation && isDirectRelation}
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
        <section
          aria-labelledby={`work-relations-${group.type}`}
          key={group.type}
        >
          <RelationSectionHeader
            count={group.items.length}
            id={`work-relations-${group.type}`}
            title={relationLabel(group.type)}
          />
          <ol className="divide-y divide-border border-b border-border">
            {group.items.map((relation, index) => {
              return (
                <WorkListItem
                  index={index}
                  item={relation}
                  key={relation.id}
                  management={
                    <WorkRelationActions
                      busy={busy}
                      canDelete={canDeleteRelation}
                      canEdit={canUpdate}
                      onChangeType={(relationType) =>
                        void changeType(relation, relationType)
                      }
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
          <AlertDialogFooter>
            <AlertDialogCancel asChild>
              <Button disabled={busy} type="button" variant="outline">
                取消
              </Button>
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

function RelationSectionHeader({
  count,
  id,
  title,
}: {
  count: number;
  id: string;
  title: string;
}) {
  return (
    <header className="flex items-baseline gap-3 border-b border-border pb-3">
      <h2 className="m-0 font-display text-xl font-bold" id={id}>
        {title}
      </h2>
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
    return (
      <span className="text-sm text-muted">{relationLabel(relationType)}</span>
    );
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
          <span className="px-2 text-sm text-muted">
            {relationLabel(relationType)}
          </span>
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
                <DropdownMenu.RadioGroup
                  value={relationType}
                  onValueChange={onChangeType}
                >
                  {WORK_RELATION_TYPES.map((value) => (
                    <DropdownMenu.RadioItem
                      className={menuItemClass}
                      key={value}
                      value={value}
                    >
                      {relationLabel(value)}
                    </DropdownMenu.RadioItem>
                  ))}
                </DropdownMenu.RadioGroup>
              </>
            ) : null}
            {canEdit && canDelete ? (
              <DropdownMenu.Separator className="my-1 h-px bg-border" />
            ) : null}
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

function compareRelatedWorks(
  left: GameWorkRelation,
  right: GameWorkRelation,
): number {
  return (
    left.title.localeCompare(right.title, "zh-CN") || left.workId - right.workId
  );
}

function compareTranslations(
  left: GameTranslationRelation,
  right: GameTranslationRelation,
): number {
  const roleOrder =
    Number(left.role === "translation") - Number(right.role === "translation");
  return (
    roleOrder ||
    left.title.localeCompare(right.title, "zh-CN") ||
    left.workId - right.workId
  );
}
