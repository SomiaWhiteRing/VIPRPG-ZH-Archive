type UserAgentData = {
  brands: { brand: string; version: string }[];
  mobile: boolean;
  platform: string;
  getHighEntropyValues?: (hints: string[]) => Promise<Record<string, unknown>>;
};

/** Only local environment data; no URLs, cookies, accounts or stored files. */
export async function browserInfo(): Promise<string> {
  const nav = navigator as Navigator & {
    userAgentData?: UserAgentData;
    deviceMemory?: number;
    standalone?: boolean;
  };
  const available = (value: unknown) => typeof value !== "undefined";
  const report: Record<string, unknown> = {
    reportVersion: 1,
    capturedAt: new Date().toISOString(),
    note: "浏览器可能缩减或伪装这些信息；不能保证识别宿主 App、WebView 品牌及真实版本。能力存在也不保证运行正常。",
    browser: {
      userAgent: nav.userAgent,
      appVersion: nav.appVersion,
      vendor: nav.vendor,
      platform: nav.platform,
      language: nav.language,
      languages: Array.from(nav.languages ?? []),
      cookieEnabled: nav.cookieEnabled,
      online: nav.onLine,
      userAgentData: nav.userAgentData ? {
        brands: nav.userAgentData.brands,
        mobile: nav.userAgentData.mobile,
        platform: nav.userAgentData.platform,
      } : "浏览器未提供",
    },
    device: {
      hardwareConcurrency: nav.hardwareConcurrency,
      deviceMemoryGiB: nav.deviceMemory ?? "浏览器未提供",
      maxTouchPoints: nav.maxTouchPoints,
      screen: { width: screen.width, height: screen.height, colorDepth: screen.colorDepth },
      viewport: { width: window.innerWidth, height: window.innerHeight, pixelRatio: window.devicePixelRatio },
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      timezoneOffsetMinutes: new Date().getTimezoneOffset(),
    },
    page: {
      secureContext: window.isSecureContext,
      crossOriginIsolated: window.crossOriginIsolated,
      displayMode: window.matchMedia("(display-mode: standalone)").matches || nav.standalone ? "standalone" : "browser",
    },
    capabilities: {
      worker: available(globalThis.Worker),
      sharedWorker: available(globalThis.SharedWorker),
      serviceWorker: "serviceWorker" in nav,
      webAssembly: available(globalThis.WebAssembly),
      offscreenCanvas: available(globalThis.OffscreenCanvas),
      transferControlToOffscreen: "transferControlToOffscreen" in HTMLCanvasElement.prototype,
      sharedArrayBuffer: available(globalThis.SharedArrayBuffer),
      atomics: available(globalThis.Atomics),
      indexedDB: available(globalThis.indexedDB),
      opfs: typeof nav.storage?.getDirectory === "function",
      storageManager: available(nav.storage),
      audioContext: available(globalThis.AudioContext),
      audioWorklet: available(globalThis.AudioWorkletNode),
      webGL: available(globalThis.WebGLRenderingContext),
      webGL2: available(globalThis.WebGL2RenderingContext),
      clipboardWriteText: typeof nav.clipboard?.writeText === "function",
      fullscreen: document.fullscreenEnabled,
      pointerEvents: available(globalThis.PointerEvent),
      visualViewport: !!window.visualViewport,
      resizeObserver: available(globalThis.ResizeObserver),
      webCrypto: !!globalThis.crypto?.subtle,
    },
  };
  const ua = nav.userAgentData;
  if (ua?.getHighEntropyValues) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      report.clientHints = await Promise.race([
        ua.getHighEntropyValues(["architecture", "bitness", "model", "platformVersion", "fullVersionList", "wow64"]),
        new Promise<string>((resolve) => { timer = setTimeout(() => resolve("读取超时"), 1200); }),
      ]);
    } catch {
      report.clientHints = "浏览器拒绝或不支持读取";
    } finally {
      clearTimeout(timer);
    }
  }
  return JSON.stringify(report, null, 2);
}
