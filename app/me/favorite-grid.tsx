"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { GameCard } from "@/app/components/home/game-card";
import { Rm2kButton } from "@/app/components/ui/rm2k-button";
import type { UserWorkListItem } from "@/lib/server/db/game-library";

export function FavoriteGrid({ items }: { items: UserWorkListItem[] }) {
  const router = useRouter();
  const [busyId, setBusyId] = useState<number | null>(null);
  async function remove(workId: number) {
    setBusyId(workId);
    try {
      const response = await fetch(`/api/works/${workId}/me`, { method: "PATCH", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify({ favorited: false }) });
      if (response.ok) router.refresh();
    } finally { setBusyId(null); }
  }
  return <ul className="grid grid-cols-2 gap-4 lg:grid-cols-3">{items.map(({ work }) => <li className="grid content-start gap-2" key={work.id}><GameCard work={work} /><Rm2kButton className="min-h-9 px-2.5 text-xs" disabled={busyId === work.id} onClick={() => remove(work.id)} type="button">{busyId === work.id ? "正在取消…" : "取消收藏"}</Rm2kButton></li>)}</ul>;
}
