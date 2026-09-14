import { notFound, redirect } from "next/navigation";
import { forumLocation } from "@/lib/server/forum/location";
import { getForumRuntime } from "@/lib/server/forum/next";
import { HttpError } from "@/lib/server/http/json";
export default async function Permalink({ params }: { params: Promise<{ topicId: string; postNumber: string }> }) {
  const value = await params;
  if (![value.topicId,value.postNumber].every((id) => /^[1-9]\d*$/.test(id) && Number.isSafeInteger(Number(id)))) notFound();
  let href;
  try { href = (await forumLocation(getForumRuntime(), Number(value.topicId), { postNumber: Number(value.postNumber) })).href; }
  catch (error) { if (error instanceof HttpError && error.status === 404) notFound(); throw error; }
  redirect(href);
}
