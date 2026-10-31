-- Manual left-to-right order of siblings in the family tree.
-- Additive only: creates one new table, does not touch people, meta or photos.
-- One row per parent pair: pkey = "<fatherId or ->~<motherId or ->", ids = JSON array of child ids.
-- The worker also runs this statement on start-up (IF NOT EXISTS), so applying it by hand is optional.
CREATE TABLE IF NOT EXISTS sibling_order (pkey TEXT PRIMARY KEY, ids TEXT NOT NULL, updated INTEGER NOT NULL);
