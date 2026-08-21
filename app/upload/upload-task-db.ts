import type { BrowserUploadTaskSnapshot } from "@/app/upload/upload-types";

const DB_NAME = "viprpg_upload_tasks_v1";
const DB_VERSION = 2;

const STORE_TASKS = "tasks";
const REMOVED_STORES = ["task_files", "task_objects", "task_events", "task_errors"];

export async function saveTaskSnapshot(
  task: BrowserUploadTaskSnapshot,
): Promise<void> {
  const db = await openUploadTaskDb();
  await putValue(db, STORE_TASKS, task);
  db.close();
}

export async function loadTaskSnapshots(): Promise<BrowserUploadTaskSnapshot[]> {
  const db = await openUploadTaskDb();
  const tasks = await getAllValues<BrowserUploadTaskSnapshot>(db, STORE_TASKS);
  db.close();

  return tasks.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function clearTaskSnapshot(localTaskId: string): Promise<void> {
  const db = await openUploadTaskDb();
  await deleteValue(db, STORE_TASKS, localTaskId);
  db.close();
}

function openUploadTaskDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;

      ensureStore(db, STORE_TASKS, "localTaskId");
      for (const storeName of REMOVED_STORES) {
        if (db.objectStoreNames.contains(storeName)) {
          db.deleteObjectStore(storeName);
        }
      }
    };

    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
  });
}

function ensureStore(db: IDBDatabase, name: string, keyPath: string): void {
  if (!db.objectStoreNames.contains(name)) {
    db.createObjectStore(name, { keyPath });
  }
}

function putValue(db: IDBDatabase, storeName: string, value: unknown): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readwrite");
    const request = tx.objectStore(storeName).put(value);

    request.onerror = () => reject(request.error);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
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
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

function getAllValues<T>(db: IDBDatabase, storeName: string): Promise<T[]> {
  return new Promise((resolve, reject) => {
    const request = db.transaction(storeName, "readonly").objectStore(storeName).getAll();

    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result as T[]);
  });
}
