#!/usr/bin/env bash
# Nightly backup of Postgres and MinIO into ./backups. Cron: 0 3 * * * /path/infra/prod/backup.sh
set -euo pipefail
cd "$(dirname "$0")"
out="backups/$(date +%F)"; mkdir -p "$out"
c="docker compose -f compose.yml --env-file .env"
$c exec -T postgres pg_dumpall -U app | gzip > "$out/postgres.sql.gz"
$c exec -T minio tar -C /data -cf - . | gzip > "$out/minio.tar.gz"
find backups -mindepth 1 -maxdepth 1 -mtime +14 -exec rm -rf {} +
