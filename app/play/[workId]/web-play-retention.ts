export type GameRetentionDays = 7 | 30 | "never";

const databaseName = "viprpg_web_play_preferences_v1";
const storeName = "preferences";
const retentionKey = "game-retention-days";

export async function readGameRetentionDays(): Promise<GameRetentionDays> {
  const db = await openPreferences();
  try {
    return await new Promise((resolve, reject) => {
      const request = db.transaction(storeName, "readonly").objectStore(storeName).get(retentionKey);
      request.onsuccess = () => resolve(request.result === 30 || request.result === "never" ? request.result : 7);
      request.onerror = () => reject(request.error);
    });
  } finally { db.close(); }
}

export async function saveGameRetentionDays(days: GameRetentionDays): Promise<void> {
  const db = await openPreferences();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(storeName, "readwrite");
      tx.objectStore(storeName).put(days, retentionKey);
      tx.oncomplete = () => resolve();
      tx.onabort = () => reject(tx.error);
    });
  } finally { db.close(); }
}

function openPreferences(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(databaseName, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(storeName);
    request.onsuccess = () => { request.result.onversionchange = () => request.result.close(); resolve(request.result); };
    request.onerror = () => reject(request.error);
  });
}
