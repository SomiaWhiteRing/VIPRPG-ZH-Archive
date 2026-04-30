import { getCurrentUserFromRequest } from "@/lib/server/auth/current-user";
import { json } from "@/lib/server/http/json";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const user = await getCurrentUserFromRequest(request);

  if (!user) {
    return json(
      {
        ok: false,
        error: "Authentication required",
      },
      { status: 401 },
    );
  }

  return json({
    ok: true,
    user: {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      role: user.role,
      createdAt: user.createdAt,
    },
  });
}
