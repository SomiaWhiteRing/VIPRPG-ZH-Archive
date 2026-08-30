import { notFound } from "next/navigation";
import { findPublicUserById } from "@/lib/server/db/users";

export async function requirePublicUser(rawId: string) {
  const userId = Number(rawId);
  if (!Number.isSafeInteger(userId) || userId <= 0) notFound();
  const user = await findPublicUserById(userId);
  if (!user) notFound();
  return user;
}
