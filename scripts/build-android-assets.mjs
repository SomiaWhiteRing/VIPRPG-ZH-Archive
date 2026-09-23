import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import UPNG from "upng-js";

const root = resolve(import.meta.dirname, "..");
const { version } = JSON.parse(await readFile(resolve(root, "lib/archive/easyrpg-runtime.json"), "utf8"));
const source = resolve(root, "public/play");
const target = resolve(root, "android/build-assets/play");

await rm(target, { recursive: true, force: true });
await mkdir(resolve(target, "runtime/easyrpg"), { recursive: true });
await cp(resolve(source, "player.html"), resolve(target, "player.html"));
await cp(resolve(source, "runtime/easyrpg", version), resolve(target, "runtime/easyrpg", version), { recursive: true, force: true });
await cp(resolve(root, "public/icon/windI.png"), resolve(root, "android/build-assets/offline/icon.png"));

// Keep the launcher mark sourced from the site's pixel-art logo.
const icon = UPNG.decode(await readFile(resolve(root, "public/icon/windI.png")));
const sourcePixels = new Uint8Array(UPNG.toRGBA8(icon)[0]);
const side = 192;
const scale = 6;
const offset = Math.floor((side - icon.width * scale) / 2);
const pixels = new Uint8Array(side * side * 4);
for (let y = 0; y < icon.height; y += 1) {
  for (let x = 0; x < icon.width; x += 1) {
    const source = (y * icon.width + x) * 4;
    for (let dy = 0; dy < scale; dy += 1) {
      for (let dx = 0; dx < scale; dx += 1) {
        pixels.set(sourcePixels.subarray(source, source + 4), ((offset + y * scale + dy) * side + offset + x * scale + dx) * 4);
      }
    }
  }
}
const drawable = resolve(root, "android/build-res/drawable-nodpi");
await mkdir(drawable, { recursive: true });
await writeFile(resolve(drawable, "ic_app.png"), new Uint8Array(UPNG.encode([pixels.buffer], side, side, 0)));
