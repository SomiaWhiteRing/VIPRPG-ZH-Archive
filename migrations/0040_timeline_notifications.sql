-- Live references keep notification excerpts subject to current content visibility.
ALTER TABLE inbox_items ADD COLUMN timeline_event_id INTEGER REFERENCES timeline_events(id);
ALTER TABLE inbox_items ADD COLUMN timeline_reply_id INTEGER REFERENCES timeline_status_replies(id);
