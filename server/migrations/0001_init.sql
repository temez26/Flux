CREATE TABLE transfers (
    id          UUID PRIMARY KEY,
    code        TEXT NOT NULL UNIQUE,
    token_hash  BYTEA NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at  TIMESTAMPTZ NOT NULL
);

CREATE INDEX transfers_expires_at ON transfers (expires_at);

CREATE TABLE files (
    transfer_id  UUID NOT NULL REFERENCES transfers (id) ON DELETE CASCADE,
    idx          INTEGER NOT NULL,
    path         TEXT NOT NULL,
    size         BIGINT NOT NULL,
    mime         TEXT NOT NULL,
    -- Sender-reported modification time, milliseconds since the Unix epoch.
    modified     BIGINT,
    -- BLAKE3 digest and CRC32 of the stored content; both set once the upload is verified.
    hash         BYTEA,
    crc32        INTEGER,
    PRIMARY KEY (transfer_id, idx)
);
