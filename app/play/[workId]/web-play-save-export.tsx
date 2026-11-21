import { Button } from "@/app/components/ui/button";
import { Checkbox } from "@/app/components/ui/checkbox";
import { Label } from "@/app/components/ui/label";
import {
  AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogTitle,
} from "@/app/components/ui/alert-dialog";
import { useToast } from "@/app/components/ui/toast";
import { formatFeedbackError } from "@/lib/i18n/feedback";
import { useMessages, useUiLocale } from "@/lib/i18n/react";
import { useEffect, useId, useRef, useState } from "react";
import { acquireGameSaveTransferLock } from "./web-play-locks";
import {
  hasSaveFiles, importSaveFiles, parseSaveImports, readSaveFiles,
  saveArchiveBlob, saveArchiveFilename, type SaveFile,
} from "./web-play-save-transfer";

type ImportPreview = { incoming: SaveFile[]; existing: SaveFile[]; conflicts: SaveFile[] };

export function WebPlaySaveExport({ workId, playKey, title, active, playerBusy, onChanged, onBusyChange, exportNames }: {
  workId: number;
  playKey: string | null;
  title: string;
  active: boolean;
  playerBusy: boolean;
  onChanged?: () => void;
  onBusyChange?: (busy: boolean) => void;
  exportNames?: string[];
}) {
  const t = useMessages();
  const locale = useUiLocale();
  const toast = useToast();
  const [hasSaves, setHasSaves] = useState(false);
  const [operation, setOperation] = useState<"export" | "read" | "import" | null>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [overwrite, setOverwrite] = useState<Set<string>>(new Set());
  const [readError, setReadError] = useState(false);
  const operationRef = useRef<AbortController | null>(null);
  const refreshLocksRef = useRef<(() => Promise<void>) | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const importButtonRef = useRef<HTMLButtonElement>(null);
  const dialogId = useId();
  const busy = operation !== null || preview !== null;

  useEffect(() => { onBusyChange?.(busy); }, [busy, onBusyChange]);

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
          setReadError(false);
        }
      } catch {
        if (current) {
          setHasSaves(false);
          setReadError(true);
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
      const files = (await readSaveFiles(workId)).filter(file => !exportNames || exportNames.includes(file.name));
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
      toast.success(t("play.save.exported", { count: files.length }));
    } catch (error) {
      if (!controller.signal.aborted) toast.error(formatFeedbackError(error, locale, t("play.save.exportFailed")));
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
        toast.error(formatFeedbackError(error, locale, t("play.save.readFailed")));
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
      onChanged?.();
      toast.success(t("play.save.imported", { title, count }));
    } catch (error) {
      if (!controller.signal.aborted) toast.error(formatFeedbackError(error, locale, t("play.save.importFailed")));
    } finally {
      if (!controller.signal.aborted) finish();
    }
  }

  const fresh = preview ? preview.incoming.length - preview.conflicts.length : 0;
  return (
    <>
      <Button disabled={!hasSaves || busy || playerBusy} onClick={() => void exportSaves()} size="sm"
        title={playerBusy ? t("play.save.stopFirst") : hasSaves ? t("play.save.exportHint") : t("play.save.empty")}
        type="button" variant="outline">
        {operation === "export" ? t("play.save.exporting") : exportNames ? t("play.save.exportSelected") : t("play.save.export")}
      </Button>
      <Button aria-controls={dialogId} aria-expanded={preview !== null} aria-haspopup="dialog"
        disabled={busy || playerBusy} onClick={() => inputRef.current?.click()} ref={importButtonRef} size="sm"
        title={playerBusy ? t("play.save.stopFirst") : t("play.save.importHint")}
        type="button" variant="outline">
        {operation === "read" ? t("play.save.reading") : operation === "import" ? t("play.save.importing") : t("play.save.import")}
      </Button>
      <input accept=".lsd,.lgs,.dyn,.zip" aria-label={t("play.save.choose")} className="hidden" multiple ref={inputRef} type="file"
        onChange={event => {
          const files = Array.from(event.currentTarget.files ?? []);
          event.currentTarget.value = "";
          void prepareImport(files);
        }} />
      {playerBusy ? <span className="w-full text-xs text-muted">{t("play.save.busy")}</span> : null}
      {readError ? <span className="w-full text-sm text-destructive" role="alert">{t("play.save.localRead")}</span> : null}
      <AlertDialog open={preview !== null} onOpenChange={open => { if (!open && operation !== "import") finish(); }}>
        <AlertDialogContent id={dialogId} onEscapeKeyDown={event => { if (operation === "import") event.preventDefault(); }}
          onCloseAutoFocus={event => { event.preventDefault(); importButtonRef.current?.focus(); }}>
          <AlertDialogTitle>{preview?.conflicts.length ? t("play.save.overwrite") : t("play.save.confirm")}</AlertDialogTitle>
          <AlertDialogDescription>
            {t("play.save.description", {
              title,
              details: preview?.conflicts.length
                ? t("play.save.conflicts", { count: fresh })
                : t("play.save.new", { count: preview?.incoming.length ?? 0 }),
            })}
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
                {file.name}<span className="block text-xs text-muted">{t("play.save.localTime", { time: file.timestamp?.toLocaleString(locale) ?? t("play.save.unknownTime") })}</span>
              </Label>
            </li>)}
          </ul> : null}
          <AlertDialogFooter>
            <AlertDialogCancel asChild>
              <Button disabled={operation === "import"} type="button" variant="outline">{t("play.save.cancel")}</Button>
            </AlertDialogCancel>
            <Button disabled={operation === "import" || fresh + overwrite.size === 0} onClick={() => void confirmImport()} type="button">
              {operation === "import" ? t("play.save.importing") : t("play.save.submit")}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
