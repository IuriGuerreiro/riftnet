# Calls and screen sharing

In a direct message, choose **Call**. The recipient can accept or decline the incoming call. During a call, the controls include mute, **Share screen**, and **Hang up**.

## Check a two-person call

[Start the media service](../architecture/calls.md#how-to-run) and use two accounts with an existing DM. Use browsers with microphone access and screen capture support.

1. Use two browser sessions with microphone access. Open the same DM in both.
2. Choose **Call** in the first session and **Accept** in the second. Speak on each side and confirm the other side hears you.
3. Choose **Share screen** and pick a window in the browser prompt. Confirm the other session shows that window and stops showing it when you stop sharing.
4. Choose **Hang up**. Confirm both sessions leave the call and audio stops.

The [voice smoke](../../scripts/smoke-calls.sh) checks audio flow through the running stack. The journey above also checks the rendered controls and screen sharing.
