import { Button } from "@/app/components/ui/button";
import * as Dialog from "@/app/components/ui/dialog";
import { Keyboard, X } from "lucide-react";
import { useState } from "react";

type GroupId = "move" | "confirm" | "cancel" | "engine";
type KeyboardKey = string | readonly [string, number];

// 说明图只呈现常用默认键位，不接管或修改播放器输入。
const groups: readonly {
  id: GroupId;
  label: string;
  keysLabel: string;
  description: string;
  keys: readonly string[];
}[] = [
  {
    id: "move",
    label: "移动 / 选择",
    keysLabel: "方向键 · W A S D",
    description: "移动角色，或在菜单中选择项目。",
    keys: ["W", "A", "S", "D", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"],
  },
  {
    id: "confirm",
    label: "确认 / 对话",
    keysLabel: "Z · Enter · Space",
    description: "确认选择、推进对话，或与角色和物件互动。",
    keys: ["Z", "Enter", "Space"],
  },
  {
    id: "cancel",
    label: "取消 / 打开菜单",
    keysLabel: "X · Esc",
    description: "关闭当前菜单；在地图上通常用于打开游戏菜单。",
    keys: ["X", "Escape"],
  },
  {
    id: "engine",
    label: "播放器功能",
    keysLabel: "F2 帧率 · F7 截图 · F9 Debug 菜单 · ` 会话历史",
    description: "F9 打开 Debug 菜单；对话显示时，按反引号键查看会话历史。",
    keys: ["F2", "F7", "F9", "`", "F", "G", "ShiftLeft", "ShiftRight"],
  },
];

const keyLabels: Readonly<Record<string, string>> = {
  Escape: "Esc", Backspace: "⌫", CapsLock: "Caps", ShiftLeft: "Shift", ShiftRight: "Shift",
  ControlLeft: "Ctrl", ControlRight: "Ctrl", MetaLeft: "Win", MetaRight: "Win",
  AltLeft: "Alt", AltRight: "Alt", ContextMenu: "Menu",
  ArrowUp: "↑", ArrowDown: "↓", ArrowLeft: "←", ArrowRight: "→",
  Insert: "Ins", Delete: "Del", PageUp: "PgUp", PageDown: "PgDn",
};
const functionKeys = ["Escape", "F1", "F2", "F3", "F4", "F5", "F6", "F7", "F8", "F9", "F10", "F11", "F12"];
const letterRows: readonly (readonly KeyboardKey[])[] = [
  ["`", "1", "2", "3", "4", "5", "6", "7", "8", "9", "0", "-", "=", ["Backspace", 2]],
  [["Tab", 1.5], "Q", "W", "E", "R", "T", "Y", "U", "I", "O", "P", "[", "]", ["\\", 1.5]],
  [["CapsLock", 1.75], "A", "S", "D", "F", "G", "H", "J", "K", "L", ";", "'", ["Enter", 2.25]],
  [["ShiftLeft", 2.25], "Z", "X", "C", "V", "B", "N", "M", ",", ".", "/", ["ShiftRight", 2.75]],
  [["ControlLeft", 1.25], ["MetaLeft", 1.25], ["AltLeft", 1.25], ["Space", 6.25], ["AltRight", 1.25], ["MetaRight", 1.25], ["ContextMenu", 1.25], ["ControlRight", 1.25]],
];
const navigationKeys = ["Insert", "Home", "PageUp", "Delete", "End", "PageDown"];
const arrowKeys = [null, "ArrowUp", null, "ArrowLeft", "ArrowDown", "ArrowRight"];
const defaultDescription = "按住 F / G 加速（默认 3× / 10×）；Shift 功能由游戏决定。";

function Keycap({ value, units = 1 }: { value: string; units?: number }) {
  return (
    <kbd
      className="web-play-help-key"
      data-key-group={groups.find((group) => group.keys.includes(value))?.id}
      data-key-units={units}
      aria-label={value === "Space" ? "空格键" : value === "`" ? "反引号键" : value}
    >
      {keyLabels[value] ?? value}
    </kbd>
  );
}

export function WebPlayControlsHelp() {
  const [selectedGroup, setSelectedGroup] = useState<GroupId | null>(null);
  const description = groups.find((group) => group.id === selectedGroup)?.description ?? defaultDescription;

  return (
    <Dialog.Root onOpenChange={(open) => { if (!open) setSelectedGroup(null); }}>
      <Dialog.Trigger asChild>
        <Button
          className="absolute right-0 top-3 min-h-0 gap-1.5 p-0 text-primary hover:bg-transparent hover:text-primary"
          size="sm"
          type="button"
          variant="ghost"
        >
          <Keyboard aria-hidden />
          操作说明
        </Button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay />
        <Dialog.Content className="web-play-controls-help left-1/2 top-1/2 max-h-[90dvh] w-[min(42rem,calc(100vw-1.5rem))] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-lg p-5">
          <div className="mb-3.5 flex items-start justify-between gap-4">
            <div>
              <Dialog.Title className="flex items-center gap-2">
                <Keyboard aria-hidden className="size-4 text-primary" />
                操作说明
              </Dialog.Title>
              <Dialog.Description className="mb-0 mt-1 text-xs text-muted">
                PC 常用默认键位
              </Dialog.Description>
            </div>
            <Dialog.Close asChild>
              <Button aria-label="关闭操作说明" className="size-8" size="icon" type="button" variant="outline">
                <X aria-hidden />
              </Button>
            </Dialog.Close>
          </div>

          <div
            className="web-play-help-board"
            data-selected-group={selectedGroup ?? undefined}
            role="img"
            aria-label="常用键位位置图：方向键或 WASD 移动；Z、Enter、Space 确认；X、Esc 取消；F2 帧率、F7 截图、F9 Debug 菜单、反引号键会话历史；F、G 加速，Shift 为游戏功能。"
          >
            <div className="web-play-help-full-keyboard">
              <div className="web-play-help-function-row">
                {functionKeys.map((key) => <Keycap key={key} value={key} />)}
              </div>
              <div className="web-play-help-keyboard-lower">
                <div className="web-play-help-letter-block">
                  {letterRows.map((row, index) => (
                    <div className="web-play-help-key-row" key={index}>
                      {row.map((key) => typeof key === "string"
                        ? <Keycap key={key} value={key} />
                        : <Keycap key={key[0]} value={key[0]} units={key[1]} />)}
                    </div>
                  ))}
                </div>
                <div className="web-play-help-navigation">
                  <div className="web-play-help-navigation-grid">
                    {navigationKeys.map((key) => <Keycap key={key} value={key} />)}
                  </div>
                  <div className="web-play-help-navigation-grid">
                    {arrowKeys.map((key, index) => key
                      ? <Keycap key={key} value={key} />
                      : <span aria-hidden key={index} />)}
                  </div>
                </div>
              </div>
            </div>
            <div className="web-play-help-narrow-keyboard">
              {groups.map((group) => (
                <div className="web-play-help-narrow-group" key={group.id}>
                  <strong>{group.label}</strong>
                  {group.keys.filter((key) => key !== "ShiftRight").map((key) => <Keycap key={key} value={key} />)}
                </div>
              ))}
            </div>
          </div>

          <div className="web-play-help-actions" aria-label="突出显示一组键位">
            {groups.map((group) => (
              <Button
                className="web-play-help-action whitespace-normal"
                data-key-group={group.id}
                aria-pressed={selectedGroup === group.id}
                key={group.id}
                onClick={() => setSelectedGroup((current) => current === group.id ? null : group.id)}
                type="button"
                variant="ghost"
              >
                <span className="web-play-help-action-name"><span className="web-play-help-dot" aria-hidden />{group.label}</span>
                <span className="web-play-help-action-keys">{group.keysLabel}</span>
              </Button>
            ))}
          </div>
          <p className="mb-0 mt-2.5 text-xs text-muted" aria-live="polite">{description}</p>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
