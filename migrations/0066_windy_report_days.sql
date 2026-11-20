ALTER TABLE windy_error_reports ADD COLUMN report_day TEXT;
ALTER TABLE windy_error_reports ADD COLUMN occurred_at TEXT;
ALTER TABLE windy_error_reports ADD COLUMN build_id TEXT;
ALTER TABLE windy_error_reports ADD COLUMN issue_key TEXT;
ALTER TABLE windy_error_reports ADD COLUMN issue_summary TEXT;
CREATE INDEX windy_reports_day ON windy_error_reports(report_day,occurred_at DESC,id);
CREATE INDEX windy_reports_issue_day ON windy_error_reports(issue_key,report_day);
CREATE INDEX windy_reports_build_day ON windy_error_reports(build_id,report_day);

-- Old samples get their exact capture time and build from their private R2 evidence.
-- Only inserts after this migration generate daily notices.
DROP TRIGGER windy_report_received;
CREATE TRIGGER windy_report_received AFTER INSERT ON windy_error_reports
BEGIN
  UPDATE windy_error_groups SET samples=samples+1, occurrences=occurrences+NEW.occurrences,
    last_seen=CURRENT_TIMESTAMP, generation=generation+iif(NEW.build_number>=fixed_build,1,0),
    fixed_build=iif(NEW.build_number>=fixed_build,NULL,fixed_build) WHERE kind=NEW.kind;
  INSERT INTO inbox_items(type,recipient_user_id,title,body,event_key,metadata_json)
    SELECT 'system_notice',ur.user_id,coalesce(NEW.report_day,date(NEW.received_at,'+8 hours')) || ' 温蒂错误报告','',
      'windy-day:' || coalesce(NEW.report_day,date(NEW.received_at,'+8 hours')),
      json_object('windyDay',coalesce(NEW.report_day,date(NEW.received_at,'+8 hours')))
    FROM user_roles ur JOIN roles r ON r.id=ur.role_id WHERE r.kind='bootstrap_admin'
    ON CONFLICT(event_key) DO NOTHING;
  DELETE FROM inbox_item_reads WHERE item_id=(SELECT id FROM inbox_items WHERE event_key='windy-day:' || NEW.report_day)
    AND NEW.issue_key IS NOT NULL AND NOT EXISTS(SELECT 1 FROM windy_error_reports
      WHERE issue_key=NEW.issue_key AND report_day=NEW.report_day AND id<>NEW.id);
END;
