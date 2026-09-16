# Flux

Self-hosted file transfer for your home network. Drop files or folders, share a code, link or QR
code. Receivers take single files or the lot as one zip.

- Very large files and thousands of them, resumable (pause, retry, cancel)
- BLAKE3 integrity check end to end
- Upload to the server, or send straight from your device
- Send to another device on your network without a code
- Collect files from others: hand out a code people add files to
- Optional public listing on the home page
- Expires after 1 hour, 1 day or 7 days
- Installable, mobile-first web app

## Run

Needs Docker with Compose.

```bash
cp .env.example .env    # set POSTGRES_PASSWORD
docker compose up -d --build
```

Serves on `http://<host>:8080`. The image is production-ready — there is no separate build step.
Update with `git pull && docker compose up -d --build`; data lives in the `flux-data` and
`db-data` volumes.

| Variable            | Default | Purpose                                                  |
| ------------------- | ------- | -------------------------------------------------------- |
| `FLUX_PORT`         | `8080`  | Host port                                                 |
| `FLUX_STUN_PORT`    | `3478`  | UDP port devices use to find each other (`0` disables)    |
| `POSTGRES_PASSWORD` | `flux`  | Set before first start; ignored afterwards                |
| `RUST_LOG`          | `info`  | Log level                                                 |

For files on a specific disk, bind-mount over `flux-data` and `chown -R 65532:65532` it.

## Reverse proxy

- **HTTPS** — installing the app, offline start and direct downloads need it.
- **UDP 3478** published straight to the host; a proxy won't carry it.
- Request bodies of **8 MiB**, request buffering **off**, **WebSocket** upgrades allowed.

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

The container must see each device's real address, or they all look like one machine and can't
connect. Check it from a phone on your network:

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
rewriting the source — add `network_mode: host` to the `flux` service. Docker Desktop on macOS and
Windows always rewrites it, so device-to-device needs a Linux host.

## Development

```bash
docker compose up -d --build            # API on :8080
cd web && npm install && npm run dev    # UI on :3000, proxies /api to :8080
```

`npm test` in `web/` and `cargo test` in `server/` cover the two zip writers, where a mistake
yields an archive that looks fine until someone opens it somewhere else.

`server/` — Rust API (axum, sqlx, PostgreSQL), also serves the web app. A module per concern:
`upload`, `download`, `zip`, `thumbs`, `signal`, `nearby`, `stun`, `cleanup`.

`web/` — Next.js, static export. `lib/` is the transfer engine and never imports a component.
`components/` renders it: `transfer/` a file per panel, `preview/` a file per viewer family,
`ui.tsx` the shared primitives.
