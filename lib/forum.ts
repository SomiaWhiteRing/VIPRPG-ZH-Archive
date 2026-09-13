export const FORUM_PAGE_SIZE = 30;
export const FORUM_COMMENT_PAGE_SIZE = 20;
export const FORUM_PREVIEW_SIZE = 5;
export const FORUM_TAG_LIMIT = 5;
export const FORUM_TAG_LENGTH = 16;
export const FORUM_TITLE_LENGTH = 160;
export const FORUM_BODY_LENGTH = 20000;
export const FORUM_COMMENT_LENGTH = 2000;
export const FORUM_QUERY_LENGTH = 200;
export const FORUM_WRITES_PER_MINUTE = 10;
export const FORUM_IMAGE_BYTES = 2 * 1024 * 1024;
export type ForumImage = {
  offset: number;
  id: string;
  url: string;
  thumb: string;
  width: number;
  height: number;
  size: number;
  format: string;
};
export const FORUM_RESERVED_TAGS = [
  "精品",
  "已锁定",
  "已隐藏",
  "已删除",
  "已停用",
];
export const FORUM_REPORT_REASONS = [
  "垃圾广告",
  "人身攻击或骚扰",
  "隐私或人身安全",
  "违法内容",
  "其他",
] as const;

export type ForumState = "published" | "hidden" | "deleted";
export type ForumTarget = { kind: "topic" | "post" | "comment"; id: number };
export type ForumAction =
  "hide" | "restore" | "lock" | "unlock" | "feature" | "unfeature" | "tags";
export type ForumTag = {
  id: number;
  name: string;
  state: "active" | "disabled" | "hidden";
  count: number;
  revision: string;
};
export type ForumAuthor = {
  id: number;
  name: string;
  avatar: string | null;
  profile: boolean;
};
export type ForumCapabilities = {
  edit: boolean;
  delete: boolean;
  reply: boolean;
  like: boolean;
  report: boolean;
  moderate: boolean;
  feature: boolean;
};
export type ForumTopic = {
  id: number;
  title: string;
  author: ForumAuthor;
  tags: ForumTag[];
  state: ForumState;
  locked: boolean;
  featured: boolean;
  createdAt: string;
  updatedAt: string;
  activeAt: string;
  replies: number;
  views: number;
  lastAuthor: ForumAuthor | null;
  revision: string;
  capabilities: ForumCapabilities;
};
export type ForumContent = {
  id: number;
  kind: "post" | "comment";
  topicId: number;
  postId: number;
  postNumber: number;
  author: ForumAuthor | null;
  body: string | null;
  images: ForumImage[];
  state: ForumState | "unavailable";
  createdAt: string;
  editedAt: string | null;
  revision: string;
  likes: number;
  liked: boolean;
  replyTo: { id: number; author: ForumAuthor | null } | null;
  capabilities: ForumCapabilities;
};
export type ForumEditVersion = {
  body: string;
  images: ForumImage[];
  revision: string;
  topic: ForumTopic;
};
export type ForumPage<T> = {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
};
export type ForumFloor = ForumContent & {
  comments: ForumPage<ForumContent>;
  commentPreview: ForumContent[];
  commentsAvailable: boolean;
};
export type ForumDetail = {
  topic: ForumTopic;
  posts: ForumPage<ForumFloor>;
  floor: number | null;
  comment: number | null;
};
export type ForumSearchHit = {
  content: ForumContent;
  topic: ForumTopic;
  snippet: string;
  score: number;
};
export type ForumViewer = {
  id: number;
  name: string;
  avatar: string | null;
  moderate: boolean;
  feature: boolean;
  tags: boolean;
} | null;

export function forumPage(value: unknown): number {
  const text = String(value ?? "1");
  return /^[1-9]\d*$/.test(text) && Number.isSafeInteger(Number(text))
    ? Number(text)
    : 1;
}
export function normalizeForumTag(value: string): string {
  return value.normalize("NFKC").trim().replace(/\s+/gu, " ");
}
export function forumTagKey(value: string): string {
  return normalizeForumTag(value).toLowerCase();
}
export function forumTagError(value: string): string | null {
  const name = normalizeForumTag(value);
  if (
    /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(value.replace(/\u200d/gu, "")) ||
    /[\[\]]/u.test(name)
  )
    return "TAG 不能包含方括号、控制字符或换行。";
  const length = Array.from(
    new Intl.Segmenter("zh", { granularity: "grapheme" }).segment(name),
  ).length;
  if (length < 1 || length > FORUM_TAG_LENGTH)
    return `TAG 需要 1–${FORUM_TAG_LENGTH} 个字符。`;
  if (
    /^[\p{P}\p{Z}\s]+$/u.test(name) ||
    FORUM_RESERVED_TAGS.includes(forumTagKey(name))
  )
    return "此名称不能用作 TAG。";
  return null;
}
export function forumTargetHref(
  target: ForumTarget,
  topicId: number,
  postNumber?: number,
): string {
  if (target.kind === "topic") return `/discussions/${target.id}`;
  return target.kind === "comment"
    ? `/discussions/${topicId}/comments/${target.id}`
    : `/discussions/${topicId}/posts/${postNumber}`;
}
export function forumParams(
  values: Record<
    string,
    string | number | undefined | null | readonly (string | number)[]
  >,
): URLSearchParams {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) {
    if (
      value == null ||
      value === "" ||
      ((key === "page" || key === "commentPage") && Number(value) === 1)
    )
      continue;
    for (const item of Array.isArray(value) ? value : [value])
      params.append(key, String(item));
  }
  return params;
}
export function forumHref(
  path: string,
  values: Parameters<typeof forumParams>[0],
): string {
  const query = forumParams(values).toString();
  return path + (query ? `?${query}` : "");
}

export function forumListReturn(value: unknown): string | undefined {
  if (
    typeof value !== "string" ||
    !/^\/discussions(?:\?|$)/.test(value) ||
    /[\\\u0000-\u001f\u007f]/.test(value)
  )
    return undefined;
  const url = new URL(value, "https://forum.invalid");
  if (url.origin !== "https://forum.invalid" || url.pathname !== "/discussions")
    return undefined;
  const tags = [...new Set(url.searchParams.getAll("tag"))];
  if (
    tags.length > 5 ||
    tags.some((tag) => !/^[1-9]\d*$/.test(tag) || !Number.isSafeInteger(Number(tag)))
  )
    return undefined;
  return forumHref("/discussions", {
    view: url.searchParams.get("view") === "featured" ? "featured" : null,
    tag: tags.sort((a, b) => Number(a) - Number(b)),
    page: forumPage(url.searchParams.get("page")),
  });
}
