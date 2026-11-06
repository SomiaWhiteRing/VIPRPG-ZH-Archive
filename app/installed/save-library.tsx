import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/app/components/ui/button";
import { Checkbox } from "@/app/components/ui/checkbox";
import { EmptyState } from "@/app/components/ui/empty-state";
import { Label } from "@/app/components/ui/label";
import { useConfirm } from "@/app/components/ui/confirm-provider";
import { useToast } from "@/app/components/ui/toast";
import { formatBytes, formatDate } from "@/lib/format";
import type { LocalLibraryWork } from "@/app/play/[workId]/web-play-db";
import { acquireGameSaveTransferLock } from "@/app/play/[workId]/web-play-locks";
import { WebPlaySaveExport } from "@/app/play/[workId]/web-play-save-export";
import { deleteSaveFiles, readSaveFiles, type SaveFile } from "@/app/play/[workId]/web-play-save-transfer";
export function SaveManager({ work, onChanged }: { work: LocalLibraryWork; onChanged: () => void }) {
  const [files, setFiles] = useState<SaveFile[]>([]);
  const [selected, setSelected] = useState(new Set<string>());
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState(false);
  const [transferBusy, setTransferBusy] = useState(false);
  const operation = useRef<AbortController | null>(null);
  const confirm = useConfirm(), toast = useToast();
  const busy = deleting || transferBusy;
  const refresh = useCallback(async () => {
    try {
      setFiles(await readSaveFiles(work.workId));
      setSelected(new Set());
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "读取本地存档失败，请检查浏览器存储权限后重试。");
    } finally { setLoading(false); }
  }, [work.workId, toast]);
  useEffect(() => {
    void refresh();
    window.addEventListener("focus", refresh);
    return () => { operation.current?.abort(); window.removeEventListener("focus", refresh); };
  }, [refresh]);

  async function remove() {
    if (operation.current || busy || !selected.size) return;
    const controller = new AbortController();
    operation.current = controller;
    setDeleting(true);
    try {
      const refreshLocks = await acquireGameSaveTransferLock(work.workId, work.playKey, controller.signal);
      const chosen = (await readSaveFiles(work.workId)).filter(file => selected.has(file.name));
      if (!chosen.length) return;
      const removed = await confirm(chosen.map(file => file.name).join("、"), {
        title: `删除「${work.title}」的 ${chosen.length} 个存档？`, confirmLabel: "删除", destructive: true,
        action: async () => {
          await refreshLocks();
          await deleteSaveFiles(work.workId, chosen, controller.signal);
        },
      });
      if (removed) { await refresh(); onChanged(); }
    } catch (error) {
      if (!controller.signal.aborted) toast.error(error instanceof Error ? error.message : "操作失败，请重试。");
    } finally {
      controller.abort();
      operation.current = null;
      setDeleting(false);
    }
  }

  return <div className="min-w-0">
    <div className="mb-4 flex flex-wrap items-center gap-2">
      <fieldset disabled={deleting} className="contents" aria-label="存档导入导出">
        <WebPlaySaveExport workId={work.workId} playKey={work.playKey} title={work.title} active playerBusy={false}
          onChanged={() => { void refresh(); onChanged(); }} onBusyChange={setTransferBusy}
          exportNames={selected.size ? [...selected] : undefined} />
      </fieldset>
      <Button type="button" size="sm" variant="ghost" disabled={busy || !selected.size} onClick={() => void remove()}>删除所选</Button>
    </div>
    {loading ? <p className="py-6 text-sm text-muted" role="status">读取本地游戏…</p> : files.length ? <>
      <Label className="mb-2 flex min-h-9 items-center gap-2 text-sm">
        <Checkbox aria-label="全选存档" disabled={busy} checked={selected.size === files.length ? true : selected.size ? "indeterminate" : false}
          onCheckedChange={checked => setSelected(checked === true ? new Set(files.map(file => file.name)) : new Set())} />全选
      </Label>
      <ul className="divide-y divide-border border-y border-border">
        {files.map(file => <li key={file.name} className="flex items-center gap-3 py-3">
          <Checkbox aria-label={`选择 ${file.name}`} disabled={busy} checked={selected.has(file.name)}
            onCheckedChange={checked => setSelected(current => { const next = new Set(current); if (checked === true) next.add(file.name); else next.delete(file.name); return next; })} />
          <div className="min-w-0 flex-1">
            <span className="font-mono text-sm wrap-anywhere">{file.name}</span>
            {file.timestamp ? <p className="mt-1 text-xs text-muted">{formatDate(file.timestamp.toISOString())}</p> : null}
          </div>
          <span className="shrink-0 font-mono text-xs text-muted">{formatBytes(file.bytes.byteLength)}</span>
        </li>)}
      </ul>
    </> : <EmptyState title="没有本地存档。" variant="plain" />}
  </div>;
}
