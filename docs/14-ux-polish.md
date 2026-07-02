# B10 UX Polish Work Packet

## Scope

This packet covers the B10 polish pass for the current UI surfaces:
- popup
- overlay
- sidebar
- settings
- onboarding and error states

Focus areas:
- caption readability
- state copy
- keyboard flow

Do not change product scope or add new surfaces.

## Caption Readability

Goal: make live captions easy to scan at a glance in the overlay and transcript surfaces.

Action items:
- Keep the overlay caption line short, with generous line height and spacing.
- Preserve strong contrast between caption text and the meeting UI behind it.
- Support density presets without making the compact option feel cramped.
- Keep partial updates stable so the text does not jitter or reflow unnecessarily.
- Make final transcript text visually distinct from partial caption updates.

Copy and layout guidance:
- Keep the title `Live captions` short and stable.
- Keep the primary overlay actions in the same position: `Pause` and `Open transcript`.
- Avoid adding decorative text or secondary labels inside the overlay body.

## State Copy

Goal: make loading, empty, error, and recovery states tell the user what to do next in one sentence.

Use the existing UI language:
- `Service ready`
- `Service missing`
- `Captions active`
- `Reconnecting`
- `No meeting detected`
- `No transcript yet`
- `No history stored`
- `Service offline`
- `Permission denied`
- `Stream failed`
- `Export failed`

Action items:
- Tighten copy in popup, sidebar, onboarding, and diagnostics so each state has one clear next step.
- Remove repeated phrasing across surfaces when the same state appears in multiple places.
- Keep failure messages specific to the missing capability or blocked action.
- Prefer explicit verbs already used in the repo: `Start`, `Pause`, `Retry`, `Export`.
- Preserve transcript data on error states and make recovery visible instead of generic.

Examples of direction:
- `Service missing` should point to the local ASR requirement and the retry path.
- `Permission denied` should say which permission is missing.
- `Stream failed` should show reconnect status and current session state.

## Keyboard Flow

Goal: reduce unnecessary clicks for core caption control flows.

Action items:
- Keep the primary action order consistent in popup and sidebar.
- Make the main actions reachable without hunting through the UI.
- Ensure shortcut labels, button labels, and command names use the same verbs.
- Keep browser shortcut conflicts handled as fallback, not as the default interaction path.
- Verify focus order in popup, overlay, sidebar, and settings after any UI copy or layout change.

Interaction rules:
- `Start` should launch the session from the primary control surface.
- `Pause` should be available without opening secondary menus.
- `Retry` should be visible in error states.
- `Export` should remain available from transcript surfaces.
- Avoid modal dialogs unless user action is required to unblock progress.

## Acceptance Criteria

- Captions remain readable across supported meeting layouts and density settings.
- State copy tells the user what happened and what to do next in one sentence.
- The same status uses the same wording across popup, overlay, sidebar, and onboarding.
- Core actions are reachable by keyboard without extra clicks or hidden controls.
- Focus order is predictable and matches the visual order on each surface.
- Error states preserve transcript/session context and expose a direct recovery action.
- No new UI surfaces or product behaviors are introduced by this polish pass.
