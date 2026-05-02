import type {
  WebPlayFileRecord,
  WebPlayInstallation,
} from "@/app/play/[archiveVersionId]/web-play-types";

const DB_NAME = "viprpg_web_play_v1";
const DB_VERSION = 1;

const STORE_INSTALLATIONS = "web_play_installations";
const STORE_FILES = "web_play_files";

export async function saveWebPlayInstallation(
  installation: WebPlayInstallation,
): Promise<void> {
  const db = await openWebPlayDb();
  await putValue(db, STORE_INSTALLATIONS, installation);
  db.close();
}

export async function getWebPlayInstallation(
  playKey: string,
): Promise<WebPlayInstallation | null> {
  const db = await openWebPlayDb();
  const value = await getValue<WebPlayInstallation>(db, STORE_INSTALLATIONS, playKey);
  db.close();

  return value;
}

export async function saveWebPlayFileRecord(record: WebPlayFileRecord): Promise<void> {
  const db = await openWebPlayDb();
  await putValue(db, STORE_FILES, record);
  db.close();
}

export async function saveWebPlayFileRecords(
  records: WebPlayFileRecord[],
): Promise<void> {
  if (records.length === 0) {
    return;
  }

  const db = await openWebPlayDb();
  await putValues(db, STORE_FILES, records);
  db.close();
}

export async function clearWebPlayFileRecords(playKey: string): Promise<void> {
  const db = await openWebPlayDb();
  await deleteByIndex(db, STORE_FILES, "playKey", playKey);
  db.close();
}

export async function deleteWebPlayInstallation(playKey: string): Promise<void> {
  const db = await openWebPlayDb();
  await Promise.all([
    deleteValue(db, STORE_INSTALLATIONS, playKey),
    deleteByIndex(db, STORE_FILES, "playKey", playKey),
  ]);
  db.close();
}

export async function markWebPlayLastPlayed(playKey: string): Promise<void> {
  const existing = await getWebPlayInstallation(playKey);

  if (!existing) {
    return;
  }

  await saveWebPlayInstallation({
    ...existing,
    lastPlayedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
}

function openWebPlayDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;

      if (!db.objectStoreNames.contains(STORE_INSTALLATIONS)) {
        db.createObjectStore(STORE_INSTALLATIONS, { keyPath: "playKey" });
      }

      if (!db.objectStoreNames.contains(STORE_FILES)) {
        const store = db.createObjectStore(STORE_FILES, { keyPath: "id" });
        store.createIndex("playKey", "playKey", { unique: false });
      }
    };

    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
  });
}

function putValue(db: IDBDatabase, storeName: string, value: unknown): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readwrite");
    const request = tx.objectStore(storeName).put(value);

    request.onerror = () => reject(request.error);
    tx.onerror = () => reject(tx.error);
    tx.oncomplete = () => resolve();
  });
}

function putValues(
  db: IDBDatabase,
  storeName: string,
  values: unknown[],
): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readwrite");
    const store = tx.objectStore(storeName);

    for (const value of values) {
      store.put(value);
    }

    tx.onerror = () => reject(tx.error);
    tx.oncomplete = () => resolve();
  });
}

function getValue<T>(
  db: IDBDatabase,
  storeName: string,
  key: IDBValidKey,
): Promise<T | null> {
  return new Promise((resolve, reject) => {
    const request = db.transaction(storeName, "readonly").objectStore(storeName).get(key);

    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve((request.result as T | undefined) ?? null);
  });
}

function deleteValue(
  db: IDBDatabase,
  storeName: string,
  key: IDBValidKey,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readwrite");
    const request = tx.objectStore(storeName).delete(key);

    request.onerror = () => reject(request.error);
    tx.onerror = () => reject(tx.error);
    tx.oncomplete = () => resolve();
  });
}

function deleteByIndex(
  db: IDBDatabase,
  storeName: string,
  indexName: string,
  key: IDBValidKey,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readwrite");
    const store = tx.objectStore(storeName);
    const index = store.index(indexName);
    const request = index.openCursor(IDBKeyRange.only(key));

    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const cursor = request.result;

      if (!cursor) {
        return;
      }

      cursor.delete();
      cursor.continue();
    };
    tx.onerror = () => reject(tx.error);
    tx.oncomplete = () => resolve();
  });
}
