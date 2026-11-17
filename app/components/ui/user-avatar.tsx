import { cn } from "@/lib/ui/cn";
import { useMessages } from "@/lib/i18n/react";
import { getUserAvatarSrc } from "@/lib/user-profile";

type UserAvatarProps = {
  avatarBlobSha256?: string | null;
  displayName: string;
  className?: string;
  size?: number;
};

export function UserAvatar({
  avatarBlobSha256,
  displayName,
  className,
  size = 40,
}: UserAvatarProps) {
  const t = useMessages();
  return (
    <img
      alt={t("avatar.imageAlt", { name: displayName })}
      className={cn(
        "shrink-0 rounded-full bg-muted/10 object-cover",
        className,
      )}
      height={size}
      src={getUserAvatarSrc(avatarBlobSha256)}
      width={size}
      loading="lazy"
    />
  );
}
