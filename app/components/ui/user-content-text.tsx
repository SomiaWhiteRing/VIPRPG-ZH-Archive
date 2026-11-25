import { Fragment, type ReactNode } from "react";
import { LocaleLink as Link } from "@/app/components/ui/locale-link";
import { AUTO_LINK_PATTERN, autoLink } from "@/lib/auto-links";
import { MENTION_PATTERN, readMention } from "@/lib/mentions";

export function UserContentLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a className="text-primary underline" href={href} target="_blank" rel="nofollow ugc noopener noreferrer">
      {children}
    </a>
  );
}

export function UserContentText({ text, extraTokens }: {
  text: string;
  extraTokens?: { pattern: RegExp; render: (token: string) => ReactNode };
}) {
  const sources = [AUTO_LINK_PATTERN.source, MENTION_PATTERN.source];
  if (extraTokens) sources.push(extraTokens.pattern.source);
  const pattern = new RegExp(sources.join("|"), "g");
  const parts: ReactNode[] = [];
  let cursor = 0;

  for (const match of text.matchAll(pattern)) {
    const token = match[0];
    const index = match.index;
    parts.push(text.slice(cursor, index));
    const link = autoLink(token);
    let content: ReactNode;
    if (link) {
      content = <><UserContentLink href={link.href}>{link.text}</UserContentLink>{link.suffix}</>;
    } else {
      const user = readMention(token);
      content = user
        ? <Link to={`/users/${user.id}`} className="text-primary underline">@{user.displayName}</Link>
        : extraTokens?.render(token) ?? token;
    }
    parts.push(<Fragment key={index}>{content}</Fragment>);
    cursor = index + token.length;
  }
  parts.push(text.slice(cursor));
  return <>{parts}</>;
}
