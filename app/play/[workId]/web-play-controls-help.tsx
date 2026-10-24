import { Button } from "@/app/components/ui/button";
import * as Dialog from "@/app/components/ui/dialog";
import { Keyboard, X } from "lucide-react";

import { WebPlayKeyboard } from "./web-play-keyboard";
import { keyboardGroups } from "./web-play-keyboard-keys";

export function WebPlayControlsHelp() {
  return (
    <Dialog.Root>
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
            role="img"
            aria-label="常用键位位置图：方向键或 WASD 移动；Z、Enter、Space 确认；X、Esc 取消；F1 系统设置、F2 帧率、F7 截图、F9 Debug 菜单、E 交互高亮、反引号键会话历史；F、G 加速，Shift 为游戏功能。"
          >
            <WebPlayKeyboard />
          </div>

          <div className="web-play-help-legend">
            {keyboardGroups.map((group) => (
              <div
                className="web-play-help-legend-item"
                data-key-group={group.id}
                key={group.id}
              >
                <span className="web-play-help-legend-name"><span className="web-play-help-dot" aria-hidden />{group.label}</span>
                <span className="web-play-help-legend-keys">{group.keysLabel}</span>
              </div>
            ))}
          </div>
          <p className="mb-0 mt-2.5 text-xs text-muted">游戏启动后，点击游戏画面再按 F1 打开系统设置。按住 F / G 加速（默认 3× / 10×），按住 E 显示交互位置；Shift 功能由游戏决定。Debug 菜单和交互高亮需在「追加功能」中分别开启「强制TestPlay」和「场景交互高亮」，加速倍率可在系统设置调整。移动端可在布局编辑中添加 Debug 和高亮按钮，通过 Menu 打开系统设置。</p>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
