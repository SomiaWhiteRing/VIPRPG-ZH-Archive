import { requireAdmin } from "@/lib/server/auth/guards";
import { approveUploader } from "@/lib/server/db/users";
import { json, jsonError } from "@/lib/server/http/json";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{
    userId: string;
  }>;
};

export async function POST(request: Request, context: RouteContext) {
  const auth = await requireAdmin(request);

  if ("response" in auth) {
    return auth.response;
  }

  try {
    const { userId: rawUserId } = await context.params;
    const userId = parseUserId(rawUserId);
    const user = await approveUploader(userId, auth.user.id);

    return mutationResponse(request, {
      ok: true,
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
        uploadStatus: user.uploadStatus,
      },
    });
  } catch (error) {
    return jsonError("Uploader approval failed", error);
  }
}

function parseUserId(value: string): number {
  const userId = Number.parseInt(value, 10);

  if (!Number.isSafeInteger(userId) || userId <= 0) {
    throw new Error("Invalid user id");
  }

  return userId;
}

function mutationResponse(request: Request, body: Parameters<typeof json>[0]): Response {
  if (request.headers.get("accept")?.includes("application/json")) {
    return json(body);
  }

  return Response.redirect(new URL("/admin/users", request.url), 303);
}
