---
name: verify-adept
description: Drive Adept against a local test stack, starting with the auth API smoke. Use the feature map for web journeys and expected results.
---

# Verify Adept

Use the [feature map](../../../docs/features/README.md) to select the journey that matches the change. Use the [project idea](../../../docs/product/README.md) for goals and planned work.

## Launch

From the repository root, build the API and run the auth helper:

```sh
cargo build --locked -p api
.agents/skills/verify-adept/auth-smoke.sh
```

Optional command arguments run after the auth smoke, from the repository root with
`API_HTTP` set to the verification API. For example, run
`VERIFY_RATE_LIMITS=off .agents/skills/verify-adept/auth-smoke.sh pnpm --filter mock smoke:activity`.
Disable rate limits only when provisioning extra fixture accounts would exceed the
auth smoke's signup quota. The default remains on.

The helper needs Docker Compose, Bash, curl, Python 3, and the Linux tools `ss` and `flock`. It starts a fresh Compose project with local test data, uses a temporary signing key, and runs the API on port 17100. Run one helper at a time on the host. Its other ports are 15432, 19042, 14222, 18222, 16379, 17102, 17106, and 17107. Use the local test stack only. If you build with `CARGO_TARGET_DIR`, pass the same value to the helper.

## Doctor

Before driving auth, the helper waits for the Zitadel service token, checks the Zitadel readiness endpoint, and runs a read-only CQL query against Scylla. It checks that the API process it started is alive and that `/health` responds. The health response goes to `doctor.log`. If startup or the smoke fails, inspect the saved logs before retrying with a fresh stack.

For web journeys, use the [local setup](../../../README.md#quick-start). Start the real API and launch the client without the mock API. For a custom API port, set both `VITE_API_HTTP` and `VITE_API_WS` before launching the client. Confirm the test account can sign in and that the client shows the conversation sidebar before you start. Use separate browser sessions for separate accounts.

## Drive

The helper runs [the auth smoke](../../../scripts/smoke-auth.sh) over HTTP. Look for the success line after the refresh-after-logout check. The [auth feature page](../../../docs/features/auth.md) has a separate journey through the login screen. Use the other feature pages for manual web journeys.

## Evidence

The auth helper prints its evidence directory. Check `auth.log` for the observed results and use `setup.log`, `doctor.log`, and `api.log` to diagnose failures. For web journeys, capture the action and the result in each relevant session. Record the commit, feature, and last step reached. Keep logs and captures outside the working tree.

## Cleanup

The helper stops its API and removes only its own Compose project, volumes, and temporary secrets. Evidence stays in the printed directory. For manual runs, close only the test sessions you opened and shut down only the processes or stack you started. Check that evidence still exists after teardown.
