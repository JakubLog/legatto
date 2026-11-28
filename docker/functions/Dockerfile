# Obraz `functions` (VPS biura): edge-runtime z self-hosted Supabase v0.8.4, router upstream
# (docker/functions/main, bez zmian) i funkcje z supabase/functions. Cache modułów (npm/jsr) jest
# zasiany w buildzie - w runtime kontener nie ma montowań ani dostępu do registry.
# Budowany z katalogu głównego repo: docker build -f docker/functions/Dockerfile .
#
# Powtarzalność (lokalna przebudowa wydania musi dać ten sam digest co CI): cache po zasianiu
# przechodzi przez normalize-cache.py (bez lotnych metadanych, tylko wersje z modules.lock),
# a etap `verify` uruchamia wszystkie funkcje z tego cache bez sieci.

# supabase/edge-runtime:v1.77.9 (docker-compose.yml self-hosted/v0.8.4)
ARG EDGE_RUNTIME_IMAGE=supabase/edge-runtime:v1.77.9@sha256:6b850a2ccf0bf50ecac9accff8098095cd191c389c2a53c59b857aa0f53a8343
# python:3.13-slim, tylko do normalizacji cache (nie trafia do obrazu)
ARG PYTHON_IMAGE=python:3.13-slim@sha256:168d3a5d10f2152f8e8d77b6843ac82c22a846cfefeef7afdf9aa630404e82a7

FROM ${EDGE_RUNTIME_IMAGE} AS warm
ENV DENO_DIR=/home/deno/.cache/deno
WORKDIR /home/deno/functions
COPY docker/functions/main/ ./main/
COPY docker/functions/deno.jsonc ./deno.jsonc
COPY supabase/functions/ ./
COPY docker/functions/warm-cache.sh /usr/local/bin/legatto-warm-cache
RUN legatto-warm-cache \
 && chmod -R a+rX /home/deno

FROM ${PYTHON_IMAGE} AS normalize
ARG SOURCE_DATE_EPOCH=0
COPY --from=warm /home/deno /home/deno
COPY docker/functions/normalize-cache.py docker/functions/modules.lock /opt/legatto/
RUN python3 /opt/legatto/normalize-cache.py /home/deno/.cache/deno /opt/legatto/modules.lock "${SOURCE_DATE_EPOCH}"

FROM ${EDGE_RUNTIME_IMAGE} AS verify
ENV DENO_DIR=/home/deno/.cache/deno
COPY --from=normalize /home/deno /home/deno
COPY docker/functions/warm-cache.sh /usr/local/bin/legatto-warm-cache
RUN --network=none legatto-warm-cache && touch /verified

FROM ${EDGE_RUNTIME_IMAGE}
ARG LEGATTO_VERSION=0.0.0-dev
ARG LEGATTO_REVISION=unknown
LABEL org.opencontainers.image.title="legatto-functions" \
      org.opencontainers.image.version="${LEGATTO_VERSION}" \
      org.opencontainers.image.revision="${LEGATTO_REVISION}" \
      org.opencontainers.image.source="https://github.com/JakubLog/legatto" \
      org.opencontainers.image.licenses="AGPL-3.0-only"
COPY --from=normalize /home/deno /home/deno
# zależność od etapu `verify` (BuildKit pomija nieużyte etapy)
COPY --from=verify /verified /home/deno/.cache/.verified
ENV DENO_DIR=/home/deno/.cache/deno \
    HOME=/home/deno
USER 65532:65532
EXPOSE 9000
CMD ["start", "--user-worker-request-idle-timeout", "150000", "--main-service", "/home/deno/functions/main"]
