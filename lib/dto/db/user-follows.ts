export type FollowDirection = "following" | "followers";
export type FollowSummary = {
  followingCount: number;
  followerCount: number;
  isFollowing: boolean;
  isFollowedBy: boolean;
  canFollow: boolean;
  canUnfollow: boolean;
};
export type FollowUser = { id: number; displayName: string; avatarBlobSha256: string | null };
export type FollowPage = { items: FollowUser[]; nextCursor: string | null };
