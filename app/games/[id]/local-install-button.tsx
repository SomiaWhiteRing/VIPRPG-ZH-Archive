import { requestOk } from "@/lib/ui/api-response";

import { Rm2kButton } from "@/app/components/ui/rm2k-button";
import { localRequest } from "@/lib/browser/android-local";
import { isAndroidClient } from "@/lib/browser/client-environment";
import { formatBytes } from "@/lib/format";
import { Download, Play } from "lucide-react";
import { useEffect, useState } from "react";
import { useToast } from "@/app/components/ui/toast";

async function coverPreview(hash: string | null): Promise<string | undefined> {
  if (!hash) return;
  try {
    const response = await requestOk(`/api/media/blobs/${hash}`, { signal: AbortSignal.timeout(10000) });

    const image = await createImageBitmap(await response.blob());
    try {
      const scale = Math.min(1, 256 / Math.max(image.width, image.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(image.width * scale));
      canvas.height = Math.max(1, Math.round(image.height * scale));
      const context = canvas.getContext("2d"); if (!context) return;
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      return canvas.toDataURL("image/jpeg", 0.8);
    } finally { image.close(); }
  } catch { return; }
}

export function LocalInstallButton({ id, bytes, title, workId, coverBlobSha256 }: { id: number; bytes: number; title: string; workId: number; coverBlobSha256: string | null }) {
  const toast = useToast();
  const [native, setNative] = useState(false);
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!isAndroidClient()) return;
    setNative(true);
    const refresh = () => {
      void localRequest<{ items: { archiveVersionId: number; status: string }[] }>("list")
        .then(result => setStatus(result.items.find(item => item.archiveVersionId === id)?.status ?? ""))
        .catch(() => {});
    };
    refresh(); window.addEventListener("viprpg:local-change", refresh);
    return () => window.removeEventListener("viprpg:local-change", refresh);
  }, [id]);
  const queued = status === "created" || status === "installing" || status === "paused";
  return <Rm2kButton className="min-h-12.5 w-full text-base"
    href={native ? undefined : `/play/${workId}`} reloadDocument
    disabled={busy} icon={native && status !== "ready" ? <Download aria-hidden /> : <Play aria-hidden />}
    onClick={native ? () => {
      setBusy(true);
      void (status === "ready" || queued ? localRequest("open", status === "ready" ? { archiveVersionId: id } : {}) : coverPreview(coverBlobSha256).then(coverDataUrl => localRequest<{ status: string }>("install", { archiveVersionId: id, title, workId, coverBlobSha256, coverDataUrl })).then(task => setStatus(task.status)))
        .catch(error => toast.error(error instanceof Error ? error.message : "无法创建安装任务。"))
        .finally(() => setBusy(false));
    } : undefined}>
    {!native ? "在线游玩" : status === "ready" ? "启动游戏" : queued ? "查看下载进度" : <>安装到本地 <span className="text-xs text-white">{formatBytes(bytes)}</span></>}
  </Rm2kButton>;
}
