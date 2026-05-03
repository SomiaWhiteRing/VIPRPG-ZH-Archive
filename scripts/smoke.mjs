import { spawnSync } from "node:child_process";

const baseUrl = process.argv[2] ?? process.env.SMOKE_BASE_URL;

if (!baseUrl) {
  console.error("Usage: node scripts/smoke.mjs <base-url>");
  process.exit(1);
}

const paths = [
  "/",
  "/games",
  "/creators",
  "/characters",
  "/tags",
  "/series",
  "/api/health",
  "/api/health/db",
  "/api/health/r2",
];

let failed = false;

for (const path of paths) {
  const url = new URL(path, baseUrl);
  const startedAt = Date.now();

  try {
    const response = await smokeFetch(url);
    const durationMs = Date.now() - startedAt;

    if (!response.ok) {
      failed = true;
      console.error(`${response.status} ${path} (${durationMs}ms)`);
      continue;
    }

    console.log(`${response.status} ${path} (${durationMs}ms)`);
  } catch (error) {
    failed = true;
    console.error(`ERR ${path}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

if (failed) {
  process.exit(1);
}

async function smokeFetch(url) {
  try {
    return await fetch(url, {
      headers: {
        "user-agent": "viprpg-smoke/1.0",
      },
    });
  } catch (error) {
    if (process.platform !== "win32") {
      throw error;
    }

    const fallback = spawnSync(
      "powershell",
      [
        "-NoProfile",
        "-Command",
        "$response = Invoke-WebRequest -Uri $env:SMOKE_URL -UseBasicParsing -TimeoutSec 30; [Console]::Write($response.StatusCode)",
      ],
      {
        env: {
          ...process.env,
          SMOKE_URL: String(url),
        },
        encoding: "utf8",
      },
    );

    if (fallback.status !== 0) {
      throw error;
    }

    return {
      ok: fallback.stdout.trim().startsWith("2"),
      status: Number.parseInt(fallback.stdout.trim(), 10),
    };
  }
}
