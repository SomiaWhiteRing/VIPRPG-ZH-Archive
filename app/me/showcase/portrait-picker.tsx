import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { Button } from "@/app/components/ui/button";
import * as Dialog from "@/app/components/ui/dialog";
import { CharacterPortrait } from "@/app/components/ui/character-portrait";
import { FaceSheetCanvas } from "@/app/components/ui/face-sheet-canvas";
import type {
  CharacterPortrait as Portrait,
  CharacterPortraitChoice,
} from "@/lib/character-names";
import type { ShowcasePortraitPage, ShowcaseTarget } from "@/lib/showcase";

type PickerProps = {
  target: ShowcaseTarget;
  selection: CharacterPortraitChoice | null;
  disabled: boolean;
  onChoose: (
    selection: CharacterPortraitChoice | null,
    portrait: Portrait | null,
  ) => void;
};

export function ShowcasePortraitPicker({
  target,
  selection,
  disabled,
  onChoose,
}: PickerProps) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog.Root open={open && !disabled} onOpenChange={setOpen}>
      <Dialog.Trigger asChild>
        <Button type="button" variant="outline" size="sm" disabled={disabled}>
          选择头像
        </Button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay />
        <Dialog.Content className="left-1/2 top-1/2 flex max-h-[calc(100dvh-2rem)] w-[min(48rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-lg">
          <header className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
            <div className="min-w-0">
              <Dialog.Title>选择展柜头像</Dialog.Title>
              <Dialog.Description className="m-0 mt-1 text-sm text-muted">
                {target.name}
              </Dialog.Description>
            </div>
            <Dialog.Close asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label="关闭头像选择"
              >
                <X aria-hidden="true" />
              </Button>
            </Dialog.Close>
          </header>
          <PortraitChoices
            target={target}
            selection={selection}
            disabled={disabled}
            onChoose={(choice, portrait) => {
              onChoose(choice, portrait);
              setOpen(false);
            }}
          />
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function PortraitChoices({
  target,
  selection,
  disabled,
  onChoose,
}: PickerProps) {
  const [offset, setOffset] = useState(0);
  const [result, setResult] = useState<ShowcasePortraitPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError("");
    void (async () => {
      try {
        const response = await fetch(
          `/api/account/showcase?op=portraits&characterId=${target.id}&offset=${offset}`,
          { signal: controller.signal },
        );
        const data = (await response.json()) as ShowcasePortraitPage & {
          detail?: string;
          error?: string;
        };
        if (!response.ok)
          throw new Error(data.detail ?? data.error ?? "头像加载失败。");
        if (!controller.signal.aborted) setResult(data);
      } catch (error) {
        if (!controller.signal.aborted)
          setError(error instanceof Error ? error.message : "头像加载失败。");
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();
    return () => controller.abort();
  }, [target.id, offset, retry]);
  const locked = disabled || loading || !!error;
  return (
    <div className="min-h-0 overflow-y-auto p-4" aria-busy={loading}>
      {result ? (
        <>
          <Button
            type="button"
            variant="outline"
            className="mb-4 h-auto gap-3"
            disabled={locked}
            aria-pressed={selection === null}
            onClick={() => onChoose(null, result.defaultPortrait)}
          >
            <CharacterPortrait
              displayName={target.name}
              portrait={result.defaultPortrait}
              size={48}
              className="size-12"
            />
            使用角色默认头像
          </Button>
          <div className="grid grid-cols-2 items-start gap-3 sm:grid-cols-3">
            {result.items.map((sheet) => (
              <FaceSheetCanvas
                key={sheet.id}
                blobSha256={sheet.blobSha256}
                width={sheet.width}
                height={sheet.height}
                scale={1}
                fit
                label={`${target.name}的头像选格`}
                disabled={locked}
                selectedCell={
                  target.portrait?.blobSha256 === sheet.blobSha256
                    ? target.portrait
                    : null
                }
                onSelectCell={(row, column) =>
                  onChoose(
                    { blobSha256: sheet.blobSha256, row, column },
                    {
                      faceSheetId: sheet.id,
                      blobSha256: sheet.blobSha256,
                      width: sheet.width,
                      height: sheet.height,
                      row,
                      column,
                    },
                  )
                }
              />
            ))}
          </div>
          {!loading && !error && !result.items.length ? (
            <p className="text-sm text-muted">该角色暂无可选择的公开脸图。</p>
          ) : null}
          {offset > 0 || result.more ? (
            <div className="mt-4 flex justify-between gap-3">
              <Button
                type="button"
                variant="outline"
                disabled={locked || offset === 0}
                onClick={() => setOffset((value) => Math.max(0, value - 12))}
              >
                上一页
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={locked || !result.more}
                onClick={() => setOffset((value) => value + 12)}
              >
                下一页
              </Button>
            </div>
          ) : null}
        </>
      ) : null}
      {loading ? (
        <p role="status" className="text-sm text-muted">
          正在加载头像…
        </p>
      ) : null}
      {error ? (
        <div role="alert" className="mt-3 flex items-center gap-3 text-sm">
          {error}
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setRetry((value) => value + 1)}
          >
            重试
          </Button>
        </div>
      ) : null}
    </div>
  );
}
