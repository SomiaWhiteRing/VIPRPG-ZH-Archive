import { Link } from "react-router";
import { MENTION_PATTERN, readMention } from "@/lib/mentions";

export function MentionText({ text }: { text: string }) {
  const parts = [];
  let cursor = 0;
  for (const match of text.matchAll(MENTION_PATTERN)) {
    const user = readMention(match[0]);
    if (!user) continue;
    parts.push(text.slice(cursor, match.index));
    parts.push(<Link key={match.index} to={`/users/${user.id}`} className="text-primary underline">@{user.displayName}</Link>);
    cursor = match.index + match[0].length;
  }
  parts.push(text.slice(cursor));
  return <>{parts}</>;
}
