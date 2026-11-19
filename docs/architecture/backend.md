# Backend structure

Applies to every Rust service (`services/api` first). Organized **by feature**,
with the same layers inside each feature.

```text
services/api/src/
├── main.rs              start the server
├── app.rs               build repos/clients/services once, mount every feature's routes
├── config.rs            env vars (+ .env)
├── common/              only what every feature needs
│   ├── error.rs         ApiError → JSON { code, message }; RepoError
│   ├── db.rs            Postgres pool + migrations
│   ├── redis.rs         Redis connection (presence, caches later)
│   ├── user_limits.rs   per-user rate limits + sockets-per-user cap, in Redis
│   ├── shutdown.rs      graceful shutdown: stop signal + live socket count
│   └── middleware/
│       ├── auth.rs      AuthUser extractor (Bearer access token)
│       └── rate_limit.rs
└── features/
    ├── auth/            register, login, refresh, logout
    ├── users/           /me, profile + avatar, /users/{id}, /users/search (see profiles.md)
    ├── friends/         /friends: requests, accept, remove (see friends.md)
    ├── presence/        online / idle / offline, Redis (see presence.md)
    ├── health/          /health, /metrics
    └── gateway/         WebSocket (parked)
```

Each feature folder:

| File            | Job                                                                |
| --------------- | ------------------------------------------------------------------ |
| `mod.rs`        | `routes()`: the feature's endpoints                                |
| `controller.rs` | HTTP in/out only: parse, call the service, return JSON             |
| `service.rs`    | Business logic. No SQL, no HTTP                                    |
| `repository.rs` | Data access: a **trait** + a Postgres implementation               |
| `dto.rs`        | Request/response JSON shapes                                       |
| `models.rs`     | Domain structs                                                     |
| (extra)         | Feature-specific pieces, e.g. `auth/identity.rs`, `auth/tokens.rs` |

## Layers

```mermaid
flowchart LR
    C["controller"] --> S["service"]
    S --> R["repository trait"]
    S --> X["client trait<br/>(e.g. IdentityProvider)"]
    R --> Cache["Cached…Repo<br/>(later, Redis)"] --> PG["Pg…Repo"]
    X --> Z["ZitadelClient"]
```

## Rules

1. **Controllers** never touch the DB or external services. They call one service method.
2. **Services** depend on **traits** (`Arc<dyn UserRepo>`), never on concrete types.
3. **Repositories** return `RepoError` (e.g. `Conflict` for unique violations), not HTTP errors.
4. **Caching is a decorator:** `CachedUserRepo` implements `UserRepo` and wraps `PgUserRepo`. Services don't change.
5. Each feature owns its **models and DTOs**. Share only through `common/`.
6. Features use each other **through traits** (e.g. `auth` uses `users::UserRepo`), never each other's tables.
7. Everything is wired once in `app.rs`.
8. **Never log secrets.** Request types holding passwords implement `Debug` with `<redacted>`.

## Adding a feature

1. Create `features/<name>/` with the files above.
2. Add a migration in `services/api/migrations/` if it needs tables.
3. Expose `routes()` and merge it in `app.rs`.
4. Unit-test the service with fake repos; add checks to a `scripts/smoke-*.sh`.

## Shutdown and limits

- **Graceful shutdown** (`main.rs`, `common/shutdown.rs`). On SIGTERM or Ctrl-C:
  1. `axum::serve` stops accepting and lets in-flight HTTP requests finish.
  2. `Shutdown::trigger()` signals active gateway sessions through a Tokio `watch` channel. They send close code 1012 so clients reconnect.
  3. Axum does not track upgraded sockets. Each socket holds a `SocketGuard` that lowers the live count when dropped. After HTTP drains, `main` waits up to 10s for the count to reach zero.
- **Body size.** Axum body extractors such as `Json` enforce a 1 MiB default. Upload handlers read the raw body with their own caps. Whole attachments are capped by `ATTACHMENT_MAX_BYTES`.
- **Rate limits.**
  - `middleware/rate_limit.rs` keeps per-instance limits in memory and keys them by IP or user.
  - `user_limits.rs` shares per-user limits across instances. A Redis Lua script updates each counter and its expiry atomically. When a limit is reached, HTTP returns `429` with `Retry-After` and WebSockets return `retry_after_ms`. See [protocol.md](protocol.md#rate-limits).
