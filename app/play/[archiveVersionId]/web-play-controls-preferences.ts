import { useCallback, useEffect, useState } from "react";

export type DisplayOrientation = "landscape" | "portrait";
export const controlIds = ["dpad", "decision", "cancel", "shift", "menu", "debug", "log", "fastForward3", "fastForward10", "screenshot"] as const;
export type ControlId = typeof controlIds[number];
export type ControlPlacement = { x: number; y: number; size: number; opacity: number; visible: boolean };
export type ControlLayout = { screen: number; buttons: Record<ControlId, ControlPlacement> };

export const controlDefinitions = {
  dpad: { label: "十字键", optional: false },
  decision: { label: "A", optional: false },
  cancel: { label: "B", optional: false },
  shift: { label: "Shift", optional: true },
  menu: { label: "Menu", optional: true },
  debug: { label: "Debug", optional: true },
  log: { label: "log", optional: true },
  fastForward3: { label: "x3", optional: true },
  fastForward10: { label: "x10", optional: true },
  screenshot: { label: "截图", optional: true },
} as const;

function createDefaultLayout(orientation: DisplayOrientation): ControlLayout {
  // GBA: controls flank the screen. GBA SP: controls sit below the screen.
  // In both layouts A is above and to the right of B.
  const positions: Record<ControlId, [number, number]> = orientation === "landscape" ? {
    dpad: [0.03, 0.6], decision: [0.97, 0.42], cancel: [0.84, 0.65],
    shift: [0.35, 0.9], menu: [0.48, 0.9], debug: [0.61, 0.9], log: [0.74, 0.9],
    fastForward3: [0.4, 0.08], fastForward10: [0.6, 0.08], screenshot: [0.95, 0.08],
  } : {
    dpad: [0.03, 0.82], decision: [0.97, 0.74], cancel: [0.7, 0.85],
    shift: [0.05, 0.97], menu: [0.35, 0.97], debug: [0.65, 0.97], log: [0.95, 0.97],
    fastForward3: [0.3, 0.6], fastForward10: [0.65, 0.6], screenshot: [0.95, 0.5],
  };
  return {
    screen: 0,
    buttons: Object.fromEntries(controlIds.map((id) => [id, {
      x: positions[id][0], y: positions[id][1], size: 1, opacity: 0.7,
      visible: !controlDefinitions[id].optional,
    }])) as Record<ControlId, ControlPlacement>,
  };
}

// Positions are fractions of each element's available horizontal/vertical travel.
export const defaultControlLayouts: Record<DisplayOrientation, ControlLayout> = {
  portrait: createDefaultLayout("portrait"),
  landscape: createDefaultLayout("landscape"),
};

type ControlsPreferences = {
  orientation: DisplayOrientation;
  touchEnabled: boolean;
  layouts: Record<DisplayOrientation, ControlLayout>;
};

const storageKey = "viprpg:web-play:controls";
const defaultPreferences: ControlsPreferences = {
  orientation: "landscape",
  touchEnabled: false,
  layouts: defaultControlLayouts,
};

function readLayout(value: unknown, fallback: ControlLayout): ControlLayout {
  const record = asRecord(value);
  const buttons = asRecord(record.buttons);
  return {
    screen: readNumber(record.screen, fallback.screen, 0, 1),
    buttons: Object.fromEntries(controlIds.map((id) => {
      const saved = asRecord(buttons[id]);
      const defaults = fallback.buttons[id];
      return [id, {
        x: readNumber(saved.x, defaults.x, 0, 1),
        y: readNumber(saved.y, defaults.y, 0, 1),
        size: readNumber(saved.size, defaults.size, 0.5, 2),
        opacity: readNumber(saved.opacity, defaults.opacity, 0, 1),
        visible: controlDefinitions[id].optional && typeof saved.visible === "boolean" ? saved.visible : defaults.visible,
      }];
    })) as Record<ControlId, ControlPlacement>,
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}

function readNumber(value: unknown, fallback: number, min: number, max: number) {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : fallback;
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
          touchEnabled: value.touchEnabled === true,
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

  const setTouchEnabled = useCallback((touchEnabled: boolean) => {
    setPreferences((current) => current.touchEnabled === touchEnabled ? current : { ...current, touchEnabled });
  }, []);

  const saveLayout = useCallback((orientation: DisplayOrientation, layout: ControlLayout) => {
    setPreferences((current) => ({
      ...current,
      layouts: { ...current.layouts, [orientation]: layout },
    }));
  }, []);

  return { preferences, setOrientation, setTouchEnabled, saveLayout, storageError };
}
