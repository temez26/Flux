-- A text transfer keeps its text here rather than as an uploaded file, because it can be edited:
-- by its owner always, and by anyone with the code while the owner allows it. The version lets
-- a save say which text it was edited from, so concurrent edits can't overwrite each other.
ALTER TABLE transfers
    ADD COLUMN note TEXT,
    ADD COLUMN editable BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN note_version INTEGER NOT NULL DEFAULT 0;
