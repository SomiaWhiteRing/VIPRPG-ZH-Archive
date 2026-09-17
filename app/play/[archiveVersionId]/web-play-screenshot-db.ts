import type { PlayerScreenshot } from "./web-play-player";

export type WebPlayScreenshot = PlayerScreenshot & {
  id: string;
  workId: number;
  createdAt: string;
};

// Screenshots belong to the work, independently of installed archive versions.
const DATABASE_NAME = "viprpg_web_play_screenshots_v1";
const STORE_NAME = "screenshots";

export async function listWebPlayScreenshots(
  workId: number,
): Promise<WebPlayScreenshot[]> {
  const db = await openDatabase();
  try {
    return await new Promise<WebPlayScreenshot[]>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const request = tx.objectStore(STORE_NAME).index("workId").getAll(workId);
      tx.oncomplete = () => resolve(
        (request.result as WebPlayScreenshot[]).sort((a, b) =>
          b.createdAt.localeCompare(a.createdAt),
        ),
      );
      tx.onabort = tx.onerror = () => reject(tx.error ?? request.error);
    });
  } finally {
    db.close();
  }
}

export async function saveWebPlayScreenshot(
  screenshot: WebPlayScreenshot,
): Promise<void> {
  const db = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      const request = tx.objectStore(STORE_NAME).add(screenshot);
      tx.oncomplete = () => resolve();
      tx.onabort = tx.onerror = () => reject(tx.error ?? request.error);
    });
  } finally {
    db.close();
  }
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, 1);
    request.onupgradeneeded = () => {
      const store = request.result.createObjectStore(STORE_NAME, { keyPath: "id" });
      store.createIndex("workId", "workId");
    };
    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => db.close();
      resolve(db);
    };
    request.onerror = () => reject(request.error);
  });
}
