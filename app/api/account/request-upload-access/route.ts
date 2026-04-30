import { requireUser } from "@/lib/server/auth/guards";
import { json, jsonError } from "@/lib/server/http/json";
import { requestUploadAccess } from "@/lib/server/db/users";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const auth = await requireUser(request);

  if ("response" in auth) {
    return auth.response;
  }

  try {
    if (auth.user.role === "admin" || auth.user.uploadStatus === "approved") {
      return json({
        ok: true,
        user: {
          id: auth.user.id,
          role: auth.user.role,
          uploadStatus: auth.user.uploadStatus,
        },
      });
    }

    const user = await requestUploadAccess(auth.user.id);

    return json({
      ok: true,
      user: {
        id: user.id,
        role: user.role,
        uploadStatus: user.uploadStatus,
      },
    });
  } catch (error) {
    return jsonError("Upload access request failed", error);
  }
}
