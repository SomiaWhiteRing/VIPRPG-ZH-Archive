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
