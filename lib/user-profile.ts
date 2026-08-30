export const DEFAULT_USER_AVATAR_SRC = "/icon/windI.png";

export function getUserAvatarSrc(avatarBlobSha256: string | null | undefined): string {
  return avatarBlobSha256
    ? `/api/media/blobs/${avatarBlobSha256}`
    : DEFAULT_USER_AVATAR_SRC;
}
