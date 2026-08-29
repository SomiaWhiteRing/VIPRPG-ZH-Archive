"use client";

import { Button } from "@/app/components/ui/button";
import { SelectField } from "@/app/components/ui/select";
import type { CatalogSummary } from "@/lib/server/db/catalogs";
import { Heart, Plus } from "lucide-react";
import { useState } from "react";

export function WorkEngagementActions({
  catalogs,
  currentUserId,
  initialWishlisted,
  workId,
}: {
  catalogs: CatalogSummary[];
  currentUserId: number | null;
  initialWishlisted: boolean;
  workId: number;
}) {
  const [wishlisted, setWishlisted] = useState(initialWishlisted);
  const [catalogId, setCatalogId] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function toggleWishlist() {
    if (!currentUserId || busy) return;
    const next = !wishlisted;
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch(`/api/works/${workId}/me`, {
        method: "PATCH",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ wishlisted: next }),
      });
      if (!response.ok) throw new Error();
      setWishlisted(next);
    } catch {
      setMessage("待玩状态保存失败。");
    } finally {
      setBusy(false);
    }
  }

  async function addToCatalog() {
    if (!catalogId || !currentUserId || busy) return;
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch(`/api/catalogs/${catalogId}/items`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ workId }),
      });
      setMessage(response.ok ? "已加入目录。" : "收录失败。");
    } catch {
      setMessage("网络请求失败。");
    } finally {
      setBusy(false);
    }
  }

  if (!currentUserId) {
    return <p className="m-0 text-xs text-muted">登录后可以加入待玩或目录。</p>;
  }

  return (
    <div className="grid gap-3.5">
      <div className="flex gap-2 max-[560px]:flex-wrap">
        <Button
          aria-pressed={wishlisted}
          className="min-w-0 flex-1 max-[560px]:basis-[calc(50%-0.25rem)]"
          disabled={busy}
          onClick={() => void toggleWishlist()}
          type="button"
          variant={wishlisted ? "default" : "outline"}
        >
          <Heart aria-hidden />
          {wishlisted ? "已加入待玩" : "加入待玩"}
        </Button>
        {catalogs.length ? (
          <Button
            className="min-w-0 flex-1 max-[560px]:basis-[calc(50%-0.25rem)]"
            disabled={busy || !catalogId}
            onClick={() => void addToCatalog()}
            type="button"
            variant="outline"
          >
            <Plus aria-hidden />
            收录到目录
          </Button>
        ) : null}
      </div>
      {catalogs.length ? (
        <SelectField
          className="w-full"
          disabled={busy}
          onValueChange={setCatalogId}
          options={catalogs.map((catalog) => ({ value: String(catalog.id), label: catalog.title }))}
          placeholder="选择要加入的目录"
          value={catalogId}
        />
      ) : null}
      {message ? <p className="m-0 text-xs text-muted" role="status">{message}</p> : null}
    </div>
  );
}
