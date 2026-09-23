import { useSyncExternalStore } from "react";

const storageKey = "viprpg.upload.resource-cleanup.v1";
const changeEvent = "viprpg:resource-cleanup-preference";
let memoryPreference = true;
let unsavedPreference: boolean | null = null;

function snapshot(): boolean {
  if (unsavedPreference !== null) return unsavedPreference;
  try {
    return localStorage.getItem(storageKey) !== "false";
  } catch {
    return memoryPreference;
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

function setPreference(enabled: boolean): void {
  memoryPreference = enabled;
  try {
    localStorage.setItem(storageKey, String(enabled));
    unsavedPreference = null;
  } catch {
    // A blocked browser store must not prevent changing this upload's option.
    unsavedPreference = enabled;
  }
  window.dispatchEvent(new Event(changeEvent));
}

export function useResourceCleanupPreference(): readonly [boolean, (enabled: boolean) => void] {
  const enabled = useSyncExternalStore(subscribe, snapshot, () => true);
  return [enabled, setPreference];
}
