# Accounts and sessions

The login screen lets you sign in or create an account. New accounts choose a username before entering the app.

## Check registration and logout

Use a fresh test email and a local app instance connected to the real API.

1. On the login screen, choose **No account? Register**. Register with a fresh test email.
2. Enter a username and choose **Continue**. Confirm the app opens and shows your account in the sidebar.
3. Log out. Confirm the app returns to the login screen.
4. Try signing in with the wrong password. Confirm the app shows an error. Sign in with the correct password and confirm the app opens without asking for a username again.

## API smoke

The [auth smoke](../../scripts/smoke-auth.sh) checks API behavior, including user search, refresh token rotation, and refresh rejection after logout. The UI journey covers navigation and messages on screen.

The default smoke passed on a fresh local stack on 2026-11-19. The optional delayed refresh reuse check and the web journey are pending.
