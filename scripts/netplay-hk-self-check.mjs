#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve4, resolve6 } from "node:dns/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { parseArgs } from "node:util";

const { values } = parseArgs({ options: {
  service: { type: "string", default: "viprpg-netplay-production" },
  origin: { type: "string", default: "https://netplay-hk.viprpg.org" },
  "coturn-config": { type: "string", default: "/etc/turnserver.conf" },
  help: { type: "boolean" },
} });
if (values.help) {
  console.log("sudo node netplay-hk-self-check.mjs [--service viprpg-netplay-production] [--origin https://netplay-hk.viprpg.org] [--coturn-config /etc/turnserver.conf]");
  console.log("只读检查服务、实际进程配置、DNS、HTTP、监听端口、TURN 密钥一致性和近期选线日志；不输出密钥，不重启或修改服务。");
  process.exit(0);
}
if (process.platform !== "linux") throw new Error("请在香港 Linux VPS 上执行此命令。");
if (!/^[a-zA-Z0-9@_.-]+$/.test(values.service)) throw new Error("无效的 systemd 服务名。");
const origin = new URL(values.origin);
if (origin.protocol !== "https:" || origin.username || origin.password || origin.search || origin.hash || origin.pathname !== "/") {
  throw new Error("origin 必须是无路径和凭据的 HTTPS 站点地址。");
}
let failed = 0;
const check = async (name, action) => {
  try {
    console.log(JSON.stringify({ check: name, ok: true, ...await action() }));
  } catch (error) {
    failed++;
    console.log(JSON.stringify({ check: name, ok: false, error: error.message }));
  }
};
const command = (program, args) => {
  const result = spawnSync(program, args, { encoding: "utf8", timeout: 10_000, maxBuffer: 2_000_000 });
  if (result.error || result.status !== 0) throw new Error(`${program} 检查失败，退出状态 ${result.status ?? result.error.code}`);
  return result.stdout.trim();
};
let environment, localHealth;
await check("service", () => {
  const status = Object.fromEntries(command("systemctl", ["show", values.service,
    "--property=ActiveState,SubState,MainPID", "--no-pager"]).split("\n").map(line => line.split("=")));
  if (status.ActiveState !== "active" || !/^[1-9]\d*$/.test(status.MainPID ?? "")) throw new Error("联机服务未运行。");
  environment = Object.fromEntries(readFileSync(`/proc/${status.MainPID}/environ`, "utf8").split("\0").filter(Boolean)
    .map(item => [item.slice(0, item.indexOf("=")), item.slice(item.indexOf("=") + 1)]));
  return { ...status, port: environment.NETPLAY_PORT ?? "8787", siteOrigin: environment.NETPLAY_SITE_ORIGIN ?? "https://staging.viprpg.org",
    turnHost: environment.NETPLAY_TURN_HOST ?? "netplay-hk-staging.viprpg.org",
    spacePaths: [environment.NETPLAY_ARCHIVE_VERSION, environment.NETPLAY_NEXT_SPACE_PATH].filter(Boolean),
    identityKeyConfigured: Boolean(environment.NETPLAY_HK_IDENTITY_KEY), turnKeyConfigured: Boolean(environment.NETPLAY_HK_TURN_SECRET) };
});
await check("websocket_library", () => {
  const require = createRequire(import.meta.url);
  const version = require("ws/package.json").version;
  const implementation = readFileSync(join(dirname(require.resolve("ws")), "lib/websocket.js"), "utf8");
  return { version, disablesNagle: /socket\.setNoDelay\(/.test(implementation) };
});
await check("local_health", async () => {
  if (!environment) throw new Error("无法读取服务进程配置；请使用 sudo。");
  const port = Number(environment.NETPLAY_PORT ?? 8787);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("联机监听端口无效。");
  const response = await fetch(`http://127.0.0.1:${port}/healthz`, { signal: AbortSignal.timeout(5000), redirect: "error" });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  localHealth = await response.json();
  if (!localHealth.ok || !localHealth.turnUdp) throw new Error("本机健康接口未报告可用的 TURN 配置。");
  return localHealth;
});
await check("public_health", async () => {
  const response = await fetch(new URL("/healthz", origin), { signal: AbortSignal.timeout(8000), redirect: "error" });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const health = await response.json();
  if (!health.ok || !localHealth || JSON.stringify(health.spacePathIds) !== JSON.stringify(localHealth.spacePathIds)) {
    throw new Error("公网与本机联机空间不一致，或本机健康检查未通过。");
  }
  return { ...health, server: response.headers.get("server"), cloudflareRayPresent: response.headers.has("cf-ray") };
});
await check("dns", async () => {
  if (!environment) throw new Error("缺少服务进程配置。");
  const hosts = [...new Set([origin.hostname, environment.NETPLAY_TURN_HOST ?? "netplay-hk-staging.viprpg.org"])];
  const addresses = [];
  for (const host of hosts) {
    const [ipv4, ipv6] = await Promise.allSettled([resolve4(host), resolve6(host)]);
    const row = { host, ipv4: ipv4.status === "fulfilled" ? ipv4.value : [], ipv6: ipv6.status === "fulfilled" ? ipv6.value : [] };
    if (!row.ipv4.length && !row.ipv6.length) throw new Error(`${host} 没有可解析的地址。`);
    addresses.push(row);
  }
  return { addresses, note: "DNS 地址和响应头不能单独证明 Cloudflare 灰云配置；需在 DNS 控制台核对。" };
});
await check("caddy_and_coturn", () => ({ states: command("systemctl", ["is-active", "caddy", "coturn"]).split("\n") }));
await check("listeners", () => {
  const sockets = command("ss", ["-H", "-lntu"]).split("\n");
  const udp = sockets.filter(line => line.startsWith("udp"));
  const ports = [3478, 443].map(port => ({ port, udpListening: udp.some(line => new RegExp(`:${port}\\s`).test(line)) }));
  if (ports.some(port => !port.udpListening)) throw new Error(`未监听 UDP ${ports.filter(port => !port.udpListening).map(port => port.port).join(", ")}`);
  return { ports, sockets: sockets.filter(line => /:(3478|443|8787|8788)\s/.test(line)) };
});
await check("turn_configuration", () => {
  const turnConfig = readFileSync(values["coturn-config"], "utf8").split("\n").map(line => line.trim()).filter(line => line && !line.startsWith("#"))
    .map(line => { const split = line.indexOf("="); return split < 0 ? [line, "true"] : [line.slice(0, split).trim(), line.slice(split + 1).trim()]; });
  const secret = turnConfig.find(([key]) => key === "static-auth-secret")?.[1];
  if (!turnConfig.some(([key]) => key === "use-auth-secret")) throw new Error("Coturn 未启用 use-auth-secret。");
  if (!secret || !environment?.NETPLAY_HK_TURN_SECRET || secret !== environment.NETPLAY_HK_TURN_SECRET) {
    throw new Error("联机进程与 Coturn 的共享密钥缺失或不匹配。");
  }
  const allowed = new Set(["listening-port", "tls-listening-port", "alt-listening-port", "aux-server", "listening-ip", "relay-ip",
    "external-ip", "min-port", "max-port", "use-auth-secret", "no-stun", "no-tcp", "no-tcp-relay"]);
  return { sharedSecretMatches: true, settings: turnConfig.filter(([key]) => allowed.has(key)),
    note: "监听与密钥检查不等于外部 TURN Allocate/Relay 连通；还需核对 VPS 产品防火墙的 UDP 3478、443 和中继端口范围。" };
});
await check("recent_routes", () => {
  const lines = command("journalctl", ["-u", values.service, "-n", "500", "-o", "cat", "--no-pager"]).split("\n");
  const routes = [];
  for (const line of lines) {
    if (!line.startsWith('{"event":"netplay_route"') && !line.startsWith('{"event":"netplay_route_probe"')) continue;
    const event = JSON.parse(line);
    if (event.event === "netplay_route_probe" && event.phase !== "select") continue;
    routes.push(event);
  }
  return { events: routes.slice(-10), note: "无近期日志不代表 TURN 失败；探测结果应按双方、同轮 round 对照。" };
});
console.log(JSON.stringify({ failedChecks: failed, changedConfiguration: false }));
process.exitCode = failed ? 1 : 0;
