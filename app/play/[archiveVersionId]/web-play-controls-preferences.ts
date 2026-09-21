import { useCallback, useEffect, useState } from "react";

export type DisplayOrientation = "landscape" | "portrait";
export type ControlLayout = { screen: number; dpad: number; actions: number };

// Positions are fractions of each element's available vertical travel.
export const defaultControlLayouts: Record<DisplayOrientation, ControlLayout> = {
  portrait: { screen: 0, dpad: 1, actions: 1 },
  landscape: { screen: 0.5, dpad: 1, actions: 1 },
};

type ControlsPreferences = {
  orientation: DisplayOrientation;
  layouts: Record<DisplayOrientation, ControlLayout>;
};

const storageKey = "viprpg:web-play:controls";
const defaultPreferences: ControlsPreferences = {
  orientation: "landscape",
  layouts: defaultControlLayouts,
};

function readLayout(value: unknown, fallback: ControlLayout): ControlLayout {
  const record = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const position = (key: keyof ControlLayout) => {
    const value = record[key];
    return typeof value === "number" && Number.isFinite(value)
      ? Math.max(0, Math.min(1, value))
      : fallback[key];
  };
  return { screen: position("screen"), dpad: position("dpad"), actions: position("actions") };
}

export function useWebPlayControlsPreferences() {
  const [preferences, setPreferences] = useState(defaultPreferences);
  const [loaded, setLoaded] = useState(false);
  const [storageError, setStorageError] = useState<string | null>(null);

  useEffect(() => {
    try {
      const value = JSON.parse(localStorage.getItem(storageKey) ?? "null") as Partial<ControlsPreferences> | null;
      if (value && typeof value === "object") {
        setPreferences({
          orientation: value.orientation === "portrait" ? "portrait" : "landscape",
          layouts: {
            portrait: readLayout(value.layouts?.portrait, defaultControlLayouts.portrait),
            landscape: readLayout(value.layouts?.landscape, defaultControlLayouts.landscape),
          },
        });
      }
    } catch {
      // Unavailable storage or an invalid cache must not prevent playing.
    }
    setLoaded(true);
  }, []);

  useEffect(() => {
    if (!loaded) return;
    try {
      localStorage.setItem(storageKey, JSON.stringify(preferences));
      setStorageError(null);
    } catch {
      setStorageError("设置已应用，但浏览器未能保存，下次进入需要重新设置。");
    }
  }, [loaded, preferences]);

  const setOrientation = useCallback((orientation: DisplayOrientation) => {
    setPreferences((current) => current.orientation === orientation ? current : { ...current, orientation });
  }, []);

  const saveLayout = useCallback((orientation: DisplayOrientation, layout: ControlLayout) => {
    setPreferences((current) => ({
      ...current,
      layouts: { ...current.layouts, [orientation]: layout },
    }));
  }, []);

  return { preferences, setOrientation, saveLayout, storageError };
}
