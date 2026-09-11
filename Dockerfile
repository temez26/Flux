# syntax=docker/dockerfile:1

FROM node:24-alpine AS web
WORKDIR /web
COPY web/package.json web/package-lock.json ./
RUN npm ci
COPY web/ ./
RUN npm run build

FROM rust:1-bookworm AS server
WORKDIR /server
COPY server/ ./
RUN --mount=type=cache,target=/usr/local/cargo/registry \
    --mount=type=cache,target=/server/target \
    cargo build --release && cp target/release/flux /flux && mkdir /data

FROM gcr.io/distroless/cc-debian12:nonroot
COPY --from=server /flux /app/flux
COPY --from=web /web/out /app/web
COPY --from=server --chown=65532:65532 /data /data
ENV FLUX_DATA_DIR=/data \
    FLUX_WEB_DIR=/app/web \
    FLUX_ADDR=0.0.0.0:8080
EXPOSE 8080
VOLUME /data
ENTRYPOINT ["/app/flux"]
