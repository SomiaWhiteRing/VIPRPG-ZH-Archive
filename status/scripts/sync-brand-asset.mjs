import { copyFile, mkdir } from "node:fs/promises";

await mkdir("status/public/icon", { recursive: true });
await copyFile("public/icon/windI.png", "status/public/icon/windI.png");

// Publish the same browser scroll policy used by the main site.
await copyFile("lib/ui/scroll.js", "status/public/scroll.js");
