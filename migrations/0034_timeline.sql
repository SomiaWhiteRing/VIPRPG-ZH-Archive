-- Independent timeline permissions. All accounts inherit the base user role;
-- custom grants remain explicit, and per-account blocks override every role.
INSERT INTO role_permissions(role_id,permission_key)
SELECT r.id,p.value FROM roles r,json_each('["timeline.use","timeline.status.create","timeline.status.update_own","timeline.status.delete_own","timeline.event.delete_own","timeline.status.like","timeline.reply.create","timeline.reply.delete_own"]') p
WHERE r.key='user';
INSERT INTO role_permissions(role_id,permission_key)
SELECT r.id,p.value FROM roles r,json_each('["timeline.status.moderate_any","timeline.event.moderate_any","timeline.reply.moderate_any"]') p
WHERE r.key IN ('admin','super_admin');

-- Timeline is opt-in. The master switch gates recording AND visibility; category
-- switches gate future recording. Comments/discussions also gate visibility.
ALTER TABLE users ADD COLUMN timeline_enabled INTEGER NOT NULL DEFAULT 0 CHECK(timeline_enabled IN (0,1));
ALTER TABLE users ADD COLUMN timeline_record_kinds TEXT NOT NULL
  DEFAULT '["favorite","catalog","upload","play","status"]'
  CHECK(json_valid(timeline_record_kinds) AND json_type(timeline_record_kinds)='array');

CREATE TABLE timeline_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK(kind IN ('favorite','catalog','comment','discussion','upload','play','status')),
  action TEXT NOT NULL,
  event_key TEXT NOT NULL UNIQUE,
  work_id INTEGER REFERENCES works(id) ON DELETE CASCADE,
  catalog_id INTEGER REFERENCES catalogs(id) ON DELETE CASCADE,
  comment_id INTEGER REFERENCES comments(id) ON DELETE CASCADE,
  forum_post_id INTEGER REFERENCES forum_posts(id) ON DELETE CASCADE,
  archive_version_id INTEGER REFERENCES archive_versions(id) ON DELETE CASCADE,
  body TEXT,
  request_hash TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  hidden_at TEXT,
  CHECK((kind='status' AND ((hidden_at IS NOT NULL AND body IS NULL) OR (body IS NOT NULL AND length(trim(body)) BETWEEN 1 AND 16000)))
    OR (kind<>'status' AND body IS NULL)),
  CHECK((kind IN ('favorite','upload','play') AND work_id IS NOT NULL)
    OR (kind='catalog' AND catalog_id IS NOT NULL)
    OR (kind='comment' AND comment_id IS NOT NULL)
    OR (kind='discussion' AND forum_post_id IS NOT NULL)
    OR kind='status')
);
CREATE INDEX timeline_events_recent ON timeline_events(created_at DESC,id DESC) WHERE hidden_at IS NULL;
CREATE INDEX timeline_events_user_recent ON timeline_events(user_id,created_at DESC,id DESC) WHERE hidden_at IS NULL;

-- NULL is a legacy suppression marker, not an invented first-play timestamp.
CREATE TABLE user_work_first_plays (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  work_id INTEGER NOT NULL REFERENCES works(id) ON DELETE CASCADE,
  first_observed_at TEXT DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(user_id,work_id)
);
INSERT INTO user_work_first_plays(user_id,work_id,first_observed_at)
SELECT user_id,work_id,NULL FROM user_work_entries WHERE last_played_at IS NOT NULL;

-- An unavailable or blocked recording permission drops only the derived event.
-- Underlying comments, favorites, uploads and first-play markers still succeed.
CREATE TRIGGER timeline_record_permission BEFORE INSERT ON timeline_events
WHEN NOT EXISTS (
  SELECT 1 FROM users u JOIN effective_user_roles ur ON ur.user_id=u.id
  JOIN role_permissions rp ON rp.role_id=ur.role_id AND rp.permission_key='timeline.use'
  WHERE u.id=NEW.user_id AND u.status='active'
    AND NOT EXISTS(SELECT 1 FROM user_permission_blocks b WHERE b.user_id=u.id AND b.permission_key=rp.permission_key)
)
BEGIN
  SELECT RAISE(IGNORE);
END;

-- Only initial main comments and discussion topics produce events.
CREATE TRIGGER timeline_comment_insert AFTER INSERT ON comments
WHEN NEW.status='published' AND NEW.root_comment_id IS NULL
BEGIN
  INSERT INTO timeline_events(user_id,kind,action,event_key,comment_id)
  SELECT NEW.user_id,'comment','发表了评论','comment:'||NEW.id,NEW.id
  FROM users WHERE id=NEW.user_id AND status='active' AND timeline_enabled=1
    AND EXISTS(SELECT 1 FROM json_each(timeline_record_kinds) WHERE value='comment');
END;
CREATE TRIGGER timeline_forum_post_insert AFTER INSERT ON forum_posts
WHEN NEW.status='published' AND NEW.post_number=1
BEGIN
  INSERT INTO timeline_events(user_id,kind,action,event_key,forum_post_id)
  SELECT NEW.user_id,'discussion','发布了讨论','forum-post:'||NEW.id,NEW.id
  FROM users WHERE id=NEW.user_id AND status='active' AND timeline_enabled=1
    AND EXISTS(SELECT 1 FROM json_each(timeline_record_kinds) WHERE value='discussion');
END;

-- Single-direction follows. Relation changes invalidate only the follower's
-- following-feed cursors; no timeline event or notification is generated.
ALTER TABLE users ADD COLUMN following_revision INTEGER NOT NULL DEFAULT 0 CHECK(following_revision>=0);
CREATE TABLE user_follows (
  follower_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  followed_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(follower_user_id,followed_user_id),
  CHECK(follower_user_id<>followed_user_id)
);
CREATE INDEX user_follows_outbound ON user_follows(follower_user_id,created_at DESC,followed_user_id DESC);
CREATE INDEX user_follows_inbound ON user_follows(followed_user_id,created_at DESC,follower_user_id DESC);
CREATE TRIGGER user_follows_insert AFTER INSERT ON user_follows BEGIN
  UPDATE users SET following_revision=following_revision+1 WHERE id=NEW.follower_user_id;
END;
CREATE TRIGGER user_follows_delete AFTER DELETE ON user_follows BEGIN
  UPDATE users SET following_revision=following_revision+1 WHERE id=OLD.follower_user_id;
END;
INSERT INTO role_permissions(role_id,permission_key)
SELECT r.id,p.value FROM roles r,json_each('["timeline.follow.create","timeline.follow.delete_own"]') p
WHERE r.key='user';

-- Status interactions do not emit timeline events or notifications.
CREATE TABLE timeline_status_likes (
  event_id INTEGER NOT NULL REFERENCES timeline_events(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(event_id,user_id)
);
CREATE TABLE timeline_status_replies (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id INTEGER NOT NULL REFERENCES timeline_events(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body TEXT,
  request_key TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  hidden_at TEXT,
  UNIQUE(event_id,user_id,request_key),
  CHECK((hidden_at IS NOT NULL AND body IS NULL) OR (body IS NOT NULL AND length(trim(body)) BETWEEN 1 AND 16000))
);
CREATE INDEX timeline_status_replies_recent ON timeline_status_replies(event_id,id) WHERE hidden_at IS NULL;
CREATE INDEX timeline_status_replies_user_recent ON timeline_status_replies(user_id,created_at);
CREATE TRIGGER timeline_status_likes_parent BEFORE INSERT ON timeline_status_likes
WHEN NOT EXISTS(SELECT 1 FROM timeline_events WHERE id=NEW.event_id AND kind='status')
BEGIN SELECT RAISE(ABORT,'status required'); END;
CREATE TRIGGER timeline_status_replies_parent BEFORE INSERT ON timeline_status_replies
WHEN NOT EXISTS(SELECT 1 FROM timeline_events WHERE id=NEW.event_id AND kind='status')
BEGIN SELECT RAISE(ABORT,'status required'); END;
CREATE TABLE timeline_event_face_emojis (
  content_id INTEGER NOT NULL REFERENCES timeline_events(id) ON DELETE CASCADE,
  emoji_id INTEGER NOT NULL REFERENCES face_emoji_refs(id),
  PRIMARY KEY(content_id,emoji_id)
);
CREATE INDEX timeline_event_face_emojis_emoji ON timeline_event_face_emojis(emoji_id,content_id);
CREATE TABLE timeline_reply_face_emojis (
  content_id INTEGER NOT NULL REFERENCES timeline_status_replies(id) ON DELETE CASCADE,
  emoji_id INTEGER NOT NULL REFERENCES face_emoji_refs(id),
  PRIMARY KEY(content_id,emoji_id)
);
CREATE INDEX timeline_reply_face_emojis_emoji ON timeline_reply_face_emojis(emoji_id,content_id);
CREATE TRIGGER timeline_event_face_emojis_available BEFORE INSERT ON timeline_event_face_emojis
WHEN NOT EXISTS(SELECT 1 FROM available_face_emojis WHERE id=NEW.emoji_id)
BEGIN SELECT RAISE(ABORT,'face emoji unavailable'); END;
CREATE TRIGGER timeline_reply_face_emojis_available BEFORE INSERT ON timeline_reply_face_emojis
WHEN NOT EXISTS(SELECT 1 FROM available_face_emojis WHERE id=NEW.emoji_id)
BEGIN SELECT RAISE(ABORT,'face emoji unavailable'); END;

-- Published timeline text cannot be edited. Deletion still erases the body.
DELETE FROM role_permissions WHERE permission_key='timeline.status.update_own';
DELETE FROM user_permission_blocks WHERE permission_key='timeline.status.update_own';

CREATE TRIGGER timeline_status_immutable BEFORE UPDATE OF body ON timeline_events
WHEN OLD.kind='status' AND NEW.body IS NOT NULL AND NEW.body IS NOT OLD.body
BEGIN
  SELECT RAISE(ABORT,'timeline status cannot be edited');
END;

-- Recording and public visibility are independent. Preserve the prior public
-- state for existing accounts; fresh accounts use the standard visible default.
ALTER TABLE users ADD COLUMN profile_show_timeline INTEGER NOT NULL DEFAULT 1 CHECK(profile_show_timeline IN (0,1));
UPDATE users SET profile_show_timeline=timeline_enabled;

ALTER TABLE users ADD COLUMN timeline_as_homepage INTEGER NOT NULL DEFAULT 0
  CHECK (timeline_as_homepage IN (0, 1));

ALTER TABLE users ADD COLUMN timeline_default_view TEXT NOT NULL DEFAULT 'following'
  CHECK (timeline_default_view IN ('following', 'all'));

ALTER TABLE users ADD COLUMN profile_show_friends INTEGER NOT NULL DEFAULT 1
  CHECK (profile_show_friends IN (0, 1));

UPDATE users SET profile_show_friends=0 WHERE status='deleted';

ALTER TABLE users ADD COLUMN notify_friend_additions INTEGER NOT NULL DEFAULT 1
  CHECK (notify_friend_additions IN (0, 1));

UPDATE users SET timeline_enabled=0,profile_show_timeline=0
WHERE profile_show_bio=0 AND profile_show_showcase=0 AND profile_show_favorites=0
  AND profile_show_history=0 AND profile_show_catalogs=0
  AND profile_show_comments=0 AND profile_show_discussions=0;

UPDATE users SET timeline_record_kinds=(
  SELECT json_group_array(value) FROM json_each(users.timeline_record_kinds)
  WHERE value<>'status'
)
WHERE EXISTS(SELECT 1 FROM json_each(users.timeline_record_kinds) WHERE value='status');

ALTER TABLE comment_images ADD COLUMN timeline_event_id INTEGER REFERENCES timeline_events(id) ON DELETE SET NULL;
ALTER TABLE comment_images ADD COLUMN timeline_reply_id INTEGER REFERENCES timeline_status_replies(id) ON DELETE SET NULL;
CREATE INDEX comment_images_timeline_event ON comment_images(timeline_event_id,position);
CREATE INDEX comment_images_timeline_reply ON comment_images(timeline_reply_id,position);

CREATE TRIGGER comment_images_content_insert BEFORE INSERT ON comment_images
WHEN (NEW.comment_id IS NOT NULL)+(NEW.timeline_event_id IS NOT NULL)+(NEW.timeline_reply_id IS NOT NULL)>1
  OR ((NEW.timeline_event_id IS NOT NULL OR NEW.timeline_reply_id IS NOT NULL) AND NEW.position IS NULL)
BEGIN SELECT RAISE(ABORT,'image requires a single content owner and position'); END;
CREATE TRIGGER comment_images_content_update BEFORE UPDATE OF comment_id,timeline_event_id,timeline_reply_id,position ON comment_images
WHEN (NEW.comment_id IS NOT NULL)+(NEW.timeline_event_id IS NOT NULL)+(NEW.timeline_reply_id IS NOT NULL)>1
  OR ((NEW.timeline_event_id IS NOT NULL OR NEW.timeline_reply_id IS NOT NULL) AND NEW.position IS NULL)
BEGIN SELECT RAISE(ABORT,'image requires a single content owner and position'); END;
