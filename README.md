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

To keep files on a specific disk, bind-mount a directory over `flux-data` and
`chown -R 65532:65532` it.

### HTTPS and reverse proxy

Installing the app, offline start and direct downloads need HTTPS, so put Flux behind a reverse
proxy. It must allow WebSocket upgrades, request bodies up to **64 MiB** with buffering off, and
pass each device's address in `X-Forwarded-For` (Caddy and Nginx Proxy Manager do by default).

Caddy: `reverse_proxy flux:8080`. nginx:

```nginx
location / {
    proxy_pass http://flux:8080;
    client_max_body_size 64m;
    proxy_request_buffering off;
    proxy_buffering off;
    proxy_read_timeout 1h;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection $http_connection;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
}
```

<details>
<summary>Device sends not connecting without a proxy?</summary>

The container must see each device's real address, or they all look like one machine. Run this
from a phone or laptop on your network:

```bash
python3 - <<'EOF'
import socket, struct, os
m = struct.pack(">HHI", 1, 0, 0x2112A442) + os.urandom(12)
s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM); s.settimeout(5)
s.sendto(m, ("YOUR-FLUX-HOST", 3478))
d, _ = s.recvfrom(1024)
v = d[24:32]
print("this device looks like",
      socket.inet_ntoa(bytes(a ^ b for a, b in zip(v[4:8], (0x2112A442).to_bytes(4, "big")))))
EOF
```

It should print that device's own address. A gateway address such as `172.17.0.1` means Docker is
rewriting it — add `network_mode: host` to the `flux` service. Docker Desktop on macOS and Windows
always rewrites it, so device-to-device sends need a Linux host.

</details>

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
