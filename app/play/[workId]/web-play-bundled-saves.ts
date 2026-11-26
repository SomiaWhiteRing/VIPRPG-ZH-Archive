import type { WebPlayPackage } from "./web-play-opfs";
import { saveName } from "@/lib/archive/save-name";
import { compactLsdSave } from "@/lib/archive/lsd-save-upgrade";

/** Seed the player's writable IDBFS directory without replacing existing saves. */
export async function seedBundledWebPlaySaves(
  workId: number,
  packages: WebPlayPackage[],
  signal: AbortSignal,
): Promise<void> {
  const bundled = packages.flatMap(({ blob, metadata }) => metadata.files.flatMap(({ filename, start, end }) => {
    const path = filename.slice(1);
    const name = saveName(path) ?? (/^[^/\\]+\.lsd$/i.test(path) ? path : null);
    return name ? [{ name, blob: blob.slice(start, end) }] : [];
  }));
  if (!bundled.length) return;

  const directory = `/work-saves/${workId}`;
  // Open without a fixed version so existing Emscripten databases stay usable.
  // IDBFS upgrades a newly created database to its own version on startup.
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(directory);
    request.onupgradeneeded = () => {
      const store = request.result.createObjectStore("FILE_DATA");
      store.createIndex("timestamp", "timestamp", { unique: false });
    };
    request.onsuccess = () => {
      request.result.onversionchange = () => request.result.close();
      resolve(request.result);
    };
    request.onerror = () => reject(request.error);
  });

  try {
    signal.throwIfAborted();
    const existing = await new Promise<Set<string>>((resolve, reject) => {
      const tx = db.transaction("FILE_DATA", "readonly");
      const request = tx.objectStore("FILE_DATA").getAllKeys();
      tx.oncomplete = () => resolve(new Set(request.result.map(key => String(key).normalize("NFC").toLowerCase())));
      tx.onabort = () => reject(tx.error ?? request.error);
    });
    const saves: { name: string; contents: Uint8Array }[] = [];
    for (const file of bundled) {
      signal.throwIfAborted();
      const path = `${directory}/${file.name}`.normalize("NFC").toLowerCase();
      if (existing.has(path)) continue;
      existing.add(path);
      const bytes = new Uint8Array(await file.blob.arrayBuffer());
      saves.push({ name: file.name, contents: /\.lsd$/i.test(file.name) ? compactLsdSave(bytes) : bytes });
    }
    signal.throwIfAborted();
    if (!saves.length) return;
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction("FILE_DATA", "readwrite");
      const store = tx.objectStore("FILE_DATA");
      const request = store.getAllKeys();
      const abort = () => tx.abort();
      signal.addEventListener("abort", abort, { once: true });
      request.onsuccess = () => {
        const paths = new Set(request.result.map((key) => String(key).normalize("NFC").toLowerCase()));
        for (const { name, contents } of saves) {
          let path = `${directory}/${name}`;
          if (name === "SaveData/Save.lgs") {
            const parent = `${directory}/SaveData`;
            const actual = request.result.find(key => String(key).toLowerCase() === parent.toLowerCase());
            if (actual === undefined) store.add({ timestamp: new Date(), mode: 0o40777 }, parent);
            else path = `${actual}/Save.lgs`;
          }
          const normalized = path.normalize("NFC").toLowerCase();
          if (paths.has(normalized)) continue;
          // Match IDBFS's timestamp, regular-file mode and byte representation.
          store.add({ timestamp: new Date(), mode: 0o100666, contents }, path);
          paths.add(normalized);
        }
      };
      tx.oncomplete = () => {
        signal.removeEventListener("abort", abort);
        resolve();
      };
      tx.onabort = tx.onerror = () => {
        signal.removeEventListener("abort", abort);
        reject(signal.aborted ? signal.reason : tx.error ?? request.error);
      };
    });
  } finally {
    db.close();
  }
}
