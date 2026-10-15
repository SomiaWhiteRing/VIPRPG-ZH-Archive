import { useCallback, useEffect, useState } from "react";
import { isCustomKeyboardCode, keyboardKeys } from "./web-play-keyboard-keys";

export type DisplayOrientation = "landscape" | "portrait";
const directionControlIds = ["up", "left", "right", "down"] as const;
export const customControlIds = ["digit1", "digit2", "digit3", "digit4"] as const;
export type CustomControlId = typeof customControlIds[number];
const defaultCustomKeys: Record<CustomControlId, string> = { digit1: "Digit1", digit2: "Digit2", digit3: "Digit3", digit4: "Digit4" };
export const controlIds = ["dpad", ...directionControlIds, "decision", "cancel", "shift", "menu", "debug", "log", "fastForward3", "fastForward10", "screenshot", ...customControlIds] as const;
export type ControlId = typeof controlIds[number];
export type ControlPlacement = { x: number; y: number; size: number; opacity: number; visible: boolean };
export type ControlLayout = { screen: number; splitDpad: boolean; customKeys: Record<CustomControlId, string>; buttons: Record<ControlId, ControlPlacement> };

export const controlDefinitions = {
  dpad: { label: "十字键", defaultVisible: true },
  up: { label: "上", defaultVisible: true },
  left: { label: "左", defaultVisible: true },
  right: { label: "右", defaultVisible: true },
  down: { label: "下", defaultVisible: true },
  decision: { label: "A", defaultVisible: true },
  cancel: { label: "B", defaultVisible: true },
  shift: { label: "Shift", defaultVisible: false },
  menu: { label: "Menu", defaultVisible: false },
  debug: { label: "Debug", defaultVisible: false },
  log: { label: "log", defaultVisible: false },
  fastForward3: { label: "x3", defaultVisible: false },
  fastForward10: { label: "x10", defaultVisible: false },
  screenshot: { label: "截图", defaultVisible: false },
  digit1: { label: "1", defaultVisible: false },
  digit2: { label: "2", defaultVisible: false },
  digit3: { label: "3", defaultVisible: false },
  digit4: { label: "4", defaultVisible: false },
} as const;

export function isCustomControlId(id: string): id is CustomControlId {
  return customControlIds.some((controlId) => controlId === id);
}

export function getControlLabel(layout: ControlLayout, id: ControlId): string {
  return isCustomControlId(id) ? keyboardKeys[layout.customKeys[id]].label : controlDefinitions[id].label;
}

export function changeCustomKey(layout: ControlLayout, id: CustomControlId, code: string): ControlLayout {
  if (!isCustomKeyboardCode(code) || customControlIds.some((other) => other !== id && layout.customKeys[other] === code)) return layout;
  return { ...layout, customKeys: { ...layout.customKeys, [id]: code } };
}

export function getLayoutControlIds(layout: ControlLayout): ControlId[] {
  return controlIds.filter((id) => {
    if (id === "dpad") return !layout.splitDpad;
    if (directionControlIds.some((direction) => direction === id)) return layout.splitDpad;
    return true;
  });
}

function createDefaultLayout(orientation: DisplayOrientation): ControlLayout {
  // GBA: controls flank the screen. GBA SP: controls sit below the screen.
  // In both layouts A is above and to the right of B.
  const positions: Record<ControlId, [number, number]> = orientation === "landscape" ? {
    dpad: [0.03, 0.6], decision: [0.97, 0.42], cancel: [0.84, 0.65],
    up: [0.12, 0.35], left: [0.03, 0.6], right: [0.21, 0.6], down: [0.12, 0.85],
    shift: [0.35, 0.9], menu: [0.48, 0.9], debug: [0.61, 0.9], log: [0.74, 0.9],
    fastForward3: [0.4, 0.08], fastForward10: [0.6, 0.08], screenshot: [0.95, 0.08],
    digit1: [0.35, 0.65], digit2: [0.48, 0.65], digit3: [0.61, 0.65], digit4: [0.74, 0.65],
  } : {
    dpad: [0.03, 0.82], decision: [0.97, 0.74], cancel: [0.7, 0.85],
    up: [0.18, 0.67], left: [0.03, 0.81], right: [0.33, 0.81], down: [0.18, 0.95],
    shift: [0.05, 0.97], menu: [0.35, 0.97], debug: [0.65, 0.97], log: [0.95, 0.97],
    fastForward3: [0.3, 0.6], fastForward10: [0.65, 0.6], screenshot: [0.95, 0.5],
    digit1: [0.05, 0.35], digit2: [0.35, 0.35], digit3: [0.65, 0.35], digit4: [0.95, 0.35],
  };
  return {
    screen: 0,
    splitDpad: false,
    customKeys: { ...defaultCustomKeys },
    buttons: Object.fromEntries(controlIds.map((id) => [id, {
      x: positions[id][0], y: positions[id][1], size: 1, opacity: 0.7,
      visible: controlDefinitions[id].defaultVisible,
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
    splitDpad: typeof record.splitDpad === "boolean" ? record.splitDpad : fallback.splitDpad,
    customKeys: readCustomKeys(record.customKeys, fallback.customKeys),
    buttons: Object.fromEntries(controlIds.map((id) => {
      const saved = asRecord(buttons[id]);
      const defaults = fallback.buttons[id];
      return [id, {
        x: readNumber(saved.x, defaults.x, 0, 1),
        y: readNumber(saved.y, defaults.y, 0, 1),
        size: readNumber(saved.size, defaults.size, 0.5, 2),
        opacity: readNumber(saved.opacity, defaults.opacity, 0, 1),
        visible: typeof saved.visible === "boolean" ? saved.visible : defaults.visible,
      }];
    })) as Record<ControlId, ControlPlacement>,
  };
}

function readCustomKeys(value: unknown, fallback: Record<CustomControlId, string>): Record<CustomControlId, string> {
  const saved = asRecord(value);
  const used = new Set<string>();
  return Object.fromEntries(customControlIds.map((id) => {
    const candidate = saved[id];
    const code = isCustomKeyboardCode(candidate) && !used.has(candidate) ? candidate
      : [fallback[id], ...Object.values(defaultCustomKeys)].find((code) => isCustomKeyboardCode(code) && !used.has(code))!;
    used.add(code);
    return [id, code];
  })) as Record<CustomControlId, string>;
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
    } catch {
      // Preferences remain active for this session if storage is unavailable.
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

  return { preferences, loaded, setOrientation, setTouchEnabled, saveLayout };
}
