import type { WebPlayInstallWorkerInput } from "./web-play-types";
import { createInstallMeasurement } from "./web-play-install-measurement";

export type TraceFields = Record<string, unknown>;
export type InstallInput = Extract<WebPlayInstallWorkerInput, { type: "install" }>;

/** Optional observation only; detailed diagnostics and consented aggregate measurement are separate. */
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
  try {
    const diagnostics = factory?.(input);
    const measurement = input.analyticsEnabled ? createInstallMeasurement() : undefined;
    installObserver = diagnostics && measurement ? {
      event(kind, fields) { diagnostics.event(kind, fields); measurement.event(kind, fields); },
      task(kind, action, fields, result) { return diagnostics.task(kind, () => measurement.task(kind, action), fields, result); },
      finish(outcome) { try { diagnostics.finish(outcome); } finally { measurement.finish(outcome); } },
    } : diagnostics ?? measurement;
  }
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
