"use client";

import Image from "next/image";
import Cropper, { type Area } from "react-easy-crop";
import { Dialog, Slider } from "radix-ui";
import { ImagePlus, LoaderCircle, RotateCcw, Upload, X } from "lucide-react";
import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
} from "react";
import { Button } from "@/app/components/ui/button";
import { Label } from "@/app/components/ui/label";
import { cn } from "@/lib/ui/cn";

const COVER_ASPECT = 4 / 3;
const WHEEL_ZOOM_STEP = 0.2;
const MIN_ZOOM = 1;
const MAX_ZOOM = 3;
const EMPTY_FILES: File[] = [];
const EMPTY_HASHES: string[] = [];
const EMPTY_CANDIDATES: CoverPickerCandidate[] = [];

export type CoverPickerCandidate = {
  fileType?: string;
  key: string;
  label: string;
  originalFile?: File;
  src: string;
};

export function CoverPicker({
  candidates: providedCandidates,
  candidateFiles,
  currentImageSrc,
  disabled = false,
  existingBlobSha256s,
  file,
  includeSelectedFileCandidate = true,
  name,
  onChange,
  required = false,
}: {
  candidates?: CoverPickerCandidate[];
  candidateFiles?: File[];
  currentImageSrc?: string | null;
  disabled?: boolean;
  existingBlobSha256s?: string[];
  file: File | null;
  includeSelectedFileCandidate?: boolean;
  name?: string;
  onChange: (file: File | null) => void;
  required?: boolean;
}) {
  const id = useId();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const uploadedSourceRef = useRef<CoverPickerCandidate | null>(null);
  const files = candidateFiles ?? EMPTY_FILES;
  const blobSha256s = existingBlobSha256s ?? EMPTY_HASHES;
  const suppliedCandidates = providedCandidates ?? EMPTY_CANDIDATES;
  const fileUrl = useFileUrl(file);
  const candidateFileUrls = useFileUrls(files);
  const [uploadedSource, setUploadedSource] = useState<CoverPickerCandidate | null>(null);
  const [open, setOpen] = useState(false);
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [area, setArea] = useState<Area | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const candidates = useMemo(() => {
    const result: CoverPickerCandidate[] = [];
    if (uploadedSource) result.push(uploadedSource);
    if (includeSelectedFileCandidate && file && fileUrl) {
      result.push({
        fileType: file.type,
        key: "selected-file",
        label: file.name,
        originalFile: file,
        src: fileUrl,
      });
    }
    for (const [index, sha256] of blobSha256s.entries()) {
      result.push({
        key: "existing-" + sha256,
        label: index === 0 ? "当前封面" : "已有预览图 " + index,
        src: "/api/media/blobs/" + sha256,
      });
    }
    for (const [index, entry] of candidateFileUrls.entries()) {
      result.push({
        fileType: entry.file.type,
        key:
          "preview-file-" +
          index +
          "-" +
          entry.file.name +
          "-" +
          entry.file.lastModified,
        label: entry.file.name,
        originalFile: entry.file,
        src: entry.url,
      });
    }
    result.push(...suppliedCandidates);
    return result;
  }, [
    blobSha256s,
    candidateFileUrls,
    file,
    fileUrl,
    includeSelectedFileCandidate,
    suppliedCandidates,
    uploadedSource,
  ]);

  const activeCandidate =
    candidates.find((candidate) => candidate.key === activeKey) ?? candidates[0] ?? null;
  const triggerSrc =
    fileUrl || currentImageSrc || (blobSha256s[0] ? "/api/media/blobs/" + blobSha256s[0] : null);

  useEffect(
    () => () => {
      if (uploadedSourceRef.current) {
        URL.revokeObjectURL(uploadedSourceRef.current.src);
      }
    },
    [],
  );

  function resetCrop() {
    setCrop({ x: 0, y: 0 });
    setZoom(1);
    setArea(null);
  }

  function selectCandidate(candidate: CoverPickerCandidate) {
    setActiveKey(candidate.key);
    setMessage(null);
    resetCrop();
  }

  function changeZoomWithWheel(event: WheelEvent): boolean {
    event.preventDefault();
    if (event.deltaY === 0) return false;
    setZoom((current) => {
      const snapped = Math.round(current / WHEEL_ZOOM_STEP) * WHEEL_ZOOM_STEP;
      const next = snapped + (event.deltaY < 0 ? WHEEL_ZOOM_STEP : -WHEEL_ZOOM_STEP);
      return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Number(next.toFixed(1))));
    });
    return false;
  }

  function chooseUpload(event: ChangeEvent<HTMLInputElement>) {
    const selected = event.target.files?.[0];
    event.target.value = "";
    if (!selected) return;
    if (!selected.type.toLowerCase().startsWith("image/")) {
      setMessage("请选择图片文件。");
      return;
    }
    if (uploadedSourceRef.current) {
      URL.revokeObjectURL(uploadedSourceRef.current.src);
    }
    const source = {
      fileType: selected.type,
      key:
        "uploaded-" +
        selected.name +
        "-" +
        selected.lastModified +
        "-" +
        selected.size,
      label: selected.name,
      src: URL.createObjectURL(selected),
    };
    uploadedSourceRef.current = source;
    setUploadedSource(source);
    setActiveKey(source.key);
    setMessage(null);
    resetCrop();
  }

  async function confirmCrop() {
    if (!activeCandidate || !area) return;
    setBusy(true);
    setMessage(null);
    try {
      const originalFile = activeCandidate.originalFile;
      const cover =
        originalFile && zoom === MIN_ZOOM && crop.x === 0 && crop.y === 0
        ? originalFile
        : await cropCoverToFile(
            activeCandidate.src,
            activeCandidate.label,
            activeCandidate.fileType,
            area,
          );
      onChange(cover);
      setOpen(false);
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "无法处理所选图片，请更换图片后重试。",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-2">
      <div className="text-sm font-bold">
        封面图{required ? <span className="ml-1 text-accent">*</span> : null}
      </div>

      <Dialog.Root
        onOpenChange={(nextOpen) => {
          if (busy) return;
          setMessage(null);
          setOpen(nextOpen);
        }}
        open={open}
      >
        <Dialog.Trigger asChild>
          <Button
            className={cn(
              "relative grid aspect-4/3 min-h-0 w-full cursor-pointer place-items-center overflow-hidden rounded-md border-2 border-dashed border-border bg-background p-0 text-muted shadow-none transition-colors hover:border-primary hover:bg-background hover:text-primary",
              disabled && "pointer-events-none opacity-60",
            )}
            disabled={disabled}
            type="button"
            variant="ghost"
          >
            {triggerSrc ? (
              <Image
                alt={file?.name ?? "当前封面"}
                className="object-cover"
                fill
                sizes="(max-width: 1024px) 100vw, 300px"
                src={triggerSrc}
                unoptimized
              />
            ) : (
              <span className="grid justify-items-center gap-1.5 text-xs font-semibold">
                <ImagePlus className="size-6" />
                选择封面
              </span>
            )}
          </Button>
        </Dialog.Trigger>

        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-50 bg-black/60" />
          <Dialog.Content className="fixed left-1/2 top-1/2 z-50 grid h-[min(92vh,720px)] w-[min(calc(100vw-1rem),960px)] -translate-x-1/2 -translate-y-1/2 grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden rounded-lg border border-border bg-card shadow-surface">
            <header className="flex min-h-14 items-center justify-between border-b border-border px-4">
              <div>
                <Dialog.Title className="m-0 text-lg font-bold">设置封面</Dialog.Title>
                <Dialog.Description className="sr-only">
                  从候选封面中选择或上传图片，然后拖动和缩放图片完成裁剪。
                </Dialog.Description>
              </div>
              <Dialog.Close asChild>
                <Button
                  aria-label="关闭"
                  disabled={busy}
                  size="icon"
                  type="button"
                  variant="ghost"
                >
                  <X />
                </Button>
              </Dialog.Close>
            </header>

            <div className="grid min-h-0 grid-rows-[minmax(0,1fr)_auto] md:grid-cols-[336px_minmax(0,1fr)] md:grid-rows-1">
              <aside className="order-2 flex min-h-0 flex-col border-t border-border bg-background/55 md:order-1 md:border-r md:border-t-0">
                <div className="flex items-baseline justify-between px-3 py-2.5">
                  <strong className="text-sm">候选封面</strong>
                  <span className="text-xs text-muted">{candidates.length} 张</span>
                </div>
                {candidates.length ? (
                  <div className="flex gap-2 overflow-x-auto px-3 pb-3 md:grid md:flex-1 md:grid-cols-2 md:content-start md:overflow-x-hidden md:overflow-y-auto md:pt-0">
                    {candidates.map((candidate) => (
                      <Button
                        aria-label={"选择" + candidate.label}
                        aria-pressed={candidate.key === activeCandidate?.key}
                        className={cn(
                          "relative aspect-4/3 min-h-0 w-20 shrink-0 overflow-hidden rounded-sm border-2 bg-black p-0 shadow-none transition-colors hover:bg-black md:w-full",
                          candidate.key === activeCandidate?.key
                            ? "border-primary ring-2 ring-primary/20"
                            : "border-transparent hover:border-muted",
                        )}
                        key={candidate.key}
                        onClick={() => selectCandidate(candidate)}
                        title={candidate.label}
                        type="button"
                        variant="ghost"
                      >
                        <Image
                          alt=""
                          className="object-cover"
                          fill
                          sizes="(max-width: 767px) 80px, 150px"
                          src={candidate.src}
                          unoptimized
                        />
                      </Button>
                    ))}
                  </div>
                ) : (
                  <p className="m-0 px-3 pb-3 text-xs text-muted">暂无候选图</p>
                )}
              </aside>

              <main className="order-1 flex min-h-0 min-w-0 flex-col justify-center gap-3 p-3 md:order-2 md:p-5">
                <div className="mx-auto flex w-full max-w-[640px] items-center justify-between gap-3 text-xs text-muted">
                  <span className="truncate">
                    {activeCandidate?.label ?? "尚未选择图片"}
                  </span>
                  <span className="shrink-0">4:3 · 滚轮缩放</span>
                </div>

                <div
                  className={cn(
                    "relative mx-auto aspect-4/3 w-full max-w-[640px] overflow-hidden rounded-md",
                    activeCandidate
                      ? "bg-black"
                      : "border border-dashed border-border bg-background",
                  )}
                >
                  {activeCandidate ? (
                    <Cropper
                      aspect={COVER_ASPECT}
                      crop={crop}
                      image={activeCandidate.src}
                      key={activeCandidate.key}
                      maxZoom={MAX_ZOOM}
                      minZoom={MIN_ZOOM}
                      objectFit="cover"
                      onCropChange={setCrop}
                      onCropComplete={(_, croppedAreaPixels) =>
                        setArea(croppedAreaPixels)
                      }
                      onWheelRequest={changeZoomWithWheel}
                      onZoomChange={setZoom}
                      restrictPosition
                      showGrid
                      zoom={zoom}
                      zoomWithScroll
                    />
                  ) : (
                    <div className="absolute inset-0 grid place-items-center p-6 text-center">
                      <div className="grid justify-items-center gap-2">
                        <ImagePlus className="size-8 text-primary" />
                        <div>
                          <strong className="block text-sm">还没有封面图片</strong>
                          <span className="mt-1 block text-xs text-muted">
                            上传一张图片开始裁剪
                          </span>
                        </div>
                      </div>
                    </div>
                  )}
                </div>

                <div className="mx-auto grid w-full max-w-[640px] grid-cols-[1fr_auto] items-center gap-2 sm:grid-cols-[auto_minmax(120px,1fr)_auto] sm:gap-3">
                  <Button
                    disabled={!activeCandidate || busy}
                    onClick={resetCrop}
                    size="sm"
                    type="button"
                    variant="outline"
                  >
                    <RotateCcw />
                    重置
                  </Button>

                  <Label className="col-span-2 row-start-2 grid min-w-0 grid-cols-[auto_minmax(50px,1fr)_auto] items-center gap-2 text-xs sm:col-span-1 sm:row-start-auto">
                    <span className="text-muted">缩放</span>
                    <Slider.Root
                      aria-label="缩放封面"
                      className="relative flex h-5 min-w-0 touch-none select-none items-center"
                      disabled={!activeCandidate || busy}
                      max={MAX_ZOOM}
                      min={MIN_ZOOM}
                      onValueChange={([value]) => setZoom(value)}
                      step={0.01}
                      value={[zoom]}
                    >
                      <Slider.Track className="relative h-1 grow rounded-full bg-muted/30">
                        <Slider.Range className="absolute h-full rounded-full bg-primary" />
                      </Slider.Track>
                      <Slider.Thumb className="block size-4 rounded-full border border-primary bg-card shadow-sm" />
                    </Slider.Root>
                    <span className="w-9 text-right text-muted">
                      {Math.round(zoom * 100)}%
                    </span>
                  </Label>

                  <Button
                    aria-controls={id}
                    className="col-start-2 row-start-1 sm:col-start-auto sm:row-start-auto"
                    disabled={disabled || busy}
                    onClick={() => fileInputRef.current?.click()}
                    size="sm"
                    type="button"
                    variant="outline"
                  >
                    <Upload />
                    上传图片
                  </Button>
                </div>

                {message ? (
                  <p
                    className="mx-auto my-0 w-full max-w-[640px] text-sm text-red-700"
                    role="alert"
                  >
                    {message}
                  </p>
                ) : null}
              </main>
            </div>

            <footer className="flex min-h-14 justify-end gap-2 border-t border-border px-4 py-2">
              <Dialog.Close asChild>
                <Button disabled={busy} type="button" variant="outline">
                  取消
                </Button>
              </Dialog.Close>
              <Button
                aria-busy={busy}
                disabled={!activeCandidate || !area || busy}
                onClick={confirmCrop}
                type="button"
              >
                {busy ? <LoaderCircle className="animate-spin" /> : null}
                {busy ? "处理中…" : "使用此封面"}
              </Button>
            </footer>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      <input
        accept="image/*"
        className="sr-only"
        disabled={disabled}
        id={id}
        name={name}
        onChange={chooseUpload}
        ref={fileInputRef}
        required={required && !blobSha256s.length && !file}
        type="file"
      />
      {includeSelectedFileCandidate && file ? (
        <span className="truncate text-xs text-muted">{file.name}</span>
      ) : null}
    </div>
  );
}

export function PreviewPicker({
  disabled = false,
  existingCount = 0,
  files,
  name,
  onChange,
}: {
  disabled?: boolean;
  existingCount?: number;
  files: File[];
  name?: string;
  onChange: (files: File[]) => void;
}) {
  const id = useId();
  const status = files.length
    ? "已选择 " + files.length + " 张预览图"
    : existingCount
      ? "当前 " + existingCount + " 张预览图"
      : "可同时选择多张图片";
  return (
    <div className="grid gap-2">
      <Label
        className={cn(
          "flex min-h-20 cursor-pointer items-center gap-3 rounded-md border border-dashed border-border bg-background px-4 py-3 hover:border-primary hover:bg-primary/5",
          disabled && "pointer-events-none opacity-60",
        )}
        htmlFor={id}
      >
        <ImagePlus className="size-6 shrink-0 text-primary" />
        <span>
          <strong className="block text-sm">上传预览图</strong>
          <span className="mt-0.5 block text-xs font-normal text-muted">{status}</span>
        </span>
      </Label>
      <input
        accept="image/*"
        className="sr-only"
        disabled={disabled}
        id={id}
        multiple
        name={name}
        onChange={(event: ChangeEvent<HTMLInputElement>) =>
          onChange(Array.from(event.target.files ?? []))
        }
        type="file"
      />
    </div>
  );
}

function useFileUrl(file: File | null): string | null {
  const [preview, setPreview] = useState<{ file: File; url: string } | null>(null);
  useEffect(() => {
    if (!file) return;
    const reader = new FileReader();
    reader.addEventListener("load", () => {
      if (typeof reader.result === "string") {
        setPreview({ file, url: reader.result });
      }
    });
    reader.readAsDataURL(file);
    return () => reader.abort();
  }, [file]);
  return preview?.file === file ? preview.url : null;
}

function useFileUrls(files: File[]): { file: File; url: string }[] {
  const [previews, setPreviews] = useState<{ file: File; url: string }[]>([]);
  useEffect(() => {
    if (!files.length) return;
    const readers = files.map(() => new FileReader());
    const next: ({ file: File; url: string } | null)[] = files.map(() => null);
    let completed = 0;
    readers.forEach((reader, index) => {
      reader.addEventListener("load", () => {
        completed += 1;
        if (typeof reader.result === "string") {
          next[index] = { file: files[index], url: reader.result };
        }
        if (completed === files.length && next.every((entry) => entry !== null)) {
          setPreviews(next);
        }
      });
      reader.readAsDataURL(files[index]);
    });
    return () => readers.forEach((reader) => reader.abort());
  }, [files]);
  return previews.length === files.length &&
    previews.every((preview, index) => preview.file === files[index])
    ? previews
    : [];
}

async function cropCoverToFile(
  source: string,
  sourceName: string,
  sourceType: string | undefined,
  area: Area,
): Promise<File> {
  return renderCroppedCover(
    await loadCoverImage(source),
    sourceName,
    sourceType,
    area,
  );
}

async function loadCoverImage(source: string): Promise<HTMLImageElement> {
  const image = new window.Image();
  image.src = source;
  try {
    await image.decode();
  } catch {
    throw new Error("无法读取所选图片，请更换图片后重试。");
  }
  if (!image.naturalWidth || !image.naturalHeight) {
    throw new Error("所选图片没有可读取的尺寸，请更换图片后重试。");
  }
  return image;
}

async function renderCroppedCover(
  image: HTMLImageElement,
  sourceName: string,
  sourceType: string | undefined,
  area: Area,
): Promise<File> {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(area.width));
  canvas.height = Math.max(1, Math.round(area.height));
  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("无法创建封面裁剪画布，请更换浏览器后重试。");
  }
  context.drawImage(
    image,
    area.x,
    area.y,
    area.width,
    area.height,
    0,
    0,
    canvas.width,
    canvas.height,
  );

  const outputType =
    sourceType === "image/jpeg" ||
    sourceType === "image/png" ||
    sourceType === "image/webp"
      ? sourceType
      : "image/png";
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, outputType, outputType === "image/png" ? undefined : 0.92),
  );
  if (!blob) {
    throw new Error("无法导出裁剪后的封面，请更换图片后重试。");
  }

  const extension =
    outputType === "image/jpeg"
      ? "jpg"
      : outputType === "image/webp"
        ? "webp"
        : "png";
  const baseName =
    sourceName.replace(/\.[^.]+$/, "").replace(/-cover$/, "").trim() || "cover";
  return new File([blob], baseName + "-cover." + extension, {
    lastModified: Date.now(),
    type: outputType,
  });
}
