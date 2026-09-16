import { findPublicUserById } from "@/app/.server/db/users";
import { throwNotFound } from "@/app/.server/http/page-response";
import type { AppRuntime } from "@/app/.server/runtime";
import type { PublicProfileSection } from "@/lib/user-profile";

export async function requirePublicUser(runtime: AppRuntime, rawId: string) {
  const userId = Number(rawId);
  if (!Number.isSafeInteger(userId) || userId <= 0) throwNotFound();
  const user = await findPublicUserById(runtime, userId);
  if (!user) throwNotFound();
  return user;
}

export async function requirePublicProfileSection(
  runtime: AppRuntime,
  rawId: string,
  section: PublicProfileSection,
) {
  const user = await requirePublicUser(runtime, rawId);
  if (!user.profileVisibility[section]) throwNotFound();
  return user;
}
