-- Collections are gone. Instead a public share's owner can open it to files from anyone who opens
-- it; each file still keeps the token of whoever added it. A collection still taking files and
-- listed publicly stays open; any other becomes an ordinary share of what it holds.
ALTER TABLE transfers RENAME COLUMN collect TO open;
UPDATE transfers SET open = false WHERE open AND (closed OR NOT public);
ALTER TABLE transfers DROP COLUMN closed;
