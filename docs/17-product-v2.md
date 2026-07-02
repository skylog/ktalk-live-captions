# Product V2

## Purpose

Product V2 extends the local captioning experience beyond live display and basic export. The focus is on making prior transcripts easier to find, making exports more useful downstream, and allowing additional capture sources without weakening the local-only model.

## Themes

### Transcript Search

- Search across saved session transcripts and captions.
- Support fast, deterministic results from local data only.
- Make it easy to jump from a result to the matching session and segment.

### Export Expansion

- Keep TXT export as the baseline format.
- Add richer export options with metadata and timestamps.
- Preserve simple copy/export flows for users who only need plain text.

### Multi-Source Capture

- Add new capture sources in a way that is explicit in the UI.
- Keep the current browser-meeting capture path intact.
- Make source selection and source status visible to the user.

## Scope Limits

- Local-only remains the default and required model.
- No cloud sync, remote indexing, or external search service.
- No AI summaries, translation, or speaker diarization in this scope.
- Search and export should operate on stored local session data only.
- New capture sources must be additive, not a rewrite of the current capture path.

## Acceptance Criteria

- A user can search past transcripts and find a matching session without manually opening every session.
- Search results return quickly enough for practical use in a normal session history.
- Export includes at least one richer format beyond plain text, with timestamps and basic metadata preserved.
- Plain-text export still works as the fallback baseline.
- The UI clearly shows which capture source is active before and during capture.
- Adding another source does not break the existing local browser capture flow.
- All new behavior remains deterministic and local-only.

## Backlog Notes

- Transcript search should decompose into indexing, query behavior, result presentation, and navigation.
- Export expansion should decompose into format definition, metadata fields, and file generation.
- Multi-source capture should decompose into source detection, UI selection, and capture routing.
