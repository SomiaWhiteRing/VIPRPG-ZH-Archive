"use client";

import { Button } from "@/app/components/ui/button";
import { FormField } from "@/app/components/ui/form-field";
import { Input } from "@/app/components/ui/input";
import { Textarea } from "@/app/components/ui/textarea";
import type { CatalogSummary } from "@/lib/server/db/catalogs";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

export function CatalogCreateForm() {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch("/api/catalogs", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title, description: description || null }),
      });
      const body = (await response.json()) as {
        ok?: boolean;
        catalog?: CatalogSummary;
        detail?: string;
      };
      if (!response.ok || !body.ok || !body.catalog) {
        setMessage(body.detail ?? "目录创建失败。");
        return;
      }
      router.push(`/catalogs/${body.catalog.id}`);
    } catch {
      setMessage("网络请求失败。");
    } finally {
      setBusy(false);
    }
  }
  return (
    <form
      className="grid gap-3 rounded-md border border-border bg-muted/10 p-4"
      onSubmit={submit}
    >
      <strong>创建目录</strong>
      <FormField label="标题">
        <Input
          required
          value={title}
          onChange={(event) => setTitle(event.target.value)}
        />
      </FormField>
      <FormField label="说明">
        <Textarea
          rows={2}
          value={description}
          onChange={(event) => setDescription(event.target.value)}
        />
      </FormField>
      <div>
        <Button disabled={busy || !title.trim()} type="submit">
          创建目录
        </Button>
      </div>
      {message ? (
        <p className="text-sm text-muted" role="status">
          {message}
        </p>
      ) : null}
    </form>
  );
}

export function CatalogSummaryEditor({
  catalog,
  canEdit = true,
  canDelete = true,
}: {
  catalog: CatalogSummary;
  canEdit?: boolean;
  canDelete?: boolean;
}) {
  const router = useRouter();
  const [title, setTitle] = useState(catalog.title);
  const [description, setDescription] = useState(catalog.description ?? "");
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function save() {
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch(`/api/catalogs/${catalog.id}`, {
        method: "PATCH",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title, description }),
      });
      const body = (await response.json()) as { ok?: boolean; detail?: string };
      if (!response.ok || !body.ok) {
        setMessage(body.detail ?? "目录保存失败。");
        return;
      }
      setMessage("已保存。");
      router.refresh();
    } catch {
      setMessage("网络请求失败。");
    } finally {
      setBusy(false);
    }
  }
  async function remove() {
    if (!window.confirm("确定删除这个目录吗？")) return;
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch(`/api/catalogs/${catalog.id}`, {
        method: "DELETE",
        credentials: "same-origin",
      });
      const body = (await response.json()) as { ok?: boolean; detail?: string };
      if (!response.ok || !body.ok) {
        setMessage(body.detail ?? "目录删除失败。");
        return;
      }
      router.push("/catalogs");
    } catch {
      setMessage("网络请求失败。");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="grid gap-3 rounded-md border border-border bg-muted/10 p-4">
      <strong>管理目录</strong>
      <FormField label="标题">
        <Input
          readOnly={!canEdit}
          value={title}
          onChange={(event) => setTitle(event.target.value)}
        />
      </FormField>
      <FormField label="说明">
        <Textarea
          readOnly={!canEdit}
          rows={2}
          value={description}
          onChange={(event) => setDescription(event.target.value)}
        />
      </FormField>
      <div className="flex flex-wrap gap-2">
        {canEdit ? (
          <Button disabled={busy || !title.trim()} onClick={save} type="button">
            保存目录
          </Button>
        ) : null}
        {canDelete ? (
          <Button
            disabled={busy}
            onClick={remove}
            type="button"
            variant="destructive"
          >
            删除目录
          </Button>
        ) : null}
      </div>
      {message ? (
        <p className="text-sm text-muted" role="status">
          {message}
        </p>
      ) : null}
    </div>
  );
}

export type CatalogItemDraft = {
  workId: number;
  title: string;
  sortOrder: number;
  note: string | null;
};

export function CatalogItemsEditor({
  catalogId,
  items,
}: {
  catalogId: number;
  items: CatalogItemDraft[];
}) {
  const router = useRouter();
  const [draft, setDraft] = useState(items);
  const [query, setQuery] = useState("");
  const [candidates, setCandidates] = useState<
    Array<{
      id: number;
      originalTitle: string;
      chineseTitle: string | null;
    }>
  >([]);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function lookup() {
    if (!query.trim()) return;
    const response = await fetch(
      `/api/works/lookup?title=${encodeURIComponent(query.trim())}`,
      { credentials: "same-origin" },
    );
    const body = (await response.json()) as {
      works?: typeof candidates;
      detail?: string;
    };
    if (!response.ok) {
      setMessage(body.detail ?? "查找游戏失败。");
      return;
    }
    setCandidates(body.works ?? []);
  }
  function add(candidate: (typeof candidates)[number]) {
    if (draft.some((item) => item.workId === candidate.id)) return;
    setDraft((current) => [
      ...current,
      {
        workId: candidate.id,
        title: candidate.chineseTitle || candidate.originalTitle,
        sortOrder: 0,
        note: null,
      },
    ]);
    setCandidates([]);
    setQuery("");
  }
  async function save() {
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch(`/api/catalogs/${catalogId}/items`, {
        method: "PATCH",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          items: draft.map((item) => ({
            workId: item.workId,
            sortOrder: item.sortOrder,
            note: item.note,
          })),
        }),
      });
      const body = (await response.json()) as { ok?: boolean; detail?: string };
      if (!response.ok || !body.ok) {
        setMessage(body.detail ?? "目录排序保存失败。");
        return;
      }
      setMessage("目录顺序已保存。");
      router.refresh();
    } catch {
      setMessage("网络请求失败。");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="grid gap-4 rounded-md border border-border bg-muted/10 p-4">
      <strong>管理收录游戏</strong>
      <div className="grid gap-2 md:grid-cols-[minmax(0,1fr)_auto]">
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="查找要加入的游戏"
        />
        <Button
          disabled={!query.trim()}
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
              className="h-auto justify-start text-left"
              key={candidate.id}
              onClick={() => add(candidate)}
              type="button"
              variant="outline"
            >
              {candidate.chineseTitle || candidate.originalTitle}
            </Button>
          ))}
        </div>
      ) : null}
      <ol className="grid gap-2">
        {draft.map((item) => (
          <li
            className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-card p-3"
            key={item.workId}
          >
            <span className="min-w-0 flex-1">
              <a href={`/games/${item.workId}`}>{item.title}</a>
            </span>
            <Input
              aria-label={`${item.title}排序值`}
              className="w-24"
              inputMode="numeric"
              onChange={(event) =>
                setDraft((current) =>
                  current.map((entry) =>
                    entry.workId === item.workId
                      ? { ...entry, sortOrder: Number(event.target.value) }
                      : entry,
                  ),
                )
              }
              type="number"
              value={item.sortOrder}
            />
            <Input
              aria-label={`${item.title}备注`}
              className="w-40"
              value={item.note ?? ""}
              onChange={(event) =>
                setDraft((current) =>
                  current.map((entry) =>
                    entry.workId === item.workId
                      ? { ...entry, note: event.target.value || null }
                      : entry,
                  ),
                )
              }
            />
            <Button
              onClick={() =>
                setDraft((current) =>
                  current.filter((entry) => entry.workId !== item.workId),
                )
              }
              size="sm"
              type="button"
              variant="ghost"
            >
              移除
            </Button>
          </li>
        ))}
      </ol>
      <div>
        <Button disabled={busy} onClick={save} type="button">
          保存顺序
        </Button>
      </div>
      {message ? (
        <p className="text-sm text-muted" role="status">
          {message}
        </p>
      ) : null}
    </div>
  );
}
