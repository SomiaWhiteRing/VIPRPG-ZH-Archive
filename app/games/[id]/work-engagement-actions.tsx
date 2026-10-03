import { ApiResponseError, requestJson } from "@/lib/ui/api-response";


import { CatalogCreateFields } from "@/app/catalogs/catalog-create-fields";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/app/components/ui/tabs";
import { Input } from "@/app/components/ui/input";
import { Button } from "@/app/components/ui/button";
import { Notice } from "@/app/components/ui/notice";
import { useToast } from "@/app/components/ui/toast";
import * as Dialog from "@/app/components/ui/dialog";
import { EmptyState } from "@/app/components/ui/empty-state";
import { CatalogSummaryList } from "@/app/components/profile/catalog-summary-list";
import { WorkFavoriteButton } from "@/app/components/work/work-favorite-button";
import type { WorkFavoriteUpdate } from "@/lib/user-tags";
import type { CatalogSummary } from "@/lib/dto/db/catalogs";
import { useState } from "react";
import { Link, useNavigate } from "react-router";

export function WorkEngagementActions({
  onSaved,
  summary,
  currentUserId,
  initialFavorited,
  workId,
}: {
  onSaved: (update: WorkFavoriteUpdate) => void | Promise<void>;
  summary?: "counts" | "tags";
  currentUserId: number | null;
  initialFavorited: boolean;
  workId: number;
}) {
  return (
    <WorkFavoriteButton
      onSaved={onSaved}
      summary={summary}
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
  const navigate = useNavigate();
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
      const payload = await requestJson<typeof catalogs>(`/api/catalogs?${new URLSearchParams({owner:"me",q:search,page:String(page)})}`, {credentials:"same-origin"}, "目录加载失败");
      setResult(payload);
      setActiveQuery(search);
    } catch (error) { setMessage(error instanceof Error ? error.message : "目录加载失败。"); }
    finally { setLoading(false); }
  }

  const [addingCatalogId, setAddingCatalogId] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  function changeOpen(nextOpen: boolean) {
    if (busy) return;
    setOpen(nextOpen);
    if (nextOpen) { setQuery(""); void loadCatalogs(1, ""); }
  }

  async function addToCatalog(catalogId: number) {
    if (busy || loading) return;
    setAddingCatalogId(catalogId);
    setBusy(true);
    setMessage(null);
    try {

      await requestJson(`/api/catalogs/${catalogId}/items`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ workId }),
      });

      toast.success("已添加到目录。");
      setOpen(false);
      navigate(`/catalogs/${catalogId}`);
    } catch (error) {
      toast.error(error instanceof ApiResponseError ? error.message : "网络请求失败，请检查连接后重试。");
    } finally {
      setBusy(false);
      setAddingCatalogId(null);
    }
  }

  return (
    <Dialog.Root open={open} onOpenChange={changeOpen}>
      <Dialog.Trigger asChild>
        <Button
          className="min-w-0 flex-1 shrink px-1 text-secondary hover:bg-transparent hover:underline"
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
          className="left-1/2 top-1/2 grid max-h-[90dvh] w-[min(92vw,760px)] overflow-y-auto -translate-x-1/2 -translate-y-1/2 gap-4 rounded-lg p-5"
        >
          <Dialog.Title>添加到目录</Dialog.Title>
          <Dialog.Description
            className="sr-only"
            id="catalog-add-work-description"
          >
            选择已有目录或创建新目录，将当前游戏添加到其中。
          </Dialog.Description>
          <Tabs defaultValue="existing">
            <TabsList aria-label="添加到目录方式">
              <TabsTrigger disabled={busy} value="existing">加入已有目录</TabsTrigger>
              <TabsTrigger disabled={busy} value="create">创建并加入新目录</TabsTrigger>
            </TabsList>
            <TabsContent value="existing" className="grid gap-4 pb-0 data-[state=inactive]:hidden">
              <form className="flex gap-2" onSubmit={(event) => {event.preventDefault(); void loadCatalogs(1, query);}}>
                <Input aria-label="搜索我的目录" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索我的目录" />
                <Button type="submit" variant="outline" disabled={loading || busy}>搜索</Button>
              </form>
              {message ? <Notice>{message}</Notice> : null}
              {loading ? <p role="status" className="text-sm text-muted">正在加载目录…</p> : null}
              {result.items.length ? (
                <>
                  <div className="max-h-[45dvh] overflow-y-auto">
                    <CatalogSummaryList
                      items={result.items}
                      showDescription
                      renderActions={(catalog) => (
                        <Button
                          disabled={busy || loading}
                          onClick={() => void addToCatalog(catalog.id)}
                          size="sm"
                          type="button"
                        >
                          {addingCatalogId === catalog.id ? "正在添加…" : "添加到目录"}
                        </Button>
                      )}
                    />
                  </div>
                  <div className="flex items-center justify-between gap-2 text-sm">
                    <Button type="button" variant="ghost" disabled={loading || busy || result.page <= 1} onClick={() => void loadCatalogs(result.page - 1)}>上一页</Button>
                    <span>{result.page} / {Math.max(1, Math.ceil(result.total / result.pageSize))} 页，共 {result.total} 个目录</span>
                    <Button type="button" variant="ghost" disabled={loading || busy || result.page * result.pageSize >= result.total} onClick={() => void loadCatalogs(result.page + 1)}>下一页</Button>
                  </div>
                </>
              ) : (
                !loading && !message ? <EmptyState title={activeQuery ? "没有匹配的目录。" : "你还没有可用的目录。"} variant="plain" /> : null
              )}
              <div className="flex justify-end gap-2 border-t border-border pt-4">
                <Dialog.Close asChild>
                  <Button disabled={busy} type="button" variant="outline">
                    关闭
                  </Button>
                </Dialog.Close>
                <Button asChild>
                  <Link
                    aria-disabled={busy || undefined}
                    onClick={(event) => { if (busy) event.preventDefault(); }}
                    to="/me/catalogs"
                  >
                    管理我的目录
                  </Link>
                </Button>
              </div>
            </TabsContent>
            <TabsContent forceMount value="create" className="pb-0 data-[state=inactive]:hidden">
              <CatalogCreateFields
                busy={busy}
                onBusyChange={setBusy}
                onCancel={() => changeOpen(false)}
                workId={workId}
              />
            </TabsContent>
          </Tabs>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
