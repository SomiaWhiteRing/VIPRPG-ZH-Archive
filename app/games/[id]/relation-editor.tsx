import { useMessages, useUiLocale } from "@/lib/i18n/react";
import { ApiResponseError, requestJson } from "@/lib/ui/api-response";


import { AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogTitle } from "@/app/components/ui/alert-dialog";
import { Button } from "@/app/components/ui/button";
import { useToast } from "@/app/components/ui/toast";
import { EmptyState } from "@/app/components/ui/empty-state";
import { SearchComboBox } from "@/app/components/ui/search-combobox";
import { WorkThumbnail } from "@/app/components/work/work-thumbnail";
import { WorkRelationGuide, WorkRelationHint } from "@/app/components/work/work-relation-guide";
import { SelectField } from "@/app/components/ui/select";
import { type WorkListItemData, WorkListItem } from "@/app/components/work/work-list-item";

import type { GameTranslationRelation, GameWorkRelation } from "@/lib/dto/db/game-library";
import { TRANSLATION_ROLE_LABELS, WORK_RELATION_TYPES, relationLabel } from "@/lib/labels";
import { EllipsisVertical } from "lucide-react";
import { DropdownMenu } from "radix-ui";
import { useEffect, useRef, useState } from "react";

import type { getGameWorkRelations } from "@/app/.server/db/game-library";
import type { RelationEditorCapabilities } from "@/lib/authz/permissions";

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
  onSaved: () => Promise<void>;
};

type RelationCreateFormProps = Pick<
  RelationEditorProps,
  "workId" | "language" | "canCreateRelation" | "canCreateTranslation" | "onSaved"
> & { excludedWorkIds: number[] };

type PendingRemoval = {
  kind: "work" | "translation";
  id: number;
  title: string;
};

const menuItemClass =
  "flex min-h-9 w-full cursor-pointer data-[disabled]:cursor-not-allowed items-center rounded-sm px-2.5 py-2 text-sm outline-none focus:bg-muted/15 data-[disabled]:pointer-events-none data-[disabled]:opacity-50";

export function RelationEditor(props: Omit<RelationEditorProps, "onSaved">) {
  const t = useMessages();
  const [snapshot, setSnapshot] = useState({ source: props.relations, value: props });
  const sequence = useRef(0);
  const data = snapshot.source === props.relations ? snapshot.value : props;
  const showCreate = data.canCreateRelation || data.canCreateTranslation;
  async function refresh() {
    const current = ++sequence.current;
    const result = await requestJson<{
      ok: true; work: NonNullable<Awaited<ReturnType<typeof getGameWorkRelations>>>; capabilities: RelationEditorCapabilities;
    }>(`/api/works/${props.workId}/relations`, {}, t("relation.edit.loadFailed"));
    if (current === sequence.current)
      setSnapshot({ source: props.relations, value: { ...props, ...result.work, ...result.capabilities } });
  }

  return (
    <div className="grid gap-5 border-t border-border pt-5">
      {showCreate ? (
        <div className="flex justify-end">
          <RelationCreateForm
            canCreateRelation={data.canCreateRelation}
            canCreateTranslation={data.canCreateTranslation}
            language={data.language}
            workId={data.workId}
            onSaved={refresh}
            excludedWorkIds={[
              ...data.relations,
              ...data.translations,
              ...data.parallelTranslations,
            ].map((item) => item.workId)}
          />
        </div>
      ) : null}
      <RelationManager {...data} onSaved={refresh} />
    </div>
  );
}

export function RelationCreateForm({
  workId,
  language,
  canCreateRelation,
  canCreateTranslation,
  excludedWorkIds,
  onSaved,
}: RelationCreateFormProps) {
  const t = useMessages();
  const locale = useUiLocale();
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

        const body = (await requestJson(`/api/works/lookup?${params}`, { credentials: "same-origin", signal: controller.signal })) as {
          ok?: boolean;
          works?: Array<Omit<Candidate, "workId" | "title">>;
          detail?: string;
        };

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
            error instanceof ApiResponseError ? error.messageFor(locale)
              : error instanceof Error ? error.message : t("relation.edit.searchFailed"),
          );
      } finally {
        if (!controller.signal.aborted) setSearching(false);
      }
    }, 200);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [menuOpen, query, retry, selected, workId, exclusions, locale, t]);

  async function createRelation() {
    if (busy) return;
    if (!selected) {
      toast.error(t("relation.edit.pick"));
      return;
    }
    if (excludedIds.has(selected.id)) {
      toast.error(t("relation.edit.duplicate"));
      return;
    }
    if (
      relationChoice.startsWith("translation:") &&
      selected.language === language
    ) {
      toast.error(t("relation.edit.sameLanguage"));
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
          targetRole: translationRole,
        }
      : {
          targetWorkId: selected.id,
          relationType: relationChoice.slice("work:".length),
        };

    setBusy(true);
    try {

      await requestJson(path, {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });

      setSelected(null);
      setQuery("");
      setResult(null);
      setSearching(false);
      setSearchError("");
      toast.success(t("relation.edit.created"));
      await onSaved();
    } catch (error) {
      toast.error(error instanceof ApiResponseError ? error : t("relation.edit.network"));
    } finally {
      setBusy(false);
    }
  }

  const relationOptions = [
    ...(canCreateRelation
      ? WORK_RELATION_TYPES.map((value) => ({
          value: `work:${value}`,
          label: relationLabel(value, locale),
        }))
      : []),
    ...(canCreateTranslation
      ? (
          Object.entries(TRANSLATION_ROLE_LABELS) as Array<
            [keyof typeof TRANSLATION_ROLE_LABELS, string]
          >
        ).map(([value], index) => ({
          value: `translation:${value}`,
          label: t(`relation.${value}`),
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
            label={t("relation.edit.target")}
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
            placeholder={t("relation.edit.placeholder")}
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
                    fallback={t("work.noCover")}
                    fallbackClassName="flex h-full items-center text-xs text-muted"
                    imageClassName="block h-full w-auto max-w-none object-contain object-left"
                  />
                </span>
                <span className="min-w-0 wrap-anywhere">{candidate.title}</span>
              </>
            )}
            emptyState={query.trim() ? (
              <p
                className="px-3 py-2 text-sm text-muted"
                role={searchError ? "alert" : "status"}
              >
                {searching
                    ? t("relation.edit.searching")
                    : searchError || t("relation.edit.noMatch")}
              </p>
            ) : null}
            footer={
              searchError && !searching ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="m-2"
                  onClick={() => setRetry((value) => value + 1)}
                >
                  {t("relation.edit.retry")}
                </Button>
              ) : null
            }
          />
        </div>
        <div className="flex items-center gap-1">
          <SelectField
            aria-label={t("relation.edit.type")}
            triggerClassName="w-[calc(5em+3rem+2px)] shrink-0"
            disabled={busy}
            onValueChange={(value) => {
              setRelationChoice(value as RelationChoice);
            }}
            options={relationOptions}
            value={relationChoice}
          />
          <WorkRelationHint type={relationChoice.slice(relationChoice.indexOf(":") + 1)} />
        </div>
        <Button
          disabled={busy || !selected || excludedIds.has(selected.id)}
          onClick={() => void createRelation()}
          type="button"
        >
          {busy ? t("relation.edit.adding") : t("relation.edit.add")}
        </Button>
        <WorkRelationGuide />
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
  onSaved,
}: RelationEditorProps) {
  const t = useMessages();
  const locale = useUiLocale();
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
      t("relation.edit.updated"),
      t("relation.edit.updateFailed"),
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
      t("relation.edit.deleted"),
      t("relation.edit.deleteFailed"),
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

      await requestJson(path, {
        method,
        credentials: "same-origin",
        ...(payload
          ? {
              headers: { "content-type": "application/json" },
              body: JSON.stringify(payload),
            }
          : {}),
      }, failureMessage);

      toast.success(successMessage);
      await onSaved();
      return true;
    } catch (error) {
      toast.error(error instanceof ApiResponseError ? error : t("relation.edit.network"));
      return false;
    } finally {
      setBusy(false);
    }
  }

  if (!allTranslations.length && !relationGroups.length) {
    return <EmptyState title={t("relation.edit.empty")} />;
  }

  return (
    <div className="grid gap-7">
      {allTranslations.length ? (
        <section aria-labelledby="translation-relations-heading">
          <RelationSectionHeader
            count={allTranslations.length}
            id="translation-relations-heading"
            title={t("relation.edit.translations")}
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
            title={relationLabel(group.type, locale)}
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
            {t("relation.edit.removeTitle", { title: pendingRemoval?.title ?? "" })}
          </AlertDialogTitle>
          <AlertDialogDescription className="m-0 text-sm leading-6 text-muted">
            {t("relation.edit.removeBoth")}
          </AlertDialogDescription>
          <AlertDialogFooter>
            <AlertDialogCancel asChild>
              <Button disabled={busy} type="button" variant="outline">
                {t("relation.edit.cancel")}
              </Button>
            </AlertDialogCancel>
            <Button
              disabled={busy || !pendingRemoval}
              onClick={() => void removePending()}
              type="button"
              variant="destructive"
            >
              {busy ? t("relation.edit.removing") : t("relation.edit.confirm")}
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
  const t = useMessages();
  return (
    <header className="flex items-baseline gap-3 border-b border-border pb-3">
      <h2 className="m-0 font-display text-xl font-bold" id={id}>
        {title}
      </h2>
      <span className="font-mono text-xs text-muted">{t("relation.edit.count", { count })}</span>
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
  const t = useMessages();
  const locale = useUiLocale();
  const menuTriggerRef = useRef<HTMLButtonElement>(null);

  if (!canEdit && !canDelete) {
    return (
      <span className="text-sm text-muted">{relationLabel(relationType, locale)}</span>
    );
  }

  return (
    <>
      <div className="hidden items-center gap-1 sm:flex">
        {canEdit ? (
          <SelectField
            aria-label={t("relation.edit.typeFor", { title })}
            triggerClassName="w-[calc(5em+3rem+2px)] shrink-0"
            disabled={busy}
            onValueChange={onChangeType}
            options={WORK_RELATION_TYPES.map((value) => ({
              value,
              label: relationLabel(value, locale),
            }))}
            value={relationType}
          />
        ) : (
          <span className="px-2 text-sm text-muted">
            {relationLabel(relationType, locale)}
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
            {t("relation.edit.remove")}
          </Button>
        ) : null}
      </div>
      <DropdownMenu.Root>
        <DropdownMenu.Trigger asChild>
          <Button
            ref={menuTriggerRef}
            aria-label={t("relation.edit.manage", { title })}
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
                  {t("relation.edit.type")}
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
                      {relationLabel(value, locale)}
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
                {t("relation.edit.removeRelation")}
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
  const t = useMessages();
  const menuTriggerRef = useRef<HTMLButtonElement>(null);
  const roleLabel = t(`relation.${role}`);

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
          {t("relation.edit.remove")}
        </Button>
      ) : null}
      {canDelete ? (
        <DropdownMenu.Root>
          <DropdownMenu.Trigger asChild>
            <Button
              ref={menuTriggerRef}
              aria-label={t("relation.edit.manageTranslation", { title })}
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
                {t("relation.edit.removeRelation")}
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
