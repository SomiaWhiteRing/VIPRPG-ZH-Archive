import { scrollElementIntoView } from "./scroll.js";

function updateNavigation() {
  const hash = window.location.hash;
  const selected = hash.startsWith("#incident-") ? "#incidents" : hash || "#services";
  for (const link of document.querySelectorAll('.site-nav a[href^="#"]')) {
    const active = link.getAttribute("href") === selected;
    link.classList.toggle("active", active);
    if (active) link.setAttribute("aria-current", "location");
    else link.removeAttribute("aria-current");
  }
}

for (const link of document.querySelectorAll('.site-nav a[href^="#"]')) {
  link.addEventListener("click", (event) => {
    if (event.defaultPrevented || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    const hash = link.getAttribute("href");
    if (!hash) return;
    const target = document.getElementById(hash.slice(1));
    if (!target) return;
    event.preventDefault();
    if (window.location.hash !== hash) window.history.pushState(window.history.state, "", hash);
    updateNavigation();
    target.focus({ preventScroll: true });
    scrollElementIntoView(target, { behavior: "smooth" });
  });
}
window.addEventListener("hashchange", updateNavigation);
updateNavigation();

const zone = "Asia/Shanghai";
let restoreIncidentAnchor = true;
const stamp = new Intl.DateTimeFormat("zh-CN", {
  timeZone: zone,
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

// Match the outline icon language used by the main site's Lucide icons.
const iconShapes = {
  operational: [["circle", { cx: 12, cy: 12, r: 10 }], ["path", { d: "m8 12 2.5 2.5L16 9" }]],
  degraded: [["path", { d: "m10.3 3.8-8.2 14.3A2 2 0 0 0 3.8 21h16.4a2 2 0 0 0 1.7-2.9L13.7 3.8a2 2 0 0 0-3.4 0Z" }], ["path", { d: "M12 9v4" }], ["path", { d: "M12 17h.01" }]],
  outage: [["circle", { cx: 12, cy: 12, r: 10 }], ["path", { d: "M12 8v4" }], ["path", { d: "M12 16h.01" }]],
  pending: [["circle", { cx: 12, cy: 12, r: 10 }], ["path", { d: "M12 6v6l4 2" }]],
};

function icon(kind) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "2");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.setAttribute("aria-hidden", "true");
  for (const [tag, attributes] of iconShapes[kind === "monitoring" ? "pending" : kind]) {
    const shape = document.createElementNS("http://www.w3.org/2000/svg", tag);
    for (const [key, value] of Object.entries(attributes)) shape.setAttribute(key, value);
    svg.append(shape);
  }
  return svg;
}

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

function statusOf(state, now, intervalSeconds = 60) {
  if (!state || Date.parse(state.last_checked_at) < now - (intervalSeconds + 120) * 1000) return "pending";
  return state.last_status;
}

function statusLabel(status) {
  return {
    operational: "运行正常",
    degraded: "性能波动",
    outage: "服务中断",
    pending: "暂无近期数据",
    monitoring: "恢复观察中",
  }[status];
}

function renderOverall(data, stateMap) {
  const now = Date.now();
  const statuses = data.monitors.map((monitor) => statusOf(stateMap.get(monitor.id), now, monitor.intervalSeconds));
  const overall = statuses.includes("outage") ? "outage"
    : statuses.includes("degraded") ? "degraded"
      : statuses.includes("pending") ? "pending"
        : data.incidentGroups.some((incident) => incident.phase === "monitoring") ? "monitoring" : "operational";
  const panel = document.getElementById("overall");
  panel.className = `overall ${overall}`;
  panel.querySelector(".overall-icon").replaceChildren(icon(overall));
  document.getElementById("overall-title").textContent = {
    operational: "所有系统运行正常",
    degraded: "部分服务出现波动",
    outage: "部分服务发生中断",
    pending: "监控数据暂不可用",
    monitoring: "服务已恢复，持续观察中",
  }[overall];
  document.getElementById("overall-description").textContent = {
    operational: "各项关键服务均可正常访问。",
    degraded: "有服务检查失败，正在继续确认。",
    outage: "有服务连续检查失败，请查看下方详情。",
    pending: "部分服务未在预定检查周期内返回记录，请稍后刷新。",
    monitoring: "近期发生过中断，正在确认恢复是否稳定。",
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
      const currentStatus = statusOf(state, Date.now(), monitor.intervalSeconds);
      const current = currentStatus === "operational" && data.incidentGroups.some((incident) =>
        incident.monitor_id === monitor.id && incident.phase === "monitoring") ? "monitoring" : currentStatus;
      const card = el("article", "service-card");
      const main = el("div", "service-main");
      const title = el("div");
      title.append(el("div", "service-name", monitor.name));
      title.append(el("div", "service-description", monitor.description));
      const badge = el("span", `service-status ${current}`);
      badge.append(icon(current), document.createTextNode(statusLabel(current)));
      main.append(title, badge);
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
        cell.setAttribute("role", "img");
        cell.setAttribute("aria-label", cell.title);
        history.append(cell);
        if (record) {
          total += Number(record.checks);
          successful += Number(record.successful);
        }
      }
      const meta = el("div", "service-meta");
      const uptime = total ? `${(100 * successful / total).toFixed(2)}%` : "—";
      meta.append(el("span", "", `近 30 天检查成功率 ${uptime}`));
      const recent = data.recent.find((item) => item.monitor_id === monitor.id && item.success === 1);
      meta.append(el("span", "", recent ? `最近成功响应 ${recent.latency_ms} ms` : "近一小时无成功响应记录"));
      card.append(main, history, meta);
      const note = el("p", "service-note", `${monitor.intervalSeconds === 60 ? "每分钟检查" : "每 15 分钟检查"} · ${formatDate(state?.last_checked_at)}`);
      if (currentStatus === "outage" || currentStatus === "degraded") {
        note.classList.add("failed");
        note.append(document.createTextNode(` · ${state?.last_error || "检查失败"}`));
      }
      card.append(note);
      section.append(card);
    }
    container.append(section);
  }
}

function duration(milliseconds) {
  const minutes = Math.max(0, Math.floor(milliseconds / 60000));
  if (!minutes) return "不足 1 分钟";
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor(minutes % 1440 / 60);
  const rest = minutes % 60;
  return [days && `${days}\u00a0天`, hours && `${hours}\u00a0小时`, rest && `${rest}\u00a0分钟`].filter(Boolean).join(" ");
}

function incidentSignal(incident, generatedAt) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 1000 12");
  svg.setAttribute("preserveAspectRatio", "none");
  svg.setAttribute("class", "incident-signal");
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", `事件跨度 ${duration(incident.span_ms)}，其中已记录中断 ${duration(incident.downtime_ms)}；红色为中断，绿色为期间恢复时段`);
  const start = Date.parse(incident.started_at);
  const span = Math.max(1, incident.span_ms);
  const rect = (x, width, className) => {
    const node = document.createElementNS(svg.namespaceURI, "rect");
    for (const [key, value] of Object.entries({ x, y: 0, width, height: 12, class: className })) node.setAttribute(key, String(value));
    svg.append(node);
  };
  rect(0, 1000, "signal-recovered");
  for (const episode of incident.episodes) {
    const x = Math.max(0, Math.min(1000, 1000 * (Date.parse(episode.started_at) - start) / span));
    const end = Math.min(Date.parse(generatedAt), Date.parse(episode.resolved_at || generatedAt));
    const width = Math.max(2, 1000 * Math.max(0, end - Date.parse(episode.started_at)) / span);
    rect(x, Math.min(1000 - x, width), "signal-outage");
  }
  return svg;
}

function incidentCard(incident, monitor, data, opened) {
  const card = el("article", `incident-card ${incident.phase}`);
  card.id = `incident-${incident.id}`;
  card.tabIndex = -1;
  const heading = el("div", "incident-heading");
  const title = el("div");
  title.append(el("p", "incident-component", `${monitor?.group || "监控服务"} · ${monitor?.name || incident.monitor_id}`));
  const name = el("h3");
  const permalink = el("a", "", `${monitor?.name || "服务"}${incident.episodes.length > 1 ? "间歇性中断" : "访问异常"}`);
  permalink.href = `#${card.id}`;
  name.append(permalink);
  title.append(name);
  const badge = el("span", `service-status ${incident.phase === "resolved" ? "operational" : incident.phase}`);
  badge.append(icon(incident.phase === "resolved" ? "operational" : incident.phase),
    document.createTextNode({ outage: "监测到中断", monitoring: "恢复观察中", resolved: "已恢复" }[incident.phase]));
  heading.append(title, badge);
  card.append(heading);
  const meta = el("p", "incident-meta");
  meta.append(el("span", "", `首次确认 ${stamp.format(new Date(incident.started_at))}`),
    el("span", "", incident.last_recovered_at ? `最近恢复 ${stamp.format(new Date(incident.last_recovered_at))}` : "中断仍在持续"));
  card.append(meta);
  const stats = el("dl", "incident-stats");
  for (const [label, value] of [["中断次数", `${incident.episodes.length} 次`], ["已记录中断", duration(incident.downtime_ms)], ["事件跨度", duration(incident.span_ms)]]) {
    const item = el("div");
    item.append(el("dt", "", label), el("dd", "", value));
    stats.append(item);
  }
  card.append(stats, incidentSignal(incident, data.generatedAt));
  const axis = el("div", "incident-axis");
  axis.append(el("span", "", stamp.format(new Date(incident.started_at))),
    el("span", "", incident.last_recovered_at ? stamp.format(new Date(incident.last_recovered_at)) : "至今"));
  card.append(axis);
  if (incident.phase === "monitoring") {
    const state = data.states.find((item) => item.monitor_id === incident.monitor_id);
    const fresh = statusOf(state, Date.parse(data.generatedAt), monitor?.intervalSeconds);
    card.append(el("p", "incident-observation", fresh === "pending"
      ? "等待新的检查记录确认恢复是否稳定。"
      : fresh === "degraded" ? "最新探测再次失败，正在确认是否持续中断。"
        : Date.parse(incident.monitoring_until) > Date.parse(data.generatedAt)
          ? `探测已恢复，继续观察至 ${formatDate(incident.monitoring_until)}。`
          : "探测已恢复，等待下一次检查确认稳定。"));
  }
  const details = el("details", "incident-timeline");
  details.id = `incident-records-${incident.id}`;
  details.open = opened.has(details.id);
  const summary = el("summary", "", `查看 ${incident.episodes.length} 次中断与恢复记录`);
  summary.id = `incident-toggle-${incident.id}`;
  details.append(summary);
  const timeline = el("ol", "timeline");
  const updates = incident.episodes.flatMap((episode, index) => [
    { at: episode.started_at, kind: "outage", label: index ? "再次中断" : "确认中断" },
    ...(episode.resolved_at ? [{ at: episode.resolved_at, kind: "operational", label: "探测恢复" }] : []),
  ]).sort((a, b) => b.at.localeCompare(a.at));
  for (const update of updates) {
    const item = el("li", `timeline-entry ${update.kind}`);
    const label = el("strong", "", update.label);
    const time = el("time", "", formatDate(update.at));
    time.dateTime = update.at;
    item.append(label, time);
    timeline.append(item);
  }
  details.append(timeline);
  card.append(details);
  return card;
}

function renderIncidents(data) {
  const opened = new Set([...document.querySelectorAll(".incident-timeline[open]")].map((node) => node.id));
  const focused = document.activeElement?.id;
  const active = document.getElementById("active-incident-list");
  const history = document.getElementById("incident-list");
  active.replaceChildren();
  history.replaceChildren();
  const monitors = new Map(data.monitors.map((monitor) => [monitor.id, monitor]));
  const current = data.incidentGroups.filter((incident) => incident.phase !== "resolved");
  document.getElementById("active-incidents").hidden = !current.length;
  document.getElementById("active-incident-count").textContent = `${current.length} 起事件`;
  document.getElementById("incident-period").textContent = `近 30 天 · 共 ${data.incidentCount} 起事件`;
  document.getElementById("incident-policy").textContent = `同一监控项恢复后 ${data.recoveryWindowSeconds / 60} 分钟内再次中断时合并展示；期间恢复时段以绿色标记。事件按探测时间归并，具体原因需另行确认。`;
  for (const incident of current) active.append(incidentCard(incident, monitors.get(incident.monitor_id), data, opened));
  let previousDay = "";
  for (const incident of data.incidentGroups.filter((item) => item.phase === "resolved")) {
    const day = dayKey(new Date(incident.started_at));
    if (day !== previousDay) {
      history.append(el("h3", "incident-date", `${day}（北京时间）`));
      previousDay = day;
    }
    history.append(incidentCard(incident, monitors.get(incident.monitor_id), data, opened));
  }
  if (!history.children.length) {
    const empty = el("div", "empty-incidents");
    const emptyIcon = el("span", "empty-icon");
    emptyIcon.append(icon("operational"));
    const body = el("div");
    body.append(el("strong", "", current.length ? "正在跟进的事件显示在页面上方" : "近 30 天没有服务中断事件"));
    body.append(el("p", "", current.length ? "恢复稳定后，将归入历史事件。" : "连续检查失败后会自动记录事件。"));
    empty.append(emptyIcon, body);
    history.append(empty);
  }
  if (data.incidentCount > data.incidentGroups.length) history.append(el("p", "incident-policy", `当前展示最近 ${data.incidentGroups.length} 起事件。`));
  if (focused?.startsWith("incident-toggle-")) document.getElementById(focused)?.focus({ preventScroll: true });
  const target = document.getElementById(window.location.hash.slice(1));
  if (restoreIncidentAnchor && target?.classList.contains("incident-card")) scrollElementIntoView(target, { behavior: "auto" });
  restoreIncidentAnchor = false;
}

async function refresh() {
  try {
    const response = await fetch("/api/status", { cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    if (!Array.isArray(data.monitors) || !Array.isArray(data.incidentGroups)) throw new Error("Invalid response");
    const states = new Map(data.states.map((state) => [state.monitor_id, state]));
    renderOverall(data, states);
    renderServices(data, states);
    renderIncidents(data);
  } catch {
    const overall = document.getElementById("overall");
    overall.className = "overall pending";
    overall.querySelector(".overall-icon").replaceChildren(icon("pending"));
    document.getElementById("overall-title").textContent = "状态数据暂不可用";
    document.getElementById("overall-description").textContent = "暂时无法刷新检查记录；下方保留上次获取的数据，请稍后刷新。";
    document.getElementById("last-check").textContent = "—";
  }
}

refresh();
setInterval(refresh, 60000);
