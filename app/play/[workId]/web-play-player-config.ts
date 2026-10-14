import type { NativePlayerResources } from "@/lib/browser/android-local";

const configRoot = "/home/web_user/.config";
export const playerConfigDirectory = `${configRoot}/EasyRPG/Player`;
const configPath = `${playerConfigDirectory}/config.ini`;

/** Use the engine's global config on Web and APK, independently of the game. */
export async function preparePlayerConfig(signal: AbortSignal, native?: NativePlayerResources): Promise<void> {
  signal.throwIfAborted();
  if (native) {
    const encoded = native.saves[configPath];
    const bytes = encoded ? Uint8Array.from(atob(encoded), c => c.charCodeAt(0)) : new Uint8Array();
    const contents = configurePlayerSettings(new TextDecoder().decode(bytes));
    const updated = new TextEncoder().encode(contents);
    let binary = "";
    for (let offset = 0; offset < updated.length; offset += 8192)
      binary += String.fromCharCode(...updated.subarray(offset, offset + 8192));
    native.saves[configPath] = btoa(binary);
    return;
  }

  // Match the existing runtime's IDBFS mount and record format. Never reset it.
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(configRoot);
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
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction("FILE_DATA", "readwrite");
      const store = tx.objectStore("FILE_DATA");
      const abort = () => tx.abort();
      signal.addEventListener("abort", abort, { once: true });
      for (const path of [`${configRoot}/EasyRPG`, playerConfigDirectory]) {
        const directory = store.get(path);
        directory.onsuccess = () => {
          if (!directory.result) store.add({ timestamp: new Date(), mode: 0o40777 }, path);
        };
      }
      const request = store.get(configPath);
      request.onsuccess = () => {
        const previous = request.result;
        const text = previous ? new TextDecoder().decode(previous.contents) : "";
        const configured = configurePlayerSettings(text);
        if (!previous || configured !== text)
          store.put({ timestamp: new Date(), mode: 0o100666, contents: new TextEncoder().encode(configured) }, configPath);
      };
      tx.oncomplete = () => { signal.removeEventListener("abort", abort); resolve(); };
      tx.onabort = tx.onerror = () => {
        signal.removeEventListener("abort", abort);
        reject(signal.aborted ? signal.reason : tx.error ?? request.error);
      };
    });
  } finally {
    db.close();
  }
}

function configurePlayerSettings(text: string): string {
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/);
  let start = lines.findIndex(line => /^\s*\[Player\]\s*$/i.test(line));
  if (start < 0) { lines.push("[Player]"); start = lines.length - 1; }
  let end = start + 1;
  while (end < lines.length && !/^\s*\[/.test(lines[end])) end++;
  // Exit persistence is required by the host, rather than the engine's opt-in default.
  for (const [key, value] of [["SettingsAutosave", "1"], ["ExtraForceTestPlay", "0"]]) {
    const entry = lines.findIndex((line, index) => index > start && index < end && new RegExp(`^\\s*${key}\\s*=`, "i").test(line));
    if (entry < 0) { lines.splice(end++, 0, `${key}=${value}`); }
    else if (key === "SettingsAutosave") lines[entry] = `${key}=${value}`;
  }
  return lines.join("\n");
}
