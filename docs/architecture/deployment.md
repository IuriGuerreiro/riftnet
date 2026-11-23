# Deployment (prod)

Two machines:

| Machine | Runs | Compose project |
|---|---|---|
| **Server** (main box, at home) | web, api, zitadel, postgres, scylla, redis, nats, minio, cloudflared | `adept-prod` |
| **VPS** | media (voice/video SFU) | `adept-media` |

- The server opens **no public ports**. Cloudflare Tunnel is the only way in.
- The VPS opens **one public UDP port** for voice/video, because Cloudflare
  Tunnel can't carry UDP.
- The VPS talks to NATS on the server over **Tailscale** (private VPN).
  NATS is published only on the server's Tailscale IP.

```mermaid
flowchart LR
    U[Browser / desktop app] -- HTTPS + WSS --> CF[Cloudflare]
    CF -- tunnel --> CFD[cloudflared]
    subgraph Server
      CFD --> WEB[web] & API[api] & MINIO[minio]
      API --> PG[(postgres)] & SC[(scylla)] & RD[(redis)] & NATS[nats] & Z[zitadel]
    end
    subgraph VPS
      MEDIA[media SFU]
    end
    MEDIA -- Tailscale --> NATS
    U -- UDP --> MEDIA
```

| Public hostname | Tunnel service |
|---|---|
| `app.<domain>` | `http://web:80` |
| `api.<domain>` | `http://api:7100` (HTTP + WebSocket) |
| `files.<domain>` | `http://minio:9000` (file downloads) |

Write the service literally as `web:80`. cloudflared runs inside the same
Docker network, so Docker service names resolve. Zitadel stays internal.

## Secrets

- `infra/prod/.env` (server) and `infra/prod/media/.env` (VPS).
  Templates: the `.env.example` next to each.
- Git-ignored. Never commit. `chmod 600`.
- Generate passwords with `openssl rand -hex 24`.
- `NATS_PASSWORD` must be **the same** in both files.
- The api's PAT and signing key are made automatically on first boot
  (`secrets-init` + Zitadel) and live in the `secrets` volume.
  Losing that volume logs everyone out.

## 1. Cloudflare (once)

1. Add the domain to Cloudflare and switch nameservers at the registrar.
2. Zero Trust → Networks → Tunnels → Create (cloudflared). Copy the token
   into `TUNNEL_TOKEN` in the server `.env`.
3. Add the 3 public hostnames above (type HTTP).
4. No Cloudflare Access policy: it would block the desktop app.

## 2. Tailscale (once)

Install on both machines:
```sh
curl -fsSL https://tailscale.com/install.sh | sh
sudo tailscale up --ssh --advertise-tags=tag:servers   # server
sudo tailscale up --ssh --advertise-tags=tag:vps       # VPS
tailscale ip -4                                         # note it
```

Policy (admin console → Access controls), the parts that matter:
- `acls`: you → everything; `tag:vps` → `tag:servers:4222` (NATS only);
  `tag:servers` → `tag:vps:22`.
- `ssh`: you → both as root; `tag:servers` → `tag:vps` as root.
- No other users get access. Keep the `tests` block: it refuses a save that
  would open NATS wider or let others SSH in.

SSH is Tailscale SSH (no keys): from the server, `ssh root@<vps tailscale ip>`.
Password SSH on the VPS is disabled.

## 3. Server

Needs Docker + Compose.
```sh
cp infra/prod/.env.example infra/prod/.env       # fill in, TAILSCALE_IP = server's
docker compose -f infra/prod/compose.yml --env-file infra/prod/.env up -d --build
docker compose -f infra/prod/compose.yml --env-file infra/prod/.env ps
```
First boot takes a few minutes: Zitadel sets itself up, then the api starts.

Nightly backups: cron `infra/prod/backup.sh`.

## 4. VPS (media)

Needs Docker + Compose, and the public IP on its own network interface
(`ip a` shows it). No GitHub on the VPS. Ship code from the server:

**On the server** (building on the VPS is very slow, so build here):
```sh
docker compose -f infra/prod/media/compose.yml --env-file infra/prod/media/.env build
docker save adept-media-media:latest | gzip > ~/adept-media-image.tar.gz
tar czf ~/adept-media.tar.gz infra/prod/media     # first time: compose + .env
scp ~/adept-media.tar.gz ~/adept-media-image.tar.gz root@<vps>:/opt/
```

**On the VPS**:
```sh
mkdir -p /opt/adept && cd /opt/adept
tar xzf ../adept-media.tar.gz                     # first time / config change
gunzip -c ../adept-media-image.tar.gz | docker load
docker compose -f infra/prod/media/compose.yml --env-file infra/prod/media/.env up -d --force-recreate
docker compose -f infra/prod/media/compose.yml logs --tail 20
```
Healthy log: `media UDP listening`, then `media ready`.

Media `.env`: `MEDIA_IP` = VPS public IP, `MEDIA_PORT` = the UDP port,
`MAIN_TAILSCALE_IP` = server's Tailscale IP, `NATS_PASSWORD` = same as server.

## 5. Release the desktop app

The Release app workflow builds a Windows x64 installer and a Linux x64 AppImage. The installed app checks GitHub Releases and asks the user before it installs a new version.

### Set up release signing

1. Create a public distribution repository if anyone with the app may download the builds. Give a fine-grained GitHub token `Contents: Read and write` access to that repository.
2. Run `pnpm --filter client tauri signer generate --write-keys /secure/path/adept.key`. Back up the private key and password. Installed apps use the matching public key to verify future updates.
3. In the source repository, set Actions variables `DESKTOP_RELEASE_REPO` to the distribution repository's `owner/name` and `TAURI_UPDATER_PUBLIC_KEY` to the contents of `adept.key.pub`. The workflow also uses `PROD_API_HTTP` and `PROD_API_WS`.
4. Set `TAURI_SIGNING_PRIVATE_KEY`, `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`, and `DESKTOP_RELEASE_TOKEN` as secrets in the `desktop-release` Actions environment. Set the environment's deployment branches to the refs authorized to sign builds.

### Build and publish

1. Bump `version` in `client/src-tauri/tauri.conf.json` for each release. Promote the commit to `prod`.
2. Run **Release app** from `prod` with `create_draft` selected. Enter the release notes to show in the app. Leave `create_draft` clear to generate signed workflow artifacts only.
3. Verify the draft includes both bundles, their signatures, and `latest.json`. Publish it as the latest stable release when verification passes.
4. For the first rollout, share the installer or AppImage with existing users for a manual upgrade. Later releases appear in **Check for updates**.

Use a separate release repository and signing key for an end-to-end test. Install the lower version on each platform, then expose the higher version on the test feed. Verify **Later**, the install and restart, settings persistence, and rejection of a mismatched signature. If a published build needs to be reverted, ship the previous working code with a higher version.

## Update / redeploy

- **Server**: pull the `prod` branch, then the same `up -d --build`.
- **VPS**: repeat step 4 (build image → scp → load → `--force-recreate`).
- Changing the domain: rebuild `web` and the desktop app (URLs baked in).

## Troubleshooting

| Symptom | Cause |
|---|---|
| NATS logs `authentication error` every minute | VPS runs an old media image, or `NATS_PASSWORD` differs |
| Media `Connection refused` to NATS | Tailscale down, or policy missing `tag:vps → tag:servers:4222` |
| `ssh: tailnet policy does not permit you` | `ssh` section of the Tailscale policy is missing the rule |
| Zitadel unhealthy on first boot | Half-finished setup: `down -v` (wipes data!) and start again |
| api `signing key not found` | `secrets-init` didn't run; check its logs |
