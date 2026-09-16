-- A collection is a transfer others send files into. Anyone with its code may add to it, and
-- each file keeps the token of whoever added it, so they can finish uploading and cancel what
-- they added — and nothing anyone else did.
ALTER TABLE transfers ADD COLUMN collect BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE files ADD COLUMN upload_token_hash BYTEA;
