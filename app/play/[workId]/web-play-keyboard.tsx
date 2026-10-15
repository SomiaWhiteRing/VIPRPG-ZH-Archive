import { Button } from "@/app/components/ui/button";
import { keyboardGroups, keyboardKeys } from "./web-play-keyboard-keys";

type KeyLayout = string | readonly [string, number];
type Props = {
  value?: string;
  disabledCodes?: ReadonlySet<string>;
  onSelect?: (code: string) => void;
};

const functionKeys = ["Escape", "F1", "F2", "F3", "F4", "F5", "F6", "F7", "F8", "F9", "F10", "F11", "F12"];
const letterRows: readonly (readonly KeyLayout[])[] = [
  ["Backquote", "Digit1", "Digit2", "Digit3", "Digit4", "Digit5", "Digit6", "Digit7", "Digit8", "Digit9", "Digit0", "Minus", "Equal", ["Backspace", 2]],
  [["Tab", 1.5], "KeyQ", "KeyW", "KeyE", "KeyR", "KeyT", "KeyY", "KeyU", "KeyI", "KeyO", "KeyP", "BracketLeft", "BracketRight", ["Backslash", 1.5]],
  [["CapsLock", 1.75], "KeyA", "KeyS", "KeyD", "KeyF", "KeyG", "KeyH", "KeyJ", "KeyK", "KeyL", "Semicolon", "Quote", ["Enter", 2.25]],
  [["ShiftLeft", 2.25], "KeyZ", "KeyX", "KeyC", "KeyV", "KeyB", "KeyN", "KeyM", "Comma", "Period", "Slash", ["ShiftRight", 2.75]],
  [["ControlLeft", 1.25], ["MetaLeft", 1.25], ["AltLeft", 1.25], ["Space", 6.25], ["AltRight", 1.25], ["MetaRight", 1.25], ["ContextMenu", 1.25], ["ControlRight", 1.25]],
];
const navigationKeys = ["Insert", "Home", "PageUp", "Delete", "End", "PageDown"];
const arrowKeys = [null, "ArrowUp", null, "ArrowLeft", "ArrowDown", "ArrowRight"];
const numpadKeys = ["NumLock", "NumpadDivide", "NumpadMultiply", "NumpadSubtract", "Numpad7", "Numpad8", "Numpad9", "NumpadAdd", "Numpad4", "Numpad5", "Numpad6", "Numpad1", "Numpad2", "Numpad3", "NumpadEnter", "Numpad0", "NumpadDecimal"];

function Keycap({ code, units = 1, value, disabledCodes, onSelect }: Props & { code: string; units?: number }) {
  const key = keyboardKeys[code];
  const label = code === "Space" ? "空格键" : code === "Backquote" ? "反引号键" : key.label;
  const attributes = { "data-key-code": code, "data-key-units": units, "aria-label": label };
  if (onSelect) {
    const disabled = key.unsupported || disabledCodes?.has(code);
    return (
      <Button {...attributes} aria-pressed={value === code} className="web-play-help-key" disabled={disabled}
        onClick={() => onSelect(code)} size="sm" title={key.unsupported ? "播放器不支持此键" : disabled ? "此键已被占用" : key.label} type="button" variant="outline">
        {code.startsWith("Numpad") ? key.label.replace("Num ", "") : key.label}
      </Button>
    );
  }
  return <kbd {...attributes} className="web-play-help-key" data-key-group={keyboardGroups.find((group) => group.keys.includes(code))?.id}>{key.label}</kbd>;
}

/** The controls guide and custom-key picker share the same physical keyboard layout. */
export function WebPlayKeyboard(props: Props) {
  return (
    <>
      <div className="web-play-help-full-keyboard" data-key-selectable={!!props.onSelect}>
        <div className="web-play-help-function-row">
          {functionKeys.map((code) => <Keycap {...props} code={code} key={code} />)}
          {props.onSelect ? ["PrintScreen", "ScrollLock", "Pause"].map((code) => <Keycap {...props} code={code} key={code} />) : null}
        </div>
        <div className="web-play-help-keyboard-lower">
          <div className="web-play-help-letter-block">
            {letterRows.map((row, index) => (
              <div className="web-play-help-key-row" key={index}>
                {row.map((key) => typeof key === "string"
                  ? <Keycap {...props} code={key} key={key} />
                  : <Keycap {...props} code={key[0]} key={key[0]} units={key[1]} />)}
              </div>
            ))}
          </div>
          <div className="web-play-help-navigation">
            <div className="web-play-help-navigation-grid">
              {navigationKeys.map((code) => <Keycap {...props} code={code} key={code} />)}
            </div>
            <div className="web-play-help-navigation-grid">
              {arrowKeys.map((code, index) => code ? <Keycap {...props} code={code} key={code} /> : <span aria-hidden key={index} />)}
            </div>
          </div>
          {props.onSelect ? <div className="web-play-help-numpad">{numpadKeys.map((code) => <Keycap {...props} code={code} key={code} />)}</div> : null}
        </div>
      </div>
      {!props.onSelect ? (
        <div className="web-play-help-narrow-keyboard">
          {keyboardGroups.map((group) => (
            <div className="web-play-help-narrow-group" key={group.id}>
              <strong>{group.label}</strong>
              {group.keys.filter((code) => code !== "ShiftRight").map((code) => <Keycap code={code} key={code} />)}
            </div>
          ))}
        </div>
      ) : null}
    </>
  );
}
