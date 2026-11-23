# Obraz `functions` (VPS biura): edge-runtime z self-hosted Supabase v0.8.4, router upstream
# (docker/functions/main, bez zmian) i funkcje z supabase/functions. Cache modułów (npm/jsr) jest
# zasiany w buildzie - w runtime kontener nie ma montowań ani dostępu do registry.
# Budowany z katalogu głównego repo: docker build -f docker/functions/Dockerfile .

# supabase/edge-runtime:v1.77.9 (docker-compose.yml self-hosted/v0.8.4)
ARG EDGE_RUNTIME_IMAGE=supabase/edge-runtime:v1.77.9@sha256:6b850a2ccf0bf50ecac9accff8098095cd191c389c2a53c59b857aa0f53a8343

FROM ${EDGE_RUNTIME_IMAGE} AS warm
ENV DENO_DIR=/home/deno/.cache/deno
WORKDIR /home/deno/functions
COPY docker/functions/main/ ./main/
COPY docker/functions/deno.jsonc ./deno.jsonc
COPY supabase/functions/ ./
COPY docker/functions/warm-cache.sh /usr/local/bin/legatto-warm-cache
RUN legatto-warm-cache \
 && chmod -R a+rX /home/deno

FROM ${EDGE_RUNTIME_IMAGE}
ARG LEGATTO_VERSION=0.0.0-dev
ARG LEGATTO_REVISION=unknown
LABEL org.opencontainers.image.title="legatto-functions" \
      org.opencontainers.image.version="${LEGATTO_VERSION}" \
      org.opencontainers.image.revision="${LEGATTO_REVISION}" \
      org.opencontainers.image.source="https://github.com/JakubLog/legatto" \
      org.opencontainers.image.licenses="AGPL-3.0-only"
COPY --from=warm /home/deno /home/deno
ENV DENO_DIR=/home/deno/.cache/deno \
    HOME=/home/deno
USER 65532:65532
EXPOSE 9000
CMD ["start", "--user-worker-request-idle-timeout", "150000", "--main-service", "/home/deno/functions/main"]
