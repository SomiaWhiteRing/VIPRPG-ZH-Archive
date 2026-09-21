import { performance } from "node:perf_hooks";
import { hashPassword } from "../app/.server/auth/password";
import passwordPolicy from "../app/.server/auth/password-policy.json";

const targetMs = 200;
const samples = 5;
const { N, r, p, maxmem } = passwordPolicy;
if (N * r * p > 2 ** 20 || 128 * N * r >= maxmem || maxmem > 48 * 1024 * 1024) {
  throw new Error("Password policy exceeds the Workers scrypt cost or memory budget.");
}

const measurements: number[] = [];
for (let sample = 0; sample < samples; sample += 1) {
  const startedAt = performance.now();
  await hashPassword("calibration-password");
  measurements.push(Number((performance.now() - startedAt).toFixed(2)));
}
const medianMs = [...measurements].sort((left, right) => left - right)[Math.floor(samples / 2)];
console.log(JSON.stringify({
  algorithm: "scrypt", parameters: passwordPolicy, targetMs, samples, medianMs,
  withinTarget: medianMs <= targetMs, measurements,
  note: "Local timing only. Verify this policy on deployed Workers before release.",
}, null, 2));
