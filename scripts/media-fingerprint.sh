#!/usr/bin/env bash
# Prints a hash of everything the media image is built from: its sources and the
# exact crates it links. Unrelated changes (client, api, their crates) keep it equal.
set -euo pipefail
cd -- "$(dirname -- "$0")/.."

crates=$(cargo tree --locked -p media -e normal,build --target x86_64-unknown-linux-gnu --prefix none --format '{p} {f}')
{
  sed -E 's/ \(\/[^)]*\)//; s/ \(\*\)$//' <<< "$crates" | LC_ALL=C sort -u
  git ls-tree -r HEAD -- services/media libs/common libs/protocol proto \
    Cargo.toml .dockerignore infra/prod/rust.Dockerfile
} | sha256sum | cut -d' ' -f1
