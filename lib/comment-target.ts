export type CommentTarget =
  | { kind: "work"; id: number }
  | { kind: "creator"; id: number };

export function commentTargetHref(target: CommentTarget): string {
  const paths = { work: "games", creator: "creators" };
  return `/${paths[target.kind]}/${target.id}`;
}
