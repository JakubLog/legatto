# Obraz `app` (VPS biura): SPA (build self-host, konfiguracja z /runtime-config.js) i serwer Node
# (server/) uruchamiający api/** z regułami vercel.json. Jeden obraz dla wszystkich biur - tytuł, adresy
# i flagi przychodzą z env kontenera. Runtime: distroless (bez powłoki i menedżera pakietów), uid 65532.
#
#   docker build --build-arg LEGATTO_VERSION=1.2.3 --build-arg LEGATTO_REVISION=<sha> -t app .
#
# Powtarzalność: scripts/release/build-images.sh (SOURCE_DATE_EPOCH, rewrite-timestamp).

# node:24-bookworm-slim (Node 24.22.3)
ARG NODE_BUILD_IMAGE=node:24-bookworm-slim@sha256:dc26ae92c9fb15cf6b1d63e20f0944b2efe0f115b20e00be48fb23fceb061c54
# gcr.io/distroless/nodejs24-debian13:nonroot (Node 24.22.3)
ARG NODE_RUNTIME_IMAGE=gcr.io/distroless/nodejs24-debian13:nonroot@sha256:6abfcb367ebc291572c774c1592a986be2ab26a2486f73093401327495a5962a

FROM ${NODE_BUILD_IMAGE} AS build
ENV CI=true \
    COREPACK_ENABLE_DOWNLOAD_PROMPT=0 \
    PNPM_HOME=/pnpm
WORKDIR /src
# Wersja pnpm z pola packageManager (corepack weryfikuje podpis paczki z npm).
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN corepack enable && pnpm install --frozen-lockfile
COPY . .
ARG LEGATTO_VERSION=0.0.0-dev
RUN LEGATTO_TARGET=selfhost LEGATTO_VERSION="${LEGATTO_VERSION}" pnpm exec vite build \
 && pnpm build:site \
 && LEGATTO_VERSION="${LEGATTO_VERSION}" node scripts/build-server.mjs

FROM ${NODE_RUNTIME_IMAGE}
ARG LEGATTO_VERSION=0.0.0-dev
ARG LEGATTO_REVISION=unknown
LABEL org.opencontainers.image.title="legatto-app" \
      org.opencontainers.image.version="${LEGATTO_VERSION}" \
      org.opencontainers.image.revision="${LEGATTO_REVISION}" \
      org.opencontainers.image.source="https://github.com/JakubLog/legatto" \
      org.opencontainers.image.licenses="AGPL-3.0-only"
WORKDIR /app
COPY --from=build /src/dist /app/dist
COPY --from=build /src/build /app/server
# Generator strony posła (site.mjs): wyspy klienta i SSR, fonty newslettera w client/fonts/newsletter.
COPY --from=build /src/site/dist /app/site/dist
COPY --from=build /src/vercel.json /app/vercel.json
COPY --from=build /src/supabase/templates/invite.html /app/supabase/templates/invite.html
ENV NODE_ENV=production \
    LEGATTO_TARGET=selfhost \
    LEGATTO_APP_ROOT=/app \
    PORT=3000 \
    INTERNAL_PORT=3001 \
    PATH=/nodejs/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
USER 65532:65532
EXPOSE 3000 3001
HEALTHCHECK --interval=15s --timeout=6s --start-period=30s --retries=3 \
  CMD ["/nodejs/bin/node", "/app/server/healthcheck.mjs"]
ENTRYPOINT ["/nodejs/bin/node"]
CMD ["/app/server/index.mjs"]
