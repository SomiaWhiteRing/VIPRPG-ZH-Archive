import { requireAdministrator } from "@/app/.server/auth/authorize";
import { netplayRecordingSequences } from "@/app/.server/db/admin-netplay-matches";
import { netplayRecordingKey } from "@/app/.server/db/netplay-recordings";
import type { AppRuntime } from "@/app/.server/runtime";

export async function GET(runtime: AppRuntime, request: Request, id: string, seatParam: string) {
  const auth = await requireAdministrator(runtime, request);
  if ("response" in auth) return auth.response;
  if (!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(id) || !/^[12]$/.test(seatParam)) {
    return new Response(null, { status: 404 });
  }
  const seat = Number(seatParam);
  const sequences = await netplayRecordingSequences(runtime, id, seat);
  if (!sequences.length) return new Response(null, { status: 404 });

  const bucket = runtime.env.ARCHIVE_BUCKET;
  const encoder = new TextEncoder();
  let index = 0;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(`{"matchId":"${id}","seat":${seat},"segments":[`));
    },
    async pull(controller) {
      const seq = sequences[index];
      if (seq === undefined) {
        controller.enqueue(encoder.encode("]}"));
        controller.close();
        return;
      }
      const object = await bucket.get(netplayRecordingKey(id, seat, seq));
      const events = object ? await object.text() : "null";
      controller.enqueue(encoder.encode(`${index ? "," : ""}{"seq":${seq},"events":${events}}`));
      ++index;
    },
  });
  return new Response(stream, {
    headers: {
      "Cache-Control": "private, no-store",
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="netplay-${id}-seat-${seat}.json"`,
    },
  });
}
