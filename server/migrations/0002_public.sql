-- Public transfers are listed for everyone who opens Flux; others stay reachable by code only.
ALTER TABLE transfers
    ADD COLUMN public BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN title  TEXT    NOT NULL DEFAULT '';

CREATE INDEX transfers_public ON transfers (created_at DESC) WHERE public;
