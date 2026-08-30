import type {
  PreparedArchiveSource,
  UploadRecoveryDraft,
} from "@/app/upload/upload-types";

const DATABASE_NAME = "viprpg-upload-drafts";
const DATABASE_VERSION = 1;
const DRAFT_STORE = "drafts";

export type DraftLock = {
  release: () => Promise<void>;
};

export function draftKey(accountId: number, importJobId: number): string {
  return `${accountId}:${importJobId}`;
}

export function sourceObjectReferences(source: PreparedArchiveSource) {
  return {
    blobs: [
      ...new Set(
        source.files
          .filter((file) => file.storage.kind === "blob")
          .map((file) => file.sha256),
      ),
    ].map((sha256) => ({ sha256 })),
    corePacks: [{ sha256: source.corePack.sha256 }],
  };
}

export async function listUploadDrafts(
  accountId: number,
): Promise<UploadRecoveryDraft[]> {
  const database = await openDatabase();
  const rows = await requestResult<UploadRecoveryDraft[]>(
    database.transaction(DRAFT_STORE, "readonly").objectStore(DRAFT_STORE).getAll(),
  );
  return rows
    .filter((draft) => draft.accountId === accountId)
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

export async function putUploadDraft(draft: UploadRecoveryDraft): Promise<void> {
  const database = await openDatabase();
  await transactionDone(
    database.transaction(DRAFT_STORE, "readwrite"),
    (store) => store.put(draft),
  );
}

export async function deleteUploadDraft(
  accountId: number,
  importJobId: number,
): Promise<void> {
  const database = await openDatabase();
  await transactionDone(
    database.transaction(DRAFT_STORE, "readwrite"),
    (store) => store.delete(draftKey(accountId, importJobId)),
  );
}

export async function acquireDraftLock(
  accountId: number,
  importJobId: number,
): Promise<DraftLock | null> {
  if (!("locks" in navigator)) {
    throw new Error("当前浏览器不支持上传草稿锁，请使用支持 Web Locks 的现代浏览器。");
  }

  let resolveAcquired!: (acquired: boolean) => void;
  let rejectAcquired!: (reason: unknown) => void;
  const acquired = new Promise<boolean>((resolve, reject) => {
    resolveAcquired = resolve;
    rejectAcquired = reject;
  });
  let releaseHeldLock!: () => void;
  const held = new Promise<void>((resolve) => {
    releaseHeldLock = resolve;
  });
  const request = navigator.locks.request(
    `viprpg-upload-draft:${draftKey(accountId, importJobId)}`,
    { mode: "exclusive", ifAvailable: true },
    async (lock) => {
      resolveAcquired(Boolean(lock));
      if (lock) await held;
    },
  );
  void request.catch(rejectAcquired);

  if (!(await acquired)) {
    await request;
    return null;
  }

  let released = false;
  return {
    async release() {
      if (released) return;
      released = true;
      releaseHeldLock();
      await request;
    },
  };
}

let databasePromise: Promise<IDBDatabase> | null = null;
function openDatabase(): Promise<IDBDatabase> {
  if (databasePromise) return databasePromise;
  databasePromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(DRAFT_STORE)) {
        database.createObjectStore(DRAFT_STORE, { keyPath: "key" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("无法打开上传草稿数据库"));
  });
  return databasePromise;
}

async function transactionDone(
  transaction: IDBTransaction,
  mutate: (store: IDBObjectStore) => IDBRequest,
): Promise<void> {
  mutate(transaction.objectStore(transaction.objectStoreNames[0]));
  await waitForTransaction(transaction);
}

function waitForTransaction(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error("上传草稿写入失败"));
    transaction.onabort = () => reject(transaction.error ?? new Error("上传草稿写入已中止"));
  });
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("上传草稿读取失败"));
  });
}
