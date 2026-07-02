# Smoke Checklist

Use this checklist before a release. One engineer should be able to complete it in under 10 minutes on a clean Chromium profile.

## Prerequisites

- Extension installed and enabled.
- Local ASR service available at `localhost:8000` for the main pass.
- A supported Kontur Talk meeting page open in a tab.
- Browser shortcuts and permissions already granted for the test profile.

## Smoke Steps

### 1. Popup

- Open the extension popup.
- **Pass:** popup shows the current agent-detected / ready state, and the primary action is enabled when the service is reachable.
- **Fail:** popup is blank, stale, or shows the wrong readiness state.

### 2. Overlay

- Start captions from the popup and confirm the overlay appears in the meeting tab.
- **Pass:** overlay renders with readable text, visible state copy, and no clipping.
- **Fail:** overlay does not mount, is unreadable, or blocks the meeting UI.

### 3. Sidebar

- Open the transcript sidebar and verify the current session is visible.
- **Pass:** sidebar shows transcript content or an explicit empty state, and export actions are available.
- **Fail:** sidebar fails to open, loses the session, or shows broken layout.

### 4. Diagnostics with local ASR available

- Open diagnostics while the local service is running.
- **Pass:** health is reported as reachable, the local endpoint is shown, and the session can start or reconnect.
- **Fail:** diagnostics report an error when the service is actually reachable.

### 5. Diagnostics with local ASR missing

- Stop the local service and refresh diagnostics.
- **Pass:** diagnostics report the service as missing or unreachable, and the recovery hint points to the local ASR setup path.
- **Fail:** the app pretends the service is ready or gives no recovery guidance.

### 6. End-to-end closeout

- Stop captions and reopen the popup once.
- **Pass:** the session state settles cleanly, and no surface shows a crash, spinner loop, or stale reconnect state.
- **Fail:** any surface stays stuck, crashes, or reports an inconsistent session.

## Release Result

- **Green:** all steps pass in both the available and missing ASR scenarios.
- **Red:** any single fail blocks the release until the failure is understood and documented.
