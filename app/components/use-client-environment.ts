import { isAndroidClient } from "@/lib/browser/client-environment";
import { useSyncExternalStore } from "react";

const subscribe = () => () => {};
const snapshot = () => isAndroidClient() ? "android" as const : "browser" as const;
const serverSnapshot = () => null;

export function useClientEnvironment() {
  return useSyncExternalStore(subscribe, snapshot, serverSnapshot);
}
