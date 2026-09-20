export const COMMENT_IMAGE_COUNT = 10;
export const COMMENT_IMAGE_BYTES = 2 * 1024 * 1024;

export type CommentImage = {
  id: string;
  url: string;
  width: number;
  height: number;
  size: number;
  format: "png" | "jpeg" | "webp" | "gif";
};
