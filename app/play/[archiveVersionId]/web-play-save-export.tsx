import { Button } from "@/app/components/ui/button";
import { useToast } from "@/app/components/ui/toast";
import { zipSync } from "fflate";
import { useEffect, useRef, useState } from "react";

type SaveFile = { name: string; bytes: Uint8Array };

export function WebPlaySaveExport({
  workId,
  title,
  active,
}: {
  workId: number;
  title: string;
  active: boolean;
}) {
  const toast = useToast();
  const [count, setCount] = useState(0);
  const [exporting, setExporting] = useState(false);
  const [readError, setReadError] = useState<string | null>(null);
  const downloadRef = useRef<AbortController | null>(null);

  useEffect(() => () => downloadRef.current?.abort(), [workId]);

  useEffect(() => {
    if (!active) return;
    let current = true;
    let reading = false;
    const refresh = async () => {
      if (document.hidden || reading) return;
      reading = true;
      try {
        const files = await readSaveFiles(workId);
        if (current) {
          setCount(files.length);
          setReadError(null);
        }
      } catch {
        if (current) {
          setCount(0);
          setReadError("读取本地存档失败，请检查浏览器存储权限后重试。");
        }
      } finally {
        reading = false;
      }
    };
    setCount(0);
    void refresh();
    // IDBFS commits saves independently of the page, including from other tabs.
    const timer = setInterval(() => void refresh(), 2000);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      current = false;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [active, workId]);

  async function exportSaves() {
    if (downloadRef.current || !count) return;
    const controller = new AbortController();
    downloadRef.current = controller;
    setExporting(true);
    try {
      // Read again at click time; never export an earlier polling snapshot.
      const files = await readSaveFiles(workId);
      controller.signal.throwIfAborted();
      setCount(files.length);
      if (!files.length) return;
      const bytes = zipSync(Object.fromEntries(files.map(file => [file.name, file.bytes])));
      const blob = new Blob([new Uint8Array(bytes)], { type: "application/zip" });
      const filename = title.replace(/[<>:"/\\|?*\p{Cc}]/gu, "_").trim().replace(/[. ]+$/g, "") || `game-${workId}`;
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `${filename}.zip`;
      document.body.appendChild(link);
      try {
        link.click();
      } finally {
        link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 30_000);
      }
      toast.success(`已导出 ${files.length} 个存档。`);
    } catch {
      if (!controller.signal.aborted) toast.error("导出存档失败，请重试。");
    } finally {
      downloadRef.current = null;
      if (!controller.signal.aborted) setExporting(false);
    }
  }

  return (
    <>
      <Button
        disabled={!count || exporting}
        onClick={() => void exportSaves()}
        size="sm"
        title={count ? `导出 ${count} 个存档` : "没有可导出的存档"}
        type="button"
        variant="outline"
      >
        {exporting ? "正在导出…" : "导出存档"}
      </Button>
      {readError ? <span className="w-full text-sm text-destructive" role="alert">{readError}</span> : null}
    </>
  );
}

async function readSaveFiles(workId: number): Promise<SaveFile[]> {
  const directory = `/work-saves/${workId}`;
  const db = await new Promise<IDBDatabase | null>((resolve, reject) => {
    // No version: the runtime owns the IDBFS schema and its upgrades.
    const request = indexedDB.open(directory);
    let missing = false;
    request.onupgradeneeded = () => {
      // Merely opening the export panel must not create an empty runtime DB.
      missing = true;
      request.transaction!.abort();
    };
    request.onsuccess = () => {
      request.result.onversionchange = () => request.result.close();
      resolve(request.result);
    };
    request.onerror = () => missing ? resolve(null) : reject(request.error);
  });
  if (!db) return [];
  try {
    return await new Promise<SaveFile[]>((resolve, reject) => {
      const files: SaveFile[] = [];
      const tx = db.transaction("FILE_DATA", "readonly");
      const request = tx.objectStore("FILE_DATA").openCursor();
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) return;
        const path = String(cursor.key);
        const name = path.startsWith(`${directory}/`) ? path.slice(directory.length + 1) : "";
        const entry = cursor.value as { mode: number; contents: Uint8Array };
        // Only regular .lsd files directly in this game's save directory.
        if (/^[^/\\]+\.lsd$/i.test(name) && (entry.mode & 0o170000) === 0o100000) {
          files.push({ name, bytes: entry.contents });
        }
        cursor.continue();
      };
      tx.oncomplete = () => resolve(files);
      tx.onabort = tx.onerror = () => reject(tx.error ?? request.error);
    });
  } finally {
    db.close();
  }
}
