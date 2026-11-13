# Identity and auth

## User login: Zitadel

- We use an **auth provider** instead of building login and 2FA ourselves.
- **Chosen: Zitadel, self-hosted.** Open source, Go + Postgres, free, no per-user bill.
- To validate with a prototype before fully committing.
- Day 1 features: email + password, passkeys, optional 2FA (TOTP), Google/GitHub login.

### Why Zitadel

| Option        | Verdict                                                                    |
| ------------- | -------------------------------------------------------------------------- |
| **Zitadel**   | Open source, passkeys/2FA/OAuth built in, ready login screens. **Picked.** |
| Ory Kratos    | Very flexible, but no screens: we'd build every login page                 |
| Keycloak      | Proven but heavy (Java) and dated UI                                       |
| Authentik     | Aimed at internal apps, not millions of public users                       |
| Clerk / Auth0 | Easiest, but closed and paid per user (~$1–2k/month at 100k MAU)           |

### Login flow

1. User clicks "Log in". The app opens the Zitadel login page.
2. User logs in (password, passkey, Google...).
3. Zitadel redirects back to the hub with proof of identity.
4. The hub issues **our own token**. The app uses only that from then on.

Because the hub issues its own tokens, we can swap providers later without touching nodes or clients.

## Hub ↔ node trust (after the MVP)

1. A node generates an **Ed25519** key pair and registers with the hub.
2. The user logs in to the hub.
3. The hub issues a **signed token** for that node: `(user_id, node_id, exp)`.
4. The node verifies it with the **hub's public key**, offline, with no call to the hub.
5. The node never sees the password.

## Devices

Accounts have devices from day 1 (`device_id`). Needed for E2E later. See [dms.md](dms.md).

## Open questions

- Token lifetime and refresh (short = safer, long = survives the hub being down).
- Revocation: how does a node learn an account was banned or stolen? (A revocation list pulled periodically?)
- Hub key rotation.
- LAN mode: a node working without the hub? Local accounts?

## Risks

- A stolen token is valid until it expires. Per-node tokens (audience) limit the damage.
