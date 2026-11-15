/* Website services offered to EasyRPG game scripts. */
self.createEasyRpgGameServices = workId => {
  const lists = new Map(), details = new Map(), recordings = new Map(), pending = new Map();
  const favoriteChanges = new Map();
  const lifetime = 60_000, frameBudget = 8 * 1024 * 1024;
  let accountId, listSequence = 0;
  const groupKey = input => input.favorites ? "favorites" : input.scope ?? "legacy";
  const clear = () => {
    for (const cache of lists.values()) cache.invalid = true;
    lists.clear(); details.clear(); recordings.clear(); favoriteChanges.clear();
  };
  async function fetchReplay(input) {
    const response = await fetch("/api/account/netplay-replays", {
      method: "POST", credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...input, workId }), signal: AbortSignal.timeout(10000),
      priority: input.priority ?? "auto",
    });
    if (!response.ok) {
      if (response.status === 401) { accountId = undefined; clear(); }
      return { error: response.status === 401 ? "sign_in" : "unavailable" };
    }
    const data = await response.json();
    if (accountId !== undefined && accountId !== data.accountId) clear();
    accountId = data.accountId;
    return data;
  }
  function once(key, load) {
    if (!pending.has(key)) {
      const promise = load().finally(() => {
        if (pending.get(key) === promise) pending.delete(key);
      });
      pending.set(key, promise);
    }
    return pending.get(key);
  }
  function remember(entry, at = Date.now()) {
    if (favoriteChanges.has(entry.id)) entry.favorite = favoriteChanges.get(entry.id);
    const previous = details.get(entry.id)?.data;
    if (previous && previous.revision !== entry.revision) recordings.delete(entry.id);
    details.delete(entry.id);
    details.set(entry.id, { data: entry, at });
    while (details.size > 90) details.delete(details.keys().next().value);
  }
  async function list(input, prefetch = false) {
    const group = groupKey(input), page = input.page;
    if (!lists.has(group)) lists.set(group, { pages: new Map(), selected: page, id: ++listSequence });
    const cache = lists.get(group);
    if (!prefetch) cache.selected = page;
    if (cache.pages.has(page)) return cache.pages.get(page).data;
    const first = Math.floor(page / 3) * 3;
    const result = await once(`list:${group}:${cache.id}:${first}`, async () => {
      const data = await fetchReplay({ ...input, operation: "list", page: first, pageCount: 3,
        snapshot: cache.snapshot, priority: prefetch ? "low" : "auto" });
      if (data.error) return data;
      if (cache.invalid) return { error: "unavailable" };
      cache.snapshot = data.snapshot;
      const at = Date.now();
      for (let offset = 0; offset < 3; offset++) {
        const number = first + offset;
        const entries = data.entries.slice(offset * 5, offset * 5 + 5);
        entries.forEach(entry => remember(entry, at));
        cache.pages.set(number, { at, data: { entries, pages: data.pages, more: number + 1 < data.pages } });
      }
      while (cache.pages.size > 6) {
        const blocks = [...new Set([...cache.pages.keys()].map(page => Math.floor(page / 3)))];
        const farthest = blocks.sort((a, b) =>
          Math.abs(b * 3 + 1 - cache.selected) - Math.abs(a * 3 + 1 - cache.selected))[0];
        for (let offset = 0; offset < 3; offset++) cache.pages.delete(farthest * 3 + offset);
      }
      return data;
    });
    if (result.error) return result;
    return cache.pages.get(page)?.data ?? { entries: result.entries.slice((page - first) * 5, (page - first + 1) * 5),
      pages: result.pages, more: page + 1 < result.pages };
  }
  async function detail(id) {
    const cached = details.get(id)?.data;
    if (cached?.start) return { ...cached, version: 1 };
    return once(`detail:${id}`, async () => {
      const data = await fetchReplay({ operation: "detail", id });
      if (!data.error) remember(data);
      return data;
    });
  }
  async function frames(id, prefetch = false) {
    const summary = details.get(id)?.data;
    const cached = recordings.get(id);
    if (cached && (!summary || cached.revision === summary.revision)) {
      recordings.delete(id); recordings.set(id, cached);
      return { ...cached, ...summary, version: cached.version, start: cached.start, frames: cached.frames };
    }
    return once(`frames:${id}:${summary?.revision ?? ""}`, async () => {
      const data = await fetchReplay({ operation: "frames", id, priority: prefetch ? "low" : "auto" });
      if (data.error) return data;
      const { frames: inputs, ...entry } = data;
      remember(entry);
      recordings.delete(id); recordings.set(id, { ...data, ...entry });
      let bytes = 0;
      for (const recording of recordings.values())
        bytes += recording.frames.length * 8 + (recording.start.variables?.length ?? 0) * 16;
      while (recordings.size > 2 || bytes > frameBudget) {
        const key = recordings.keys().next().value, recording = recordings.get(key);
        bytes -= recording.frames.length * 8 + (recording.start.variables?.length ?? 0) * 16;
        recordings.delete(key);
      }
      return { ...data, ...entry, frames: inputs };
    });
  }
  return async (name, input) => {
    if (name !== "netplay.replays") return { data: { error: "unavailable" } };
    let data;
    if (input.operation === "available") {
      data = await once("available", () => fetchReplay(input));
      // Revalidate the account before serving cached personal data on room entry.
      if (!data.error) {
        favoriteChanges.clear();
        const now = Date.now();
        for (const [key, cache] of lists)
          if ([...cache.pages.values()].some(page => now - page.at >= lifetime)) {
            cache.invalid = true;
            lists.delete(key);
          }
        for (const [id, value] of details) if (now - value.at >= lifetime) details.delete(id);
      }
    } else if (input.operation === "list") data = await list(input);
    else if (input.operation === "detail") data = await detail(input.id);
    else if (input.operation === "frames") data = await frames(input.id);
    else if (input.operation === "prefetch") {
      const result = input.target === "list" ? await list(input, true) : await frames(input.id, true);
      data = result.error ? result : { prefetched: true };
    } else if (input.operation === "favorite") {
      data = await fetchReplay(input);
      if (!data.error) {
        favoriteChanges.set(input.id, data.favorite);
        for (const cache of lists.values()) for (const page of cache.pages.values())
          for (const entry of page.data.entries) if (entry.id === input.id) entry.favorite = data.favorite;
        const entry = details.get(input.id)?.data;
        if (entry) entry.favorite = data.favorite;
        const recording = recordings.get(input.id);
        if (recording) recording.favorite = data.favorite;
        const favorites = lists.get("favorites");
        if (favorites) favorites.invalid = true;
        lists.delete("favorites");
      }
    } else data = { error: "unavailable" };
    const players = data.players ?? (data.entries ?? []).flatMap(entry => entry.players);
    return { data, avatars: players.map(player => player.avatar) };
  };
};
