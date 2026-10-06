CREATE TABLE audit_daily_reports (
  report_date TEXT PRIMARY KEY,
  status TEXT NOT NULL CHECK(status IN ('complete','incomplete','failed')),
  summary_json TEXT CHECK(summary_json IS NULL OR json_valid(summary_json)),
  generated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_auth_audit_logs_created_at_id ON auth_audit_logs(datetime(created_at),id);
