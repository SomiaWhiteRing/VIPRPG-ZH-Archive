import { getCloudflareEnv } from "@/app/.server/cloudflare/env";
import type { AppRuntime } from "@/app/.server/runtime";

export function getAuthSecret(runtime: AppRuntime): string {
  const value = readRuntimeSecret(runtime, "AUTH_SECRET");

  if (!value) {
    throw new Error("AUTH_SECRET is not configured");
  }

  if (value.length < 16) {
    throw new Error("AUTH_SECRET must be at least 16 characters");
  }

  return value;
}

export function getBootstrapAdminEmail(runtime: AppRuntime): string | null {
  const value = readRuntimeSecret(runtime, "BOOTSTRAP_ADMIN_EMAIL");

  if (!value) {
    return null;
  }

  return value.trim().toLowerCase();
}

export function getEmailFrom(runtime: AppRuntime): string {
  const value = readRuntimeVariable(runtime, "EMAIL_FROM");

  if (!value) {
    throw new Error("EMAIL_FROM is not configured");
  }

  return value;
}

export function getAppOrigin(runtime: AppRuntime): string {
  return runtime.origin;
}

export function normalizeAppOrigin(input: string | undefined): string {
  const value = input?.trim();

  if (!value) {
    throw new Error("APP_ORIGIN is not configured");
  }

  const url = new URL(value);
  const isLocalhost =
    url.hostname === "localhost" ||
    url.hostname === "127.0.0.1" ||
    url.hostname === "[::1]";

  if (url.protocol !== "https:" && !(isLocalhost && url.protocol === "http:")) {
    throw new Error("APP_ORIGIN must be an https origin");
  }

  return url.origin;
}

function readRuntimeSecret(
  runtime: AppRuntime,
  name: "AUTH_SECRET" | "BOOTSTRAP_ADMIN_EMAIL",
): string | null {
  return readRuntimeVariable(runtime, name);
}

function readRuntimeVariable(
  runtime: AppRuntime,
  name: "AUTH_SECRET" | "BOOTSTRAP_ADMIN_EMAIL" | "EMAIL_FROM" | "APP_ORIGIN",
): string | null {
  try {
    const env = getCloudflareEnv(runtime) as unknown as Record<
      string,
      string | undefined
    >;
    return env[name]?.trim() || null;
  } catch {
    return null;
  }
}
