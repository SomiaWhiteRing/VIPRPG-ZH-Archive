import { cookies } from "next/headers";
import {
  SESSION_COOKIE_NAME,
  readSessionUserIdFromCookieHeader,
  readSessionUserIdFromToken,
} from "@/lib/server/auth/session";
import { type ArchiveUser, findUserById } from "@/lib/server/db/users";

export async function getCurrentUserFromRequest(
  request: Request,
): Promise<ArchiveUser | null> {
  try {
    const userId = await readSessionUserIdFromCookieHeader(
      request.headers.get("cookie"),
    );

    const user = userId ? await findUserById(userId) : null;

    return user?.status === "active" ? user : null;
  } catch {
    return null;
  }
}

export async function getCurrentUserFromCookies(): Promise<ArchiveUser | null> {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;

    if (!token) {
      return null;
    }

    const userId = await readSessionUserIdFromToken(token);

    const user = userId ? await findUserById(userId) : null;

    return user?.status === "active" ? user : null;
  } catch {
    return null;
  }
}
