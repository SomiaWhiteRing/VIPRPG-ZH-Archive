import type { AppRuntime } from "./runtime";
import type { SiteAnalyticsConfig } from "@/lib/analytics";

export function getSiteAnalyticsConfig(runtime: AppRuntime): SiteAnalyticsConfig | null {
  const env = runtime.env as CloudflareEnv & {
    GA_ENABLED?: string; GA_MEASUREMENT_ID?: string; GA_GATEWAY_PATH?: string;
  };
  if (env.GA_ENABLED !== "true" || runtime.origin !== "https://viprpg.org"
    || new URL(runtime.request.url).hostname !== "viprpg.org"
    || env.SITE_NOINDEX !== "false" || !/^G-[A-Z0-9]+$/.test(env.GA_MEASUREMENT_ID ?? "")
    || !/^\/[A-Za-z0-9]+$/.test(env.GA_GATEWAY_PATH ?? "")) return null;
  const cf = runtime.request.cf as { country?: string; regionCode?: string; asn?: number } | undefined;
  return {
    measurementId: env.GA_MEASUREMENT_ID!,
    gatewayPath: env.GA_GATEWAY_PATH!,
    context: {
      edge_country: /^[A-Z]{2}$/.test(cf?.country ?? "") ? cf!.country! : "unknown",
      edge_region: /^[a-zA-Z0-9-]{1,16}$/.test(cf?.regionCode ?? "") ? cf!.regionCode! : "unknown",
      network_asn: Number.isSafeInteger(cf?.asn) && cf!.asn! > 0 ? String(cf!.asn) : "unknown",
    },
  };
}
