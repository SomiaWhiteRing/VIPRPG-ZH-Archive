import { saveNetplayRecording } from "@/app/.server/db/netplay-recordings";
import type { AppRuntime } from "@/app/.server/runtime";
import { readRecordingGrant, validRecordingEvents } from "../../../../../../scripts/netplay-recording.mjs";

export async function POST(runtime: AppRuntime, request: Request) {
  const grant = readRecordingGrant(request.headers.get("X-Netplay-Recording-Grant"), runtime.env.NETPLAY_HK_IDENTITY_KEY);
  if (!grant) return new Response(null, { status: 403 });
  if (Number(request.headers.get("Content-Length")) > 262_144) return new Response(null, { status: 413 });
  const body = await request.text();
  if (Buffer.byteLength(body) > 262_144) return new Response(null, { status: 413 });
  let batch;
  try { batch = JSON.parse(body); } catch { return new Response(null, { status: 400 }); }
  const { seq, events } = batch ?? {};
  if (!validRecordingEvents(seq, events, 16_384) || (seq === 0 && events[0][0] !== "start")) {
    return new Response(null, { status: 400 });
  }
  await saveNetplayRecording(runtime.env, { ...grant, seq, events }, seq === 0);
  return new Response(null, { status: 204 });
}
