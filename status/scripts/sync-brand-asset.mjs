import { copyFile, mkdir } from "node:fs/promises";

await mkdir("status/public/icon", { recursive: true });
await copyFile("public/icon/windI.png", "status/public/icon/windI.png");
