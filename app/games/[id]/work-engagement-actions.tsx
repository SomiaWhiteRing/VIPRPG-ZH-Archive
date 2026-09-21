import { Input } from "@/app/components/ui/input";
import { Button } from "@/app/components/ui/button";
import { Notice } from "@/app/components/ui/notice";
import { useToast } from "@/app/components/ui/toast";
import * as Dialog from "@/app/components/ui/dialog";
import { EmptyState } from "@/app/components/ui/empty-state";
import { FormField } from "@/app/components/ui/form-field";
import { SelectField } from "@/app/components/ui/select";
import { WorkFavoriteButton } from "@/app/components/work/work-favorite-button";
import type { CatalogSummary } from "@/lib/dto/db/catalogs";
import { useState } from "react";
import { Link, useRevalidator } from "react-router";

export function WorkEngagementActions({
  currentUserId,
  initialFavorited,
  workId,
}: {
  currentUserId: number | null;
  initialFavorited: boolean;
  workId: number;
}) {
  return (
    <WorkFavoriteButton
      currentUserId={currentUserId}
      initialFavorited={initialFavorited}
      workId={workId}
    />
  );
}

export function CatalogAddDialog({
  catalogs,
  workId,
}: {
  catalogs: { items: CatalogSummary[]; total: number; page: number; pageSize: number };
  workId: number;
}) {
  const revalidator = useRevalidator();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [result, setResult] = useState(catalogs);
  const [query, setQuery] = useState("");
  const [activeQuery, setActiveQuery] = useState("");
  const [loading, setLoading] = useState(false);
  async function loadCatalogs(page: number, search = activeQuery) {
    if (loading) return;
    setLoading(true);
    setMessage(null);
    try {
      const response = await fetch(`/api/catalogs?${new URLSearchParams({owner:"me",q:search,page:String(page)})}`, {credentials:"same-origin"});
      if (!response.ok) throw new Error("目录加载失败，请重试。");
      const payload = await response.json() as typeof catalogs & {ok:boolean};
      if (!payload.ok) throw new Error("目录加载失败，请重试。");
      setResult(payload);
      setActiveQuery(search);
      setCatalogId("");
    } catch (error) { setMessage(error instanceof Error ? error.message : "目录加载失败。"); }
    finally { setLoading(false); }
  }

  const [catalogId, setCatalogId] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  function changeOpen(nextOpen: boolean) {
    if (busy) return;
    setOpen(nextOpen);
    if (nextOpen) { setQuery(""); void loadCatalogs(1, ""); }
  }

  async function addToCatalog() {
    if (!catalogId || busy) return;
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch(`/api/catalogs/${catalogId}/items`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ workId }),
      });
      if (!response.ok) {
        toast.error("添加到目录失败，请稍后重试。");
        return;
      }
      toast.success("已添加到目录。");
      setOpen(false);
      revalidator.revalidate();
    } catch {
      toast.error("网络请求失败，请检查连接后重试。");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog.Root open={open} onOpenChange={changeOpen}>
      <Dialog.Trigger asChild>
        <Button
          className="min-w-0 flex-1 shrink px-1 text-[#1f6f67] hover:bg-transparent hover:underline"
          size="sm"
          type="button"
          variant="ghost"
        >
          添加到目录
        </Button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay />
        <Dialog.Content
          aria-describedby="catalog-add-work-description"
          className="left-1/2 top-1/2 grid w-[min(92vw,520px)] -translate-x-1/2 -translate-y-1/2 gap-4 rounded-lg p-5"
        >
          <Dialog.Title>添加到目录</Dialog.Title>
          <Dialog.Description
            className="sr-only"
            id="catalog-add-work-description"
          >
            选择一个目录，将当前游戏添加到其中。
          </Dialog.Description>
          <form className="flex gap-2" onSubmit={(event) => {event.preventDefault(); void loadCatalogs(1, query);}}>
            <Input aria-label="搜索我的目录" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索我的目录" />
            <Button type="submit" variant="outline" disabled={loading || busy}>搜索</Button>
          </form>
          {message ? <Notice>{message}</Notice> : null}
          {loading ? <p role="status" className="text-sm text-muted">正在加载目录…</p> : null}
          {result.items.length ? (
            <>
              <FormField controlId="games-id--field-1" label="目录">
                <SelectField
                  id="games-id--field-1"
                  aria-label="目录"
                  disabled={busy || loading}
                  onValueChange={setCatalogId}
                  options={result.items.map((catalog) => ({
                    value: String(catalog.id),
                    label: catalog.title,
                  }))}
                  placeholder="选择目录"
                  value={catalogId}
                />
              </FormField>
              <div className="flex items-center justify-between gap-2 text-sm">
                <Button type="button" variant="ghost" disabled={loading || busy || result.page <= 1} onClick={() => void loadCatalogs(result.page - 1)}>上一页</Button>
                <span>{result.page} / {Math.max(1, Math.ceil(result.total / result.pageSize))} 页，共 {result.total} 个目录</span>
                <Button type="button" variant="ghost" disabled={loading || busy || result.page * result.pageSize >= result.total} onClick={() => void loadCatalogs(result.page + 1)}>下一页</Button>
              </div>
              <div className="flex justify-end gap-2 border-t border-border pt-4">
                <Dialog.Close asChild>
                  <Button disabled={busy} type="button" variant="outline">
                    关闭
                  </Button>
                </Dialog.Close>
                <Button
                  disabled={busy || loading || !catalogId}
                  onClick={() => void addToCatalog()}
                  type="button"
                >
                  {busy ? "正在添加…" : "添加"}
                </Button>
              </div>
            </>
          ) : (
            <>
              {!loading && !message ? <EmptyState title={activeQuery ? "没有匹配的目录。" : "你还没有可用的目录。"} variant="plain" /> : null}
              <div className="flex justify-end gap-2 border-t border-border pt-4">
                <Dialog.Close asChild>
                  <Button type="button" variant="outline">
                    关闭
                  </Button>
                </Dialog.Close>
                <Button asChild>
                  <Link to="/me/catalogs">管理我的目录</Link>
                </Button>
              </div>
            </>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
