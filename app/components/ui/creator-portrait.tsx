import { cn } from "@/lib/ui/cn";
import { useMessages } from "@/lib/i18n/react";

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
  const t = useMessages();
  const initial = [...name.trim()][0] ?? t("avatar.creatorInitial");
  return avatarBlobSha256 ? (
    <img
      alt={t("avatar.imageAlt", { name })}
      className={cn(
        "aspect-square rounded-md border border-border object-cover",
        className,
      )}
      height={size}
      src={`/api/media/blobs/${avatarBlobSha256}`}
      width={size}
      loading="lazy"
    />
  ) : (
    <span
      role="img"
      aria-label={t("avatar.noImage", { name })}
      className={cn(
        "grid size-48 aspect-square place-items-center rounded-md border border-border bg-muted/15 font-serif text-4xl font-bold text-muted",
        className,
      )}
    >
      {initial}
    </span>
  );
}
