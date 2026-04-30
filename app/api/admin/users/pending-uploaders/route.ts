import { requireAdmin } from "@/lib/server/auth/guards";
import { listPendingUploaders } from "@/lib/server/db/users";
import { json, jsonError } from "@/lib/server/http/json";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const auth = await requireAdmin(request);

  if ("response" in auth) {
    return auth.response;
  }

  try {
    const users = await listPendingUploaders();

    return json({
      ok: true,
      users: users.map((user) => ({
        id: user.id,
        email: user.email,
        displayName: user.displayName,
        role: user.role,
        uploadStatus: user.uploadStatus,
        createdAt: user.createdAt,
      })),
    });
  } catch (error) {
    return jsonError("Pending uploader query failed", error);
  }
}
