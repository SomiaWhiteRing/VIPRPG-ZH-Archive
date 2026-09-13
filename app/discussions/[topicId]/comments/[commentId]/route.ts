import { forumPermalink } from "@/lib/server/forum/permalink";
export const dynamic = "force-dynamic";
export async function GET(
  request: Request,
  { params }: { params: Promise<{ topicId: string; commentId: string }> },
) {
  const p = await params;
  return forumPermalink(p.topicId, "comment", p.commentId);
}
