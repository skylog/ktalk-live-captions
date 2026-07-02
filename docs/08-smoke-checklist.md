# Smoke Checklist

Run this before merge or release. One developer should be able to finish it on a clean Chromium profile in under 10 minutes.

## Prerequisites

- Extension installed and enabled in the test profile.
- Local ASR service reachable at `localhost:8000`.
- A supported Kontur Talk meeting tab is open.
- Browser permissions and shortcuts are already granted.

## Checks

1. Popup readiness
- Open the popup.
- Pass: the popup shows the current detected/ready state, and the main action is enabled only when the service is reachable.
- Fail: blank UI, stale state, or a ready indicator that does not match the service.

2. Overlay mount
- Start captions from the popup.
- Pass: the overlay appears in the meeting tab, text is readable, and state copy is visible.
- Fail: overlay missing, clipped, unreadable, or blocking the meeting UI.

3. Sidebar session
- Open the transcript sidebar.
- Pass: the current session is shown, or an explicit empty state appears with export actions available.
- Fail: sidebar does not open, drops the session, or renders broken layout.

4. Live diagnostics
- Check diagnostics with `localhost:8000` up.
- Pass: health is reachable, the local endpoint is shown, and start/reconnect is available.
- Fail: diagnostics report an error while the service is healthy.

5. Missing service
- Stop the local service and refresh diagnostics.
- Pass: the UI reports the service as missing or unreachable and points to the local setup path.
- Fail: the app still claims the service is ready or gives no recovery hint.

6. Closeout
- Stop captions and reopen the popup once.
- Pass: state settles cleanly with no crash, spinner loop, or stale reconnect state.
- Fail: any surface remains inconsistent after shutdown.

## Release Rule

- Any single fail blocks release until the issue is documented and understood.
- Record the surface, state, exact text, screenshot, and build SHA for every fail.
