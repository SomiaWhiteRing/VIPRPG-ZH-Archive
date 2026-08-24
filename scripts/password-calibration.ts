import { performance } from "node:perf_hooks";

const targetMs = 200;
const samples = 5;
const step = 10_000;
const maximum = 2_000_000;
const password = new TextEncoder().encode("calibration-password");
const salt = crypto.getRandomValues(new Uint8Array(16));
const key = await crypto.subtle.importKey("raw", password, "PBKDF2", false, ["deriveBits"]);

let low = 1;
let high = maximum / step;
let best = step;
const measurements: Array<{ iterations: number; medianMs: number }> = [];

while (low <= high) {
  const units = Math.floor((low + high) / 2);
  const iterations = units * step;
  const medianMs = await medianDuration(iterations);
  measurements.push({ iterations, medianMs });
  if (medianMs <= targetMs) {
    best = iterations;
    low = units + 1;
  } else {
    high = units - 1;
  }
}

const finalMedianMs = measurements.find((item) => item.iterations === best)?.medianMs ??
  await medianDuration(best);
console.log(JSON.stringify({ targetMs, samples, recommendedIterations: best, medianMs: finalMedianMs, measurements }, null, 2));

async function medianDuration(iterations: number): Promise<number> {
  const durations: number[] = [];
  for (let sample = 0; sample < samples; sample += 1) {
    const startedAt = performance.now();
    await crypto.subtle.deriveBits(
      { name: "PBKDF2", hash: "SHA-256", salt, iterations },
      key,
      256,
    );
    durations.push(performance.now() - startedAt);
  }
  durations.sort((left, right) => left - right);
  return Number(durations[Math.floor(durations.length / 2)].toFixed(2));
}
