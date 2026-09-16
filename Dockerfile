# syntax=docker/dockerfile:1

FROM node:24-alpine AS web
WORKDIR /web
COPY web/package.json web/package-lock.json ./
RUN npm ci
COPY web/ ./
RUN npm run build

FROM rust:1-trixie AS server
WORKDIR /server
# libheif decodes the HEIC an iPhone shoots by default. Debian 13 is the first release with
# a libheif new enough for the bindings.
RUN apt-get update && apt-get install -y --no-install-recommends libheif-dev pkg-config \
    && rm -rf /var/lib/apt/lists/*
COPY server/ ./
RUN --mount=type=cache,target=/usr/local/cargo/registry \
    --mount=type=cache,target=/server/target \
    cargo build --release && cp target/release/flux /flux && mkdir /data
# The shared libraries a distroless image doesn't already carry. libheif reaches its codecs
# by dlopen, so ldd never names them: the plugins are collected separately, along with what
# they need in turn.
RUN set -eux; \
    mkdir -p /libs /plugins; \
    needed() { ldd "$1" | awk '/=> \//{print $3}' | grep -vE '/lib(c|m|gcc_s|stdc\+\+)\.so'; }; \
    needed /flux | xargs -r -I{} cp -Lu {} /libs/; \
    for plugin in /usr/lib/*/libheif/plugins/*.so; do \
        cp -L "$plugin" /plugins/; \
        needed "$plugin" | xargs -r -I{} cp -Lu {} /libs/; \
    done

FROM gcr.io/distroless/cc-debian13:nonroot
COPY --from=server /libs/ /app/lib/
COPY --from=server /plugins/ /app/lib/libheif-plugins/
COPY --from=server /flux /app/flux
COPY --from=web /web/out /app/web
COPY --from=server --chown=65532:65532 /data /data
ENV FLUX_DATA_DIR=/data \
    FLUX_WEB_DIR=/app/web \
    FLUX_ADDR=0.0.0.0:8080 \
    LD_LIBRARY_PATH=/app/lib \
    LIBHEIF_PLUGIN_PATH=/app/lib/libheif-plugins
EXPOSE 8080
EXPOSE 3478/udp
VOLUME /data
ENTRYPOINT ["/app/flux"]
