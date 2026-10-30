ARG BUILD_FROM=ghcr.io/home-assistant/base:3.24
FROM ${BUILD_FROM}

ARG BUILD_ARCH=amd64
ARG CLOUDFLARED_VERSION=2026.10.1
ARG CLOUDFLARED_SHA256_AMD64=3bfc539f45d2620c71debb7a86be0efa737ed5ccbad9eb85c787116900e5c586
ARG CLOUDFLARED_SHA256_ARM64=2c65dfabf616c40efc7545d107d7a57ad5e21377e2964b7e88af19a238074a46

RUN apk add --no-cache caddy nodejs \
    && adduser -S -D -H -s /sbin/nologin worker

# Binaire officiel de cloudflared, vérifié par sa somme SHA-256
RUN case "${BUILD_ARCH}" in \
        amd64) cf_arch=amd64; cf_sha256="${CLOUDFLARED_SHA256_AMD64}" ;; \
        aarch64) cf_arch=arm64; cf_sha256="${CLOUDFLARED_SHA256_ARM64}" ;; \
        *) echo "Architecture non supportée : ${BUILD_ARCH}" >&2; exit 1 ;; \
    esac \
    && curl -fsSL -o /usr/bin/cloudflared \
        "https://github.com/cloudflare/cloudflared/releases/download/${CLOUDFLARED_VERSION}/cloudflared-linux-${cf_arch}" \
    && echo "${cf_sha256}  /usr/bin/cloudflared" | sha256sum -c - \
    && chmod a+x /usr/bin/cloudflared

COPY rootfs /

RUN chmod a+x /etc/s6-overlay/s6-rc.d/*/run /etc/s6-overlay/s6-rc.d/*/finish
