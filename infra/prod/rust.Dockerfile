# Builds one Rust service from the workspace. Pick it with --build-arg BIN=api|media.
# Build context: repo root.
FROM rust:1.96-bookworm AS build
ARG BIN
WORKDIR /src
COPY . .
RUN --mount=type=cache,target=/usr/local/cargo/registry \
    --mount=type=cache,target=/src/target \
    cargo build --release --locked -p ${BIN} && cp target/release/${BIN} /app

FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl \
    && rm -rf /var/lib/apt/lists/*
COPY --from=build /app /usr/local/bin/app
# Runs as root for now: it shares the secrets volume with Zitadel.
ENV APP_ENV=production LOG_FORMAT=json
ENTRYPOINT ["/usr/local/bin/app"]
