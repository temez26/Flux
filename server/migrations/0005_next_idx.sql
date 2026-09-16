-- Indices are handed out once and never again, even for a file since removed: a device that
-- saved file 2 must never be told a different file is file 2.
ALTER TABLE transfers ADD COLUMN next_idx INTEGER NOT NULL DEFAULT 0;
UPDATE transfers t SET next_idx = coalesce((SELECT max(idx) + 1 FROM files f WHERE f.transfer_id = t.id), 0);
