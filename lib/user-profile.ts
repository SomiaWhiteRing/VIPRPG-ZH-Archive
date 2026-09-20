export const DEFAULT_USER_AVATAR_SRC = "/icon/alex.png";

export type ProfileVisibility = {
  bio: boolean;
  showcase: boolean;
  favorites: boolean;
  history: boolean;
  catalogs: boolean;
  comments: boolean;
  discussions: boolean;
};

export type PublicProfileSection = Exclude<keyof ProfileVisibility, "bio">;

export function getUserAvatarSrc(avatarBlobSha256: string | null | undefined): string {
  return avatarBlobSha256
    ? `/api/media/blobs/${avatarBlobSha256}`
    : DEFAULT_USER_AVATAR_SRC;
}
