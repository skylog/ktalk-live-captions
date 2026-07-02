# Manual Regression Coverage

Use this checklist in a clean Chromium profile with the extension installed, the popup available, and the local ASR service expected on `localhost:8000`. Run the cases in order and return the app to a known-good state before moving to the next one.

## Checklist

### 1. Service missing

- Trigger: stop WhisperLiveKit or make `localhost:8000` unavailable.
- Verify: the installer reports a missing local service and the popup shows the service as not reachable.
- Recovery action: **start WhisperLiveKit on this machine, confirm `localhost:8000` is free, then retry discovery or refresh the popup.**
- Pass: onboarding, popup, and installer all return to a ready state.

### 2. Permission denied

- Trigger: revoke tab-capture or microphone access in the current browser profile.
- Verify: onboarding shows the permission warning and lists the missing access.
- Recovery action: **reload the extension, accept the prompt, and try the readiness check again.**
- Pass: onboarding reports the required permissions as ready.

### 3. Reconnect

- Trigger: interrupt the local service while captions are active.
- Verify: popup, overlay, or diagnostics show a reconnecting or degraded state.
- Recovery action: **wait for the local service to recover, then refresh diagnostics; if the popup is blocked, stop captions, confirm the service is healthy, and restart captions once.**
- Pass: the session recovers without losing the active transcript.

### 4. Export failure

- Trigger: request TXT or Markdown export before the transcript has settled, or while the local service is still recovering.
- Verify: the sidebar export flow fails while clipboard copy remains separate.
- Recovery action: **retry after the local service is reachable and the transcript has settled.**
- Pass: TXT and Markdown export complete with session metadata intact.

## Notes

- Keep file export and clipboard copy separate when validating failures.
- Use the exact recovery wording above when writing bug reports or support notes.
- If a case passes only after a page reload, repeat it once more to confirm the recovery is repeatable.
