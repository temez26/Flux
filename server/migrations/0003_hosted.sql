-- Transfers served straight from the sender's device: the server keeps the code, the file
-- list and the signalling room, but never the bytes.
ALTER TABLE transfers ADD COLUMN hosted BOOLEAN NOT NULL DEFAULT false;
