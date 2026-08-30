"use client";

import Cropper, { type Area } from "react-easy-crop";
import { Dialog, Slider } from "radix-ui";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/app/components/ui/button";
import { Rm2kButton } from "@/app/components/ui/rm2k-button";
import { UserAvatar } from "@/app/components/ui/user-avatar";

const MAX_SOURCE_BYTES = 10 * 1024 * 1024;

export function AvatarCropper({ avatarBlobSha256, displayName }: { avatarBlobSha256: string | null; displayName: string }) {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [source, setSource] = useState<string | null>(null);
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [area, setArea] = useState<Area | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => () => {
    if (source) URL.revokeObjectURL(source);
  }, [source]);

  function choose(file: File | undefined) {
    if (!file) return;
    if (!(["image/jpeg", "image/png", "image/webp"] as string[]).includes(file.type)) {
      setMessage("请选择 JPEG、PNG 或 WebP 图片。");
      return;
    }
    if (file.size > MAX_SOURCE_BYTES) {
      setMessage("源图片不能超过 10 MiB。");
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
      const response = await fetch("/api/account/avatar", {
        method: "PUT",
        credentials: "same-origin",
        headers: { "content-type": "image/png" },
        body: blob,
      });
      const result = await response.json() as { detail?: string };
      if (!response.ok) throw new Error(result.detail || "头像上传失败");
      setSource(null);
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "头像上传失败");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-4">
      <UserAvatar avatarBlobSha256={avatarBlobSha256} className="size-20" displayName={displayName} size={80} />
      <div className="grid gap-2">
        <input accept="image/jpeg,image/png,image/webp" className="sr-only" onChange={(event) => choose(event.target.files?.[0])} ref={fileInputRef} type="file" />
        <Button onClick={() => fileInputRef.current?.click()} size="sm" type="button" variant="outline">修改头像</Button>
        {message ? <p className="m-0 max-w-sm text-sm text-red-700" role="status">{message}</p> : null}
      </div>
      <Dialog.Root open={Boolean(source)} onOpenChange={(open) => { if (!open && !busy) setSource(null); }}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-50 bg-black/55" />
          <Dialog.Content aria-describedby="avatar-crop-description" className="fixed left-1/2 top-1/2 z-50 grid w-[min(92vw,620px)] -translate-x-1/2 -translate-y-1/2 gap-4 rounded-lg border border-border bg-card p-4 shadow-surface">
            <Dialog.Title className="m-0 text-lg font-bold">裁剪头像</Dialog.Title>
            <Dialog.Description className="m-0 text-sm text-muted" id="avatar-crop-description">拖动图片并缩放，圆形区域是最终显示范围。</Dialog.Description>
            <div className="relative h-[min(55vh,380px)] overflow-hidden rounded-md bg-black">
              {source ? <Cropper aspect={1} crop={crop} cropShape="round" image={source} onCropChange={setCrop} onCropComplete={(_, pixels) => setArea(pixels)} onZoomChange={setZoom} showGrid={false} zoom={zoom} /> : null}
            </div>
            <div className="flex items-center gap-3">
              <span className="text-sm">缩放</span>
              <Slider.Root aria-label="缩放头像" className="relative flex h-5 flex-1 touch-none select-none items-center" max={3} min={1} onValueChange={([value]) => setZoom(value)} step={0.01} value={[zoom]}>
                <Slider.Track className="relative h-1 grow rounded-full bg-muted/30"><Slider.Range className="absolute h-full rounded-full bg-primary" /></Slider.Track>
                <Slider.Thumb className="block size-4 rounded-full border border-primary bg-card shadow-sm" />
              </Slider.Root>
            </div>
            {message ? <p className="m-0 text-sm text-red-700" role="status">{message}</p> : null}
            <div className="flex justify-end gap-2">
              <Rm2kButton disabled={busy} onClick={() => setSource(null)} type="button">取消</Rm2kButton>
              <Rm2kButton disabled={busy || !area} onClick={upload} type="button">{busy ? "正在上传…" : "保存头像"}</Rm2kButton>
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
  context.drawImage(image, area.x, area.y, area.width, area.height, 0, 0, 192, 192);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
  if (!blob) throw new Error("头像导出失败");
  return blob;
}
