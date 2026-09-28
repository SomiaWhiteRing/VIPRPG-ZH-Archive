import { useSyncExternalStore } from "react";

function createBooleanPreference(storageKey: string, defaultValue: boolean) {
  const changeEvent = `${storageKey}:change`;
  let memoryPreference = defaultValue;
  let unsavedPreference: boolean | null = null;

  function snapshot(): boolean {
    if (unsavedPreference !== null) return unsavedPreference;
    try {
      const stored = localStorage.getItem(storageKey);
      return stored === null ? defaultValue : stored !== "false";
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

  return function usePreference(): readonly [boolean, (enabled: boolean) => void] {
    const enabled = useSyncExternalStore(subscribe, snapshot, () => defaultValue);
    return [enabled, setPreference];
  };
}

export const useResourceCleanupPreference = createBooleanPreference("viprpg.upload.resource-cleanup.v1", true);
export const useMissingResourcesPreference = createBooleanPreference("viprpg.upload.missing-resources.v1", false);
export const useSharedPlayerPreference = createBooleanPreference("viprpg.upload.shared-player.v1", true);
