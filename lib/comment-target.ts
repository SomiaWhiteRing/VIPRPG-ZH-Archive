export type CommentTarget =
  | { kind: "work"; id: number }
  | { kind: "creator"; id: number }
  | { kind: "character"; id: number };

export function commentTargetHref(target: CommentTarget): string {
  const paths = { work: "games", creator: "creators", character: "characters" };
  return `/${paths[target.kind]}/${target.id}`;
}
