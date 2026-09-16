import { getCurrentUser } from "@/app/.server/auth/current-user";
import { assertSameOrigin, SameOriginError } from "@/app/.server/auth/origin";
import type { AppRuntime } from "@/app/.server/runtime";
import type { ArchiveUser } from "@/lib/dto/db/user-access";
import { json } from "@/lib/http";

export type AuthSuccess = {
  user: ArchiveUser;
};

export type AuthFailure = {
  response: Response;
};

export async function requireUser(
  runtime: AppRuntime,
  request: Request,
): Promise<AuthSuccess | AuthFailure> {
  try {
    assertSameOrigin(runtime, request);
  } catch (error) {
    if (!(error instanceof SameOriginError)) throw error;
    return {
      response: json({ ok: false, error: error.message }, { status: 403 }),
    };
  }
  const user = await getCurrentUser(runtime);

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
