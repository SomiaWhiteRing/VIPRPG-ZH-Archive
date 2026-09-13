import { forumPermalink } from "@/lib/server/forum/permalink";
export const dynamic = "force-dynamic";
export async function GET(
  request: Request,
  { params }: { params: Promise<{ topicId: string; postNumber: string }> },
) {
  const p = await params;
  return forumPermalink(p.topicId, "post", p.postNumber);
}
