-- Correct the initial timeline defaults without rewriting the applied 0034.
-- Existing accounts receive all six business recording categories.
UPDATE users
SET timeline_record_kinds='["favorite","catalog","comment","discussion","upload","play"]'
WHERE status<>'deleted';

-- Preserve the opt-out inferred from all seven legacy profile sections being
-- hidden. Deleted accounts also retain their disabled recording and visibility.
UPDATE users
SET timeline_enabled=1,profile_show_timeline=1
WHERE status<>'deleted'
  AND (profile_show_bio=1 OR profile_show_showcase=1 OR profile_show_favorites=1
    OR profile_show_history=1 OR profile_show_catalogs=1
    OR profile_show_comments=1 OR profile_show_discussions=1);
