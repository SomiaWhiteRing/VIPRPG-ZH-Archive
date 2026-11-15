import { saveNetplayRecording } from "@/app/.server/db/netplay-recordings";
import { prepareNetplayReplay } from "@/app/.server/db/netplay-replays";
import { readJsonObject } from "@/app/.server/http/request";
import type { AppRuntime } from "@/app/.server/runtime";
import { readRecordingGrant, validRecordingEvents } from "../../../../../../scripts/netplay-recording.mjs";

export async function POST(runtime: AppRuntime, request: Request) {
  const grant = readRecordingGrant(request.headers.get("X-Netplay-Recording-Grant"), runtime.env.NETPLAY_HK_IDENTITY_KEY);
  if (!grant) return new Response(null, { status: 403 });
  const { seq, events } = await readJsonObject(request, "Invalid recording batch", { maximumBytes: 262_144 });
  if (!validRecordingEvents(seq, events, 16_384) || (seq === 0 && events[0][0] !== "start")) {
    return new Response(null, { status: 400 });
  }
  const ready = await saveNetplayRecording(runtime.env, { ...grant, seq: seq as number, events }, seq === 0);
  if (ready) await prepareNetplayReplay(runtime, grant.id);
  return new Response(null, { status: 204 });
}
