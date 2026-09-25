CREATE TABLE monitor_state (
  monitor_id TEXT PRIMARY KEY,
  last_status TEXT NOT NULL CHECK (last_status IN ('operational', 'degraded', 'outage')),
  consecutive_failures INTEGER NOT NULL DEFAULT 0,
  last_checked_at TEXT NOT NULL,
  last_success_at TEXT,
  latency_ms INTEGER,
  last_error TEXT
);

CREATE TABLE check_results (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  monitor_id TEXT NOT NULL,
  checked_at TEXT NOT NULL,
  success INTEGER NOT NULL CHECK (success IN (0, 1)),
  latency_ms INTEGER NOT NULL,
  error TEXT,
  UNIQUE (monitor_id, checked_at)
);

CREATE INDEX check_results_checked_at_idx ON check_results (checked_at);
CREATE INDEX check_results_monitor_time_idx ON check_results (monitor_id, checked_at DESC);

CREATE TABLE daily_rollups (
  monitor_id TEXT NOT NULL,
  day_bjt TEXT NOT NULL,
  checks INTEGER NOT NULL DEFAULT 0,
  successful INTEGER NOT NULL DEFAULT 0,
  latency_sum_ms INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (monitor_id, day_bjt)
);

CREATE TABLE incidents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  monitor_id TEXT NOT NULL,
  started_at TEXT NOT NULL,
  resolved_at TEXT,
  summary TEXT NOT NULL
);

CREATE INDEX incidents_started_at_idx ON incidents (started_at DESC);
CREATE INDEX incidents_open_idx ON incidents (monitor_id, resolved_at);
