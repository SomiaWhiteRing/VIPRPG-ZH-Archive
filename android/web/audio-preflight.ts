import { localRequest, type AudioProfile } from "@/lib/browser/android-local";

const probeUrl = "/_android/audio-probe.js";
let preparing: Promise<void> | undefined;

async function measure(profile: AudioProfile): Promise<boolean> {
  const context = new AudioContext({
    latencyHint: "interactive",
    sampleRate: profile === "reduced" ? 22050 : undefined,
  });
  let worker: Worker | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const producer = worker = new Worker(probeUrl);
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error("Audio preflight timed out")), 4500);
    });
    return await Promise.race([timeout, (async () => {
      await Promise.all([context.audioWorklet.addModule(probeUrl), context.resume()]);
      const node = new AudioWorkletNode(context, "audio-preflight", {
        numberOfInputs: 0, outputChannelCount: [2], processorOptions: { buffered: profile !== "default" },
      });
      const mute = context.createGain();
      mute.gain.value = 0;
      const channel = new MessageChannel();
      const result = new Promise<boolean>((resolve, reject) => {
        node.port.onmessage = event => resolve(event.data);
        node.onprocessorerror = producer.onerror = () => reject(new Error("Audio preflight failed"));
      });
      producer.postMessage({ port: channel.port1, rate: context.sampleRate }, [channel.port1]);
      node.port.postMessage(channel.port2, [channel.port2]);
      node.connect(mute).connect(context.destination);
      return result;
    })()]);
  } finally {
    clearTimeout(timer);
    worker?.terminate();
    await context.close();
  }
}

export function prepareAudioProfile(): Promise<void> {
  return preparing ??= (async () => {
    const cached = await localRequest<{ key: string; profile?: AudioProfile } | null>("audioProfile");
    if (!cached || cached.profile) return;
    for (const profile of ["default", "buffered", "reduced"] as const) {
      let stable;
      try { stable = await measure(profile); }
      catch (error) {
        if (profile !== "reduced" || !(error instanceof DOMException) || error.name !== "NotSupportedError") throw error;
        await localRequest("setAudioProfile", { key: cached.key, profile: "buffered" });
        return;
      }
      if (stable || profile === "reduced") {
        await localRequest("setAudioProfile", { key: cached.key, profile });
        break;
      }
    }
  })().catch(() => { /* An inconclusive probe leaves the device default available. */ })
    .finally(() => { preparing = undefined; });
}
