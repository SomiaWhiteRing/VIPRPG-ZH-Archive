"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/app/components/ui/button";
import { notifyInboxChanged } from "@/lib/inbox-events";

export function InboxActions({ item, all = false }: {
  item?: { id:number; readAt:string|null; canApprove:boolean; canReject:boolean }; all?: boolean;
}) {
  const router = useRouter();
  const [busy,setBusy] = useState(false);
  const [refreshing,startTransition] = useTransition();
  const [error,setError] = useState("");
  const disabled = busy || refreshing;
  async function act(action: "read" | "approve" | "reject") {
    if (disabled) return;
    setBusy(true);
    setError("");
    try {
      const data = new FormData();
      if (action !== "read") data.set("decision",action);
      const url = all ? "/api/inbox/read-all" : `/api/inbox/${item!.id}/${action === "read" ? "read" : "resolve"}`;
      const response = await fetch(url,{method:"POST",headers:{Accept:"application/json"},body:data});
      const result = await response.json() as { detail?: unknown };
      const detail = typeof result.detail === "string" ? result.detail : null;
      if (!response.ok) {
        if (response.status === 409) {
          notifyInboxChanged(detail || "申请状态已变化，请查看最新结果。");
          document.getElementById("inbox-controls")?.focus({preventScroll:true});
          startTransition(() => router.refresh());
        }
        throw new Error(response.status === 401 ? "登录已失效，请重新登录后重试。" : detail || "操作失败，请重试。");
      }
      notifyInboxChanged(action === "read" ? all ? "已将全部提醒标记为已读。" : "已标记为已读。" : action === "approve" ? "申请已通过。" : "申请已驳回。");
      document.getElementById("inbox-controls")?.focus({preventScroll:true});
      startTransition(() => router.refresh());
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "操作失败，请重试。");
    } finally { setBusy(false); }
  }
  return (
    <div className="min-w-0" aria-busy={disabled}>
      <div className="flex flex-wrap items-center gap-2">
        {item?.canApprove ? <Button size="sm" disabled={disabled} onClick={() => void act("approve")}>通过</Button> : null}
        {item?.canReject ? <Button size="sm" variant="outline" disabled={disabled} onClick={() => void act("reject")}>驳回</Button> : null}
        {all || (item && !item.readAt) ? <Button size="sm" variant={all ? "outline" : "ghost"} disabled={disabled}
          onClick={() => void act("read")}>{all ? "全部标记已读" : "标记已读"}</Button> : null}
      </div>
      {error ? <p role="alert" className="mt-2 max-w-sm text-sm text-destructive">{error}</p> : null}
    </div>
  );
}
