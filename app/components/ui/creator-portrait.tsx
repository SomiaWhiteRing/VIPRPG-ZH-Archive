import Image from "next/image";
import { cn } from "@/lib/ui/cn";

export function CreatorPortrait({
  avatarBlobSha256,
  className,
  name,
  size = 192,
}: {
  avatarBlobSha256: string | null;
  className?: string;
  name: string;
  size?: number;
}) {
  const initial = [...name.trim()][0] ?? "作";
  return avatarBlobSha256 ? (
    <Image
      alt={`${name}的头像`}
      className={cn("aspect-square rounded-md border border-border object-cover", className)}
      height={size}
      src={`/api/media/blobs/${avatarBlobSha256}`}
      unoptimized
      width={size}
    />
  ) : (
    <span
      aria-label={`${name}暂无头像`}
      className={cn(
        "grid size-48 aspect-square place-items-center rounded-md border border-border bg-muted/15 font-serif text-4xl font-bold text-muted",
        className,
      )}
    >
      {initial}
    </span>
  );
}
