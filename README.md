# Flux

Self-hosted file transfer for your home network. Drop files or folders, share a link or QR code.
Receivers take single files or the lot as one zip.

- **Public** — upload files anyone who opens Flux can see and download, optionally letting them add
  their own
- **Device** — send files straight to a nearby device; nothing is uploaded
- **Text** — a note, link or password, public or link-only, read only or edited together live
- Very large files and folders, resumable, BLAKE3-verified end to end
- Expires after 5 minutes to 7 days
- Installable, mobile-first web app

## Run

Needs Docker with Compose.

```bash
git clone https://github.com/temez26/Flux.git && cd Flux
cp .env.example .env    # set POSTGRES_PASSWORD
docker compose up -d --build
```

Open `http://<host>:8080`. Update with `git pull && docker compose up -d --build`. Data lives in the
`flux-data` (files) and `db-data` (PostgreSQL) volumes.

### Configuration

Set in `.env`:

| Variable            | Default | Purpose                                                              |
| ------------------- | ------- | -------------------------------------------------------------------- |
| `FLUX_PORT`         | `8080`  | Host port for the web app                                            |
| `FLUX_STUN_PORT`    | `3478`  | UDP port devices use to find each other for direct sends; `0` turns it off |
| `POSTGRES_PASSWORD` | `flux`  | Database password; only applies when the database is first created  |
| `RUST_LOG`          | `info`  | Log level: `error`, `warn`, `info`, `debug`                          |

## Development

Needs Docker with Compose and Node.js 24.

```bash
cp .env.example .env
docker compose up -d --build            # API on :8080
cd web && npm install && npm run dev    # UI on http://localhost:3000, proxies /api to :8080
```

Rebuild the container after changing `server/`. Set `FLUX_API` to point `npm run dev` at another
API address.

Before a PR:

- `web/`: `npm test`, `npm run lint`, `npm run format`
- `server/`: `cargo test`, `cargo clippy --all-targets`, `cargo fmt` (needs `libheif-dev`)

Layout: `server/` is the Rust API (axum, sqlx, PostgreSQL) that also serves the built web app.
`web/` is the Next.js static export — `lib/` holds the transfer engine, `components/` the UI.

## License

[MIT](LICENSE)
