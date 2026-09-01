"use client";

import { CatalogGameListItem } from "@/app/catalogs/catalog-game-list-item";
import { Button } from "@/app/components/ui/button";
import { InfoTooltip } from "@/app/components/ui/info-tooltip";
import { Input } from "@/app/components/ui/input";
import { SelectField } from "@/app/components/ui/select";
import {
  WORK_RELATION_TYPES,
  TRANSLATION_ROLE_LABELS,
  relationLabel,
} from "@/lib/labels";
import type {
  GameTranslationRelation,
  GameWorkRelation,
} from "@/lib/server/db/game-library";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Dialog } from "radix-ui";

type Candidate = {
  id: number;
  originalTitle: string;
  chineseTitle: string | null;
  originalReleaseDate: string | null;
  engineFamily: string;
  language: string;
  previewBlobSha256: string | null;
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
  canUpdateTranslation: boolean;
  canDeleteRelation: boolean;
  canDeleteTranslation: boolean;
  canManageRelationsAny: boolean;
  canManageTranslationsAny: boolean;
  mode?: "all" | "create" | "manage";
  onCreated?: () => void;
};

export function RelationEditor({
  workId,
  language,
  relations,
  translations,
  parallelTranslations,
  currentUserId,
  canCreateRelation,
  canCreateTranslation,
  canUpdate,
  canUpdateTranslation,
  canDeleteRelation,
  canDeleteTranslation,
  canManageRelationsAny,
  canManageTranslationsAny,
  mode = "all",
  onCreated,
}: RelationEditorProps) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [selected, setSelected] = useState<Candidate | null>(null);
  const [relationChoice, setRelationChoice] = useState<RelationChoice>(() =>
    canCreateRelation ? "work:same_setting" : "translation:original",
  );
  const [searching, setSearching] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

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
        works?: Candidate[];
        detail?: string;
      };
      if (!response.ok || !body.ok) {
        setMessage(body.detail ?? "查找游戏失败。");
        return;
      }
      const works = (body.works ?? []).filter(
        (candidate) => candidate.id !== workId,
      );
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
    let saved = false;
    if (relationChoice.startsWith("translation:")) {
      if (selected.language === language) {
        setMessage("原版和译版语言必须不同。");
        return;
      }
      const currentRole = relationChoice.slice(
        "translation:".length,
      ) as keyof typeof TRANSLATION_ROLE_LABELS;
      saved = await mutate(
        `/api/works/${workId}/translation-relations`,
        "POST",
        {
          targetWorkId: selected.id,
          targetRole: currentRole === "original" ? "translation" : "original",
        },
        "关联已保存。",
        true,
        "保存关联失败。",
      );
    } else {
      saved = await mutate(
        `/api/works/${workId}/relations`,
        "POST",
        {
          targetWorkId: selected.id,
          relationType: relationChoice.slice("work:".length),
        },
        "关联已保存。",
        true,
        "保存关联失败。",
      );
    }
    if (saved) onCreated?.();
  }

  async function mutate(
    path: string,
    method: "POST" | "PATCH" | "DELETE",
    payload?: Record<string, unknown>,
    successMessage = "操作已完成。",
    reset = false,
    failureMessage = "保存关联失败。",
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
      if (reset) {
        setSelected(null);
        setCandidates([]);
        setQuery("");
      }
      setMessage(successMessage);
      router.refresh();
      return true;
    } catch {
      setMessage("网络请求失败。");
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function remove(path: string) {
    await mutate(
      path,
      "DELETE",
      undefined,
      "关联已删除。",
      false,
      "删除关联失败。",
    );
  }

  async function changeOrder(
    relation: GameWorkRelation,
    index: number,
    delta: number,
  ) {
    const neighbor = relations[index + delta];
    if (!neighbor) return;
    await mutate(
      `/api/work-relations/${relation.id}`,
      "PATCH",
      { direction: delta },
      "排序已保存。",
      false,
      "排序保存失败。",
    );
  }

  async function changeType(relation: GameWorkRelation, nextType: string) {
    await mutate(
      `/api/work-relations/${relation.id}`,
      "PATCH",
      { relationType: nextType },
      "关联类型已保存。",
      false,
      "关联类型保存失败。",
    );
  }

  async function changeTranslationOrder(
    translation: GameTranslationRelation,
    delta: number,
  ) {
    const index = translations.findIndex((item) => item.id === translation.id);
    const neighbor = index < 0 ? null : translations[index + delta];
    if (!neighbor) return;
    await mutate(
      `/api/translation-relations/${translation.id}`,
      "PATCH",
      { direction: delta },
      "翻译关联排序已保存。",
      false,
      "翻译关联排序保存失败。",
    );
  }

  const allTranslations = [
    ...translations,
    ...parallelTranslations.filter(
      (item) =>
        item.workId !== workId &&
        !translations.some((direct) => direct.workId === item.workId),
    ),
  ].sort((a, b) => a.relationOrder - b.relationOrder || a.id - b.id);
  const showCreate =
    mode !== "manage" && (canCreateRelation || canCreateTranslation);
  const showManage =
    mode !== "create" &&
    (canUpdate ||
      canUpdateTranslation ||
      canDeleteRelation ||
      canDeleteTranslation);
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
    <div
      className={
        mode === "create"
          ? "grid gap-5"
          : "grid gap-5 border-t border-border pt-5"
      }
    >
      {showCreate ? (
        <div
          className={
            mode === "create"
              ? "grid gap-4"
              : "grid gap-4 rounded-md border border-border bg-muted/10 p-4"
          }
        >
          {mode === "all" ? <strong>补充关联</strong> : null}
          <div className="grid gap-2 text-sm font-semibold">
            <div className="flex items-center gap-1">
              <span>关联类型</span>
              <InfoTooltip>本作品之于关联对象的关系。</InfoTooltip>
            </div>
            <SelectField
              disabled={busy}
              onValueChange={(value) => {
                setRelationChoice(value as RelationChoice);
                setMessage(null);
              }}
              options={relationOptions}
              value={relationChoice}
            />
          </div>
          <div className="grid min-h-0 gap-2 text-sm font-semibold">
            <span>关联对象</span>
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
            <div className="min-h-52 overflow-y-auto">
              {candidates.length ? (
                <ol
                  aria-label="查找结果"
                  className="divide-y divide-border border-y border-border"
                >
                  {candidates.map((candidate, index) => (
                    <CatalogGameListItem
                      index={index}
                      item={{
                        workId: candidate.id,
                        title:
                          candidate.chineseTitle || candidate.originalTitle,
                        originalTitle: candidate.originalTitle,
                        chineseTitle: candidate.chineseTitle,
                        originalReleaseDate: candidate.originalReleaseDate,
                        engineFamily: candidate.engineFamily,
                        language: candidate.language,
                        previewBlobSha256: candidate.previewBlobSha256,
                        sortOrder: 0,
                        note: null,
                      }}
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
                          variant={
                            selected?.id === candidate.id
                              ? "default"
                              : "outline"
                          }
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
          </div>
          <div className="flex justify-end gap-2 border-t border-border pt-4">
            {mode === "create" ? (
              <Dialog.Close asChild>
                <Button disabled={busy} type="button" variant="outline">
                  取消
                </Button>
              </Dialog.Close>
            ) : null}
            <Button
              disabled={busy || searching || !selected}
              onClick={() => void createRelation()}
              type="button"
            >
              {busy ? "正在建立…" : "建立关联"}
            </Button>
          </div>
        </div>
      ) : null}
      {showManage ? (
        <div className="grid gap-3 text-sm">
          {relations.map((relation, index) => {
            const ownsRelation =
              relation.createdByUserId === currentUserId ||
              canManageRelationsAny;
            const canEditSource =
              canUpdate && !relation.viceVersa && ownsRelation;
            return (
              <div
                className="grid gap-2 border-b border-border pb-3 last:border-0"
                key={relation.id}
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="min-w-0 flex-1">{relation.title}</span>
                  <div className="flex flex-wrap items-center justify-end gap-1">
                    {canEditSource ? (
                      <SelectField
                        className="w-36"
                        onValueChange={(value) => changeType(relation, value)}
                        options={WORK_RELATION_TYPES.map((value) => ({
                          value,
                          label: relationLabel(value),
                        }))}
                        value={relation.relationType}
                      />
                    ) : (
                      <span>{relationLabel(relation.relationType)}</span>
                    )}
                    {canUpdate && ownsRelation ? (
                      <>
                        <Button
                          disabled={busy || index === 0}
                          onClick={() => changeOrder(relation, index, -1)}
                          size="sm"
                          type="button"
                          variant="ghost"
                        >
                          上移
                        </Button>
                        <Button
                          disabled={busy || index === relations.length - 1}
                          onClick={() => changeOrder(relation, index, 1)}
                          size="sm"
                          type="button"
                          variant="ghost"
                        >
                          下移
                        </Button>
                      </>
                    ) : null}
                    {canDeleteRelation && ownsRelation ? (
                      <Button
                        disabled={busy}
                        onClick={() =>
                          remove(`/api/work-relations/${relation.id}`)
                        }
                        size="sm"
                        type="button"
                        variant="ghost"
                      >
                        删除
                      </Button>
                    ) : null}
                  </div>
                </div>
              </div>
            );
          })}
          {allTranslations.map((translation) => {
            const directIndex = translations.findIndex(
              (item) => item.id === translation.id,
            );
            const canEditOrder =
              canUpdateTranslation &&
              (translation.createdByUserId === currentUserId ||
                canManageTranslationsAny);
            return (
              <div
                className="flex flex-wrap items-center justify-between gap-2"
                key={`translation-${translation.id}`}
              >
                <span>
                  {translation.role === "original" ? "原版" : "译版"}：
                  {translation.title}
                </span>
                <div className="flex flex-wrap items-center gap-1">
                  {canEditOrder && directIndex >= 0 ? (
                    <>
                      <Button
                        disabled={busy || directIndex === 0}
                        onClick={() => changeTranslationOrder(translation, -1)}
                        size="sm"
                        type="button"
                        variant="ghost"
                      >
                        上移
                      </Button>
                      <Button
                        disabled={
                          busy || directIndex === translations.length - 1
                        }
                        onClick={() => changeTranslationOrder(translation, 1)}
                        size="sm"
                        type="button"
                        variant="ghost"
                      >
                        下移
                      </Button>
                    </>
                  ) : null}
                  {canDeleteTranslation &&
                  (translation.createdByUserId === currentUserId ||
                    canManageTranslationsAny) ? (
                    <Button
                      disabled={busy}
                      onClick={() =>
                        remove(`/api/translation-relations/${translation.id}`)
                      }
                      size="sm"
                      type="button"
                      variant="ghost"
                    >
                      删除
                    </Button>
                  ) : null}
                </div>
              </div>
            );
          })}
          {!showCreate && message ? (
            <p className="m-0 text-sm text-muted" role="status">
              {message}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export function RelationCreateDialog(
  props: Omit<RelationEditorProps, "mode" | "onCreated">,
) {
  const [open, setOpen] = useState(false);

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger asChild>
        <Button
          className="min-w-0 flex-1 shrink px-1 text-[#1f6f67] hover:bg-transparent hover:underline"
          size="sm"
          type="button"
          variant="ghost"
        >
          添加关联
        </Button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/45" />
        <Dialog.Content
          aria-describedby="relation-create-description"
          className="fixed left-1/2 top-1/2 z-50 grid max-h-[85dvh] w-[min(92vw,680px)] -translate-x-1/2 -translate-y-1/2 gap-4 overflow-y-auto rounded-lg border border-border bg-card p-5 shadow-surface"
        >
          <Dialog.Title className="m-0 text-lg font-bold">
            添加关联
          </Dialog.Title>
          <Dialog.Description
            className="sr-only"
            id="relation-create-description"
          >
            选择关联类型，查找关联对象并建立关联。
          </Dialog.Description>
          <RelationEditor
            {...props}
            mode="create"
            onCreated={() => setOpen(false)}
          />
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
