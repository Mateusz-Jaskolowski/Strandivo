-- The count of update checks (services/updates/src/index.mjs): one row per day, version,
-- OS and processor, holding how many checks there were. Nothing else is kept. Create it
-- once with:
--   npx wrangler@4 d1 execute strandivo-update-checks --remote --file services/updates/schema.sql
CREATE TABLE IF NOT EXISTS checks (
  day TEXT NOT NULL,
  version TEXT NOT NULL,
  os TEXT NOT NULL,
  arch TEXT NOT NULL,
  n INTEGER NOT NULL,
  PRIMARY KEY (day, version, os, arch)
);
