import { useConfirm } from "./confirm-provider";
import { Button } from "@/app/components/ui/button";
import { useToast } from "@/app/components/ui/toast";
import { CreatorPortrait } from "@/app/components/ui/creator-portrait";
import { CharacterAvatarPicker } from "./character-avatar-picker";
import * as Dialog from "@/app/components/ui/dialog";
import { UserAvatar } from "@/app/components/ui/user-avatar";
import { cn } from "@/lib/ui/cn";
import type { CharacterPortrait } from "@/lib/character-names";
import { Slider } from "radix-ui";
import { useEffect, useId, useRef, useState } from "react";
import type { Area } from "react-easy-crop";
import Cropper from "react-easy-crop";

const MAX_SOURCE_BYTES = 10 * 1024 * 1024;

export function AvatarCropper({
  avatarBlobSha256,
  displayName,
  shape = "round",
  allowDelete = false,
  alignActions = "start",
  disabled = false,
  onChange,
  onBusyChange,
}: {
  avatarBlobSha256: string | null;
  displayName: string;
  shape?: "round" | "square";
  allowDelete?: boolean;
  alignActions?: "start" | "end";
  disabled?: boolean;
  onChange?: (changed: boolean) => void;
  onBusyChange?: (busy: boolean) => void;
}) {
  const toast = useToast();
  const confirm = useConfirm();
  const dialogId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const editButtonRef = useRef<HTMLButtonElement>(null);
  const [source, setSource] = useState<string | null>(null);
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [area, setArea] = useState<Area | null>(null);
  const [preparing, setPreparing] = useState(false);
  const [draft, setDraft] = useState<{ file: File; src: string } | null>();
  const busy = disabled || preparing;
  const hasAvatar = draft === undefined ? Boolean(avatarBlobSha256) : Boolean(draft);

  useEffect(() => {
    const form = rootRef.current?.closest("form");
    if (!form || draft === undefined) return;
    function appendAvatar(event: FormDataEvent) {
      event.formData.set("avatar", draft ? draft.file : "remove");
    }
    form.addEventListener("formdata", appendAvatar);
    return () => form.removeEventListener("formdata", appendAvatar);
  }, [draft]);

  useEffect(() => () => {
    if (draft) URL.revokeObjectURL(draft.src);
  }, [draft]);

  useEffect(
    () => () => {
      if (source) URL.revokeObjectURL(source);
    },
    [source],
  );

  function choose(file: File | undefined) {
    if (!file) return;
    if (!new Set(["image/jpeg", "image/png", "image/webp"]).has(file.type)) {
      toast.error("请选择 JPEG、PNG 或 WebP 图片。");
      return;
    }
    if (file.size > MAX_SOURCE_BYTES) {
      toast.error("源图片不能超过 10 MiB。");
      return;
    }
    if (source) URL.revokeObjectURL(source);
    setSource(URL.createObjectURL(file));
    setCrop({ x: 0, y: 0 });
    setZoom(1);
    setArea(null);
  }

  async function prepare(portrait?: CharacterPortrait): Promise<boolean> {
    const imageSource = portrait ? `/api/media/blobs/${portrait.blobSha256}` : source;
    const imageArea = portrait
      ? { x: portrait.column * 48, y: portrait.row * 48, width: 48, height: 48 }
      : area;
    if (!imageSource || !imageArea || busy) return false;
    setPreparing(true);
    onBusyChange?.(true);
    try {
      const blob = await cropToPng(imageSource, imageArea, Boolean(portrait));

      const file = new File([blob], "avatar.png", { type: "image/png" });
      setDraft({ file, src: URL.createObjectURL(file) });
      onChange?.(true);
      setSource(null);
      return true;
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "头像处理失败");
      return false;
    } finally {
      setPreparing(false);
      onBusyChange?.(false);
    }
  }

  async function remove() {
    if (!hasAvatar || busy) return;
    if (await confirm(`确定删除“${displayName}”的头像吗？保存资料后生效。`, {
      title: "删除头像", confirmLabel: "删除", destructive: true,
    })) {
      setDraft(avatarBlobSha256 ? null : undefined);
      onChange?.(Boolean(avatarBlobSha256));
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-4" ref={rootRef}>
      {draft ? (
        <img
          alt={`${displayName}的待保存头像`}
          className={cn("shrink-0 object-cover", shape === "round" ? "size-20 rounded-full" : "size-24 rounded-md border border-border")}
          height={shape === "round" ? 80 : 96}
          src={draft.src}
          width={shape === "round" ? 80 : 96}
        />
      ) : shape === "round" ? (
        <UserAvatar
          avatarBlobSha256={draft === null ? null : avatarBlobSha256}
          className="size-20"
          displayName={displayName}
          size={80}
        />
      ) : (
        <CreatorPortrait
          avatarBlobSha256={draft === null ? null : avatarBlobSha256}
          className="size-24"
          name={displayName}
          size={96}
        />
      )}
      <div
        className={cn(
          "grid gap-2",
          alignActions === "end" && "ml-auto justify-items-end",
        )}
      >
        <input
          accept="image/jpeg,image/png,image/webp"
          className="sr-only"
          onChange={(event) => {
            choose(event.target.files?.[0]);
            event.target.value = "";
          }}
          ref={fileInputRef}
          type="file"
        />
        <div
          className={cn(
            "flex flex-wrap gap-2",
            alignActions === "end" && "justify-end",
          )}
        >
          <Button
            aria-controls={dialogId}
            aria-expanded={Boolean(source)}
            aria-haspopup="dialog"
            disabled={busy}
            onClick={() => fileInputRef.current?.click()}
            ref={editButtonRef}
            size="sm"
            type="button"
            variant="outline"
          >
            上传图片
          </Button>
          <CharacterAvatarPicker disabled={busy} shape={shape} onSave={prepare} />
          {allowDelete && hasAvatar ? (
            <Button
              disabled={busy}
              onClick={() => void remove()}
              size="sm"
              type="button"
              variant="ghost"
            >
              删除头像
            </Button>
          ) : null}
        </div>
        <p className="m-0 text-sm text-muted">{draft !== undefined ? "头像已修改，保存资料后生效。" : "头像修改将在保存资料后生效。"}</p>
      </div>
      <Dialog.Root
        open={Boolean(source)}
        onOpenChange={(open) => {
          if (!open && !busy) setSource(null);
        }}
      >
        <Dialog.Portal>
          <Dialog.Overlay className="bg-black/55" />
          <Dialog.Content
            aria-describedby={`${dialogId}-description`}
            className="left-1/2 top-1/2 grid w-[min(92vw,620px)] -translate-x-1/2 -translate-y-1/2 gap-4 rounded-lg p-4"
            id={dialogId}
            onCloseAutoFocus={(event) => {
              event.preventDefault();
              editButtonRef.current?.focus();
            }}
          >
            <Dialog.Title>裁剪头像</Dialog.Title>
            <Dialog.Description
              className="m-0 text-sm text-muted"
              id={`${dialogId}-description`}
            >
              拖动、缩放以裁剪
            </Dialog.Description>
            <div className="relative h-[min(55vh,380px)] overflow-hidden rounded-md bg-black">
              {source ? (
                <Cropper
                  aspect={1}
                  crop={crop}
                  cropShape={shape === "round" ? "round" : "rect"}
                  image={source}
                  onCropChange={setCrop}
                  onCropComplete={(_, pixels) => setArea(pixels)}
                  onZoomChange={setZoom}
                  showGrid={false}
                  zoom={zoom}
                />
              ) : null}
            </div>
            <div className="flex items-center gap-3">
              <span className="text-sm">缩放</span>
              <Slider.Root
                className="relative flex h-5 flex-1 cursor-pointer touch-none select-none items-center"
                max={3}
                min={1}
                onValueChange={([value]) => setZoom(value)}
                step={0.01}
                value={[zoom]}
              >
                <Slider.Track className="relative h-1 grow rounded-full bg-muted/30">
                  <Slider.Range className="absolute h-full rounded-full bg-primary" />
                </Slider.Track>
                <Slider.Thumb
                  aria-label="缩放头像"
                  className="block size-4 cursor-grab active:cursor-grabbing rounded-full border border-primary bg-card shadow-sm"
                />
              </Slider.Root>
            </div>
            <div className="flex justify-end gap-2">
              <Button
                disabled={busy}
                onClick={() => setSource(null)}
                type="button"
                variant="outline"
              >
                取消
              </Button>
              <Button
                disabled={busy || !area}
                onClick={() => void prepare()}
                type="button"
              >
                {busy ? "正在处理…" : "使用此头像"}
              </Button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  );
}

async function cropToPng(source: string, area: Area, pixelated = false): Promise<Blob> {
  const image = new Image();
  image.src = source;
  await image.decode();
  const canvas = document.createElement("canvas");
  canvas.width = 192;
  canvas.height = 192;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("当前浏览器无法处理头像");
  // Role face cells are enlarged exactly 4x without blending adjacent pixels.
  context.imageSmoothingEnabled = !pixelated;
  context.drawImage(
    image,
    area.x,
    area.y,
    area.width,
    area.height,
    0,
    0,
    192,
    192,
  );
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/png"),
  );
  if (!blob) throw new Error("头像导出失败");
  return blob;
}
