# Obraz `migrator` (VPS biura): psql + supabase/migrations + docker/migrator/legatto-migrate.sh.
# Uruchamiany przez updater: `docker compose run --rm migrator [migrate|status --json|check]`.
# Budowany z katalogu głównego repo: docker build -f docker/migrator/Dockerfile .

# postgres:17-alpine (klient psql 17; serwer bazy to supabase/postgres 17)
ARG POSTGRES_IMAGE=postgres:17-alpine@sha256:f9cf3e1f0066f0eb0c48707d864f0ac5941e9ff454a072077d97a4d278d07d73

FROM ${POSTGRES_IMAGE}
ARG LEGATTO_VERSION=0.0.0-dev
ARG LEGATTO_REVISION=unknown
LABEL org.opencontainers.image.title="legatto-migrator" \
      org.opencontainers.image.version="${LEGATTO_VERSION}" \
      org.opencontainers.image.revision="${LEGATTO_REVISION}" \
      org.opencontainers.image.source="https://github.com/JakubLog/legatto" \
      org.opencontainers.image.licenses="AGPL-3.0-only"
COPY supabase/migrations/ /migrations/
COPY docker/migrator/selfhost.sql /usr/local/share/legatto/selfhost.sql
COPY --chmod=0555 docker/migrator/legatto-migrate.sh /usr/local/bin/legatto-migrate
ENV PGHOST=db \
    PGPORT=5432 \
    PGUSER=postgres \
    PGDATABASE=postgres \
    PGCONNECT_TIMEOUT=10 \
    PGAPPNAME=legatto-migrate
USER 65532:65532
ENTRYPOINT ["/usr/local/bin/legatto-migrate"]
CMD ["migrate"]
