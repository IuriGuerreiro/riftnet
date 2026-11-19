# Friends and presence

Open **Friends** in the sidebar to search by username, manage requests, and open a DM. A status dot appears next to friends.

## Check a friendship and status update

Use two accounts with usernames, no existing friendship, and no other sessions signed in as the second account.

1. Sign in as two test accounts in separate browser sessions. From **Friends**, search for the second account and choose **Add**.
2. In the second session, choose **Accept** on the request. Confirm both accounts list each other as friends.
3. Log out of the second account and sign back in. Confirm the first account sees the friend return online without reloading.

The [friends smoke](../../tools/mock/src/smoke-friends.ts) and [presence smoke](../../tools/mock/src/smoke-presence.ts) check updates at the API and WebSocket boundaries.
