import type {
  WebPlayFileRecord,
  WebPlayInstallation,
} from "@/app/play/[workId]/web-play-types";
import { installObserver, observeInstallTask } from "./web-play-install-observer";

const DB_NAME = "viprpg_web_play_v1";
// Add work identities while retaining existing installation and file stores.
const DB_VERSION = 3;

const STORE_INSTALLATIONS = "web_play_installations";
const STORE_FILES = "web_play_files";
const STORE_WORKS = "web_play_works";

export type LocalLibraryWork = {
  workId: number; title: string; playKey: string | null;
  coverBlobSha256?: string | null;
  lastPlayedAt?: string | null;
  /** Undefined means the first play predates local history tracking; null means not yet played. */
  firstPlayedAt?: string | null;
  launchCount?: number;
};

export async function listLocalLibraryWorks(): Promise<LocalLibraryWork[]> {
  const db = await openWebPlayDb();
  try {
    return await new Promise<LocalLibraryWork[]>((resolve, reject) => {
      const request = db.transaction(STORE_WORKS, "readonly").objectStore(STORE_WORKS).getAll();
      request.onsuccess = () => resolve(request.result as LocalLibraryWork[]);
      request.onerror = () => reject(request.error);
    });
  } finally { db.close(); }
}

export async function rememberLocalLibraryWorks(works: Array<Pick<LocalLibraryWork, "workId" | "title" | "coverBlobSha256">>): Promise<void> {
  if (!works.length) return;
  const db = await openWebPlayDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_WORKS, "readwrite");
      const store = tx.objectStore(STORE_WORKS);
      for (const work of works) {
        const request = store.get(work.workId);
        request.onsuccess = () => store.put({ playKey: null, ...(request.result as LocalLibraryWork | undefined), ...work });
      }
      tx.oncomplete = () => resolve();
      tx.onabort = () => reject(tx.error);
    });
  } finally { db.close(); }
}

export async function listWebPlayInstallations(): Promise<WebPlayInstallation[]> {
  const db = await openWebPlayDb();
  try {
    return await new Promise<WebPlayInstallation[]>((resolve, reject) => {
      const request = db.transaction(STORE_INSTALLATIONS, "readonly")
        .objectStore(STORE_INSTALLATIONS).getAll();
      request.onsuccess = () => resolve(request.result as WebPlayInstallation[]);
      request.onerror = () => reject(request.error);
    });
  } finally {
    db.close();
  }
}

export async function saveWebPlayInstallation(
  installation: WebPlayInstallation,
): Promise<void> {
  const db = await openWebPlayDb();
  try {
    await observeInstallTask("idb.transaction", () => new Promise<void>((resolve, reject) => {
      const tx = db.transaction([STORE_INSTALLATIONS, STORE_WORKS], "readwrite");
      tx.objectStore(STORE_INSTALLATIONS).put(installation);
      if (installation.workId) {
        const works = tx.objectStore(STORE_WORKS);
        const previous = works.get(installation.workId);
        previous.onsuccess = () => works.put({
          ...((previous.result as LocalLibraryWork | undefined) ?? { firstPlayedAt: null, launchCount: 0 }),
          workId: installation.workId, title: installation.title, playKey: installation.playKey,
          coverBlobSha256: installation.coverBlobSha256 ?? (previous.result as LocalLibraryWork | undefined)?.coverBlobSha256,
          lastPlayedAt: installation.lastPlayedAt ?? (previous.result as LocalLibraryWork | undefined)?.lastPlayedAt,
        });
      }
      tx.oncomplete = () => resolve();
      tx.onabort = () => reject(tx.error);
    }), { store: STORE_INSTALLATIONS, mode: "readwrite", records: installation.workId ? 2 : 1 });
  } finally { db.close(); }
}

export async function getWebPlayInstallation(
  playKey: string,
): Promise<WebPlayInstallation | null> {
  const db = await openWebPlayDb();
  const value = await getValue<WebPlayInstallation>(db, STORE_INSTALLATIONS, playKey);
  db.close();

  return value;
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
  await deleteInstallationData(db, playKey);
  db.close();
}

export async function markWebPlayLastPlayed(playKey: string, recordLaunch = false): Promise<WebPlayInstallation | null> {
  const db = await openWebPlayDb();
  try {
    return await updateLastPlayed(db, playKey, recordLaunch);
  } finally {
    db.close();
  }
}

function openWebPlayDb(): Promise<IDBDatabase> {
  return observeInstallTask("idb.open", () => new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onblocked = () => installObserver?.event("idb.blocked", { database: DB_NAME, version: DB_VERSION });

    request.onupgradeneeded = () => {
      const db = request.result;

      if (!db.objectStoreNames.contains(STORE_INSTALLATIONS)) {
        db.createObjectStore(STORE_INSTALLATIONS, { keyPath: "playKey" });
      }

      if (!db.objectStoreNames.contains(STORE_FILES)) {
        const store = db.createObjectStore(STORE_FILES, { keyPath: "id" });
        store.createIndex("playKey", "playKey", { unique: false });
      }
      if (!db.objectStoreNames.contains(STORE_WORKS)) {
        const works = db.createObjectStore(STORE_WORKS, { keyPath: "workId" });
        const cursorRequest = request.transaction!.objectStore(STORE_INSTALLATIONS).openCursor();
        cursorRequest.onsuccess = () => {
          const cursor = cursorRequest.result;
          if (!cursor) return;
          const row = cursor.value as WebPlayInstallation;
          if (row.workId) works.put({ workId: row.workId, title: row.title, playKey: row.playKey,
            coverBlobSha256: row.coverBlobSha256, lastPlayedAt: row.lastPlayedAt });
          cursor.continue();
        };
      }
    };

    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => db.close();
      resolve(db);
    };
  }), { database: DB_NAME, version: DB_VERSION });
}

function putValues(
  db: IDBDatabase,
  storeName: string,
  values: unknown[],
): Promise<void> {
  return observeInstallTask("idb.transaction", () => new Promise<void>((resolve, reject) => {
    const tx = db.transaction(storeName, "readwrite");
    const store = tx.objectStore(storeName);

    for (const value of values) {
      store.put(value);
    }

    tx.onerror = () => reject(tx.error);
    tx.oncomplete = () => resolve();
  }), { store: storeName, mode: "readwrite", records: values.length });
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

function deleteInstallationData(db: IDBDatabase, playKey: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction([STORE_INSTALLATIONS, STORE_FILES], "readwrite");
    tx.objectStore(STORE_INSTALLATIONS).delete(playKey);
    const request = tx
      .objectStore(STORE_FILES)
      .index("playKey")
      .openCursor(IDBKeyRange.only(playKey));

    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) return;
      cursor.delete();
      cursor.continue();
    };
    tx.onerror = () => reject(tx.error);
    tx.oncomplete = () => resolve();
  });
}

function updateLastPlayed(db: IDBDatabase, playKey: string, recordLaunch: boolean): Promise<WebPlayInstallation | null> {
  return new Promise((resolve, reject) => {
    let updated: WebPlayInstallation | null = null;
    const tx = db.transaction([STORE_INSTALLATIONS, STORE_WORKS], "readwrite");
    const store = tx.objectStore(STORE_INSTALLATIONS);
    const request = store.get(playKey);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const existing = request.result as WebPlayInstallation | undefined;
      if (!existing || existing.status !== "ready") return;
      const now = new Date().toISOString();
      updated = { ...existing, lastPlayedAt: now, updatedAt: now };
      store.put(updated);
      if (existing.workId) {
        const works = tx.objectStore(STORE_WORKS);
        const history = works.get(existing.workId);
        history.onsuccess = () => {
          const previous = history.result as LocalLibraryWork | undefined;
          const firstLaunch = previous ? previous.firstPlayedAt === null : !existing.lastPlayedAt;
          works.put({
            ...previous, workId: existing.workId, title: existing.title, playKey: existing.playKey,
            coverBlobSha256: existing.coverBlobSha256 ?? previous?.coverBlobSha256, lastPlayedAt: now,
            firstPlayedAt: recordLaunch && firstLaunch ? now : previous?.firstPlayedAt,
            launchCount: recordLaunch ? (previous?.launchCount ?? 0) + 1 : previous?.launchCount,
          });
        };
      }
    };
    tx.onerror = () => reject(tx.error);
    tx.oncomplete = () => resolve(updated);
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
