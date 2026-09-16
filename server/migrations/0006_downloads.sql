-- How many times people have started downloading a transfer, counted by the pages they use
-- rather than by requests: a preview fetches the same files, and a resumed download fetches
-- them more than once.
ALTER TABLE transfers ADD COLUMN downloads INTEGER NOT NULL DEFAULT 0;
