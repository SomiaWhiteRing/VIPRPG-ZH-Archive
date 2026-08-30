"use client";

import Image from "next/image";
import { ImagePlus } from "lucide-react";
import { useEffect, useId, useState, type ChangeEvent } from "react";
import { Label } from "@/app/components/ui/label";
import { cn } from "@/lib/ui/cn";

export function CoverPicker({
  disabled = false,
  existingBlobSha256,
  file,
  name,
  onChange,
  required = false,
}: {
  disabled?: boolean;
  existingBlobSha256?: string | null;
  file: File | null;
  name?: string;
  onChange: (file: File | null) => void;
  required?: boolean;
}) {
  const id = useId();
  const fileUrl = useFileUrl(file);
  const src = fileUrl || (existingBlobSha256 ? `/api/media/blobs/${existingBlobSha256}` : null);
  return (
    <div className="grid gap-2">
      <div className="text-sm font-bold">
        封面图{required ? <span className="ml-1 text-accent">*</span> : null}
      </div>
      <Label
        className={cn(
          "relative grid aspect-video w-full cursor-pointer place-items-center overflow-hidden rounded-md border-2 border-dashed border-border bg-background text-muted hover:border-primary hover:text-primary",
          disabled && "pointer-events-none opacity-60",
        )}
        htmlFor={id}
      >
        {src ? (
          <Image
            alt={file?.name ?? "当前封面"}
            className="object-cover"
            fill
            sizes="(max-width: 1024px) 100vw, 300px"
            src={src}
            unoptimized
          />
        ) : (
          <span className="grid justify-items-center gap-1.5 text-xs font-semibold">
            <ImagePlus className="size-6" />
            选择封面
          </span>
        )}
      </Label>
      <input
        accept="image/*"
        className="sr-only"
        disabled={disabled}
        id={id}
        name={name}
        onChange={(event) => onChange(event.target.files?.[0] ?? null)}
        required={required && !existingBlobSha256}
        type="file"
      />
      {file ? <span className="truncate text-xs text-muted">{file.name}</span> : null}
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
    ? `已选择 ${files.length} 张预览图`
    : existingCount
      ? `当前 ${existingCount} 张预览图`
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
      if (typeof reader.result === "string") setPreview({ file, url: reader.result });
    });
    reader.readAsDataURL(file);
    return () => reader.abort();
  }, [file]);
  return preview?.file === file ? preview.url : null;
}
