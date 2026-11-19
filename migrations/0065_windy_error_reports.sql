CREATE TABLE windy_error_groups (
  kind TEXT PRIMARY KEY,
  occurrences INTEGER NOT NULL DEFAULT 0,
  samples INTEGER NOT NULL DEFAULT 0,
  first_seen TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_seen TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  fixed_build INTEGER,
  generation INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE windy_error_reports (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL REFERENCES windy_error_groups(kind),
  version TEXT NOT NULL,
  build_number INTEGER NOT NULL,
  occurrences INTEGER NOT NULL,
  received_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX windy_reports_by_kind ON windy_error_reports(kind, received_at DESC, id);
CREATE TRIGGER windy_report_received AFTER INSERT ON windy_error_reports
BEGIN
  UPDATE windy_error_groups SET
    samples=samples+1, occurrences=occurrences+NEW.occurrences, last_seen=CURRENT_TIMESTAMP,
    generation=generation+iif(NEW.build_number>=fixed_build,1,0),
    fixed_build=iif(NEW.build_number>=fixed_build,NULL,fixed_build)
  WHERE kind=NEW.kind;
  INSERT INTO inbox_items(type,recipient_user_id,title,body,event_key,metadata_json)
    SELECT 'system_notice',ur.user_id,'温蒂翻译器出现新的报错类型','',
      'windy-error:' || g.kind || ':' || g.generation,json_object('windyErrorKind',g.kind)
    FROM windy_error_groups g CROSS JOIN user_roles ur JOIN roles r ON r.id=ur.role_id
    WHERE g.kind=NEW.kind AND r.kind='bootstrap_admin'
      AND NOT EXISTS (SELECT 1 FROM inbox_items WHERE event_key='windy-error:' || g.kind || ':' || g.generation);
END;
