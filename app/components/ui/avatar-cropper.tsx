import { Button } from "@/app/components/ui/button";
import { Notice } from "@/app/components/ui/notice";
import { useToast } from "@/app/components/ui/toast";
import { CreatorPortrait } from "@/app/components/ui/creator-portrait";
import * as Dialog from "@/app/components/ui/dialog";
import { Rm2kButton } from "@/app/components/ui/rm2k-button";
import { UserAvatar } from "@/app/components/ui/user-avatar";
import { cn } from "@/lib/ui/cn";
import { Slider } from "radix-ui";
import { useEffect, useId, useRef, useState } from "react";
import type { Area } from "react-easy-crop";
import Cropper from "react-easy-crop";
import { useRevalidator } from "react-router";

const MAX_SOURCE_BYTES = 10 * 1024 * 1024;

export function AvatarCropper({
  avatarBlobSha256,
  displayName,
  endpoint = "/api/account/avatar",
  shape = "round",
  allowDelete = false,
  alignActions = "start",
}: {
  avatarBlobSha256: string | null;
  displayName: string;
  endpoint?: string;
  shape?: "round" | "square";
  allowDelete?: boolean;
  alignActions?: "start" | "end";
}) {
  const revalidator = useRevalidator();
  const toast = useToast();
  const dialogId = useId();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const editButtonRef = useRef<HTMLButtonElement>(null);
  const [source, setSource] = useState<string | null>(null);
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [area, setArea] = useState<Area | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

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
    setMessage(null);
  }

  async function upload() {
    if (!source || !area) return;
    setBusy(true);
    setMessage(null);
    try {
      const blob = await cropToPng(source, area);
      const response = await fetch(endpoint, {
        method: "PUT",
        credentials: "same-origin",
        headers: { "content-type": "image/png" },
        body: blob,
      });
      const result = (await response.json()) as { detail?: string };
      if (!response.ok) throw new Error(result.detail || "头像上传失败");
      setSource(null);
      toast.success("头像已更新。");
      revalidator.revalidate();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "头像上传失败");
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!avatarBlobSha256 || busy || !window.confirm("确定删除当前头像吗？"))
      return;
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch(endpoint, {
        method: "DELETE",
        credentials: "same-origin",
      });
      const result = (await response.json()) as { detail?: string };
      if (!response.ok) throw new Error(result.detail || "头像删除失败");
      toast.success("头像已删除。");
      revalidator.revalidate();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "头像删除失败");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-4">
      {shape === "round" ? (
        <UserAvatar
          avatarBlobSha256={avatarBlobSha256}
          className="size-20"
          displayName={displayName}
          size={80}
        />
      ) : (
        <CreatorPortrait
          avatarBlobSha256={avatarBlobSha256}
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
          onChange={(event) => choose(event.target.files?.[0])}
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
            修改头像
          </Button>
          {allowDelete && avatarBlobSha256 ? (
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
            {message ? <Notice>{message}</Notice> : null}
            <div className="flex justify-end gap-2">
              <Rm2kButton
                disabled={busy}
                onClick={() => setSource(null)}
                type="button"
              >
                取消
              </Rm2kButton>
              <Rm2kButton
                disabled={busy || !area}
                onClick={() => void upload()}
                type="button"
              >
                {busy ? "正在上传…" : "保存头像"}
              </Rm2kButton>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  );
}

async function cropToPng(source: string, area: Area): Promise<Blob> {
  const image = new Image();
  image.src = source;
  await image.decode();
  const canvas = document.createElement("canvas");
  canvas.width = 192;
  canvas.height = 192;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("当前浏览器无法处理头像");
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
