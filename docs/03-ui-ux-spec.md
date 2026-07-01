# UI and UX Specification

## Design Rules

- Prioritize legibility over visual decoration.
- Use short copy and predictable labels.
- Show state clearly before showing content.
- Never hide connection problems behind generic errors.

## Overlay

Purpose: display live captions without breaking meeting focus.

```text
┌───────────────────────────────┐
│ Live captions                 │
│                               │
│ We should ship the first      │
│ version this week.            │
│                               │
│ [Pause] [Open transcript]     │
└───────────────────────────────┘
```

Behavior:
- Always pinned above the meeting UI.
- Updates on partial transcript events.
- Collapses to a compact chip when idle.

## Sidebar

Purpose: review transcript history and export content.

```text
┌───────────────────────────────┐
│ Transcript                    │
│ Today 10:32 - 11:14           │
│                               │
│ 10:41 Decision recorded ...   │
│ 10:43 Action item ...         │
│                               │
│ [Copy] [TXT] [Markdown]       │
└───────────────────────────────┘
```

## Popup

Purpose: quick status and start/stop control.

States:
- Service ready
- Service missing
- Captions active
- Reconnecting

## Settings

Include:
- Capture source
- Caption density
- Overlay position
- Export format defaults
- History retention

## Onboarding

Steps:
1. Explain local-only processing.
2. Check browser permissions.
3. Verify local ASR service.
4. Start first caption session.

## Agent Detection

Show a clear status row:
- Kontur Talk tab detected
- Local service available
- Audio capture ready
- Mic or tab capture denied

## Error States

- Service offline: show localhost status and retry action.
- Permission denied: explain which permission is missing.
- Stream failed: show reconnect timer and current session state.
- Export failed: preserve transcript and allow retry.

## Empty States

- No meeting detected.
- No transcript yet.
- No history stored.

## Loading States

- Detecting meeting.
- Connecting to local service.
- Starting audio capture.
- Waiting for first partial transcript.

## Interaction Notes

- Keep primary actions in the same visual position.
- Use explicit verbs: Start, Pause, Retry, Export.
- Avoid modal dialogs unless user action is required to unblock progress.

