# Quality Gates

This document defines the B12 release gates for QA and release workers.
All three gates must pass before B12 is considered complete.

## Gate 1: Smoke Automation

Purpose: prove the core local-only flow still starts and connects.

Checks:
- Launch the extension in a clean Chromium profile.
- Confirm popup, sidebar, and overlay open without errors.
- Verify the local ASR service is reachable on `localhost:8000`.
- Start a capture session and confirm first partial and final transcript updates arrive.
- Stop and restart the session once to confirm reconnect and recovery behavior.

Acceptance criteria:
- The smoke script or checklist completes in under 5 minutes.
- Any broken startup, connection, or session flow fails the gate before merge.
- The run records the exact failure point and the affected surface.

## Gate 2: Accessibility Audit

Purpose: catch regressions in keyboard access, focus, labels, and contrast.

Checks:
- Navigate the main surfaces with keyboard only.
- Verify visible focus on interactive controls.
- Confirm labels and ARIA roles are present on popup, sidebar, overlay, and settings.
- Check caption and UI contrast against the current theme and density settings.
- Recheck error states for service-missing, permission-denied, reconnecting, and export-failed.

Acceptance criteria:
- No keyboard trap exists on any tested surface.
- All primary actions are reachable without mouse input.
- No unlabeled control, hidden focus state, or unreadable caption text is left open.
- Any known accessibility issue is documented with a specific owner and follow-up task.

## Gate 3: Long-Session Stress

Purpose: confirm sustained capture remains stable over extended use.

Checks:
- Run a continuous capture session for the agreed long-session window.
- Watch memory growth, storage growth, and transcript update consistency during the run.
- Confirm partial and final transcript ordering stays deterministic after extended use.
- Force a reconnect once during the session and verify recovery does not lose the session.
- Confirm export or transcript persistence still works after the run.

Acceptance criteria:
- The session completes without crash, hang, or unrecovered disconnect.
- Memory growth stays within the expected envelope for the test window.
- No transcript drift, data loss, or storage corruption is observed.
- The final report includes the session length, reconnect result, and any anomalies.

## Release Rule

B12 can move forward only when:
- smoke automation passes,
- accessibility audit passes or has only explicitly tracked non-blockers,
- long-session stress passes.

If any gate fails, stop the release worker and file the exact repro, scope, and owner before retrying.
