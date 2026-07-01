# Backlog

This backlog is organized for direct import into Jira-style planning. Each story includes discrete tasks and an acceptance criterion.

## Parallel Execution Map

- Lane A: Product and acceptance criteria (`B1`, `B8`)
- Lane B: Architecture and contracts (`B2`, `B3`)
- Lane C: UI and UX surfaces (`B5`)
- Lane D: Storage, transcript, and installer flows (`B4`, `B6`)
- Lane E: Engineering, security, and QA (`B7`)

Rules:
- `B1` is the main dependency gate.
- `B2`, `B3`, `B4`, `B5`, `B6`, `B7`, and `B8` can run in parallel once shared terminology is stable.
- Tasks that touch the same file should be assigned to one agent at a time.

## EPIC B1 - Foundation

### B1-01 - Repo skeleton
- Task: Create the base directory layout.
- Task: Add the documentation index.
- Acceptance Criteria: New contributors can find product, architecture, UI, and engineering docs from one place.

### B1-02 - Tooling baseline
- Task: Choose the package manager and lockfile strategy.
- Task: Add format and lint scripts.
- Acceptance Criteria: Build and validation commands are reproducible on a clean checkout.

### B1-03 - Manifest baseline
- Task: Create an MV3 manifest skeleton.
- Task: Register the service worker and permissions.
- Acceptance Criteria: The extension loads without warnings in Chromium.

### B1-04 - Shared types
- Task: Define shared session and transcript types.
- Task: Define message enums for UI and transport events.
- Acceptance Criteria: Frontend and adapter code compile against the same contracts.

### B1-05 - Health check contract
- Task: Specify the local service health endpoint.
- Task: Document expected failure codes.
- Acceptance Criteria: The extension can determine readiness before capture starts.

### B1-06 - Storage baseline
- Task: Define transcript and session storage keys.
- Task: Implement safe read/write helpers.
- Acceptance Criteria: Storage operations are deterministic and isolated.

### B1-07 - Logging baseline
- Task: Define console log format and log levels.
- Task: Add session-scoped identifiers.
- Acceptance Criteria: Debugging one meeting does not require tracing unrelated noise.

### B1-08 - Error model
- Task: Enumerate user-facing error codes.
- Task: Map each code to recovery guidance.
- Acceptance Criteria: Every failure state has a clear user message and next action.

### B1-09 - Documentation templates
- Task: Define templates for product, architecture, and UI specs.
- Task: Add naming rules for future documents.
- Acceptance Criteria: New docs follow the same structure and tone.

### B1-10 - Dependency policy
- Task: Record supported runtime and browser versions.
- Task: Define how dependency upgrades are approved.
- Acceptance Criteria: Version support is explicit and easy to maintain.

## EPIC B2 - Extension Core

### B2-01 - Popup shell
- Task: Build the popup layout.
- Task: Show service and session status.
- Acceptance Criteria: Popup opens and reflects current app state.

### B2-02 - Service worker lifecycle
- Task: Initialize background messaging.
- Task: Handle restart and reconnect events.
- Acceptance Criteria: Session state survives worker restarts where possible.

### B2-03 - Content script injection
- Task: Inject the content script on Kontur Talk pages.
- Task: Detect meeting surfaces.
- Acceptance Criteria: Meeting detection works on supported page variants.

### B2-04 - Overlay host
- Task: Mount the overlay root.
- Task: Keep the overlay isolated from page styles.
- Acceptance Criteria: Overlay renders consistently across meetings.

### B2-05 - Sidebar shell
- Task: Build the transcript sidebar container.
- Task: Wire the sidebar open and close actions.
- Acceptance Criteria: Sidebar can be opened without losing session state.

### B2-06 - Message bus
- Task: Define UI-to-worker message routing.
- Task: Add validation for every message type.
- Acceptance Criteria: Invalid messages fail safely and predictably.

### B2-07 - Permission handling
- Task: Detect missing permissions.
- Task: Present actionable permission recovery steps.
- Acceptance Criteria: The user understands what to grant and why.

### B2-08 - Tab state detection
- Task: Detect active Kontur Talk tabs.
- Task: Surface agent-detected and inactive states.
- Acceptance Criteria: UI clearly shows whether captions can start.

### B2-09 - Keyboard shortcuts
- Task: Add shortcuts for start, pause, and open transcript.
- Task: Document shortcut conflicts and fallback behavior.
- Acceptance Criteria: Keyboard control works without breaking page shortcuts.

### B2-10 - Overlay theming
- Task: Apply a stable visual theme to the overlay shell.
- Task: Keep the overlay readable across meeting page backgrounds.
- Acceptance Criteria: Captions remain legible in all supported layouts.

## EPIC B3 - Audio and ASR Transport

### B3-01 - Capture pipeline
- Task: Wire browser audio capture to PCM buffers.
- Task: Normalize sample rate and channels.
- Acceptance Criteria: Captured audio is suitable for the local ASR service.

### B3-02 - Session start
- Task: Send session metadata before audio chunks.
- Task: Add session identifiers to every request.
- Acceptance Criteria: WhisperLiveKit can correlate audio with the correct meeting.

### B3-03 - Chunk streaming
- Task: Stream audio chunks over WebSocket.
- Task: Backpressure the queue when the socket slows down.
- Acceptance Criteria: Audio streaming stays stable under normal meeting load.

### B3-04 - Partial transcript handling
- Task: Parse partial transcript messages.
- Task: Update overlay text incrementally.
- Acceptance Criteria: Caption text appears before the final sentence is complete.

### B3-05 - Final transcript handling
- Task: Persist final segment records.
- Task: Remove duplicates when partials resolve into finals.
- Acceptance Criteria: Final transcript output is ordered and clean.

### B3-06 - Reconnect logic
- Task: Detect disconnects and retry with bounds.
- Task: Restore the active session after reconnect.
- Acceptance Criteria: Temporary service interruption does not lose the entire meeting.

### B3-07 - Health probe
- Task: Add a local service probe before capture starts.
- Task: Fail fast when the endpoint is unreachable.
- Acceptance Criteria: Users see a service error before they start talking.

### B3-08 - Session shutdown
- Task: Close the WebSocket cleanly.
- Task: Flush final transcript state on stop.
- Acceptance Criteria: Ending a meeting does not drop the last captions.

### B3-09 - Audio source selection
- Task: Support the active tab as the primary source.
- Task: Document behavior when the source cannot be captured.
- Acceptance Criteria: Users know which capture mode is active.

### B3-10 - Chunk sizing
- Task: Choose the audio chunk duration for streaming.
- Task: Verify the choice against latency and stability targets.
- Acceptance Criteria: Chunk size does not create visible caption lag.

## EPIC B4 - Transcript and Storage

### B4-01 - Transcript store
- Task: Implement a session transcript store.
- Task: Add lookup by meeting and timestamp.
- Acceptance Criteria: Transcript data can be retrieved for the active session.

### B4-02 - Segment model
- Task: Define segment fields.
- Task: Support partial and final segment states.
- Acceptance Criteria: The UI can render a stable transcript timeline.

### B4-03 - History list
- Task: Show past sessions in the sidebar.
- Task: Limit the list to the configured retention window.
- Acceptance Criteria: Users can revisit recent meetings without manual cleanup.

### B4-04 - Copy action
- Task: Copy transcript text to clipboard.
- Task: Preserve paragraph breaks and timestamps.
- Acceptance Criteria: Clipboard output is usable in notes and chat apps.

### B4-05 - TXT export
- Task: Generate a plain-text export.
- Task: Include meeting metadata in the header.
- Acceptance Criteria: Exported TXT is readable and complete.

### B4-06 - Markdown export
- Task: Generate a Markdown export.
- Task: Keep headings and timestamps stable.
- Acceptance Criteria: Exported Markdown works in common note tools.

### B4-07 - Retention policy
- Task: Add transcript cleanup rules.
- Task: Document the retention default.
- Acceptance Criteria: Stored data does not grow without explicit control.

### B4-08 - Empty history state
- Task: Show a no-history message.
- Task: Offer a clear first-run action.
- Acceptance Criteria: New users understand that no transcripts exist yet.

### B4-09 - Deduplication
- Task: Prevent duplicate final segments from being stored.
- Task: Merge resolved partials into a single final line.
- Acceptance Criteria: Transcript history reads cleanly without repeated lines.

### B4-10 - Export metadata
- Task: Add meeting date, duration, and source metadata to exports.
- Task: Keep metadata formatting consistent across TXT and Markdown.
- Acceptance Criteria: Exported files are useful without extra manual context.

## EPIC B5 - UI and UX

### B5-01 - Overlay state machine
- Task: Render idle, listening, and reconnecting overlay states.
- Task: Animate state transitions without blocking capture.
- Acceptance Criteria: The overlay explains what the system is doing.

### B5-02 - Overlay controls
- Task: Add pause/resume actions.
- Task: Add open transcript action.
- Acceptance Criteria: Users can control captions without leaving the meeting.

### B5-03 - Sidebar content
- Task: Render transcript segments.
- Task: Support scroll-to-latest behavior.
- Acceptance Criteria: The latest transcript is easy to inspect.

### B5-04 - Popup content
- Task: Show current status and service health.
- Task: Add a primary start button.
- Acceptance Criteria: The popup is a reliable control surface.

### B5-05 - Settings surface
- Task: Add caption density and overlay position controls.
- Task: Add export preference controls.
- Acceptance Criteria: Settings changes persist across sessions.

### B5-06 - Loading states
- Task: Add visual states for startup and reconnect.
- Task: Keep copy short and explicit.
- Acceptance Criteria: Users understand why captions are not yet visible.

### B5-07 - Error states
- Task: Design service, permission, and export failures.
- Task: Provide retry and recovery actions.
- Acceptance Criteria: Errors always include a next step.

### B5-08 - Empty states
- Task: Design no-meeting, no-captions, and no-history states.
- Task: Keep empty screens helpful rather than blank.
- Acceptance Criteria: Every empty state guides the user forward.

### B5-09 - Responsive layout
- Task: Verify overlay and sidebar sizing on common browser widths.
- Task: Prevent clipping on smaller windows.
- Acceptance Criteria: The UI remains usable in constrained layouts.

### B5-10 - Accessibility pass
- Task: Check color contrast and focus states.
- Task: Add screen-reader labels for key actions.
- Acceptance Criteria: Primary surfaces are usable with accessibility tooling.

## EPIC B6 - Installer and Onboarding

### B6-01 - First-run flow
- Task: Explain the local-only model.
- Task: Walk the user through the first session.
- Acceptance Criteria: A new user understands setup without external docs.

### B6-02 - Agent detection
- Task: Detect whether the local service is available.
- Task: Surface a clear readiness result.
- Acceptance Criteria: The product can start only when prerequisites are met.

### B6-03 - Permissions onboarding
- Task: Request capture permissions in context.
- Task: Explain why each permission is required.
- Acceptance Criteria: Permission prompts are understandable and recoverable.

### B6-04 - Service installation guidance
- Task: Detect a missing ASR service.
- Task: Link to the installation steps or local fix path.
- Acceptance Criteria: Users know how to unblock the app.

### B6-05 - Diagnostic screen
- Task: Add a connection diagnostics view.
- Task: Show current health, version, and last error.
- Acceptance Criteria: Support can diagnose startup problems quickly.

### B6-06 - Browser support checks
- Task: Detect unsupported browser versions.
- Task: Block unsupported combinations with a clear message.
- Acceptance Criteria: Unsupported environments fail early and visibly.

### B6-07 - Onboarding completion
- Task: Mark onboarding as completed locally.
- Task: Allow rerun from settings.
- Acceptance Criteria: Users can revisit onboarding if they need a refresher.

### B6-08 - Recovery flow
- Task: Guide users back from failed setup.
- Task: Preserve partial configuration when retries happen.
- Acceptance Criteria: Setup issues do not force a full reset.

### B6-09 - Local service discovery
- Task: Detect the ASR service on the expected localhost port.
- Task: Support clear messaging when the port differs.
- Acceptance Criteria: Users can see whether discovery succeeded or failed.

### B6-10 - Update prompt
- Task: Detect when the extension version is outdated.
- Task: Show a simple path to reinstall or refresh.
- Acceptance Criteria: Users can recover from stale installs without support.

## EPIC B7 - Security, Performance, Observability

### B7-01 - Permission minimization
- Task: Remove any unused extension permissions.
- Task: Document every required permission.
- Acceptance Criteria: The extension requests only what it uses.

### B7-02 - Local-only enforcement
- Task: Restrict transport to localhost endpoints.
- Task: Reject accidental external destinations.
- Acceptance Criteria: Audio cannot be routed to cloud services by mistake.

### B7-03 - Latency monitoring
- Task: Measure capture-to-caption delay.
- Task: Store latency in local debug logs.
- Acceptance Criteria: Performance regressions are visible in development.

### B7-04 - Reconnect budget
- Task: Set retry limits and backoff.
- Task: Show retry status to the user.
- Acceptance Criteria: Retry behavior is bounded and explainable.

### B7-05 - Long-meeting stability
- Task: Test sustained capture for long sessions.
- Task: Check memory growth and buffer cleanup.
- Acceptance Criteria: A two-hour meeting remains usable.

### B7-06 - Failure isolation
- Task: Ensure UI errors do not crash transport.
- Task: Ensure transport errors do not break settings.
- Acceptance Criteria: One failing surface does not take down the app.

### B7-07 - Debug visibility
- Task: Add traceable session identifiers.
- Task: Add a concise diagnostics export for support.
- Acceptance Criteria: Developers can reconstruct a failing session locally.

### B7-08 - No telemetry default
- Task: Verify no analytics calls exist.
- Task: Document the no-telemetry decision.
- Acceptance Criteria: The product ships without hidden data collection.

### B7-09 - Performance budget
- Task: Define CPU and memory targets for long meetings.
- Task: Add a budget check to the QA checklist.
- Acceptance Criteria: Releases can be judged against explicit limits.

### B7-10 - Crash isolation
- Task: Ensure a failed transcript render does not crash capture.
- Task: Ensure a failed reconnect does not freeze the popup.
- Acceptance Criteria: One component failure does not cascade across the app.

## EPIC B8 - Release and QA

### B8-01 - Smoke tests
- Task: Verify popup, overlay, and sidebar launch paths.
- Task: Verify startup against a local ASR service.
- Acceptance Criteria: Core flows pass before every release.

### B8-02 - Regression suite
- Task: Add tests for reconnect, export, and error handling.
- Task: Add tests for transcript ordering.
- Acceptance Criteria: Known failure modes are covered by automation.

### B8-03 - Packaging
- Task: Package the extension reproducibly.
- Task: Record the build version and manifest version.
- Acceptance Criteria: Release artifacts are traceable to source.

### B8-04 - Release notes
- Task: Summarize behavior changes and fixes.
- Task: List any new permissions or prerequisites.
- Acceptance Criteria: Users can review what changed before upgrading.

### B8-05 - Manual QA checklist
- Task: Create a checklist for browser, overlay, and export flows.
- Task: Include service down and permission denied cases.
- Acceptance Criteria: QA can validate the product without guesswork.

### B8-06 - Support runbook
- Task: Document common failure modes and fixes.
- Task: Map user complaints to known diagnostics.
- Acceptance Criteria: Support can resolve most issues without engineering escalation.

### B8-07 - Versioning
- Task: Define semantic version rules for the extension and adapter.
- Task: Align release tags with docs and package versions.
- Acceptance Criteria: Version numbers mean the same thing across artifacts.

### B8-08 - Post-release verification
- Task: Confirm install, start, and export in a clean environment.
- Task: Record any release regressions in the backlog.
- Acceptance Criteria: Every release gets a real-world sanity check.

### B8-09 - CI checks
- Task: Add automated validation for docs and packaging changes.
- Task: Fail the pipeline on missing manifest or contract files.
- Acceptance Criteria: Broken release inputs are caught before tagging.

### B8-10 - Rollback path
- Task: Define how to revert a bad extension release.
- Task: Document the rollback communication steps.
- Acceptance Criteria: A broken release can be withdrawn quickly and clearly.
