import { getCloudflareEnv } from "@/lib/server/cloudflare/env";

export function getAuthSecret(): string {
  const value = readRuntimeSecret("AUTH_SECRET");

  if (!value) {
    throw new Error("AUTH_SECRET is not configured");
  }

  if (value.length < 16) {
    throw new Error("AUTH_SECRET must be at least 16 characters");
  }

  return value;
}

export function getBootstrapAdminEmail(): string | null {
  const value = readRuntimeSecret("BOOTSTRAP_ADMIN_EMAIL");

  if (!value) {
    return null;
  }

  return value.trim().toLowerCase();
}

export function getTurnstileSecretKey(): string {
  const value = readRuntimeSecret("TURNSTILE_SECRET_KEY");

  if (!value) {
    throw new Error("TURNSTILE_SECRET_KEY is not configured");
  }

  return value;
}

export function getTurnstileSiteKey(): string {
  const value = readRuntimeVariable("TURNSTILE_SITE_KEY");

  if (!value) {
    throw new Error("TURNSTILE_SITE_KEY is not configured");
  }

  return value;
}

export function getEmailFrom(): string {
  const value = readRuntimeVariable("EMAIL_FROM");

  if (!value) {
    throw new Error("EMAIL_FROM is not configured");
  }

  return value;
}

export function getAppOrigin(): string {
  const value = readRuntimeVariable("APP_ORIGIN");

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
  name: "AUTH_SECRET" | "BOOTSTRAP_ADMIN_EMAIL" | "TURNSTILE_SECRET_KEY",
): string | null {
  return readRuntimeVariable(name);
}

function readRuntimeVariable(
  name:
    | "AUTH_SECRET"
    | "BOOTSTRAP_ADMIN_EMAIL"
    | "TURNSTILE_SECRET_KEY"
    | "TURNSTILE_SITE_KEY"
    | "EMAIL_FROM"
    | "APP_ORIGIN",
): string | null {
  const processValue = process.env[name]?.trim();

  if (processValue) {
    return processValue;
  }

  try {
    const env = getCloudflareEnv() as unknown as Record<string, string | undefined>;
    return env[name]?.trim() || null;
  } catch {
    return null;
  }
}
