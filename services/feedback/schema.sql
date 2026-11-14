-- What the feedback Worker keeps (services/feedback/src/index.mjs): one row per day (UTC),
-- holding how many reports came and how many of them GitHub turned down. Nothing about a
-- report or who sent it is kept. Create it once with:
--   npx wrangler@4 d1 execute strandivo-feedback-counts --remote --file services/feedback/schema.sql
CREATE TABLE IF NOT EXISTS days (
  day TEXT PRIMARY KEY,
  reports INTEGER NOT NULL DEFAULT 0,
  failures INTEGER NOT NULL DEFAULT 0
);
