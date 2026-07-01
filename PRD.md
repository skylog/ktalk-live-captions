# PRD --- Kontur Talk Live Transcript

## Vision

Deliver Google Meet--like live captions for Kontur Talk while keeping
**all speech processing local**.

## Problem Statement

Kontur Talk does not provide native live captions or a searchable
transcript. Users who join meetings late, have poor audio quality, or
need accessibility support lose context and cannot quickly review
discussions.

## Goals

-   Live captions with \<1s latency
-   Local-only processing
-   Zero cloud dependency
-   Simple installation
-   Familiar UX

## Personas

-   Engineer attending daily standups
-   Product Manager taking meeting notes
-   User with hearing difficulties

## User Stories

-   Join late and immediately understand the discussion.
-   Read captions when audio quality is poor.
-   Export the transcript after a meeting.
-   Trust that audio never leaves the device.

## MVP Scope

### Included

-   Chrome/Edge extension
-   Live captions overlay
-   Transcript sidebar
-   WhisperLiveKit integration
-   TXT/Markdown export

### Excluded

-   Translation
-   AI summaries
-   Speaker diarization

## Success Metrics

-   Install \<5 minutes
-   Caption latency \<1 second
-   2-hour meeting stability
-   No cloud connectivity required
