export const recoveryWindowMs = 30 * 60_000;

export type Incident = {
  id: number;
  monitor_id: string;
  started_at: string;
  resolved_at: string | null;
  summary: string;
};

export type IncidentState = { monitor_id: string; last_checked_at: string };

export type IncidentGroup = {
  id: number;
  monitor_id: string;
  started_at: string;
  last_recovered_at: string | null;
  monitoring_until: string | null;
  phase: "outage" | "monitoring" | "resolved";
  downtime_ms: number;
  span_ms: number;
  episodes: Incident[];
};

// Group the recorded interruption intervals without rewriting monitoring history.
// A single successful probe starts observation; a recurrence within 30 minutes
// belongs to the same incident, even when its HTTP error text changes.
export function groupIncidents(
  incidents: readonly Incident[], states: readonly IncidentState[], now: number,
): IncidentGroup[] {
  const groups: { episodes: Incident[]; end: number | null }[] = [];
  const latest = new Map<string, (typeof groups)[number]>();
  for (const incident of [...incidents].sort((a, b) => a.started_at.localeCompare(b.started_at) || a.id - b.id)) {
    let group = latest.get(incident.monitor_id);
    const start = Date.parse(incident.started_at);
    const end = incident.resolved_at ? Date.parse(incident.resolved_at) : null;
    if (!group || (group.end !== null && start > group.end + recoveryWindowMs)) {
      group = { episodes: [incident], end };
      groups.push(group);
      latest.set(incident.monitor_id, group);
    } else {
      group.episodes.push(incident);
      group.end = group.end === null || end === null ? null : Math.max(group.end, end);
    }
  }

  const checkedAt = new Map(states.map((state) => [state.monitor_id, Date.parse(state.last_checked_at)]));
  return groups.map((group): IncidentGroup => {
    const first = group.episodes[0];
    const start = Date.parse(first.started_at);
    const until = group.end === null ? null : group.end + recoveryWindowMs;
    // Time alone cannot confirm recovery when scheduled probes have stopped.
    const observing = until !== null && (now < until ||
      (latest.get(first.monitor_id) === group && (checkedAt.get(first.monitor_id) ?? 0) < until));
    let coveredUntil = start;
    let downtime = 0;
    for (const episode of group.episodes) {
      const end = Math.min(now, episode.resolved_at ? Date.parse(episode.resolved_at) : now);
      downtime += Math.max(0, end - Math.max(coveredUntil, Date.parse(episode.started_at)));
      coveredUntil = Math.max(coveredUntil, end);
    }
    return {
      id: first.id, monitor_id: first.monitor_id, started_at: first.started_at,
      last_recovered_at: group.end === null ? null : new Date(group.end).toISOString(),
      monitoring_until: until === null ? null : new Date(until).toISOString(),
      phase: group.end === null ? "outage" : observing ? "monitoring" : "resolved",
      downtime_ms: downtime,
      span_ms: Math.max(0, Math.min(now, group.end ?? now) - start),
      episodes: group.episodes,
    };
  }).sort((a, b) => Number(a.phase === "resolved") - Number(b.phase === "resolved") ||
    b.started_at.localeCompare(a.started_at) || b.id - a.id);
}
