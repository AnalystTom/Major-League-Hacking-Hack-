-- SQLite CHECK accepts NULL. A ready short must have a measured positive duration.
CREATE TRIGGER video_duration_insert BEFORE INSERT ON video_results
WHEN NEW.status = 'ready' AND coalesce(NEW.duration_seconds, 0) <= 0
BEGIN SELECT RAISE(ABORT, 'ready video requires a positive duration'); END;
CREATE TRIGGER video_duration_update BEFORE UPDATE ON video_results
WHEN NEW.status = 'ready' AND coalesce(NEW.duration_seconds, 0) <= 0
BEGIN SELECT RAISE(ABORT, 'ready video requires a positive duration'); END;
