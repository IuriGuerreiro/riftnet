# Messaging and group DMs

Open a direct message with **DM** in a friend's row. To start a group, enter a group name and friends' usernames in the sidebar, then choose **Group**. The group header shows its members and a limit of five.

## Check messages and group membership

Prepare three accounts, with the group creator already friends with the other two.

1. Open a DM between two test accounts. Send a message and confirm the other account receives it without reloading.
2. Edit the message, then delete it. Confirm the recipient sees the edit and then sees the message disappear.
3. With three accounts, create a group after the creator has friended both recipients. Confirm all three see the group and can read a message sent to it.
4. Rename the group from its header. Confirm another member sees the new name. Have that member choose **Leave** and confirm the group disappears from their sidebar.

The [WebSocket smoke](../../tools/mock/src/smoke-ws.ts) covers the direct message protocol. The group journey checks behavior through the client.
