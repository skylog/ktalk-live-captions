# Product Specification

## Vision

Kontur Talk Live Captions provides Google Meet-like live captions for Kontur Talk while keeping all speech processing local. The product must be simple to install, fast to start, and reliable enough for long meetings.

## Problem Statement

Users lose context when they join late, miss words because of poor audio, or need a searchable record after a meeting. Existing meeting tools do not give a local-only captioning flow that works inside the browser with low latency.

## Personas

- Engineer in daily standups: needs fast comprehension and quick review of action items.
- Product manager: needs a transcript for notes, decisions, and follow-ups.
- Accessibility user: needs captions to understand speech in real time.

## User Stories

- Join a meeting and see captions within one second.
- Detect when audio is unavailable and show a clear recovery path.
- Open a transcript sidebar and copy or export the output.
- Trust that audio never leaves the device.

## User Flows

1. Install extension.
2. Open Kontur Talk in the browser.
3. Detect meeting state and local ASR availability.
4. Capture audio and stream PCM to `localhost:8000/asr`.
5. Render partial captions immediately.
6. Persist final transcript segments.
7. Export TXT or Markdown after the meeting.

## UX Flows

- First run: install -> detect local service -> explain permissions -> start captions.
- In-meeting: start listening -> show overlay -> update partial text -> surface reconnect state if needed.
- Post-meeting: open sidebar -> review transcript -> copy/export -> clear session data when finished.

## Acceptance Criteria

- Captions appear during a live meeting with no manual refresh.
- The product works without cloud transcription services.
- Users can recover from service downtime, audio denial, and reconnect loops.
- Exported transcripts preserve timestamps and segment order.

## MVP Scope

### Included

- Chrome/Edge extension
- Overlay captions
- Transcript sidebar
- WhisperLiveKit integration
- TXT and Markdown export

### Excluded

- Translation
- AI summaries
- Speaker diarization
- Cloud sync

## V2 Roadmap

- Better transcript search and filtering
- Speaker labeling if local metadata becomes available
- Meeting summaries if explicitly added later
- More robust installer and diagnostics
- Keyboard shortcuts and power-user controls

## Product Principles

- Local first.
- Low friction.
- Transparent failure states.
- Minimal setup.
- Deterministic behavior over speculative automation.

