import { analyticsPage, analyticsSizeBucket, type SiteAnalyticsConfig } from "@/lib/analytics";

let config: SiteAnalyticsConfig | null = null;
let enabled = false;
let configured = false;
let tagInserted = false;
let lastPage = "";
type AnalyticsWindow = Window & { dataLayer?: unknown[]; gtag?: (...args: unknown[]) => void };
type EventName = "download_click" | "install_start" | "install_result" | "play_start" | "play_result" | "scroll_depth";
type EventFields = Partial<{
  work_id: number; archive_version_id: number; action_kind: "zip" | "external";
  install_outcome: "success" | "error" | "cancel";
  size_bucket: string; duration_bucket: string; duration_ms: number;
  download_unpack_ms: number; network_wait_ms: number; write_ms: number;
  transferred_bytes: number; retry_count: number; scroll_percent: number;
}>;

function disable(value: boolean): void {
  if (config) (window as unknown as Record<string, unknown>)[`ga-disable-${config.measurementId}`] = value;
}

export function pauseAnalytics(): void { enabled = false; disable(true); }

function emit(...command: unknown[]): void {
  try { (window as AnalyticsWindow).gtag?.(...command); }
  catch { pauseAnalytics(); } // Measurement failures must not interrupt downloads or installation.
}

export function synchronizeAnalytics(value: SiteAnalyticsConfig | null): boolean {
  if (!value) pauseAnalytics();
  config = value;
  const page = analyticsPage(location.pathname);
  enabled = Boolean(value && page && location.hostname === "viprpg.org" && window.self === window.top);
  disable(!enabled);
  if (!enabled || !value) { lastPage = ""; return false; }
  const target = window as AnalyticsWindow;
  target.dataLayer ??= [];
  // eslint-disable-next-line prefer-rest-params -- gtag's documented queue requires an Arguments object.
  target.gtag ??= function () { target.dataLayer!.push(arguments); };
  const pageFields = safePageFields();
  if (!configured) {
    emit("consent", "default", { analytics_storage: "granted", ad_storage: "denied",
      ad_user_data: "denied", ad_personalization: "denied" });
    emit("js", new Date());
    configured = true;
  }
  emit("config", value.measurementId, { send_page_view: false, allow_google_signals: false,
    allow_ad_personalization_signals: false, ...pageFields, ...value.context });
  if (!enabled) return false;
  if (!tagInserted) try {
    const script = document.createElement("script");
    script.async = true;
    // The gateway owns the tag ID; Google's manual setup uses the reserved path itself.
    script.src = `${value.gatewayPath}/`;
    script.onerror = () => { script.remove(); tagInserted = false; pauseAnalytics(); };
    document.head.appendChild(script);
    tagInserted = true;
  } catch { pauseAnalytics(); return false; }
  return true;
}

function safePageFields(): Record<string, string> {
  let referrer = "";
  try { referrer = new URL(document.referrer).origin; } catch { /* No referrer. */ }
  return { page_location: `${location.origin}${location.pathname}`,
    page_title: `VIPRPG.org | ${analyticsPage(location.pathname) ?? "页面"}`, page_referrer: referrer };
}

export function canTrackAnalytics(): boolean {
  return enabled && Boolean(analyticsPage(location.pathname));
}

export function trackAnalytics(name: EventName, fields: EventFields = {}): void {
  if (!canTrackAnalytics() || !config) return;
  // Only typed fields and coarse edge metadata are accepted. No arbitrary event payloads.
  emit("event", name, { ...safePageFields(), ...config.context,
    page_group: analyticsPage(location.pathname), ...fields, send_to: config.measurementId });
}

export function trackAnalyticsPage(key: string): void {
  if (!canTrackAnalytics() || !config || key === lastPage) return;
  lastPage = key;
  emit("event", "page_view", { ...safePageFields(), ...config.context,
    page_group: analyticsPage(location.pathname), send_to: config.measurementId });
}

export function trackDownloadClick(workId: number, versionId: number | null, bytes: number | null, external: boolean): void {
  trackAnalytics("download_click", { work_id: workId, ...(versionId ? { archive_version_id: versionId } : {}),
    action_kind: external ? "external" : "zip", size_bucket: analyticsSizeBucket(bytes) });
}
