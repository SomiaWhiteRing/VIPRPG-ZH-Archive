import type { BrowserUploadTaskSnapshot } from "@/app/upload/upload-types";

const DB_NAME = "viprpg_upload_tasks_v1";
const DB_VERSION = 1;

const STORE_TASKS = "tasks";
const STORE_TASK_FILES = "task_files";
const STORE_TASK_OBJECTS = "task_objects";
const STORE_TASK_EVENTS = "task_events";
const STORE_TASK_ERRORS = "task_errors";

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

export async function saveTaskEvent(input: {
  localTaskId: string;
  phase: string;
  message: string;
}): Promise<void> {
  const db = await openUploadTaskDb();
  await putValue(db, STORE_TASK_EVENTS, {
    id: `${input.localTaskId}:${Date.now()}:${Math.random().toString(16).slice(2)}`,
    localTaskId: input.localTaskId,
    phase: input.phase,
    message: input.message,
    createdAt: new Date().toISOString(),
  });
  db.close();
}

export async function saveTaskError(input: {
  localTaskId: string;
  phase: string;
  message: string;
}): Promise<void> {
  const db = await openUploadTaskDb();
  await putValue(db, STORE_TASK_ERRORS, {
    id: `${input.localTaskId}:${Date.now()}:${Math.random().toString(16).slice(2)}`,
    localTaskId: input.localTaskId,
    phase: input.phase,
    message: input.message,
    createdAt: new Date().toISOString(),
  });
  db.close();
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
      ensureStore(db, STORE_TASK_FILES, "id");
      ensureStore(db, STORE_TASK_OBJECTS, "id");
      ensureStore(db, STORE_TASK_EVENTS, "id");
      ensureStore(db, STORE_TASK_ERRORS, "id");
    };

    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
  });
}

function ensureStore(db: IDBDatabase, name: string, keyPath: string): void {
  if (!db.objectStoreNames.contains(name)) {
    const store = db.createObjectStore(name, { keyPath });

    if (name !== STORE_TASKS) {
      store.createIndex("localTaskId", "localTaskId", { unique: false });
    }
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
