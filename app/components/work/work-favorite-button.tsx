"use client";

import { useState } from "react";
import { Heart } from "lucide-react";
import { Button } from "@/app/components/ui/button";

export function WorkFavoriteButton({
  currentUserId,
  initialFavorited,
  workId,
}: {
  currentUserId: number | null;
  initialFavorited: boolean;
  workId: number;
}) {
  const [favorited, setFavorited] = useState(initialFavorited);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function toggleFavorite() {
    if (!currentUserId || busy) return;
    const next = !favorited;
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch(`/api/works/${workId}/me`, {
        method: "PATCH",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ favorited: next }),
      });
      if (!response.ok) throw new Error();
      setFavorited(next);
    } catch {
      setMessage("收藏状态保存失败，请稍后重试。");
    } finally {
      setBusy(false);
    }
  }

  if (!currentUserId) {
    return <p className="m-0 text-xs text-muted">登录后可以收藏作品。</p>;
  }

  return (
    <div className="grid gap-2">
      <Button
        aria-pressed={favorited}
        className="w-full"
        disabled={busy}
        onClick={() => void toggleFavorite()}
        type="button"
        variant={favorited ? "default" : "outline"}
      >
        <Heart aria-hidden />
        {favorited ? "已收藏" : "收藏"}
      </Button>
      {message ? <p className="m-0 text-xs text-muted" role="status">{message}</p> : null}
    </div>
  );
}
