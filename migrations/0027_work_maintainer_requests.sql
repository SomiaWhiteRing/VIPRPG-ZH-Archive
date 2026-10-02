CREATE TABLE work_maintainer_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  work_id INTEGER NOT NULL REFERENCES works(id) ON DELETE CASCADE,
  applicant_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK(status IN ('pending','approved','rejected','withdrawn','closed')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  resolved_at TEXT,
  resolved_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  submission_key TEXT NOT NULL UNIQUE,
  resolution_key TEXT UNIQUE
);
CREATE UNIQUE INDEX idx_work_maintainer_request_pending
  ON work_maintainer_requests(work_id,applicant_user_id) WHERE status='pending';
CREATE INDEX idx_work_maintainer_request_applicant
  ON work_maintainer_requests(applicant_user_id,created_at DESC);
CREATE INDEX idx_work_maintainer_request_work
  ON work_maintainer_requests(work_id,status,id);
ALTER TABLE inbox_items ADD COLUMN work_maintainer_request_id INTEGER
  REFERENCES work_maintainer_requests(id) ON DELETE CASCADE;
CREATE UNIQUE INDEX idx_inbox_work_maintainer_request
  ON inbox_items(work_maintainer_request_id) WHERE work_maintainer_request_id IS NOT NULL;
CREATE INDEX idx_inbox_maintainer_digest ON inbox_items(recipient_user_id,created_at DESC)
  WHERE json_extract(metadata_json,'$.kind')='work_maintainer_digest';

-- Lifecycle changes must also close requests made through another API or a merge.
CREATE TRIGGER close_deleted_work_maintainer_requests AFTER UPDATE OF status ON works
WHEN NEW.status='deleted' AND OLD.status<>'deleted'
BEGIN
  UPDATE work_maintainer_requests SET status='closed',resolved_at=CURRENT_TIMESTAMP
  WHERE work_id=NEW.id AND status='pending';
END;
CREATE TRIGGER close_inactive_applicant_requests AFTER UPDATE OF status ON users
WHEN NEW.status<>'active'
BEGIN
  UPDATE work_maintainer_requests SET status='closed',resolved_at=CURRENT_TIMESTAMP
  WHERE applicant_user_id=NEW.id AND status='pending';
END;
CREATE TRIGGER sync_work_maintainer_request_inbox AFTER UPDATE OF status ON work_maintainer_requests
BEGIN
  UPDATE inbox_items SET status=CASE WHEN NEW.status IN ('approved','rejected') THEN NEW.status ELSE 'archived' END,
    resolved_at=NEW.resolved_at,resolved_by_user_id=NEW.resolved_by_user_id,
    metadata_json=json_set(COALESCE(metadata_json,'{}'),'$.closedReason',
      CASE NEW.status WHEN 'withdrawn' THEN '申请人已撤回申请。' WHEN 'closed' THEN '作品或申请账户已不可用，申请已关闭。' ELSE NULL END)
  WHERE work_maintainer_request_id=NEW.id;
END;
