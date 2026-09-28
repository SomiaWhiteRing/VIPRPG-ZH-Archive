import { Rm2kButton } from "@/app/components/ui/rm2k-button";
import { localRequest } from "@/lib/browser/android-local";
import { isAndroidClient } from "@/lib/browser/client-environment";
import { formatBytes } from "@/lib/format";
import { Download, Play } from "lucide-react";
import { useEffect, useState } from "react";
import { useToast } from "@/app/components/ui/toast";

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
    href={native ? undefined : `/play/${id}`} reloadDocument
    disabled={busy} icon={native && status !== "ready" ? <Download aria-hidden /> : <Play aria-hidden />}
    onClick={native ? () => {
      setBusy(true);
      void (status === "ready" || queued ? localRequest("open", status === "ready" ? { archiveVersionId: id } : {}) : localRequest<{ status: string }>("install", { archiveVersionId: id, title, workId, coverBlobSha256 }).then(task => setStatus(task.status)))
        .catch(error => toast.error(error instanceof Error ? error.message : "无法创建安装任务。"))
        .finally(() => setBusy(false));
    } : undefined}>
    {!native ? "在线游玩" : status === "ready" ? "启动游戏" : queued ? "查看下载进度" : <>安装到本地 <span className="text-xs text-muted">{formatBytes(bytes)}</span></>}
  </Rm2kButton>;
}
