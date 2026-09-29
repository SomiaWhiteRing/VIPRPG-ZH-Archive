export const TRACE_MESSAGE = "viprpg-install-trace-v1";
export type TraceEvent = {
  session: string;
  source: "worker" | "page";
  sequence: number;
  epochMs: number;
  elapsedMs: number;
  kind: string;
  fields: Record<string, unknown>;
};
export type TraceBatch = { type: typeof TRACE_MESSAGE; events: TraceEvent[] };

/** Do not export cookies, authorization, request bodies, full query strings or game bytes. */
export function diagnosticUrl(value: string): string {
  try {
    const url = new URL(value, location.href);
    return `${url.origin}${url.pathname}`;
  } catch {
    return "invalid-url";
  }
}

export function errorFields(error: unknown): Record<string, unknown> {
  return error instanceof Error || error instanceof DOMException
    ? { name: error.name, message: error.message, stack: error.stack?.slice(0, 6000) }
    : { message: String(error).slice(0, 6000) };
}

export function environment(): Record<string, unknown> {
  const nav = navigator as Navigator & {
    deviceMemory?: number;
    connection?: { effectiveType?: string; downlink?: number; rtt?: number; saveData?: boolean };
  };
  const connection = nav.connection;
  return {
    userAgent: nav.userAgent, hardwareConcurrency: nav.hardwareConcurrency,
    deviceMemory: nav.deviceMemory, online: nav.onLine,
    connection: connection ? { effectiveType: connection.effectiveType, downlink: connection.downlink,
      rtt: connection.rtt, saveData: connection.saveData } : null,
    timeOrigin: performance.timeOrigin,
  };
}
