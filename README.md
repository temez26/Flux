# Flux

Flux is a minimalistic, self-hosted file transfer application for fast and reliable file sharing between devices on a network.

Drop files or folders, get a short code (`abcd-efgh`), a link and a QR code. The other device opens the link or types the code and downloads a single file or everything as one zip. Transfers are temporary and delete themselves.

## Features

- **Any size, any count.** Single files of many gigabytes and folders of tens of thousands of files.
- **Resilient queue.** Every file uploads independently in resumable chunks, with per-file and overall progress, pause/resume, retry and cancel. Network drops, sleeping laptops and server restarts resume where they stopped. A failing file never restarts the others.
- **End-to-end integrity.** The browser hashes each file with BLAKE3 while uploading, and the server only accepts the file if its own hash matches. Receivers can download a `b3sum`-compatible checksum list.
- **Fast downloads.** Individual files, or *Download all* as a zip that is laid out from stored metadata, so it streams with an exact size and supports resuming (HTTP Range), including ZIP64 for files and archives over 4 GiB.
- **Direct when possible.** While the sender's page is open, receivers fetch files straight from the sender's device over WebRTC, and the server upload steps aside. Files the server already has come from the server. If a direct connection can't be made or drops, the transfer continues through the server.
- **Temporary.** Transfers expire after 1 hour, 1 day or 7 days and are cleaned up automatically.
- **App-like.** Installable PWA, mobile-first, touch-friendly, dark mode, keeps the screen awake while sending.

## Running

```bash
docker compose up -d --build
```

Flux listens on port `8080`. Point your existing reverse proxy at it; Flux does not ship its own.

| Variable            | Default | Purpose                                  |
| ------------------- | ------- | ---------------------------------------- |
| `FLUX_PORT`         | `8080`  | Host port published by Compose           |
| `POSTGRES_PASSWORD` | `flux`  | Database password (internal network only)|
| `RUST_LOG`          | `info`  | Server log level                         |

Files live in the `flux-data` volume, metadata in `db-data`. To store files on a specific disk, replace the `flux-data` volume with a bind mount owned by UID `65532` (the container's non-root user):

```bash
sudo chown -R 65532:65532 /mnt/storage/flux
```

### Reverse proxy

- Serve Flux over **HTTPS**. Browsers only enable installation, the service worker, clipboard and sharing in a secure context.
- Allow request bodies of at least **8 MiB** (uploads are sent in 8 MiB chunks), and disable request buffering for throughput.
- Allow WebSocket upgrades on `/api/` (used for direct transfers).

nginx:

```nginx
location / {
    proxy_pass http://flux:8080;
    client_max_body_size 16m;
    proxy_request_buffering off;
    proxy_buffering off;
    proxy_read_timeout 1h;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection $http_connection;
}
```

Caddy needs nothing beyond `reverse_proxy flux:8080`.

## Architecture

```
web/     Next.js + TypeScript + Tailwind, built as a static export
server/  Rust (axum, tokio, sqlx) – API, static files, storage, cleanup
```

A single container serves both the app and the API, so uploads go straight to Rust with no Node.js proxy in between. The app is one static page; `/<code>` routes are rendered client-side.

- **Storage.** Each file is stored as-is at `/data/<transfer-id>/<index>`. PostgreSQL holds transfers and file metadata (path, size, type, modification time, BLAKE3, CRC32). Database access uses sqlx with embedded migrations, since Prisma has no maintained Rust client and the frontend never touches the database.
- **Uploads.** `PATCH /api/transfers/{code}/files/{idx}` with an `Upload-Offset` header appends a chunk. The file's length on disk is the authoritative offset, so interrupted requests keep every byte that arrived and no per-chunk database writes are needed. The final chunk carries `Upload-Hash`; the server compares it with the BLAKE3 it computed while writing.
- **Zip.** Files are stored uncompressed (they are usually already compressed). Because sizes and CRCs are known up front, the archive is assembled on the fly with an exact `Content-Length`, and any byte range can be served.
- **Cleanup.** Expired transfers are deleted every minute, and orphaned data is removed on startup.
- **Direct transfers.** The sender's page stays registered on a WebSocket (`/signal`) that relays WebRTC offers, answers and ICE candidates; the owner token is sent inside the socket, never in a URL. Only host candidates are used, so no STUN/TURN or other third party is contacted and direct mode works between devices on the same network. Receivers pull 1 MiB ranges over an ordered data channel with a bounded window, verify each file's BLAKE3, and save through a service-worker stream (a native download, as a single file or zip built on the fly). Browsers without that (Safari, plain-HTTP deployments) assemble up to 1 GB in memory; larger transfers use the server.

### API

| Method   | Path                                  | Purpose                                     |
| -------- | ------------------------------------- | ------------------------------------------- |
| `POST`   | `/api/transfers`                      | Create a transfer, returns code and owner token |
| `GET`    | `/api/transfers/{code}`               | Metadata and upload progress                |
| `DELETE` | `/api/transfers/{code}`               | Delete (owner)                              |
| `PATCH`  | `/api/transfers/{code}/files/{idx}`   | Upload a chunk (owner)                      |
| `GET`    | `/api/transfers/{code}/files/{idx}`   | Download a file (Range supported)           |
| `DELETE` | `/api/transfers/{code}/files/{idx}`   | Remove a file (owner)                       |
| `GET`    | `/api/transfers/{code}/zip`           | Download everything as a zip (Range supported) |
| `GET`    | `/api/transfers/{code}/signal`        | WebSocket for direct-transfer signaling     |

Owner requests use `Authorization: Bearer <token>`. The token is returned once at creation and kept in the sender's browser.

## Development

```bash
docker compose up -d --build   # API on :8080
cd web && npm install && npm run dev   # UI on :3000, proxies /api to :8080
```

Set `FLUX_API` to point `npm run dev` at a different server.
