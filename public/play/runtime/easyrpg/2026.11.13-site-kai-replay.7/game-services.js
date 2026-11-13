/* Website services offered to EasyRPG game scripts. */
self.createEasyRpgGameServices = workId => async (name, input) => {
  if (name !== "netplay.replays") return { data: { error: "unavailable" } };
  const response = await fetch("/api/account/netplay-replays", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...input, workId }),
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) return { data: { error: response.status === 401 ? "sign_in" : "unavailable" } };
  const data = await response.json();
  const players = data.players ?? (data.entries ?? []).flatMap(entry => entry.players);
  return { data, avatars: players.map(player => player.avatar) };
};
