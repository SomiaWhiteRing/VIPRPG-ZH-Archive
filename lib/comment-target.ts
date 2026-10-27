export type CommentTarget =
  | { kind: "work"; id: number }
  | { kind: "creator"; id: number }
  | { kind: "character"; id: number }
  | { kind: "catalog"; id: number };

export function commentTargetHref(target: CommentTarget): string {
  const paths = { work: "games", creator: "creators", character: "characters", catalog: "catalogs" };
  return `/${paths[target.kind]}/${target.id}`;
}

export const COMMENT_TARGET_LABELS: Record<CommentTarget["kind"], string> = {
  work: "作品", creator: "作者", character: "角色", catalog: "目录",
};

export function parseCommentTargetKind(value: unknown): CommentTarget["kind"] | undefined {
  if (value === "work" || value === "creator" || value === "character" || value === "catalog") return value;
  return undefined;
}
