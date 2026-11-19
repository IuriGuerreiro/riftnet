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

Presence preferences persist in Postgres. The presence store combines them with live socket state: disconnected accounts remain offline, invisible always appears offline, and idle or do-not-disturb overrides socket activity while connected. Online uses automatic idle detection. Changes broadcast through the existing presence audience. Reads apply preferences in bulk. Heartbeats read the saved preference before updating live state, so reconnects and activity cannot reveal an invisible account.

Run the backend coverage with local test infrastructure:

```sh
cargo test --locked -p api --test integration settings:: -- --ignored
```
