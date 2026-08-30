import Image from "next/image";
import { cn } from "@/lib/ui/cn";
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
  return (
    <Image
      alt={`${displayName}的头像`}
      className={cn("shrink-0 rounded-full bg-muted/10 object-cover", className)}
      height={size}
      src={getUserAvatarSrc(avatarBlobSha256)}
      unoptimized
      width={size}
    />
  );
}
