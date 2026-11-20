# Friends and presence

Open **Friends** in the sidebar to search by username, manage requests, and open a DM. A status dot appears next to friends.

## Check a friendship and status update

Use two accounts with usernames, no existing friendship, and no other sessions signed in as the second account.

1. Sign in as two test accounts in separate browser sessions. From **Friends**, search for the second account and choose **Add**.
2. In the second session, choose **Accept** on the request. Confirm both accounts list each other as friends.
3. Log out of the second account and sign back in. Confirm the first account sees the friend return online without reloading.

The [friends smoke](../../tools/mock/src/smoke-friends.ts) and [presence smoke](../../tools/mock/src/smoke-presence.ts) check updates at the API and WebSocket boundaries.

## Check gaming activity and joining

1. Use two accepted friends, A and B, plus a third account C that shares a DM with A but is not a friend.
2. In A's sidebar, enter `Minecraft` in **Game or stream label** and choose **Share activity**. Within 10 seconds, B sees **Playing Minecraft**. C sees no activity.
3. Start a DM call from A to B. B can choose **Join call** beside A, which opens the conversation and connects through the existing call flow.
4. Share A's screen. B sees **Streaming Minecraft** within 10 seconds. Stop screen sharing and confirm the label returns to **Playing Minecraft**.
5. Choose **Stop sharing activity**. B's activity label and Join button disappear on the next refresh.
6. Publish again, then remove the friendship. Confirm B loses activity access even if both accounts still share a group. A stale Join button must fail after access is revoked.
7. Publish from one of A's two sessions and close that session. The remaining session stays online but does not retain the closed session's label.

Activity is manually selected on web and desktop. It is off on each new connection.
Joining requires existing conversation membership. Server voice channels are not
part of this release.

Run the API smoke on a fresh local stack:

```sh
cargo build --locked -p api
.agents/skills/verify-discord/auth-smoke.sh pnpm --filter mock smoke:activity
```
