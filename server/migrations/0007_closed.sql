-- A collection its owner has stopped: nothing more can be added, and what was collected stays.
ALTER TABLE transfers ADD COLUMN closed BOOLEAN NOT NULL DEFAULT false;
