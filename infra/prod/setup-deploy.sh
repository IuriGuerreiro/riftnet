#!/usr/bin/env bash
# Sets up one machine for CI deploys. Safe to run again. Restarts nothing.
# Usage: sudo infra/prod/setup-deploy.sh api|media /absolute/path/to/live/.env
set -euo pipefail
umask 022

fail() { echo "ERROR: $*" >&2; exit 1; }

service=${1:-}
env_file=${2:-}
here=$(dirname -- "$(realpath -- "$0")")
target=/opt/adept-deploy

[[ $EUID == 0 ]] || fail 'Run with sudo.'
[[ "$env_file" =~ ^/[A-Za-z0-9._/-]+$ && -s "$env_file" ]] || fail 'Give the absolute path of the live .env.'
for tool in docker flock curl gzip visudo; do command -v "$tool" > /dev/null || fail "$tool is missing."; done
docker compose version > /dev/null

case "$service" in
  api)
    project=discord2-prod wait_seconds=180
    compose="$here/compose.yml" override="$here/compose.api-deploy.yml"
    domain=$(sed -nE 's/^DOMAIN=([A-Za-z0-9.-]+).*/\1/p' "$env_file")
    [[ -n "$domain" ]] || fail "DOMAIN is missing in $env_file."
    health_url="https://api.$domain/health"
    ;;
  media)
    project=discord2-media wait_seconds=90 health_url=
    compose="$here/media/compose.yml" override="$here/media/compose.deploy.yml"
    ;;
  *) fail 'Usage: setup-deploy.sh api|media /absolute/path/to/live/.env' ;;
esac

[[ -n $(docker ps -aq --filter "label=com.docker.compose.project=$project" --filter "label=com.docker.compose.service=$service") ]] \
  || fail "No $service container in project $project on this machine."

if [[ "$service" == api ]]; then
  # NATS publishes on the Tailscale IP, which may not exist yet when Docker starts.
  echo 'net.ipv4.ip_nonlocal_bind = 1' > /etc/sysctl.d/60-adept-nats.conf
  sysctl -q -p /etc/sysctl.d/60-adept-nats.conf
fi

id adept-deploy > /dev/null 2>&1 || useradd --system --create-home --shell /bin/bash adept-deploy
passwd --lock adept-deploy > /dev/null
if id -nG adept-deploy | tr ' ' '\n' | grep -qxE 'docker|sudo|wheel'; then
  fail 'adept-deploy must not be in the docker, sudo or wheel group.'
fi

install -d -o root -g root -m 0755 "$target"
install -d -o root -g root -m 0700 /var/backups/adept
install -o root -g root -m 0644 "$compose" "$target/compose.yml"
install -o root -g root -m 0644 "$override" "$target/compose.deploy.yml"
cat > "$target/config" <<CONFIG
SERVICE=$service
PROJECT=$project
IMAGE_REPO=ghcr.io/iuriguerreiro/adept-$service
ENV_FILE=$env_file
PUBLIC_HEALTH_URL=$health_url
BACKUP_DIR=/var/backups/adept
WAIT_SECONDS=$wait_seconds
CONFIG
# Replace by rename, so a running deploy keeps its own copy.
install -o root -g root -m 0755 "$here/deploy.sh" "$target/deploy.sh.new"
mv -- "$target/deploy.sh.new" "$target/deploy.sh"

# "" = the CI user can run the script only without arguments.
rule=$(mktemp)
trap 'rm -f -- "${rule:?}"' EXIT
echo "adept-deploy ALL=(root) NOPASSWD: $target/deploy.sh \"\"" > "$rule"
visudo -cqf "$rule" || fail 'The sudo rule is invalid.'
install -o root -g root -m 0440 "$rule" /etc/sudoers.d/adept-deploy

echo status | "$target/deploy.sh"
echo "Done. $service is ready for CI deploys."
