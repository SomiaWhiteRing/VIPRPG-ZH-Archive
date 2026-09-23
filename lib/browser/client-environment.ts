/** The site shell injects this bridge before loading either online or offline pages. */
export function isAndroidClient(): boolean {
  if (typeof window === "undefined") return false;
  const bridge = (window as Window & {
    VIPRPGAndroid?: { setPlaying?: unknown; setOrientation?: unknown };
  }).VIPRPGAndroid;
  return typeof bridge?.setPlaying === "function" && typeof bridge.setOrientation === "function";
}
