import { Button } from "@/app/components/ui/button";
import { InfoTooltip } from "@/app/components/ui/info-tooltip";
import { Label } from "@/app/components/ui/label";
import { SelectField } from "@/app/components/ui/select";
import { useToast } from "@/app/components/ui/toast";
import type { CharacterMaterial } from "@/lib/character-materials";
import { cn } from "@/lib/ui/cn";
import { Switch } from "radix-ui";
import { useCallback, useEffect, useId, useRef, useState } from "react";

const FACE_SIZE = 48;
const SCALES = [1, 2, 3, 4].map((value) => ({ value: String(value), label: `${value}×` }));
const GRID_COLUMNS = ["", "grid-cols-1", "grid-cols-2", "grid-cols-3", "grid-cols-4"];

export function FaceQuickCopyControls({ enabled, onEnabledChange, scale, onScaleChange }: {
  enabled: boolean;
  onEnabledChange: (enabled: boolean) => void;
  scale: number;
  onScaleChange: (scale: number) => void;
}) {
  const switchId = useId();
  return (
    <div className="ml-auto flex min-h-8 items-center gap-2">
      {enabled ? (
        <SelectField
          aria-label="缩放倍率"
          value={String(scale)}
          onValueChange={(value) => onScaleChange(Number(value))}
          options={SCALES}
          triggerClassName="h-8 gap-1 px-2"
        />
      ) : null}
      <div className="flex shrink-0 items-center gap-1">
        <InfoTooltip label="脸图快取用法" className="whitespace-pre-line">
          {"可以快捷在网站外使用脸图的功能。\n启用后，PC端可以点击复制到剪贴板或拖动到聊天窗口。移动端可以长按后保存或分享。"}
        </InfoTooltip>
        <Label htmlFor={switchId} className="cursor-pointer whitespace-nowrap text-sm">脸图快取</Label>
      </div>
      <Switch.Root
        id={switchId}
        checked={enabled}
        onCheckedChange={onEnabledChange}
        className="relative inline-flex h-6 w-10 shrink-0 cursor-pointer items-center rounded-full bg-muted transition-colors data-[state=checked]:bg-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
      >
        <Switch.Thumb className="block size-4 translate-x-1 rounded-full bg-background transition-transform data-[state=checked]:translate-x-5" />
      </Switch.Root>
    </div>
  );
}

export function FaceMaterial({ sheet, label, quickCopy, scale, onPreview }: {
  sheet: CharacterMaterial;
  label: string;
  quickCopy: boolean;
  scale: number;
  onPreview: () => void;
}) {
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  const captureLoadedImage = useCallback((node: HTMLImageElement | null) => {
    if (node?.complete && node.naturalWidth) setImage(node);
  }, []);

  return (
    <div className="relative w-fit max-w-full">
      {quickCopy ? <FaceQuickCopyGrid key={scale} image={image} sheet={sheet} label={label} scale={scale} /> : null}
      <Button
        aria-label={`查看${label}`}
        className="block h-auto min-h-0 max-w-full rounded-none p-0 hover:bg-transparent peer-data-[ready=true]:invisible"
        inert={quickCopy}
        onClick={onPreview}
        type="button"
        variant="ghost"
      >
        <img
          alt={label}
          className="block h-auto max-w-full [image-rendering:pixelated]"
          width={sheet.width}
          height={sheet.height}
          loading="lazy"
          src={`/api/media/blobs/${sheet.blobSha256}`}
          onLoad={(event) => setImage(event.currentTarget)}
          ref={captureLoadedImage}
        />
      </Button>
    </div>
  );
}

function FaceQuickCopyGrid({ image, sheet, label, scale }: {
  image: HTMLImageElement | null;
  sheet: CharacterMaterial;
  label: string;
  scale: number;
}) {
  const toast = useToast();
  const [cells, setCells] = useState<{ png: Blob; url: string }[]>();
  const [ready, setReady] = useState(false);
  const loaded = useRef(0);
  const columns = sheet.width / FACE_SIZE;
  const rows = sheet.height / FACE_SIZE;
  const size = FACE_SIZE * scale;
  const androidShare = typeof window === "undefined" ? undefined
    : (window as Window & { VIPRPGFaceShare?: { postMessage: (png: string) => void } }).VIPRPGFaceShare;

  useEffect(() => {
    if (!image) return;
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = size;
    const context = canvas.getContext("2d");
    if (!context) return;
    context.imageSmoothingEnabled = false;

    let cancelled = false;
    let urls: string[] = [];
    const crops = Array.from({ length: rows * columns }, (_, index) => {
      const x = (index % columns) * FACE_SIZE;
      const y = Math.floor(index / columns) * FACE_SIZE;
      context.clearRect(0, 0, size, size);
      context.drawImage(image, x, y, FACE_SIZE, FACE_SIZE, 0, 0, size, size);
      return new Promise<Blob>((resolve, reject) => {
        canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("PNG encoding failed")));
      });
    });
    void Promise.all(crops).then((blobs) => {
      if (cancelled) return;
      urls = blobs.map((blob) => URL.createObjectURL(blob));
      setCells(blobs.map((png, index) => ({ png, url: urls[index] })));
    }).catch(console.error);

    return () => {
      cancelled = true;
      urls.forEach((url) => URL.revokeObjectURL(url));
    };
  }, [columns, image, rows, size]);

  return (
    // Keep the source visible until every image in the overlay can paint.
    <div
      role="group"
      aria-label={label}
      className={cn("peer absolute inset-0 z-10 grid auto-rows-fr", GRID_COLUMNS[columns])}
      data-ready={ready}
    >
      {Array.from({ length: rows * columns }, (_, index) => {
        const cell = cells?.[index];
        const row = Math.floor(index / columns) + 1;
        const column = (index % columns) + 1;
        return (
          <Button
            key={index}
            aria-label={`复制第 ${row} 行第 ${column} 列脸图`}
            className="relative min-h-0 min-w-0 cursor-copy rounded-none p-0 hover:bg-transparent focus-visible:ring-0 after:pointer-events-none after:absolute after:inset-0 after:z-10 after:border-2 after:border-transparent hover:after:border-emerald-500 focus-visible:after:border-emerald-500"
            onClick={(event) => {
              if (event.nativeEvent instanceof PointerEvent && event.nativeEvent.pointerType === "touch") return;
              if (!cell || !navigator.clipboard?.write || typeof ClipboardItem !== "function") return;
              void navigator.clipboard.write([new ClipboardItem({ "image/png": cell.png })])
                .then(() => toast.success("已复制到剪贴板。"))
                .catch(console.error);
            }}
            type="button"
            variant="ghost"
          >
            {cell ? (
              <img
                alt=""
                className={cn("absolute inset-0 block size-full [image-rendering:pixelated]", !ready && "invisible")}
                src={cell.url}
                draggable={androidShare ? false : undefined}
                onContextMenu={(event) => {
                  if (!androidShare || !event.nativeEvent.isTrusted) return;
                  event.preventDefault();
                  const reader = new FileReader();
                  reader.onload = () => {
                    if (typeof reader.result === "string") androidShare.postMessage(reader.result);
                  };
                  reader.readAsDataURL(cell.png);
                }}
                onDragStart={({ dataTransfer }) => {
                  // Keep the native image data and omit the browser-local link.
                  dataTransfer.clearData("text/uri-list");
                  dataTransfer.clearData("text/plain");
                  dataTransfer.clearData("text/html");
                  dataTransfer.effectAllowed = "copy";
                  const filename = `face-r${row}-c${column}-${scale}x.png`;
                  dataTransfer.setData("DownloadURL", `image/png:${filename}:${cell.url}`);
                }}
                onLoad={(event) => {
                  void event.currentTarget.decode().then(() => {
                    loaded.current += 1;
                    if (loaded.current === rows * columns) setReady(true);
                  }).catch(console.error);
                }}
              />
            ) : null}
          </Button>
        );
      })}
    </div>
  );
}
