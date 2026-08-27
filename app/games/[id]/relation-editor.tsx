"use client";

import { Button } from "@/app/components/ui/button";
import { FormField } from "@/app/components/ui/form-field";
import { Input } from "@/app/components/ui/input";
import { SelectField } from "@/app/components/ui/select";
import { Textarea } from "@/app/components/ui/textarea";
import {
  WORK_RELATION_TYPES,
  TRANSLATION_ROLE_LABELS,
  relationLabel,
  languageLabel,
} from "@/lib/labels";
import type {
  GameTranslationRelation,
  GameWorkRelation,
} from "@/lib/server/db/game-library";
import { useRouter } from "next/navigation";
import { useState } from "react";

type Candidate = {
  id: number;
  originalTitle: string;
  chineseTitle: string | null;
  language: string;
  isOriginal: boolean;
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
}: {
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
}) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [selected, setSelected] = useState<Candidate | null>(null);
  const [relationType, setRelationType] = useState("same_setting");
  const [translationRole, setTranslationRole] = useState<
    "original" | "translation"
  >("original");
  const [notes, setNotes] = useState("");
  const [noteDrafts, setNoteDrafts] = useState<Record<number, string>>(() =>
    Object.fromEntries(
      relations.map((relation) => [relation.id, relation.notes ?? ""]),
    ),
  );
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function lookup() {
    setMessage(null);
    if (!query.trim()) return;
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
    setCandidates(body.works ?? []);
  }

  async function createOrdinary() {
    if (!selected) {
      setMessage("请先查找并选择目标游戏。");
      return;
    }
    await mutate(`/api/works/${workId}/relations`, "POST", {
      targetWorkId: selected.id,
      relationType,
      notes: notes || null,
    }, "关联已保存。", true, "保存关联失败。");
  }

  async function createTranslation() {
    if (!selected) {
      setMessage("请先查找并选择目标游戏。");
      return;
    }
    if (selected.language === language) {
      setMessage("原版和译版语言必须不同。");
      return;
    }
    await mutate(`/api/works/${workId}/translation-relations`, "POST", {
      targetWorkId: selected.id,
      targetRole: translationRole,
    }, "关联已保存。", true, "保存关联失败。");
  }

  async function mutate(
    path: string,
    method: "POST" | "PATCH" | "DELETE",
    payload?: Record<string, unknown>,
    successMessage = "操作已完成。",
    reset = false,
    failureMessage = "保存关联失败。",
  ) {
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
        return;
      }
      if (reset) {
        setSelected(null);
        setCandidates([]);
        setQuery("");
        setNotes("");
      }
      setMessage(successMessage);
      router.refresh();
    } catch {
      setMessage("网络请求失败。");
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

  async function changeNotes(relation: GameWorkRelation) {
    await mutate(
      `/api/work-relations/${relation.id}`,
      "PATCH",
      { notes: noteDrafts[relation.id] || null },
      "备注已保存。",
      false,
      "备注保存失败。",
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
  return (
    <div className="grid gap-5 border-t border-border pt-5">
      {canCreateRelation || canCreateTranslation ? (
        <div className="grid gap-4 rounded-md border border-border bg-muted/10 p-4">
          <strong>补充关联</strong>
          <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto]">
            <FormField label="查找目标游戏">
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="输入标题或别名"
              />
            </FormField>
            <Button
              className="self-end"
              disabled={busy || !query.trim()}
              onClick={lookup}
              type="button"
              variant="outline"
            >
              查找
            </Button>
          </div>
          {candidates.length ? (
            <div className="grid gap-2">
              {candidates.map((candidate) => (
                <Button
                  className={`h-auto justify-start rounded-md border p-3 text-left text-sm ${selected?.id === candidate.id ? "border-primary bg-primary/5" : "border-border bg-card"}`}
                  key={candidate.id}
                  onClick={() => setSelected(candidate)}
                  type="button"
                  variant="outline"
                >
                  <strong>
                    {candidate.chineseTitle || candidate.originalTitle}
                  </strong>
                  <span className="ml-2 text-muted">
                    {candidate.originalTitle} ·{" "}
                    {languageLabel(candidate.language)}
                  </span>
                </Button>
              ))}
            </div>
          ) : null}
          {selected ? (
            <p className="text-sm text-muted">
              已选择：{selected.chineseTitle || selected.originalTitle}
            </p>
          ) : null}
          <div className="grid gap-4 md:grid-cols-2">
            <FormField label="普通关联类型">
              <SelectField
                onValueChange={setRelationType}
                options={WORK_RELATION_TYPES.map((value) => ({
                  value,
                  label: relationLabel(value),
                }))}
                value={relationType}
              />
            </FormField>
            <FormField label="翻译关联角色">
              <SelectField
                onValueChange={(value) =>
                  setTranslationRole(value as "original" | "translation")
                }
                options={Object.entries(TRANSLATION_ROLE_LABELS).map(
                  ([value, label]) => ({
                    value,
                    label: `${label}（当前游戏是${value === "original" ? "译本" : "原版"}）`,
                  }),
                )}
                value={translationRole}
              />
            </FormField>
          </div>
          <FormField label="普通关联备注">
            <Textarea
              rows={2}
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
            />
          </FormField>
          <div className="flex flex-wrap gap-2">
            {canCreateRelation ? (
              <Button
                disabled={busy || !selected}
                onClick={createOrdinary}
                type="button"
              >
                建立普通关联
              </Button>
            ) : null}
            {canCreateTranslation ? (
              <Button
                disabled={busy || !selected}
                onClick={createTranslation}
                type="button"
                variant="outline"
              >
                建立翻译关联
              </Button>
            ) : null}
          </div>
          {message ? (
            <p className="text-sm text-muted" role="status">
              {message}
            </p>
          ) : null}
        </div>
      ) : null}
      {canUpdate ||
      canUpdateTranslation ||
      canDeleteRelation ||
      canDeleteTranslation ? (
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
                {canEditSource ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <Input
                      aria-label={`${relation.title}关联备注`}
                      className="min-w-48 flex-1"
                      onChange={(event) =>
                        setNoteDrafts((current) => ({
                          ...current,
                          [relation.id]: event.target.value,
                        }))
                      }
                      value={noteDrafts[relation.id] ?? relation.notes ?? ""}
                    />
                    <Button
                      disabled={busy}
                      onClick={() => changeNotes(relation)}
                      size="sm"
                      type="button"
                      variant="outline"
                    >
                      保存备注
                    </Button>
                  </div>
                ) : relation.notes ? (
                  <span className="text-muted">{relation.notes}</span>
                ) : null}
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
        </div>
      ) : null}
    </div>
  );
}
