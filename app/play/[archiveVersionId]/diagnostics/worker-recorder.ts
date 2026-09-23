import { registerInstallObserver } from "../web-play-install-observer";
import type { InstallInput, InstallObserver, TraceFields } from "../web-play-install-observer";
import { diagnosticUrl, environment, errorFields, TRACE_MESSAGE } from "./protocol";
import type { TraceBatch, TraceEvent } from "./protocol";

type Pending = { id: number; kind: string; started: number; fields: TraceFields };
type Metric = { started: number; completed: number; failed: number; totalMs: number; maxMs: number; bytes: number };
const responseHeaders = ["content-length", "content-type", "content-encoding", "cf-ray", "cf-cache-status",
  "x-download-cache", "x-download-zip-builder", "x-manifest-sha256", "etag", "accept-ranges", "content-range", "server-timing"];

class Recorder implements InstallObserver {
  private readonly session = crypto.randomUUID();
  private readonly started = performance.now();
  private sequence = 0;
  private operation = 0;
  private batch: TraceEvent[] = [];
  private dropped = 0;
  private stopped = false;
  private readonly pending = new Map<number, Pending>();
  private readonly metrics: Record<string, Metric> = {};
  private readonly heartbeat: ReturnType<typeof setInterval>;
  private readonly sender: ReturnType<typeof setInterval>;
  private previousTick = performance.now();
  private lastReadEnd: number | null = null;
  private lastByte: number | null = null;
  private lastInstallation: TraceFields = {};
  private entry: TraceFields = {};
  private queueDepth = 0;
  private maxQueueDepth = 0;
  private bytesRead = 0;
  private attempt = 0;
  private attemptStartBytes = 0;
  private sampledBytes = 0;
  private sampledAt = performance.now();
  private observer: PerformanceObserver | undefined;
  private readonly downloadPath: string;

  constructor(input: InstallInput) {
    this.downloadPath = diagnosticUrl(input.metadata.downloadUrl);
    this.event("session.start", {
      ...environment(), schema: 1, playKey: input.metadata.playKey, archiveVersionId: input.metadata.archiveVersionId,
      manifestSha256: input.metadata.manifestSha256, installerVersion: input.metadata.webPlayInstallerVersion,
      zipBuilder: input.metadata.downloadZipBuilderVersion, storageKind: input.storageKind,
      storageSnapshot: input.storageSnapshot, url: this.downloadPath,
      archiveBytes: input.metadata.totalSizeBytes, installBytes: input.metadata.installTotalSizeBytes,
      archiveFiles: input.metadata.totalFiles, installFiles: input.metadata.installTotalFiles,
      heartbeatMs: 1000, flushMs: 500, workerBufferLimit: 4096,
    });
    this.sender = setInterval(() => this.flush(), 500);
    this.heartbeat = setInterval(() => {
      const now = performance.now();
      this.event("heartbeat", this.snapshot(now, Math.max(0, now - this.previousTick - 1000)));
      this.previousTick = now;
    }, 1000);
    try {
      this.observer = new PerformanceObserver(list => this.resources(list.getEntries()));
      this.observer.observe({ type: "resource", buffered: true });
    } catch (error) {
      this.event("resource-timing.unavailable", errorFields(error));
    }
  }

  event(kind: string, fields: TraceFields = {}): void {
    if (this.stopped) return;
    // Never let observation fail the download. Only bounded, structured metadata is retained.
    try {
      if (kind === "installation") this.lastInstallation = fields;
      if (kind === "attempt.start") {
        this.attempt = Number(fields.attempt);
        this.attemptStartBytes = this.bytesRead;
        this.lastReadEnd = null;
        this.lastByte = null;
        this.entry = {};
      }
      if (kind === "zip.entry") this.entry = fields;
      if (typeof fields.queueDepth === "number") {
        this.queueDepth = fields.queueDepth;
        this.maxQueueDepth = Math.max(this.maxQueueDepth, this.queueDepth);
      }
      const safeFields = { ...fields };
      if (safeFields.error != null) safeFields.error = errorFields(safeFields.error);
      if (typeof safeFields.url === "string") safeFields.url = diagnosticUrl(safeFields.url);
      if (this.batch.length >= 4096) { this.dropped += 1; return; }
      const now = performance.now();
      this.batch.push({ session: this.session, source: "worker", sequence: ++this.sequence,
        epochMs: performance.timeOrigin + now, elapsedMs: now - this.started, kind, fields: { attempt: this.attempt, ...safeFields } });
    } catch { this.dropped += 1; }
  }

  async task<T>(kind: string, action: () => Promise<T>, fields: TraceFields = {}, result?: (value: T) => TraceFields): Promise<T> {
    const id = ++this.operation, started = performance.now();
    const metric = this.metrics[kind] ??= { started: 0, completed: 0, failed: 0, totalMs: 0, maxMs: 0, bytes: 0 };
    metric.started += 1;
    const context = { ...fields };
    if (typeof context.url === "string") context.url = diagnosticUrl(context.url);
    if (kind === "network.read") context.consumerGapMs = this.lastReadEnd === null ? null : started - this.lastReadEnd;
    this.pending.set(id, { id, kind, started, fields: context });
    this.event(`${kind}.start`, { id, ...context });
    let details: TraceFields = {};
    try {
      const value = await action();
      metric.completed += 1;
      // Diagnostic processing is separate from the operation's error semantics.
      try {
        if (kind === "network.read") {
          const read = value as ReadableStreamReadResult<Uint8Array>;
          const bytes = read.value?.byteLength ?? 0;
          this.bytesRead += bytes;
          if (bytes) this.lastByte = performance.now();
          details = { bytes, done: read.done, totalBytesRead: this.bytesRead };
        } else if (kind === "network.headers") {
          const response = value as Response;
          details = { status: response.status, responseType: response.type, redirected: response.redirected,
            url: diagnosticUrl(response.url), headers: Object.fromEntries(responseHeaders.map(key => [key, response.headers.get(key)])) };
        } else if (kind === "storage.estimate") {
          details = { estimate: value };
        }
        if (result) details = { ...details, ...result(value) };
      } catch (error) { this.event("recorder.error", errorFields(error)); }
      const durationMs = performance.now() - started;
      metric.bytes += Number(details.bytes ?? fields.bytes ?? 0);
      this.event(`${kind}.end`, { id, durationMs, ...details });
      return value;
    } catch (error) {
      metric.failed += 1;
      this.event(`${kind}.error`, { id, durationMs: performance.now() - started, error });
      throw error;
    } finally {
      const duration = performance.now() - started;
      metric.totalMs += duration;
      metric.maxMs = Math.max(metric.maxMs, duration);
      this.pending.delete(id);
      if (kind === "network.read") this.lastReadEnd = performance.now();
    }
  }

  finish(outcome: string): void {
    if (this.stopped) return;
    clearInterval(this.heartbeat);
    clearInterval(this.sender);
    if (this.observer) { this.resources(this.observer.takeRecords()); this.observer.disconnect(); }
    this.event("session.end", { outcome, ...this.snapshot(performance.now(), 0) });
    this.flush();
    this.stopped = true;
  }

  private snapshot(now: number, timerLagMs: number): TraceFields {
    const readBytesPerSecond = (this.bytesRead - this.sampledBytes) * 1000 / Math.max(1, now - this.sampledAt);
    this.sampledBytes = this.bytesRead;
    this.sampledAt = now;
    return { timerLagMs, noBytesForMs: this.lastByte === null ? null : now - this.lastByte,
      bytesRead: this.bytesRead, attemptBytesRead: this.bytesRead - this.attemptStartBytes,
      readBytesPerSecond, queueDepth: this.queueDepth, maxQueueDepth: this.maxQueueDepth,
      workerDroppedEvents: this.dropped, installation: this.lastInstallation, entry: this.entry,
      // These scopes overlap (ZIP entries contain reads/writes); totals must not be added together.
      metrics: structuredClone(this.metrics), pending: [...this.pending.values()].map(p => ({
        id: p.id, kind: p.kind, pendingMs: now - p.started, ...p.fields,
      })) };
  }

  private resources(entries: PerformanceEntry[]): void {
    for (const entry of entries) {
      if (entry.entryType !== "resource" || entry.startTime < this.started || diagnosticUrl(entry.name) !== this.downloadPath) continue;
      const r = entry as PerformanceResourceTiming;
      this.event("network.resource-timing", { url: diagnosticUrl(r.name), startTime: r.startTime,
        durationMs: r.duration, nextHopProtocol: r.nextHopProtocol, workerStart: r.workerStart,
        fetchStart: r.fetchStart, domainLookupStart: r.domainLookupStart, domainLookupEnd: r.domainLookupEnd,
        connectStart: r.connectStart, secureConnectionStart: r.secureConnectionStart, connectEnd: r.connectEnd,
        requestStart: r.requestStart, responseStart: r.responseStart, responseEnd: r.responseEnd,
        transferSize: r.transferSize, encodedBodySize: r.encodedBodySize, decodedBodySize: r.decodedBodySize });
    }
  }

  private flush(): void {
    if (!this.batch.length) return;
    const events = this.batch;
    this.batch = [];
    try { postMessage({ type: TRACE_MESSAGE, events } satisfies TraceBatch); }
    catch { this.dropped += events.length; }
  }
}

registerInstallObserver(input => new Recorder(input));
