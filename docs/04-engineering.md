# Engineering Specification

## Coding Standards

- Use small, single-purpose modules.
- Prefer explicit names over clever abstractions.
- Keep browser, adapter, and transport logic separate.
- Document non-obvious protocol or state transitions in code comments.

## Folder Structure

Recommended layout:

```text
src/
  extension/
    popup/
    sidebar/
    overlay/
    content/
    service-worker/
  adapter/
  asr/
  storage/
  shared/
assets/
docs/
```

## Backend Contracts

- The local ASR service must expose health and session endpoints.
- HTTP and WebSocket clients must reject non-local endpoints and stay on `localhost:8000`.
- Responses should distinguish partial and final transcript messages.
- Failures must include a stable code and a human-readable reason.

## Frontend Contracts

- UI code must not depend on internal ASR implementation details.
- All state changes should flow through typed messages or events.
- Transcription rendering must tolerate duplicate or out-of-order updates.

## Testing Strategy

- Unit test transcript parsing, message routing, and storage helpers.
- Integration test reconnect logic and export generation.
- Smoke test extension startup, tab detection, and localhost connectivity.
- Add regression tests for every user-visible error state.

## Release Process

1. Update docs if behavior changes.
2. Run the relevant test suite.
3. Validate the extension in Chromium.
4. Verify the local ASR connection.
5. Package and tag the release.

## Parallel Agent Workflow

- Keep one owner per document section.
- Make shared contracts explicit before starting parallel implementation work.
- Prefer short-lived tasks with a single file target.
- Use the backlog as the source of truth for assignment and dependency ordering.
- Hand off any contract change to the coordinator before other agents build on it.

## Telemetry

Default position: no telemetry. If telemetry is ever added, it must be opt-in, local-policy compliant, and documented in the product spec.

## Packaging

- Keep extension packaging reproducible.
- Separate source files from generated bundles.
- Version the package alongside the release tag.
- Record the minimum browser version and local ASR version in release notes.

## Definition of Done

- Feature matches the product spec.
- UI states are documented and tested.
- Failure handling is deterministic.
- Export paths are verified.
- No undocumented dependency on external cloud services.
