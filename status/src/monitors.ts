export type Monitor = {
  id: string;
  name: string;
  description: string;
  group: string;
  url: string;
  kind: "html" | "health";
  dependency?: string;
};

// New production IDs preserve the meaning of existing staging history.
const staging = "https://staging.viprpg.org";

export const monitors: readonly Monitor[] = [
  {
    id: "production-web", name: "档案站网页", description: "正式站首页可访问并正确返回站点内容",
    group: "正式站", url: "https://viprpg.org/", kind: "html",
  },
  {
    id: "production-worker", name: "应用 API", description: "正式站 Cloudflare Worker 健康接口",
    group: "正式站", url: "https://viprpg.org/api/health", kind: "health",
  },
  {
    id: "production-d1", name: "数据库", description: "正式站 D1 查询可正常执行",
    group: "正式站", url: "https://viprpg.org/api/health/db", kind: "health", dependency: "database",
  },
  {
    id: "production-r2", name: "对象存储", description: "正式站 R2 对象读取接口可用",
    group: "正式站", url: "https://viprpg.org/api/health/r2", kind: "health", dependency: "object-storage",
  },
  {
    id: "staging-web",
    name: "档案站网页",
    description: "首页可访问并正确返回站点内容",
    group: "预生产站",
    url: `${staging}/`,
    kind: "html",
  },
  {
    id: "staging-worker",
    name: "应用 API",
    description: "Cloudflare Worker 健康接口",
    group: "预生产站",
    url: `${staging}/api/health`,
    kind: "health",
  },
  {
    id: "staging-d1",
    name: "数据库",
    description: "D1 查询可正常执行",
    group: "预生产站",
    url: `${staging}/api/health/db`,
    kind: "health",
    dependency: "database",
  },
  {
    id: "staging-r2",
    name: "对象存储",
    description: "R2 对象读取接口可用",
    group: "预生产站",
    url: `${staging}/api/health/r2`,
    kind: "health",
    dependency: "object-storage",
  },
];
