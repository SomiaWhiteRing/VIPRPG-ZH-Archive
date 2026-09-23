import type { WebPlayInstallWorkerInput } from "./web-play-types";

export type TraceFields = Record<string, unknown>;
export type InstallInput = Extract<WebPlayInstallWorkerInput, { type: "install" }>;

/** Optional observation only: no timers, logging, storage or downloads in the normal entry. */
export interface InstallObserver {
  event(kind: string, fields?: TraceFields): void;
  task<T>(kind: string, action: () => Promise<T>, fields?: TraceFields,
    result?: (value: T) => TraceFields): Promise<T>;
  finish(outcome: string): void;
}

let factory: ((input: InstallInput) => InstallObserver) | undefined;
export let installObserver: InstallObserver | undefined;

export function registerInstallObserver(value: typeof factory): void {
  factory = value;
}

export function startInstallObservation(input: InstallInput): void {
  try { installObserver = factory?.(input); }
  catch (error) {
    installObserver = undefined;
    console.warn("Install diagnostics could not start", error);
  }
}

export function finishInstallObservation(outcome: string): void {
  try { installObserver?.finish(outcome); }
  catch (error) { console.warn("Install diagnostics could not finish", error); }
  finally { installObserver = undefined; }
}

export function observeInstallTask<T>(kind: string, action: () => Promise<T>, fields?: TraceFields,
  result?: (value: T) => TraceFields): Promise<T> {
  return installObserver ? installObserver.task(kind, action, fields, result) : action();
}
