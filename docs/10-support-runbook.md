# Support Runbook

Use this runbook for the most common local-only issues in Kontur Talk Live Captions. Keep the language consistent with the product UI: popup, overlay, sidebar, diagnostics, and local ASR service.

## Common Complaints

### "Captions do not start"

- Check the popup state first.
- In diagnostics, confirm the local endpoint is `localhost:8000` and health is reachable.
- If the service is missing or unreachable, ask the user to start the local ASR service and refresh the page.
- If the popup shows `checking-agent` or `reconnecting`, wait for the state to settle, then retry start.

### "Overlay is empty or stale"

- Open diagnostics and confirm the session is active and the overlay is attached to the meeting tab.
- If the transcript is present in the sidebar but not in the overlay, ask the user to stop captions, reopen the meeting tab, and start again.
- If overlay state says `unreachable`, verify the local service is still running and reconnect.

### "Browser says permission or tab-capture failed"

- Ask whether the browser granted tab capture and microphone permissions in the current profile.
- In diagnostics, look for a permission-related failure rather than a service failure.
- Recovery: reload the page, re-approve the permission prompt, and retry in the same clean Chromium profile.

### "Transcript exports are wrong or missing"

- Check the sidebar session first.
- If the session is empty, no export can be produced yet.
- If export fails, retry after the local service is reachable and the transcript has settled.
- Keep clipboard copy separate from file export when verifying the issue.

### "Reconnect keeps looping"

- In diagnostics, look for repeated reconnect attempts or a bounded reconnect budget warning.
- Recovery: stop captions, confirm the local service is healthy, then restart captions once.
- If the loop continues, capture the diagnostics state before making any more changes.

## Escalation Questions

Ask only for local evidence:

- What exact surface failed: popup, overlay, sidebar, or diagnostics?
- What does diagnostics show for health, endpoint, and session state?
- Is `localhost:8000` running on the same machine and in the same browser profile?
- Did the user change permissions, browser version, or meeting tab after the last working session?

## Escalation Rule

Escalate only after the user can share the diagnostics state and the failure still reproduces locally. Do not suggest cloud workarounds, external services, or account-side fixes.
