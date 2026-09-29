import { defineConfig } from "vite";
import { reactRouter } from "@react-router/dev/vite";
import { cloudflare } from "@cloudflare/vite-plugin";
import { fileURLToPath } from "node:url";

export default defineConfig({
  plugins: [
    cloudflare({
      viteEnvironment: { name: "ssr" },
    }),
    reactRouter(),
  ],
  resolve: { alias: { "@": fileURLToPath(new URL(".", import.meta.url)) } },
  worker: {
    plugins: () => [{
      name: "upng-worker-pako",
      enforce: "pre",
      transform(code, id) {
        if (!id.replaceAll("\\", "/").endsWith("/upng-js/UPNG.js")) return;
        // UPNG 2.1.0 probes the runtime require global even after bundling its
        // pako import. Workers have neither require nor the window.pako fallback.
        const loader = 'if (typeof require == "function") {pako = require("pako");}  else {pako = window.pako;}';
        if (!code.includes(loader))
          this.error("UPNG dependency loader changed; review the Worker adapter.");
        return { code: code.replace(loader, 'pako = require("pako");'), map: null };
      },
    }],
  },
  optimizeDeps: {
    // Worker-only encoders are discovered too late by the page scan. Discovering
    // them on the first image selection otherwise reloads the page mid-draft.
    include: ["upng-js", "@jsquash/jpeg/encode", "@jsquash/webp/encode", "7z-wasm"],
  },
  server: {
    host: "127.0.0.1",
    port: 3000,
    strictPort: false,
    watch: {
      // Offline seeds and local artifacts can contain tens of thousands of files.
      ignored: ["**/output/**", "**/.wrangler/**", "**/data/**"],
    },
  },
});
