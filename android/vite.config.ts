import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";

import { styleNamespace } from "../scripts/style-namespace.mjs";

export default defineConfig({
  plugins: [styleNamespace()],
  root: fileURLToPath(new URL("web/", import.meta.url)),
  publicDir: false,
  base: "/_android/",
  resolve: { alias: { "@": fileURLToPath(new URL("../", import.meta.url)) } },
  build: {
    outDir: fileURLToPath(new URL("build-assets/offline/", import.meta.url)),
    emptyOutDir: true,
    target: "es2022",
  },
});
