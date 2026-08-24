import { getCurrentUserFromRequest } from "@/lib/server/auth/current-user";
import { assertSameOrigin, SameOriginError } from "@/lib/server/auth/origin";
import { json } from "@/lib/server/http/json";
import type { ArchiveUser } from "@/lib/server/db/users";

export type AuthSuccess = {
  user: ArchiveUser;
};

export type AuthFailure = {
  response: Response;
};

export async function requireUser(request: Request): Promise<AuthSuccess | AuthFailure> {
  try {
    assertSameOrigin(request);
  } catch (error) {
    if (!(error instanceof SameOriginError)) throw error;
    return { response: json({ ok: false, error: error.message }, { status: 403 }) };
  }
  const user = await getCurrentUserFromRequest(request);

  if (!user) {
    return {
      response: json(
        {
          ok: false,
          error: "Authentication required",
        },
        { status: 401 },
      ),
    };
  }

  return { user };
}
