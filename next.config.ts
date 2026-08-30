import type { NextConfig } from "next";
import { initOpenNextCloudflareForDev } from "@opennextjs/cloudflare";

const systemTestConfigPath = process.env.SYSTEM_TEST_WRANGLER_CONFIG;
const systemTestPersistPath = process.env.SYSTEM_TEST_PERSIST_PATH;
const systemTestDistDir =
  process.env.SYSTEM_TEST_DIST_DIR ??
  (systemTestConfigPath ? ".next-system-test" : undefined);

if (Boolean(systemTestConfigPath) !== Boolean(systemTestPersistPath)) {
  throw new Error(
    "SYSTEM_TEST_WRANGLER_CONFIG and SYSTEM_TEST_PERSIST_PATH must be set together",
  );
}

initOpenNextCloudflareForDev(
  systemTestConfigPath && systemTestPersistPath
    ? {
        configPath: systemTestConfigPath,
        envFiles: [],
        persist: { path: systemTestPersistPath },
        remoteBindings: false,
      }
    : undefined,
);

const nextConfig: NextConfig = systemTestDistDir
  ? {
      distDir: systemTestDistDir,
      typescript: { tsconfigPath: ".next-system-test.tsconfig.json" },
    }
  : {};

export default nextConfig;
