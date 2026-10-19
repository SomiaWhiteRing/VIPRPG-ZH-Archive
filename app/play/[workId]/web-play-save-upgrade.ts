import { deflateSync } from "fflate";
import { compactLsdSave } from "@/lib/archive/lsd-save-upgrade";
import { openExistingDatabase, sameBytes, saveDirectory } from "./web-play-save-transfer";

const storeName = "FILE_DATA";
const backupDatabase = "viprpg_web_play_save_backups";
const backupStore = "files";
type Entry = { mode: number; contents: Uint8Array; timestamp?: Date };

function transaction<T>(
  db: IDBDatabase, store: string, mode: IDBTransactionMode, signal: AbortSignal,
  action: (store: IDBObjectStore, result: (value: T) => void, fail: (error: unknown) => void) => void,
): Promise<T> {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, mode, mode === "readwrite" ? { durability: "strict" } : undefined);
    let result: T, failure: unknown;
    const fail = (error: unknown) => {
      failure = error;
      try { tx.abort(); } catch { /* A completed transaction cannot be cancelled. */ }
    };
    const abort = () => fail(signal.reason);
    tx.oncomplete = () => { signal.removeEventListener("abort", abort); resolve(result); };
    tx.onabort = () => {
      signal.removeEventListener("abort", abort);
      reject(failure ?? tx.error ?? new Error("本地存档升级事务失败。"));
    };
    signal.addEventListener("abort", abort, { once: true });
    try { action(tx.objectStore(store), value => { result = value; }, fail); }
    catch (error) { fail(error); }
  });
}

function openBackups(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(backupDatabase, 1);
    let blocked = false;
    request.onupgradeneeded = () => request.result.createObjectStore(backupStore);
    request.onblocked = () => { blocked = true; reject(new Error("存档备份库正在被其他页面使用。")); };
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => db.close();
      if (blocked) db.close(); else resolve(db);
    };
  });
}

function sameTimestamp(a: Date | undefined, b: Date | undefined): boolean {
  return a instanceof Date && b instanceof Date ? a.getTime() === b.getTime() : a === b;
}

/** Caller holds the existing Work-wide save lock; run before the engine populates IDBFS. */
export async function upgradeWebPlaySaves(workId: number, signal: AbortSignal): Promise<void> {
  const directory = saveDirectory(workId);
  const db = await openExistingDatabase(directory);
  if (!db) return;
  let backups: IDBDatabase | undefined;
  try {
    const keys = await transaction<IDBValidKey[]>(db, storeName, "readonly", signal, (store, result) => {
      const request = store.getAllKeys();
      request.onsuccess = () => result(request.result);
    });
    for (const key of keys) {
      signal.throwIfAborted();
      if (typeof key !== "string" || !key.startsWith(`${directory}/`) || !/\.lsd$/i.test(key)) continue;
      const entry = await transaction<Entry | undefined>(db, storeName, "readonly", signal, (store, result) => {
        const request = store.get(key);
        request.onsuccess = () => result(request.result);
      });
      if (!entry || (entry.mode & 0o170000) !== 0o100000) continue;
      if (!(entry.contents instanceof Uint8Array)) throw new Error("本地存档格式异常，原档已保留。");
      const updated = compactLsdSave(entry.contents);
      if (updated === entry.contents) continue;
      signal.throwIfAborted();
      // Keep recoverable original bytes outside the engine's mount, without retaining their zero padding on disk.
      const backup = { ...entry, contents: deflateSync(entry.contents), encoding: "deflate-raw", originalSize: entry.contents.length };
      backups ??= await openBackups();
      await transaction<void>(backups, backupStore, "readwrite", signal, store => { store.put(backup, [workId, key]); });
      await transaction<void>(db, storeName, "readwrite", signal, (store, _result, fail) => {
        const request = store.get(key);
        request.onsuccess = () => {
          try {
            const current = request.result as Entry | undefined;
            if (!current || current.mode !== entry.mode || !sameTimestamp(current.timestamp, entry.timestamp)
              || !(current.contents instanceof Uint8Array) || !sameBytes(current.contents, entry.contents)) {
              throw new Error("本地存档已变化，请重新启动游戏；原档已保留。");
            }
            store.put({ ...current, contents: updated }, key);
          } catch (error) { fail(error); }
        };
      });
    }
  } finally { backups?.close(); db.close(); }
}
