"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Rm2kButton } from "@/app/components/ui/rm2k-button";

export function UploadCancelButton({ jobId }: { jobId: number }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function cancel() {
    setBusy(true); setError(null);
    try {
      const response = await fetch(`/api/imports/${jobId}/cancel`, { method: "POST", credentials: "same-origin" });
      if (!response.ok) throw new Error("取消失败，任务状态可能已经改变。");
      router.refresh();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "取消失败。"); }
    finally { setBusy(false); }
  }
  return <div className="flex flex-wrap items-center gap-3"><Rm2kButton className="min-h-9 px-2.5 text-xs" disabled={busy} onClick={cancel} type="button">{busy ? "正在取消…" : "取消任务"}</Rm2kButton>{error ? <span className="text-sm text-red-700" role="status">{error}</span> : null}</div>;
}
