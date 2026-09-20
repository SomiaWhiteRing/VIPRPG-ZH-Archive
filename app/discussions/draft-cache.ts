import type { ForumDraft } from "./draft";

let database: Promise<IDBDatabase> | null = null;
let queue: Promise<unknown> = Promise.resolve();

function openDatabase() {
  database ??= new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open("forum-drafts", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("drafts");
    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => {
        db.close();
        database = null;
      };
      resolve(db);
    };
    request.onerror = () => {
      database = null;
      reject(request.error);
    };
  });
  return database;
}

function ordered<T>(operation: () => Promise<T>): Promise<T> {
  const result = queue.then(operation);
  queue = result.catch(() => undefined);
  return result;
}

export function forumDraftKey(
  userId: number,
  topicId: number | undefined,
  draft: ForumDraft,
) {
  return JSON.stringify([
    userId,
    draft.target ? "edit" : draft.mode,
    draft.target?.kind ?? null,
    draft.target?.id ?? (draft.mode === "topic" ? null : topicId),
    draft.mode === "comment" ? draft.postId : null,
  ]);
}

export function saveForumDraft(draft: ForumDraft) {
  if (!draft.cacheKey) return Promise.resolve();
  // Store File/Blob data, not a blob URL tied to the current document.
  const stored = {
    ...draft,
    images: draft.images.map((image) => ({ ...image, preview: "" })),
  };
  return ordered(async () => {
    const db = await openDatabase();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction("drafts", "readwrite");
      tx.objectStore("drafts").put(stored, draft.cacheKey);
      tx.oncomplete = () => resolve();
      tx.onabort = tx.onerror = () => reject(tx.error);
    });
  });
}

export function readForumDraft(key: string) {
  return ordered(async () => {
    const db = await openDatabase();
    const stored = await new Promise<ForumDraft | undefined>((resolve, reject) => {
      const request = db.transaction("drafts").objectStore("drafts").get(key);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    return stored ?? null;
  });
}

// Preloading keeps File data only. Each editor owns fresh preview URLs so an
// earlier editor's cleanup cannot invalidate a restored draft's images.
export function restoreForumDraft(stored: ForumDraft): ForumDraft {
  return {
    ...stored,
    editorId: crypto.randomUUID(),
    images: stored.images.map((image) => ({
      ...image,
      preview: image.file
        ? URL.createObjectURL(image.file)
        : (image.uploaded?.url ?? ""),
    })),
  };
}

export function deleteForumDraft(key: string) {
  return ordered(async () => {
    const db = await openDatabase();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction("drafts", "readwrite");
      tx.objectStore("drafts").delete(key);
      tx.oncomplete = () => resolve();
      tx.onabort = tx.onerror = () => reject(tx.error);
    });
  });
}
