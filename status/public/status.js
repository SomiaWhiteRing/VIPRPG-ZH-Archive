const zone = "Asia/Shanghai";
const stamp = new Intl.DateTimeFormat("zh-CN", {
  timeZone: zone,
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = String(text);
  return node;
}

function dayKey(date) {
  return new Date(date.getTime() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function datesForThirtyDays() {
  const today = dayKey(new Date());
  const end = Date.parse(`${today}T00:00:00Z`);
  return Array.from({ length: 30 }, (_, index) =>
    new Date(end - (29 - index) * 86400000).toISOString().slice(0, 10));
}

function formatDate(iso) {
  return iso ? `${stamp.format(new Date(iso))}（北京时间）` : "尚无记录";
}

function statusOf(state, now) {
  if (!state || Date.parse(state.last_checked_at) < now - 180000) return "pending";
  return state.last_status;
}

function statusLabel(status) {
  return {
    operational: "运行正常",
    degraded: "性能波动",
    outage: "服务中断",
    pending: "暂无近期数据",
  }[status];
}

function renderOverall(data, stateMap) {
  const now = Date.now();
  const statuses = data.monitors.map((monitor) => statusOf(stateMap.get(monitor.id), now));
  const overall = statuses.includes("outage") ? "outage"
    : statuses.includes("degraded") ? "degraded"
      : statuses.includes("pending") ? "pending" : "operational";
  const panel = document.getElementById("overall");
  panel.className = `overall ${overall}`;
  panel.querySelector(".overall-icon").textContent = {
    operational: "✓", degraded: "!", outage: "!", pending: "…",
  }[overall];
  document.getElementById("overall-title").textContent = {
    operational: "所有系统运行正常",
    degraded: "部分服务出现波动",
    outage: "部分服务发生中断",
    pending: "监控数据暂不可用",
  }[overall];
  document.getElementById("overall-description").textContent = {
    operational: "各项关键服务均可正常访问。",
    degraded: "有服务检查失败，正在继续确认。",
    outage: "有服务连续检查失败，请查看下方详情。",
    pending: "最近三分钟没有完整检查记录，请稍后刷新。",
  }[overall];
  const latest = [...stateMap.values()].map((s) => s.last_checked_at).sort().at(-1);
  document.getElementById("last-check").textContent = formatDate(latest);
}

function renderServices(data, stateMap) {
  const container = document.getElementById("service-groups");
  container.replaceChildren();
  const days = datesForThirtyDays();
  const groups = [...new Set(data.monitors.map((monitor) => monitor.group))];
  const dayMap = new Map(data.days.map((day) => [`${day.monitor_id}:${day.day_bjt}`, day]));
  for (const group of groups) {
    const section = el("section", "service-group");
    section.append(el("h3", "group-title", group));
    for (const monitor of data.monitors.filter((item) => item.group === group)) {
      const state = stateMap.get(monitor.id);
      const current = statusOf(state, Date.now());
      const card = el("article", "service-card");
      const main = el("div", "service-main");
      const title = el("div");
      title.append(el("div", "service-name", monitor.name));
      title.append(el("div", "service-description", monitor.description));
      main.append(title, el("span", `service-status ${current}`, statusLabel(current)));
      const history = el("div", "history");
      history.setAttribute("aria-label", `${monitor.name}近 30 天检查记录`);
      let total = 0;
      let successful = 0;
      for (const day of days) {
        const record = dayMap.get(`${monitor.id}:${day}`);
        const kind = !record ? "unknown" : Number(record.successful) === 0 ? "outage"
          : Number(record.successful) === Number(record.checks) ? "good" : "degraded";
        const cell = el("span", `history-day ${kind}`);
        cell.title = `${day}（北京时间）：${record ? `${record.successful}/${record.checks} 次成功` : "无检查记录"}`;
        history.append(cell);
        if (record) {
          total += Number(record.checks);
          successful += Number(record.successful);
        }
      }
      const meta = el("div", "service-meta");
      const uptime = total ? `${(100 * successful / total).toFixed(2)}%` : "—";
      meta.append(el("span", "", `近 30 天可用率 ${uptime}`));
      const recent = data.recent.find((item) => item.monitor_id === monitor.id && item.success === 1);
      meta.append(el("span", "", recent ? `最近响应 ${recent.latency_ms} ms` :
        state?.latency_ms != null ? `最近响应 ${state.latency_ms} ms` : "尚无响应记录"));
      card.append(main, history, meta);
      section.append(card);
    }
    container.append(section);
  }
}

function renderIncidents(data) {
  const container = document.getElementById("incident-list");
  container.replaceChildren();
  if (!data.incidents.length) {
    const empty = el("div", "empty-incidents");
    empty.append(el("span", "empty-icon", "✓"));
    const body = el("div");
    body.append(el("strong", "", "近期没有服务中断事件"));
    body.append(el("p", "", "服务检查结果会在这里自动形成事件记录。"));
    empty.append(body);
    container.append(empty);
    return;
  }
  const names = new Map(data.monitors.map((monitor) => [monitor.id, monitor.name]));
  for (const incident of data.incidents) {
    const card = el("article", `incident-card ${incident.resolved_at ? "resolved" : ""}`);
    const heading = el("div", "incident-heading");
    heading.append(el("span", "", names.get(incident.monitor_id) || "服务事件"));
    heading.append(el("span", "incident-time", incident.resolved_at ? "已恢复" : "处理中"));
    card.append(heading);
    card.append(el("p", "", incident.summary));
    card.append(el("p", "", `${formatDate(incident.started_at)} 开始${incident.resolved_at ? ` · ${formatDate(incident.resolved_at)} 恢复` : ""}`));
    container.append(card);
  }
}

async function refresh() {
  try {
    const response = await fetch("/api/status", { cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    if (!Array.isArray(data.monitors)) throw new Error("Invalid response");
    const states = new Map(data.states.map((state) => [state.monitor_id, state]));
    renderOverall(data, states);
    renderServices(data, states);
    renderIncidents(data);
  } catch {
    const overall = document.getElementById("overall");
    overall.className = "overall pending";
    overall.querySelector(".overall-icon").textContent = "…";
    document.getElementById("overall-title").textContent = "状态数据暂不可用";
    document.getElementById("overall-description").textContent = "状态服务无法读取检查记录，请稍后刷新。";
    document.getElementById("last-check").textContent = "—";
  }
}

refresh();
setInterval(refresh, 60000);
