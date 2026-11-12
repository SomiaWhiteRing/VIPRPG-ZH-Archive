import { createHmac, timingSafeEqual } from "node:crypto";
import { saveNetplayRecording } from "@/app/.server/db/netplay-recordings";
import { readJsonObject } from "@/app/.server/http/request";
import type { AppRuntime } from "@/app/.server/runtime";
import { HttpError } from "@/lib/http";
import type { RecordingBatch } from "../../../../../../scripts/netplay-recording.mjs";

export async function POST(runtime: AppRuntime, request: Request) {
  const key = runtime.env.NETPLAY_HK_IDENTITY_KEY;
  const signature = request.headers.get("X-Netplay-Recording");
  if (!key || !signature || !/^[0-9a-f]{64}$/.test(signature)) return new Response(null, { status: 403 });
  const actual = Buffer.from(signature, "hex");
  const batch = await readJsonObject(request, "Invalid recording batch", {
    maximumBytes: 60_000,
    verifyBody(body) {
      const expected = createHmac("sha256", key).update("netplay-recording/v1\n").update(body).digest();
      if (!timingSafeEqual(actual, expected)) throw new HttpError(403, "Invalid recording signature");
    },
  });
  await saveNetplayRecording(runtime.env, batch as unknown as RecordingBatch);
  return new Response(null, { status: 204 });
}
