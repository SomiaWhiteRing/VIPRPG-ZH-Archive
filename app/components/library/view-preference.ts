import { useSyncExternalStore } from "react";

type LibraryView = "list" | "grid";

const storageKey = "viprpg.library.view.v1";
const changeEvent = "viprpg:library-view-preference";
let unsavedPreference: LibraryView | null = null;

function snapshot(): LibraryView {
  if (unsavedPreference !== null) return unsavedPreference;
  try {
    return localStorage.getItem(storageKey) === "grid" ? "grid" : "list";
  } catch {
    return "list";
  }
}

function subscribe(onChange: () => void): () => void {
  const onStorage = (event: StorageEvent) => {
    if (event.key === storageKey || event.key === null) {
      unsavedPreference = null;
      onChange();
    }
  };
  window.addEventListener("storage", onStorage);
  window.addEventListener(changeEvent, onChange);
  return () => {
    window.removeEventListener("storage", onStorage);
    window.removeEventListener(changeEvent, onChange);
  };
}

function setPreference(view: LibraryView): void {
  try {
    localStorage.setItem(storageKey, view);
    unsavedPreference = null;
  } catch {
    // Keep the selector usable when browser storage is unavailable.
    unsavedPreference = view;
  }
  window.dispatchEvent(new Event(changeEvent));
}

export function useLibraryViewPreference(): readonly [LibraryView, (view: LibraryView) => void] {
  const view = useSyncExternalStore(subscribe, snapshot, () => "list" as const);
  return [view, setPreference];
}
