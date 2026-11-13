# Monetization (brainstorm)

Nothing here is decided. Base tiers and costs: [tiers-and-costs.md](tiers-and-costs.md).

## On the table

- Personal subscription and server boosts.
- Later: cosmetics, managed hosting, plugin/bot marketplace (commission), LFG/coaches (commission).

## Idea: HQ audio bots (e.g. music bots)

Bots that play audio in a voice channel can pay for higher quality. **We charge for audio quality and infrastructure, never for the music.**

| Bot tier | Audio                 | Price idea            |
| -------- | --------------------- | --------------------- |
| Free     | 64 kbps mono          | €0                    |
| HQ       | 128–256 kbps stereo   | €X / instance / month |
| Studio   | up to 510 kbps stereo | €Y / instance / month |

- **Instance** = one copy of the bot playing in one channel at a time.
- Self-host: no limits, as always.

### Cost check

- 256 kbps ≈ 115 MB/h per listener.
- 10 listeners × 8h/day × 30 days ≈ 280 GB ≈ **~€0.30** of Hetzner bandwidth. Almost all margin.

### Open questions

- Who pays: server owner, bot dev or user?
- Price per instance, per server or per listener?
- Revenue share with bot devs (gives them a reason to promote us)?
- Generalise to any media bot (radio, TTS, streams)?
- Does the bot run as a WASM plugin in the node, or as a separate process?

### Risks

- Bot devs are responsible for their music sources. Big music bots (Groovy, Rythm) were shut down over YouTube. Our terms must make that clear.
- Don't make it feel like we put formerly free things behind a paywall.
