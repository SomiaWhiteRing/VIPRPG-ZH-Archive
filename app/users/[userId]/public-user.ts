import { notFound } from "next/navigation";
import { findPublicUserById } from "@/lib/server/db/users";
import type { PublicProfileSection } from "@/lib/user-profile";

export async function requirePublicUser(rawId: string) {
  const userId = Number(rawId);
  if (!Number.isSafeInteger(userId) || userId <= 0) notFound();
  const user = await findPublicUserById(userId);
  if (!user) notFound();
  return user;
}

export async function requirePublicProfileSection(rawId: string, section: PublicProfileSection) {
  const user = await requirePublicUser(rawId);
  if (!user.profileVisibility[section]) notFound();
  return user;
}
