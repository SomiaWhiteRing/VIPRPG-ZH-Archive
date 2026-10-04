import { useCallback, useEffect, useRef, useState } from "react";
import type { StatusImageAttachment } from "./image-attachments";

type TimelineDraft = { body: string; requestKey: string; images: StatusImageAttachment[] };
type DraftKind = "status" | "reply";

let database: Promise<IDBDatabase> | null = null;
let queue: Promise<unknown> = Promise.resolve();

function openDatabase() {
  database ??= new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open("timeline-drafts", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("drafts");
    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => { db.close(); database = null; };
      resolve(db);
    };
    request.onerror = () => { database = null; reject(request.error); };
  });
  return database;
}

function ordered<T>(operation: () => Promise<T>): Promise<T> {
  const result = queue.then(operation);
  queue = result.catch(() => undefined);
  return result;
}

function readDraft(key: string) {
  return ordered(async () => {
    const db = await openDatabase();
    return new Promise<TimelineDraft | null>((resolve, reject) => {
      const request = db.transaction("drafts").objectStore("drafts").get(key);
      request.onsuccess = () => {
        const stored = request.result as TimelineDraft | undefined;
        resolve(stored && typeof stored.body === "string" && typeof stored.requestKey === "string"
          ? { ...stored, images: Array.isArray(stored.images) ? stored.images.map((image) => ({ ...image, stage: undefined })) : [] } : null);
      };
      request.onerror = () => reject(request.error);
    });
  });
}

function saveDraft(key: string, draft: TimelineDraft) {
  return ordered(async () => {
    const db = await openDatabase();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction("drafts", "readwrite");
      tx.objectStore("drafts").put({ ...draft, images: draft.images.map((image) => ({ ...image, stage: undefined })) }, key);
      tx.oncomplete = () => resolve();
      tx.onabort = tx.onerror = () => reject(tx.error);
    });
  });
}

function clearDraft(key: string, requestKey: string) {
  return ordered(async () => {
    const db = await openDatabase();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction("drafts", "readwrite"), store = tx.objectStore("drafts");
      const request = store.get(key);
      // A completed submission must not erase a newer draft written after leaving.
      request.onsuccess = () => { if (request.result?.requestKey === requestKey) store.delete(key); };
      tx.oncomplete = () => resolve();
      tx.onabort = tx.onerror = () => reject(tx.error);
    });
  });
}

export function useTimelineDraft({ userId, kind, eventId, onError }: {
  userId: number | null; kind: DraftKind; eventId?: number; onError: () => void;
}) {
  const key = userId === null || kind !== "status" && eventId === undefined ? null : JSON.stringify([userId, kind, eventId ?? null]);
  const [state, setState] = useState<{ key: string | null; draft: TimelineDraft; ready: boolean }>({
    key, draft: { body: "", requestKey: "", images: [] }, ready: key === null,
  });
  const changes = useRef(0);

  useEffect(() => {
    if (key === null) return;
    let active = true;
    const revision = changes.current;
    void readDraft(key).then((saved) => {
      if (active && revision === changes.current) setState({ key, draft: saved ?? { body: "", requestKey: crypto.randomUUID(), images: [] }, ready: true });
    }, () => {
      if (!active) return;
      onError();
      // A failed read must not overwrite a stored draft with an empty default.
      if (revision === changes.current) setState({ key, draft: { body: "", requestKey: crypto.randomUUID(), images: [] }, ready: true });
    });
    return () => { active = false; };
  }, [key, onError]);

  const ready = key === null || state.key === key && state.ready;
  const draft = state.key === key ? state.draft : { body: "", requestKey: "", images: [] };
  const current = useRef(draft);
  current.current = draft;
  const setBody = useCallback((body: string) => {
    changes.current++;
    const previous = current.current;
    const next = { ...previous, body, requestKey: body.trim() === previous.body.trim() && previous.requestKey ? previous.requestKey : crypto.randomUUID() };
    current.current = next;
    setState({ key, draft: next, ready: true });
    // Queue each edit immediately, including the last keystroke before navigation.
    if (key !== null) void saveDraft(key, next).catch(onError);
  }, [key, onError]);
  const setImages = useCallback((images: StatusImageAttachment[]) => {
    changes.current++;
    const previous = current.current;
    const unchanged = images.length === previous.images.length && images.every((image, index) => image.key === previous.images[index].key);
    const next = { ...previous, images, requestKey: unchanged && previous.requestKey ? previous.requestKey : crypto.randomUUID() };
    current.current = next;
    setState({ key, draft: next, ready: true });
    if (key !== null) void saveDraft(key, next).catch(onError);
  }, [key, onError]);
  const clear = useCallback(async () => {
    changes.current++;
    setState((current) => current.key === key && current.draft.requestKey === draft.requestKey
      ? { key, draft: { body: "", requestKey: crypto.randomUUID(), images: [] }, ready: true } : current);
    if (key !== null) await clearDraft(key, draft.requestKey).catch(onError);
  }, [key, draft.requestKey, onError]);

  return { ...draft, ready, setBody, setImages, clear };
}
