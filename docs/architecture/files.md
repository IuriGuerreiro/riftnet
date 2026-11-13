# Files (draft)

## Decided

- Files are split into **chunks**, each hashed with **BLAKE3** (detects corruption and duplicates).
- Order of attempts: **P2P** → **relay/cache for 24h** (MinIO / Cloudflare R2).
- A self-hosted node is a **permanent seeder** (keeps everything).
- Premium = permanent retention.
- **Relay rules (draft):** files up to a hard cap (~1 GB, TBD) are uploaded to the relay and cached for **1 day to 1 week** (TBD). After that the file is **P2P only**: sender and receiver must both be online. Bigger files are P2P only from the start.
- Full design (transport, manifest, permissions, resume, abuse) happens **after voice + screen share**.

## Open questions

- Chunk size.
- Who may download (permission checks at the relay).
- Malware / illegal content scanning on the relay.
- What happens when the file expires and nobody has it.

## Risks

- "No limits" attracts abuse (piracy hosting). The relay needs per-tier limits.
