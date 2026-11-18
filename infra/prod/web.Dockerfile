# Web client: Vite build served by Caddy. Build context: repo root.
FROM node:24-bookworm-slim AS build
ARG VITE_API_HTTP
ARG VITE_API_WS
RUN corepack enable
WORKDIR /src
COPY . .
RUN pnpm install --frozen-lockfile && pnpm --filter client build

FROM caddy:2.10-alpine
COPY infra/prod/Caddyfile /etc/caddy/Caddyfile
COPY --from=build /src/client/dist /srv
