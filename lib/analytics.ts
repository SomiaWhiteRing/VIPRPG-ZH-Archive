/** Public, coarse telemetry only. Never add account identifiers, titles or raw URLs here. */
export type SiteAnalyticsConfig = {
  measurementId: string;
  gatewayPath: string;
  context: { edge_country: string; edge_region: string; network_asn: string };
};

export type InstallMeasurement = {
  outcome: "success" | "error" | "cancel";
  duration_ms: number;
  download_unpack_ms: number | null;
  network_wait_ms: number;
  write_ms: number;
  transferred_bytes: number;
  retry_count: number;
};

const publicPages: Record<string, string> = {
  "/": "首页", "/about": "关于", "/games": "游戏", "/characters": "角色",
  "/creators": "创作者", "/catalogs": "分类", "/discussions": "讨论",
  "/discussions/search": "讨论搜索", "/search": "搜索", "/explore": "探索",
  "/resources": "素材", "/tags": "标签", "/timeline": "动态",
  "/installed": "本地游戏", "/rakuen": "乐园", "/sea": "永恒之海",
  "/material-search": "大镜",
};

export function analyticsPage(pathname: string): string | null {
  if (publicPages[pathname]) return publicPages[pathname];
  const match = /^\/(games|play|characters|creators|catalogs|discussions)\/\d+(?:\/(characters|catalogs|collections|related|relations|works|comments\/\d+|posts\/\d+))?$/.exec(pathname);
  return match ? ({ games: "游戏详情", play: "在线游玩", characters: "角色详情",
    creators: "创作者详情", catalogs: "分类详情", discussions: "讨论详情" })[match[1]] ?? null : null;
}

export function analyticsSizeBucket(bytes: number | null): string {
  if (bytes === null || !Number.isFinite(bytes) || bytes < 0) return "unknown";
  const mib = bytes / 1024 ** 2;
  return mib < 10 ? "lt10MiB" : mib < 50 ? "10-50MiB" : mib < 100 ? "50-100MiB"
    : mib < 300 ? "100-300MiB" : mib < 1024 ? "300-1024MiB" : "ge1GiB";
}

export function analyticsDurationBucket(ms: number): string {
  return ms < 5000 ? "lt5s" : ms < 30000 ? "5-30s" : ms < 120000 ? "30-120s"
    : ms < 600000 ? "2-10min" : "ge10min";
}
