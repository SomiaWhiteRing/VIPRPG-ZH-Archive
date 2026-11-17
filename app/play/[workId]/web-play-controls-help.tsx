import { Button } from "@/app/components/ui/button";
import * as Dialog from "@/app/components/ui/dialog";
import { useMessages } from "@/lib/i18n/react";
import { Keyboard, X } from "lucide-react";

import { WebPlayKeyboard } from "./web-play-keyboard";
import { keyboardGroups } from "./web-play-keyboard-keys";

export function WebPlayControlsHelp() {
  const t = useMessages();
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
          {t("play.help")}
        </Button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay />
        <Dialog.Content className="web-play-controls-help left-1/2 top-1/2 max-h-[90dvh] w-[min(42rem,calc(100vw-1.5rem))] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-lg p-5">
          <div className="mb-3.5 flex items-start justify-between gap-4">
            <div>
              <Dialog.Title className="flex items-center gap-2">
                <Keyboard aria-hidden className="size-4 text-primary" />
                {t("play.help")}
              </Dialog.Title>
              <Dialog.Description className="mb-0 mt-1 text-xs text-muted">
                {t("play.defaultKeys")}
              </Dialog.Description>
            </div>
            <Dialog.Close asChild>
              <Button aria-label={t("play.closeHelp")} className="size-8" size="icon" type="button" variant="outline">
                <X aria-hidden />
              </Button>
            </Dialog.Close>
          </div>

          <div
            className="web-play-help-board"
            role="img"
            aria-label={t("play.keyboardMap", { engineKeys: t("play.engineKeys") })}
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
                <span className="web-play-help-legend-name"><span className="web-play-help-dot" aria-hidden />{t(`play.keys.${group.id}`)}</span>
                <span className="web-play-help-legend-keys">{group.id === "move" ? t("play.moveKeys") : group.id === "engine" ? t("play.engineKeys") : group.keysLabel}</span>
              </div>
            ))}
          </div>
          <p className="mb-0 mt-2.5 text-xs text-muted">{t("play.extraFeatures")}</p>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
