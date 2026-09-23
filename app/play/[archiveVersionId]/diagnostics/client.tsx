import { useState, useSyncExternalStore } from "react";
import { Button } from "@/app/components/ui/button";
import { diagnosticUrl, environment, errorFields, TRACE_MESSAGE } from "./protocol";
import type { TraceBatch, TraceEvent } from "./protocol";

const MAX_EVENTS = 30000;
const MAX_CHARACTERS = 6 * 1024 * 1024; // Roughly 12 MiB of UTF-16 text; not an exact JS heap limit.
const HEAD_EVENTS = 128;
const listeners = new Set<() => void>();
type Chunk = { events: TraceEvent[]; characters: number };
let head: TraceEvent[] = [];
let chunks: Chunk[] = [];
let retainedEvents = 0, characters = 0, droppedEvents = 0, activeWorkers = 0;
let pageSequence = 0;
const emptySnapshot = { events: 0, dropped: 0, active: 0, last: "尚未开始安装", lastWorker: 0 };
let snapshot = emptySnapshot;
let lastWorker = 0;
let lastWorkerSnapshot: TraceEvent | null = null;

function append(events: TraceEvent[]): void {
  if (!events.length) return;
  const remaining = events.slice();
  if (head.length < HEAD_EVENTS) {
    const first = remaining.splice(0, HEAD_EVENTS - head.length);
    head.push(...first);
    retainedEvents += first.length;
    characters += JSON.stringify(first).length;
  }
  if (remaining.length) {
    const size = JSON.stringify(remaining).length;
    chunks.push({ events: remaining, characters: size });
    retainedEvents += remaining.length;
    characters += size;
  }
  while (chunks.length && (retainedEvents > MAX_EVENTS || characters > MAX_CHARACTERS)) {
    const removed = chunks.shift()!;
    retainedEvents -= removed.events.length;
    characters -= removed.characters;
    droppedEvents += removed.events.length;
  }
  for (const event of events) {
    if (event.source === "worker") lastWorker = Date.now();
    if (event.kind === "heartbeat" || event.kind === "session.end") lastWorkerSnapshot = event;
  }
  const last = events.at(-1)!;
  snapshot = { events: retainedEvents, dropped: droppedEvents, active: activeWorkers,
    last: last.kind, lastWorker };
  for (const listener of listeners) listener();
}

function exportedLog(): string {
  const events = [...head, ...chunks.flatMap(chunk => chunk.events)];
  // Worker and page batches arrive at different times. Preserve source sequence and sort by epoch.
  events.sort((a, b) => a.epochMs - b.epochMs);
  return JSON.stringify({ schema: "viprpg-install-diagnostics-v1", exportedAt: new Date().toISOString(),
    retention: { maxEvents: MAX_EVENTS, maxCharacters: MAX_CHARACTERS, retainedEvents, droppedEvents,
      firstEventsPreserved: head.length, characters },
    lastWorkerSnapshot, events,
    interpretation: "Durations of nested spans overlap; do not sum them. network.read is JS stream consumption, not NIC traffic. Zero resource timing fields may be unavailable or connection reuse. Missing session.end means incomplete capture. Logging affects timings.",
  }, null, 2);
}

/** Same exports as the production entry; only this module loads the diagnostic worker/UI. */
export function createInstallWorker(): Worker {
  const worker = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
  const session = crypto.randomUUID(), started = performance.now();
  let terminated = false, installing = false, previousTick = started;
  const pageEvent = (kind: string, fields: Record<string, unknown> = {}) => {
    const now = performance.now();
    append([{ session, source: "page", sequence: ++pageSequence, epochMs: performance.timeOrigin + now,
      elapsedMs: now - started, kind, fields }]);
  };
  pageEvent("page.worker-created", { ...environment(), url: diagnosticUrl(location.href),
    visibility: document.visibilityState });
  const onMessage = (event: MessageEvent) => {
    const data = event.data;
    if (data?.type === TRACE_MESSAGE) {
      // Keep trace packets out of the product's existing 300-line log and onmessage handler.
      event.stopImmediatePropagation();
      append((data as TraceBatch).events);
    } else if (["install-finished", "install-rejected", "log"].includes(data?.type)) {
      if (data.type !== "log" && installing) { installing = false; activeWorkers -= 1; }
      pageEvent("page.product-message", { type: data.type, level: data.level, message: data.message });
    }
  };
  const onError = (event: ErrorEvent) => pageEvent("page.worker-error", {
    message: event.message, filename: diagnosticUrl(event.filename), line: event.lineno, column: event.colno,
  });
  const onMessageError = () => pageEvent("page.worker-message-error");
  const onVisibility = () => pageEvent("page.visibility", { visibility: document.visibilityState });
  const onNetwork = () => pageEvent("page.network", environment());
  worker.addEventListener("message", onMessage);
  worker.addEventListener("error", onError);
  worker.addEventListener("messageerror", onMessageError);
  document.addEventListener("visibilitychange", onVisibility);
  window.addEventListener("online", onNetwork);
  window.addEventListener("offline", onNetwork);
  const timer = setInterval(() => {
    const now = performance.now();
    if (installing) pageEvent("page.heartbeat", { timerLagMs: Math.max(0, now - previousTick - 1000),
      workerSilenceMs: lastWorker ? Date.now() - lastWorker : null, visibility: document.visibilityState });
    previousTick = now;
  }, 1000);
  // Wrap only this worker instance, never browser prototypes or other application workers.
  const post = worker.postMessage.bind(worker);
  worker.postMessage = (message: unknown, options?: Transferable[] | StructuredSerializeOptions) => {
    if (message && typeof message === "object" && "type" in message) {
      if (message.type === "install" && !installing) { installing = true; activeWorkers += 1; lastWorker = 0; }
      pageEvent("page.worker-command", { type: message.type });
    }
    if (Array.isArray(options)) post(message, options);
    else post(message, options);
  };
  const terminate = worker.terminate.bind(worker);
  worker.terminate = () => {
    if (terminated) return;
    terminated = true;
    if (installing) activeWorkers -= 1;
    installing = false;
    pageEvent("page.worker-terminated", { unflushedWorkerEventsMayBeLost: true });
    clearInterval(timer);
    document.removeEventListener("visibilitychange", onVisibility);
    window.removeEventListener("online", onNetwork);
    window.removeEventListener("offline", onNetwork);
    worker.removeEventListener("message", onMessage);
    worker.removeEventListener("error", onError);
    worker.removeEventListener("messageerror", onMessageError);
    terminate();
  };
  return worker;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function InstallDiagnosticsPanel() {
  const state = useSyncExternalStore(subscribe, () => snapshot, () => emptySnapshot);
  const [text, setText] = useState("");
  const [notice, setNotice] = useState("");
  const download = () => {
    const contents = exportedLog();
    const url = URL.createObjectURL(new Blob([contents], { type: "application/json" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `viprpg-install-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
    setNotice("已发起导出；若当前应用未弹出保存，请使用复制日志或展开文本。");
  };
  const copy = async () => {
    const contents = exportedLog();
    try {
      await navigator.clipboard.writeText(contents);
      setNotice("完整诊断日志已复制。");
    } catch (error) {
      setText(contents);
      setNotice(`自动复制失败，请在下方文本框全选复制。${errorFields(error).message}`);
    }
  };
  return (
    <details className="mt-4 rounded border border-border p-3 text-sm">
      <summary className="cursor-pointer font-semibold">详细安装诊断（临时）</summary>
      <p className="my-2">已记录 {state.events.toLocaleString()} 条；容量限制淘汰 {state.dropped.toLocaleString()} 条。最近事件：{state.last}</p>
      <p className="my-2 text-muted-foreground">日志保存在本页内存，刷新会丢失。卡住时也可导出；不会自动上传。</p>
      <div className="flex flex-wrap gap-2">
        <Button type="button" size="sm" variant="outline" onClick={download}>导出 JSON</Button>
        <Button type="button" size="sm" variant="outline" onClick={() => void copy()}>复制日志</Button>
        <Button type="button" size="sm" variant="outline" onClick={() => setText(text ? "" : exportedLog())}>{text ? "收起文本" : "展开文本"}</Button>
        <Button type="button" size="sm" variant="ghost" disabled={state.active > 0} onClick={() => {
          head = []; chunks = []; retainedEvents = 0; characters = 0; droppedEvents = 0;
          lastWorkerSnapshot = null; lastWorker = 0; snapshot = emptySnapshot;
          setText(""); setNotice(""); for (const listener of listeners) listener();
        }}>清空记录</Button>
      </div>
      {notice ? <p role="status" className="mt-2">{notice}</p> : null}
      {text ? <label className="mt-2 block">诊断 JSON（只读，可全选复制）
        <textarea className="mt-1 block w-full rounded border border-border p-2 font-mono text-xs" readOnly rows={10} value={text} />
      </label> : null}
    </details>
  );
}
