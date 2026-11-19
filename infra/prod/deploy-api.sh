#!/usr/bin/env bash
set -euo pipefail
umask 077

cd -- "$(dirname -- "$(realpath -- "$0")")"
exec 9>api-deploy.lock
flock 9

compose=(docker compose --env-file .env -f compose.yml -f compose.api-image.yml)
repository=ghcr.io/iuriguerreiro/discord2.0-api
rollback_file=api-rollback-image

case "${1:-}" in
  deploy)
    if [[ $# != 3 || ! "$2" =~ ^sha256:[a-f0-9]{64}$ ]]; then
      echo 'Usage: deploy-api.sh deploy sha256:<digest> <registry username>' >&2
      exit 1
    fi
    export API_IMAGE="$repository@$2"
    registry_config=$(mktemp -d)
    trap 'rm -rf -- "$registry_config"' EXIT
    docker --config "$registry_config" login ghcr.io --username="$3" --password-stdin
    docker --config "$registry_config" pull "$API_IMAGE"

    current=$("${compose[@]}" ps --all --quiet api)
    if [[ -n "$current" ]]; then
      current_state=$(docker inspect --format '{{.Image}} {{.State.Health.Status}}' "$current")
      read -r current_id health <<< "$current_state"
      next_id=$(docker image inspect --format '{{.Id}}' "$API_IMAGE")
      if [[ "$health" == healthy && "$current_id" != "$next_id" ]]; then
        previous="discord2-api-rollback:${current_id#sha256:}"
        docker image tag "$current_id" "$previous"
        printf '%s\n' "$previous" > "$rollback_file.tmp"
        mv -- "$rollback_file.tmp" "$rollback_file"
        echo "Saved previous API image: $previous"
      fi
    fi
    ;;
  rollback)
    if [[ $# != 1 || ! -s "$rollback_file" ]]; then
      echo 'Rollback requires a previously saved API image.' >&2
      exit 1
    fi
    read -r API_IMAGE < "$rollback_file"
    export API_IMAGE
    ;;
  *)
    echo 'Usage: deploy-api.sh {deploy <digest> <username>|rollback}' >&2
    exit 1
    ;;
esac

"${compose[@]}" up --no-build --pull never --no-deps --wait --wait-timeout 120 api
