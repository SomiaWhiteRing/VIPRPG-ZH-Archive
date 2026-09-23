import { open } from "node:fs/promises";
import { readAndroidPackage } from "../lib/android-package";
import { MAX_TOOL_BYTES } from "../lib/resources";

const path = process.argv[2];
if (!path) throw new Error("Usage: tsx scripts/inspect-android-package.ts <release.apk>");
const file = await open(path, "r");
try {
  const { size } = await file.stat();
  if (size < 1 || size > MAX_TOOL_BYTES) throw new Error("APK exceeds the website's 95 MB limit");
  const info = await readAndroidPackage(size, async (offset, length) => {
    const bytes = new Uint8Array(length);
    const { bytesRead } = await file.read(bytes, 0, length, offset);
    return bytes.subarray(0, bytesRead);
  });
  if (process.env.ANDROID_VERSION_CODE && info.versionCode !== Number(process.env.ANDROID_VERSION_CODE)) throw new Error("APK versionCode does not match the release");
  if (process.env.ANDROID_VERSION_NAME && info.version !== process.env.ANDROID_VERSION_NAME) throw new Error("APK versionName does not match the release");
  console.log(JSON.stringify({ ...info, sizeBytes: size }, null, 2));
} finally {
  await file.close();
}
