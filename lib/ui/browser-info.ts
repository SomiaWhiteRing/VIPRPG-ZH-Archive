type BrowserBrand = { brand: string; version: string };
type UserAgentData = {
  brands: BrowserBrand[];
  platform: string;
  getHighEntropyValues?: (hints: string[]) => Promise<{
    fullVersionList?: BrowserBrand[];
    platformVersion?: string;
    model?: string;
  }>;
};

/** Local browser identity and relevant API presence; no user data or URLs. */
export async function browserInfo(): Promise<string> {
  const nav = navigator as Navigator & { userAgentData?: UserAgentData };
  const data = nav.userAgentData;
  let hints: { fullVersionList?: BrowserBrand[]; platformVersion?: string; model?: string } = {};
  if (data?.getHighEntropyValues) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      hints = await Promise.race([
        data.getHighEntropyValues(["fullVersionList", "platformVersion", "model"]),
        new Promise<Record<string, never>>((resolve) => { timer = setTimeout(() => resolve({}), 1000); }),
      ]);
    } catch {
      // UA and low-entropy fields still form a useful report.
    } finally {
      clearTimeout(timer);
    }
  }
  const brands = (hints.fullVersionList ?? data?.brands ?? []).filter((item) => !/not.*brand/i.test(item.brand));
  const named = brands.filter((item) => item.brand !== "Chromium");
  let browser = (named.length ? named : brands).map((item) => `${item.brand} ${item.version}`).join(" / ");
  if (!browser) {
    const patterns: [string, RegExp][] = [
      ["Edge", /Edg(?:A|iOS)?\/([\d.]+)/],
      ["Firefox", /(?:Firefox|FxiOS)\/([\d.]+)/],
      ["Opera", /OPR\/([\d.]+)/],
      ["Chrome", /(?:Chrome|CriOS)\/([\d.]+)/],
      ["Safari", /Version\/([\d.]+).*Safari/],
    ];
    for (const [name, pattern] of patterns) {
      const match = nav.userAgent.match(pattern);
      if (match) { browser = `${name} ${match[1]}`; break; }
    }
  }
  const platform = data?.platform || nav.platform || "未提供";
  const lines = [
    `浏览器标识：${browser || "未识别，见 UA"}`,
    `平台：${platform}${hints.platformVersion ? `（平台版本 ${hints.platformVersion}）` : ""}`,
  ];
  if (hints.model) lines.push(`设备：${hints.model}`);
  if (/\bwv\b/i.test(nav.userAgent)) lines.push("UA 标记：Android WebView");
  lines.push(`屏幕：${screen.width} × ${screen.height}；视口：${window.innerWidth} × ${window.innerHeight}；像素比：${window.devicePixelRatio}`);
  const features: [string, boolean][] = [
    ["Worker", typeof globalThis.Worker !== "undefined"],
    ["WASM", typeof globalThis.WebAssembly !== "undefined"],
    ["OffscreenCanvas", typeof globalThis.OffscreenCanvas !== "undefined"],
    ["OPFS", typeof nav.storage?.getDirectory === "function"],
    ["AudioWorklet", typeof globalThis.AudioWorkletNode !== "undefined"],
  ];
  lines.push(`游玩接口：${features.map(([name, present]) => `${name} ${present ? "有" : "无"}`).join("；")}`);
  lines.push(`UA：${nav.userAgent}`);
  return lines.join("\n");
}
