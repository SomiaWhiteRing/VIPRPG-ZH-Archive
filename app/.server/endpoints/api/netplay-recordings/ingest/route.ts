import { createHmac, timingSafeEqual } from "node:crypto";
import { saveNetplayRecording } from "@/app/.server/db/netplay-recordings";
import type { AppRuntime } from "@/app/.server/runtime";
import type { RecordingBatch } from "../../../../../../scripts/netplay-recording.mjs";

export async function POST(runtime: AppRuntime, request: Request) {
  const key = runtime.env.NETPLAY_HK_IDENTITY_KEY;
  const signature = request.headers.get("X-Netplay-Recording");
  if (!key || !signature || !/^[0-9a-f]{64}$/.test(signature)) return new Response(null, { status: 403 });
  if (Number(request.headers.get("Content-Length")) > 60_000) return new Response(null, { status: 413 });
  const body = await request.text();
  if (body.length > 60_000) return new Response(null, { status: 413 });
  const actual = Buffer.from(signature, "hex");
  const expected = createHmac("sha256", key).update("netplay-recording/v1\n").update(body).digest();
  if (!timingSafeEqual(actual, expected)) return new Response(null, { status: 403 });
  await saveNetplayRecording(runtime.env, JSON.parse(body) as RecordingBatch);
  return new Response(null, { status: 204 });
}
