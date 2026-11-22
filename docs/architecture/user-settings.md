# User settings API

All endpoints require bearer authentication. Settings use the authenticated user ID; callers cannot select another account.

| Method | Path | Body / response |
| --- | --- | --- |
| GET | `/me/settings/notifications` | `{ messages, incoming_calls, friend_requests }` |
| PATCH | `/me/settings/notifications` | Any subset of those boolean fields; returns all three |
| GET | `/me/settings/notifications/conversations/{id}` | `{ muted }` |
| PUT | `/me/settings/notifications/conversations/{id}` | `{ muted: boolean }` |
| GET | `/me/settings/presence` | `{ presence }` |
| PUT | `/me/settings/presence` | `{ presence: "online" \| "idle" \| "do_not_disturb" \| "invisible" }` |

Notification preferences default to enabled; conversations default to unmuted. Missing or null PATCH fields keep their current value. Updates are atomic, so simultaneous changes to different fields do not overwrite each other. Unknown fields and invalid types are rejected.

Conversation mutes are permanent until unmuted. Both reads and writes require current membership; unknown conversations and nonmembers receive 404. Preferences remain private and are not included in public user profiles or profile pushes.

These endpoints store notification preferences. Desktop, push, sound delivery, and a notification inbox are not implemented. Existing message and call gateway events continue to arrive so clients can keep their state current. Future notification delivery must consult global preferences, conversation mutes, and do-not-disturb status before alerting.

Presence preferences and their versions persist in Postgres. Redis caches the preference separately from expiring socket state. One Lua script combines preference updates, socket operations, and visible status. A delayed cache fill cannot overwrite a newer saved version. Disconnected accounts remain offline; invisible appears offline; idle and do-not-disturb override socket activity. Online allows automatic idle detection.

Warm heartbeats, disconnects, and presence reads use Redis without querying Postgres for preferences. A missing cache entry stays invisible until the saved preference loads. Database errors during that recovery do not prevent Redis from refreshing or removing sockets.

Presence pushes and snapshots carry a Redis-generated monotonic revision. Clients ignore older revisions, so delayed Online pushes cannot override newer Invisible updates. A self-presence push also refreshes the account's presence selector, including when two different preferences have the same visible status.

The presence service runs each saved preference update and its announcement in a task that survives cancellation of the HTTP caller. Postgres saves the preference and a pending update in one transaction. The endpoint succeeds after Redis applies the update and the event bus accepts its announcement. If either step fails, the pending update remains for recovery every five seconds and after API restarts. Acknowledging an older version cannot delete a newer pending update. Repeated recovery is safe because Redis rejects older saved versions.

Run the backend coverage with local test infrastructure:

```sh
cargo test --locked -p api --lib features::presence -- --include-ignored
cargo test --locked -p api --test integration settings:: -- --ignored
```
