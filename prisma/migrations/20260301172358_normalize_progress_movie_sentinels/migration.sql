-- Normalize existing movie progress_items rows: NULL → '\n' sentinel
-- This ensures the composite unique constraint (tmdb_id, user_id, season_id, episode_id)
-- works correctly for movies (PostgreSQL treats NULL != NULL in UNIQUE indexes).

-- First, deduplicate: if both a NULL row and a '\n' row exist for the same movie,
-- keep the '\n' row (more recently written) and delete the NULL one.
DELETE FROM "progress_items" a
USING "progress_items" b
WHERE a."tmdb_id" = b."tmdb_id"
  AND a."user_id" = b."user_id"
  AND a."season_id" IS NULL
  AND a."episode_id" IS NULL
  AND b."season_id" = E'\n'
  AND b."episode_id" = E'\n';

-- Now convert remaining NULL rows to '\n' (covers both fully-NULL and mixed cases)
UPDATE "progress_items"
SET "season_id" = E'\n'
WHERE "season_id" IS NULL;

UPDATE "progress_items"
SET "episode_id" = E'\n'
WHERE "episode_id" IS NULL;

-- Normalize existing movie watch_history rows: NULL → '\n' sentinel
-- Same pattern as progress_items above.

-- Deduplicate: if both a NULL row and a '\n' row exist for the same movie,
-- keep the '\n' row and delete the NULL one.
DELETE FROM "watch_history" a
USING "watch_history" b
WHERE a."tmdb_id" = b."tmdb_id"
  AND a."user_id" = b."user_id"
  AND a."season_id" IS NULL
  AND a."episode_id" IS NULL
  AND b."season_id" = E'\n'
  AND b."episode_id" = E'\n';

-- Convert remaining NULL rows to '\n'
UPDATE "watch_history"
SET "season_id" = E'\n'
WHERE "season_id" IS NULL;

UPDATE "watch_history"
SET "episode_id" = E'\n'
WHERE "episode_id" IS NULL;