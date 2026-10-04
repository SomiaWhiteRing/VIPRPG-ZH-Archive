import { Button } from "@/app/components/ui/button";
import { Checkbox } from "@/app/components/ui/checkbox";
import { Label } from "@/app/components/ui/label";
import {
  AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogTitle,
} from "@/app/components/ui/alert-dialog";
import { useToast } from "@/app/components/ui/toast";
import { useEffect, useId, useRef, useState } from "react";
import { acquireGameSaveTransferLock } from "./web-play-locks";
import {
  hasSaveFiles, importSaveFiles, parseSaveImports, readSaveFiles,
  saveArchiveBlob, saveArchiveFilename, type SaveFile,
} from "./web-play-save-transfer";

type ImportPreview = { incoming: SaveFile[]; existing: SaveFile[]; conflicts: SaveFile[] };

export function WebPlaySaveExport({ workId, playKey, title, active, playerBusy }: {
  workId: number;
  playKey: string;
  title: string;
  active: boolean;
  playerBusy: boolean;
}) {
  const toast = useToast();
  const [hasSaves, setHasSaves] = useState(false);
  const [operation, setOperation] = useState<"export" | "read" | "import" | null>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [overwrite, setOverwrite] = useState<Set<string>>(new Set());
  const [readError, setReadError] = useState<string | null>(null);
  const operationRef = useRef<AbortController | null>(null);
  const refreshLocksRef = useRef<(() => Promise<void>) | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const importButtonRef = useRef<HTMLButtonElement>(null);
  const dialogId = useId();
  const busy = operation !== null || preview !== null;

  useEffect(() => () => operationRef.current?.abort(), [workId]);

  useEffect(() => {
    if (!active) return;
    let current = true;
    let reading = false;
    const refresh = async () => {
      if (document.hidden || reading) return;
      reading = true;
      try {
        const available = await hasSaveFiles(workId);
        if (current) {
          setHasSaves(available);
          setReadError(null);
        }
      } catch {
        if (current) {
          setHasSaves(false);
          setReadError("读取本地存档失败，请检查浏览器存储权限后重试。");
        }
      } finally { reading = false; }
    };
    setHasSaves(false);
    void refresh();
    const timer = setInterval(() => void refresh(), 2000);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      current = false;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [active, workId]);

  function finish() {
    operationRef.current?.abort();
    operationRef.current = null;
    refreshLocksRef.current = null;
    setOperation(null);
    setPreview(null);
    setOverwrite(new Set());
  }

  async function exportSaves() {
    if (operationRef.current || playerBusy || !hasSaves) return;
    const controller = new AbortController();
    operationRef.current = controller;
    setOperation("export");
    try {
      await acquireGameSaveTransferLock(workId, playKey, controller.signal);
      const files = await readSaveFiles(workId);
      controller.signal.throwIfAborted();
      setHasSaves(files.length > 0);
      if (!files.length) return;
      const url = URL.createObjectURL(saveArchiveBlob(files));
      const link = document.createElement("a");
      link.href = url;
      link.download = saveArchiveFilename(title, workId);
      document.body.appendChild(link);
      try { link.click(); }
      finally {
        link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 30_000);
      }
      toast.success(`已导出 ${files.length} 个存档。`);
    } catch (error) {
      if (!controller.signal.aborted) toast.error(error instanceof Error ? error.message : "导出存档失败，请重试。");
    } finally {
      if (!controller.signal.aborted) finish();
    }
  }

  async function prepareImport(files: File[]) {
    if (!files.length || operationRef.current || playerBusy) return;
    const controller = new AbortController();
    operationRef.current = controller;
    setOperation("read");
    try {
      // Keep this lock through preview/confirmation so a new player cannot race import.
      refreshLocksRef.current = await acquireGameSaveTransferLock(workId, playKey, controller.signal);
      const incoming = await parseSaveImports(files, controller.signal);
      const existing = await readSaveFiles(workId);
      controller.signal.throwIfAborted();
      const names = new Set(incoming.map(file => file.name.toLowerCase()));
      setPreview({ incoming, existing, conflicts: existing.filter(file => names.has(file.name.toLowerCase())) });
      setOverwrite(new Set());
      setOperation(null);
    } catch (error) {
      if (!controller.signal.aborted) {
        toast.error(error instanceof Error ? error.message : "读取存档失败，请重试。");
        finish();
      }
    }
  }

  async function confirmImport() {
    const controller = operationRef.current;
    if (!preview || !controller || operation === "import") return;
    setOperation("import");
    try {
      await refreshLocksRef.current?.();
      controller.signal.throwIfAborted();
      const count = await importSaveFiles(workId, preview.incoming, preview.existing, overwrite, controller.signal);
      controller.signal.throwIfAborted();
      setHasSaves(true);
      toast.success(`已为「${title}」导入 ${count} 个存档。启动游戏后可读取。`);
    } catch (error) {
      if (!controller.signal.aborted) toast.error(error instanceof Error ? error.message : "导入存档失败，请重试。");
    } finally {
      if (!controller.signal.aborted) finish();
    }
  }

  const fresh = preview ? preview.incoming.length - preview.conflicts.length : 0;
  return (
    <>
      <Button disabled={!hasSaves || busy || playerBusy} onClick={() => void exportSaves()} size="sm"
        title={playerBusy ? "请先停止游戏，等待存档写入完成" : hasSaves ? "导出当前游戏的存档" : "没有可导出的存档"}
        type="button" variant="outline">
        {operation === "export" ? "正在导出…" : "导出存档"}
      </Button>
      <Button aria-controls={dialogId} aria-expanded={preview !== null} aria-haspopup="dialog"
        disabled={busy || playerBusy} onClick={() => inputRef.current?.click()} ref={importButtonRef} size="sm"
        title={playerBusy ? "请先停止游戏，等待存档写入完成" : "导入当前游戏的 LSD 或 ZIP 存档"}
        type="button" variant="outline">
        {operation === "read" ? "正在读取…" : operation === "import" ? "正在导入…" : "导入存档"}
      </Button>
      <input accept=".lsd,.zip" aria-label="选择要导入的存档" className="hidden" multiple ref={inputRef} type="file"
        onChange={event => {
          const files = Array.from(event.currentTarget.files ?? []);
          event.currentTarget.value = "";
          void prepareImport(files);
        }} />
      {playerBusy ? <span className="w-full text-xs text-muted">导入或导出前请先停止游戏，等待存档写入完成。</span> : null}
      {readError ? <span className="w-full text-sm text-destructive" role="alert">{readError}</span> : null}
      <AlertDialog open={preview !== null} onOpenChange={open => { if (!open && operation !== "import") finish(); }}>
        <AlertDialogContent id={dialogId} onEscapeKeyDown={event => { if (operation === "import") event.preventDefault(); }}
          onCloseAutoFocus={event => { event.preventDefault(); importButtonRef.current?.focus(); }}>
          <AlertDialogTitle>{preview?.conflicts.length ? "选择要覆盖的存档" : "导入存档？"}</AlertDialogTitle>
          <AlertDialogDescription>
            将为「{title}」导入存档。LSD 和 ZIP 不包含可验证的游戏身份，请确认来源属于此游戏。
            {preview?.conflicts.length ? ` 未勾选的保留本地存档；另有 ${fresh} 个新存档将导入。` : ` 共 ${preview?.incoming.length ?? 0} 个新存档。`}
            导入后启动游戏读取，导入不会自动载入进度。
          </AlertDialogDescription>
          {preview?.conflicts.length ? <ul className="m-0 grid max-h-64 list-none gap-3 overflow-y-auto p-0">
            {preview.conflicts.map(file => <li className="flex items-center gap-3" key={file.name}>
              <Checkbox checked={overwrite.has(file.name)} disabled={operation === "import"} id={`${dialogId}-${file.name}`}
                onCheckedChange={checked => setOverwrite(current => {
                  const next = new Set(current);
                  if (checked === true) next.add(file.name); else next.delete(file.name);
                  return next;
                })} />
              <Label className="cursor-pointer break-all text-sm" htmlFor={`${dialogId}-${file.name}`}>
                {file.name}<span className="block text-xs text-muted">本地：{file.timestamp?.toLocaleString("zh-CN") ?? "时间未知"}</span>
              </Label>
            </li>)}
          </ul> : null}
          <AlertDialogFooter>
            <AlertDialogCancel asChild>
              <Button disabled={operation === "import"} type="button" variant="outline">取消</Button>
            </AlertDialogCancel>
            <Button disabled={operation === "import" || fresh + overwrite.size === 0} onClick={() => void confirmImport()} type="button">
              {operation === "import" ? "正在导入…" : "导入"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
