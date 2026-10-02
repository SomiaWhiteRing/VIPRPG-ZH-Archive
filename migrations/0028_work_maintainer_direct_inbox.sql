-- Application rows now appear directly in every applicable inbox category.
-- Carry existing read receipts over before removing redundant summary notices.
INSERT OR IGNORE INTO inbox_item_reads(item_id,user_id,read_at)
SELECT request_item.id,summary.recipient_user_id,receipt.read_at
FROM inbox_items summary
JOIN inbox_item_reads receipt ON receipt.item_id=summary.id AND receipt.user_id=summary.recipient_user_id
JOIN inbox_items request_item ON summary.event_key=
  'work-maintainer-digest:'||summary.recipient_user_id||':'||request_item.work_maintainer_request_id
WHERE json_extract(summary.metadata_json,'$.kind')='work_maintainer_digest';

DELETE FROM inbox_items WHERE json_extract(metadata_json,'$.kind')='work_maintainer_digest';
DROP INDEX idx_inbox_maintainer_digest;
