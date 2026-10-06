-- Forum edit/delete audit entries have exactly one normalized target.
-- The partial predicate also keeps malformed legacy detail out of the index.
CREATE INDEX idx_auth_audit_logs_forum_target
  ON auth_audit_logs (
    json_extract(detail_json, '$.targets[0].type'),
    CAST(json_extract(detail_json, '$.targets[0].id') AS TEXT),
    id DESC
  )
  WHERE event_type IN ('forum_edit','forum_delete') AND json_valid(detail_json);
