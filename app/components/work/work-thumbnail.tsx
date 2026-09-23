import type { ReactNode } from "react";

/** The caller owns the aspect ratio and link, so cards and list rows stay independent. */
export function WorkThumbnail({
  blobSha256,
  src,
  alt = "",
  fallback,
  fallbackClassName,
  imageClassName = "h-full w-full object-cover",
  width,
  height,
  sizes,
}: {
  blobSha256?: string | null;
  src?: string | null;
  alt?: string;
  fallback: ReactNode;
  fallbackClassName?: string;
  imageClassName?: string;
  width?: number;
  height?: number;
  sizes?: string;
}) {
  return src || blobSha256 ? (
    <img
      alt={alt}
      className={
        width && height
          ? imageClassName
          : `absolute inset-0 h-full w-full ${imageClassName ?? ""}`
      }
      src={src || `/api/media/blobs/${blobSha256}`}
      {...(width && height ? { width, height } : { sizes })}
      loading="lazy"
    />
  ) : (
    <span className={fallbackClassName}>{fallback}</span>
  );
}
