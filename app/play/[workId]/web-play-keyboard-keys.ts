export type KeyboardKey = {
  code: string;
  key: string;
  keyCode: number;
  label: string;
  location: number;
  unsupported?: boolean;
};

type KeyEntry = [code: string, key: string, keyCode: number, label?: string, location?: number];

const entries: KeyEntry[] = [
  ...Array.from({ length: 26 }, (_, index): KeyEntry => {
    const letter = String.fromCharCode(65 + index);
    return [`Key${letter}`, letter.toLowerCase(), 65 + index, letter];
  }),
  ...Array.from({ length: 10 }, (_, index): KeyEntry => [`Digit${index}`, String(index), 48 + index]),
  ...Array.from({ length: 12 }, (_, index): KeyEntry => [`F${index + 1}`, `F${index + 1}`, 112 + index]),
  ...Array.from({ length: 10 }, (_, index): KeyEntry => [`Numpad${index}`, String(index), 96 + index, `Num ${index}`, 3]),
  ["Escape", "Escape", 27, "Esc"], ["Backspace", "Backspace", 8, "⌫"],
  ["Tab", "Tab", 9], ["CapsLock", "CapsLock", 20, "Caps"],
  ["Enter", "Enter", 13], ["Space", " ", 32, "Space"],
  ["ShiftLeft", "Shift", 16, "Shift", 1], ["ShiftRight", "Shift", 16, "Shift", 2],
  ["ControlLeft", "Control", 17, "Ctrl", 1], ["ControlRight", "Control", 17, "Ctrl", 2],
  ["AltLeft", "Alt", 18, "Alt", 1], ["AltRight", "Alt", 18, "Alt", 2],
  ["MetaLeft", "Meta", 91, "Win", 1], ["MetaRight", "Meta", 92, "Win", 2],
  ["ContextMenu", "ContextMenu", 93, "Menu"],
  ["Backquote", "`", 192], ["Minus", "-", 189], ["Equal", "=", 187],
  ["BracketLeft", "[", 219], ["BracketRight", "]", 221], ["Backslash", "\\", 220],
  ["Semicolon", ";", 186], ["Quote", "'", 222], ["Comma", ",", 188],
  ["Period", ".", 190], ["Slash", "/", 191],
  ["Insert", "Insert", 45, "Ins"], ["Delete", "Delete", 46, "Del"],
  ["Home", "Home", 36], ["End", "End", 35],
  ["PageUp", "PageUp", 33, "PgUp"], ["PageDown", "PageDown", 34, "PgDn"],
  ["ArrowUp", "ArrowUp", 38, "↑"], ["ArrowDown", "ArrowDown", 40, "↓"],
  ["ArrowLeft", "ArrowLeft", 37, "←"], ["ArrowRight", "ArrowRight", 39, "→"],
  ["PrintScreen", "PrintScreen", 44, "PrtSc"], ["ScrollLock", "ScrollLock", 145, "ScrLk"],
  ["Pause", "Pause", 19], ["NumLock", "NumLock", 144, "Num", 3],
  ["NumpadDivide", "/", 111, "Num /", 3], ["NumpadMultiply", "*", 106, "Num *", 3],
  ["NumpadSubtract", "-", 109, "Num -", 3], ["NumpadAdd", "+", 107, "Num +", 3],
  ["NumpadDecimal", ".", 110, "Num .", 3], ["NumpadEnter", "Enter", 13, "Num Enter", 3],
];

// These codes have no mapping in the current Web runtime; keep their keyboard positions.
const unsupportedCodes = new Set(["Minus", "Equal", "MetaLeft", "MetaRight", "ContextMenu", "PrintScreen", "Pause"]);
export const keyboardKeys: Readonly<Record<string, KeyboardKey>> = Object.fromEntries(entries.map(
  ([code, key, keyCode, label = key, location = 0]) => [code, { code, key, keyCode, label, location, unsupported: unsupportedCodes.has(code) }],
));

export const keyboardGroups = [
  { id: "move", label: "移动 / 选择", keysLabel: "方向键 · W A S D", keys: ["KeyW", "KeyA", "KeyS", "KeyD", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"] },
  { id: "confirm", label: "确认 / 对话", keysLabel: "Z · Enter · Space", keys: ["KeyZ", "Enter", "Space"] },
  { id: "cancel", label: "取消 / 打开菜单", keysLabel: "X · Esc", keys: ["KeyX", "Escape"] },
  { id: "engine", label: "播放器功能", keysLabel: "F1 系统设置 · F2 帧率 · F7 截图 · F9 Debug 菜单 · ` 会话历史", keys: ["F1", "F2", "F7", "F9", "Backquote", "KeyF", "KeyG", "ShiftLeft", "ShiftRight"] },
];

// NumpadEnter shares Enter's engine input; reserve it along with the default controls.
export const reservedKeyboardCodes = new Set([...keyboardGroups.flatMap((group) => group.keys), "NumpadEnter"]);

export function isCustomKeyboardCode(value: unknown): value is string {
  return typeof value === "string" && Object.hasOwn(keyboardKeys, value)
    && !keyboardKeys[value].unsupported && !reservedKeyboardCodes.has(value);
}
