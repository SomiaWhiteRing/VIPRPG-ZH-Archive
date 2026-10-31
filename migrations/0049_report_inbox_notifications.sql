-- One shared inbox item per report; read state remains individual to each moderator.
CREATE TRIGGER forum_report_inbox_insert AFTER INSERT ON forum_content_reports
WHEN NEW.status='pending'
BEGIN
  INSERT INTO inbox_items(type,status,required_permission_key,title,body,metadata_json,created_at,event_key)
  VALUES('system_notice','pending','forum.content.moderate_any','收到讨论版举报',NEW.reason,
    json_object('reportKind','forum','reportId',NEW.id),NEW.created_at,'forum_report:' || NEW.id);
END;

CREATE TRIGGER message_report_inbox_insert AFTER INSERT ON direct_message_reports
WHEN NEW.status='pending'
BEGIN
  INSERT INTO inbox_items(type,status,required_permission_key,title,body,metadata_json,created_at,event_key)
  VALUES('system_notice','pending','forum.content.moderate_any','收到私信举报',NEW.reason,
    json_object('reportKind','message','reportId',NEW.id),NEW.created_at,'message_report:' || NEW.id);
END;

CREATE TRIGGER forum_report_inbox_resolve AFTER UPDATE OF status ON forum_content_reports
WHEN NEW.status<>'pending'
BEGIN
  UPDATE inbox_items SET status='archived',resolved_by_user_id=NEW.resolved_by,resolved_at=NEW.resolved_at
  WHERE event_key='forum_report:' || NEW.id;
END;

CREATE TRIGGER message_report_inbox_resolve AFTER UPDATE OF status ON direct_message_reports
WHEN NEW.status<>'pending'
BEGIN
  UPDATE inbox_items SET status='archived',resolved_by_user_id=NEW.resolved_by,resolved_at=NEW.resolved_at
  WHERE event_key='message_report:' || NEW.id;
END;

INSERT INTO inbox_items(type,status,required_permission_key,title,body,metadata_json,created_at,event_key)
SELECT 'system_notice','pending','forum.content.moderate_any','收到讨论版举报',reason,
  json_object('reportKind','forum','reportId',id),created_at,'forum_report:' || id
FROM forum_content_reports WHERE status='pending';

INSERT INTO inbox_items(type,status,required_permission_key,title,body,metadata_json,created_at,event_key)
SELECT 'system_notice','pending','forum.content.moderate_any','收到私信举报',reason,
  json_object('reportKind','message','reportId',id),created_at,'message_report:' || id
FROM direct_message_reports WHERE status='pending';
