# Flux

Self-hosted file transfer for your home network. Drop files or folders and share a code, link or QR code, or list the transfer publicly. Receivers download single files or everything as one zip.

- Very large files and thousands of files, with resumable uploads (pause, retry, cancel)
- End-to-end integrity check (BLAKE3)
- Direct device-to-device transfer when both devices are online, server fallback otherwise
- Optional public space: transfers listed on the home page, no code needed
- Transfers expire after 1 hour, 1 day or 7 days
- Installable, mobile-first web app

## Run

Requires Docker with Compose.

```bash
cp .env.example .env    # set POSTGRES_PASSWORD
docker compose up -d --build
```

Flux runs on `http://<host>:8080`. The build is production-ready: an optimized Rust binary and a static web app in a minimal container. There is no separate production build step.

Update with `git pull && docker compose up -d --build`. Files and metadata persist in the `flux-data` and `db-data` volumes.

| Variable            | Default | Purpose                                         |
| ------------------- | ------- | ----------------------------------------------- |
| `FLUX_PORT`         | `8080`  | Host port                                       |
| `POSTGRES_PASSWORD` | `flux`  | Database password (used when the database is first created) |
| `RUST_LOG`          | `info`  | Log level                                       |

To store files on a specific disk, replace the `flux-data` volume with a bind mount owned by UID `65532`:

```bash
sudo chown -R 65532:65532 /mnt/storage/flux
```

## Reverse proxy

- Use **HTTPS**. Installing the app, offline start and direct downloads need it.
- Allow request bodies of at least **8 MiB** and turn off request buffering.
- Allow **WebSocket** upgrades (used for direct transfers).

Caddy: `reverse_proxy flux:8080`. nginx:

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

## Development

```bash
docker compose up -d --build            # API on :8080
cd web && npm install && npm run dev    # UI on :3000, proxies /api to :8080
```

`server/` is the Rust API (axum, sqlx, PostgreSQL), which also serves the web app. `web/` is the Next.js app, built as a static export.
