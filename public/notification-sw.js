self.addEventListener("install", event => event.waitUntil(self.skipWaiting()));
self.addEventListener("activate", event => event.waitUntil(self.clients.claim()));

// Pushes in a burst share the same notification list; update that list in order.
let pending = Promise.resolve();
self.addEventListener("push", event => {
  let payload;
  try { payload = event.data?.json(); } catch { return; }
  if (!payload || typeof payload.title !== "string" || typeof payload.body !== "string"
    || !Number.isSafeInteger(payload.userId) || !/^(inbox|messages):[1-9]\d*$/.test(payload.id)
    || !["inbox", "messages"].includes(payload.group) || !Number.isFinite(payload.timestamp)
    || typeof payload.url !== "string" || !/^\/(?:inbox\/\d+|me\/messages\/\d+)$/.test(payload.url)) return;
  if (payload.timestamp + 86400000 <= Date.now()) return;
  const actions = Array.isArray(payload.actions) ? payload.actions.filter(item =>
    item && typeof item.title === "string" && ["reply", "friend-accept", "friend-ignore"].includes(item.action)
    && (item.action !== "reply" || typeof item.url === "string"
      && /^\/(?:games\/\d+|creators\/\d+|characters\/\d+|catalogs\/\d+|discussions\/\d+|timeline|me\/messages\/\d+)\?/.test(item.url))).slice(0, 2) : [];
  const icon = typeof payload.icon === "string" && /^\/(?:icon\/[A-Za-z0-9_-]+\.png|api\/media\/blobs\/[a-f0-9]{64})$/.test(payload.icon) ? payload.icon : "/icon/windI.png";
  pending = pending.catch(() => {}).then(async () => {
    const prefix = `viprpg:${payload.userId}:${payload.group}:`;
    const groupTag = `${prefix}group`;
    const existing = (await self.registration.getNotifications()).filter(item => item.tag.startsWith(prefix));
    const group = existing.find(item => item.tag === groupTag);
    const ownTag = `${prefix}${payload.id}`;
    const data = { ...payload, actions, url: new URL(payload.url, self.location.origin).href };
    if (group || existing.filter(item => item.tag !== ownTag).length >= 5) {
      const entries = new Map();
      for (const notification of existing) {
        for (const entry of notification.data.entries ?? [{ id: notification.data.id, title: notification.title, timestamp: notification.timestamp }]) {
          if (entry.id && entry.timestamp + 86400000 > Date.now()) entries.set(entry.id, entry);
        }
      }
      entries.set(payload.id, { id: payload.id, title: payload.title, timestamp: payload.timestamp });
      const items = [...entries.values()].sort((a, b) => b.timestamp - a.timestamp);
      await self.registration.showNotification(`${items.length} 条${payload.group === "inbox" ? "站内提醒" : "私信"}`, {
        body: items.slice(0, 5).map(item => item.title).join("\n"), icon: "/icon/windI.png", badge: "/icon/windI.png",
        tag: groupTag, timestamp: items[0].timestamp, renotify: false,
        data: { userId: payload.userId, group: payload.group, entries: items, actions: [],
          url: new URL(payload.group === "inbox" ? "/inbox" : "/me/messages", self.location.origin).href },
      });
      for (const notification of existing) if (notification.tag !== groupTag) notification.close();
    } else {
      await self.registration.showNotification(payload.title, { body: payload.body, icon, badge: "/icon/windI.png",
        tag: ownTag, timestamp: payload.timestamp, renotify: false,
        actions: actions.map(({ action, title }) => ({ action, title })), data });
    }
  });
  event.waitUntil(pending);
});

async function openTarget(url) {
  const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
  const target = new URL(url, self.location.origin);
  // Match reply targets to open editors so their current drafts stay active.
  let client = windows.find(window => window.frameType === "top-level" && window.url === target.href);
  const forumReply = /^\/discussions\/[1-9]\d*$/.test(target.pathname) && target.searchParams.has("reply");
  if (forumReply || target.searchParams.has("pushReply")) {
    const base = new URL(target);
    base.searchParams.delete("pushReply"); base.searchParams.delete("inbox"); base.searchParams.sort(); base.hash = "";
    client = windows.find(window => {
      if (window.frameType !== "top-level") return false;
      const current = new URL(window.url);
      if (forumReply) return current.origin === target.origin && current.pathname === target.pathname;
      current.searchParams.delete("pushReply"); current.searchParams.delete("inbox"); current.searchParams.sort(); current.hash = "";
      return current.href === base.href;
    });
    if (client) client.postMessage({ type: "viprpg-push-reply", url: target.href });
  }
  if (client) await client.focus();
  else await self.clients.openWindow(target.href);
}

self.addEventListener("notificationclick", event => {
  event.waitUntil((async () => {
    const data = event.notification.data;
    const action = data.actions?.find(item => item.action === event.action);
    if (action?.action === "friend-accept" || action?.action === "friend-ignore") {
      const id = data.id.split(":")[1];
      try {
        const response = await fetch(`/api/push/inbox/${id}/friend`, { method: "POST", credentials: "include",
          headers: { "Content-Type": "application/json" }, body: JSON.stringify({ userId: data.userId,
            decision: action.action === "friend-accept" ? "accept" : "ignore" }) });
        if (!response.ok) { await openTarget(data.url); return; }
        const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
        for (const client of windows) client.postMessage({ type: "viprpg-inbox-changed" });
      } catch { await openTarget(data.url); return; }
    } else await openTarget(action?.url ?? data.url);
    event.notification.close();
  })());
});
