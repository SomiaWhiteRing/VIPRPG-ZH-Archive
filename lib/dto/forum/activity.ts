import type { ForumAuthor, ForumPage } from "@/lib/forum";

export type UserDiscussionItem = {
  id: number;
  kind: "topic" | "post" | "comment";
  title: string;
  snippet: string;
  createdAt: string;
  href: string;
};

export type PublicSearchPage = ForumPage<{
  id: number;
  kind: "post" | "comment";
  topicId: number;
  title: string;
  snippet: string;
  createdAt: string;
  author: ForumAuthor;
  href: string;
}>;
